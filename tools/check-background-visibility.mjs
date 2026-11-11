#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const CHECK = 'background-visibility-check';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ?? null;
const binary = target === null ? null : resolve(target);
if (binary === null || (!existsSync(binary))) {
  console.error(`${CHECK}: usage: node tools/check-background-visibility.mjs <path-to-native-binary | node>`);
  process.exit(2);
}
const lead = ['serve'];
const REPLY_MS = 120000;
const BODY_MS = 4000;
const WAIT_MS = 20000;
const UNDER_MS = 15000;

const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
const started = Date.now();
const scratch = mkdtempSync(join(tmpdir(), 'gm-background-visibility-'));

try {
  const workspace = mkdtempSync(join(scratch, 'ws-'));
  writeFileSync(join(workspace, 'README.md'), 'x\n');
  const quiet = join(scratch, 'quiet-mcp.json');
  writeFileSync(quiet, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
  const child = spawn(binary, [...lead, '--workspace', workspace, '--run-dir', join(workspace, 'run'), '--mcp-config', quiet], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.on('error', () => {});
  const pending = new Map();
  child.once('exit', () => {
    for (const done of pending.values()) done(null);
    pending.clear();
  });
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  let nextId = 1;
  const rpc = (method, params) =>
    new Promise((done) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        done(null);
      }, REPLY_MS);
      pending.set(id, (message) => {
        clearTimeout(timer);
        done(message);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  const tool = async (name, args) => (await rpc('tools/call', { name, arguments: args }))?.result?.structuredContent ?? {};
  try {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CHECK, version: '1' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
    await tool('next_context', {});
    const bodyStarted = Date.now();
    const background = await tool('run_code', { body: `await new Promise((r) => setTimeout(r, ${BODY_MS})); return "slow-done";`, timeoutMs: 1000 });
    const job = background.job ?? background.background;
    expect(typeof job === 'string' && job.length > 0, `run_code did not return a background job: ${JSON.stringify(background).slice(0, 300)}`);
    if (typeof job === 'string') {
      const during = await tool('next_context', { full: true });
      expect(JSON.stringify(during).includes(job), `next_context while the body runs does not name ${job}: ${JSON.stringify(during).slice(0, 300)}`);
      const woke = await tool('next_context', { waitMs: WAIT_MS });
      const elapsed = Date.now() - bodyStarted;
      expect(woke.unchanged !== true, `next_context with waitMs returned unchanged, so the body's end was not delivered: ${JSON.stringify(woke).slice(0, 300)}`);
      expect(elapsed < UNDER_MS, `the wait ran ${elapsed} ms; the body ends after ${BODY_MS} ms and the wait should return then`);
      const settled = await tool('run_code', { body: `return await gm.job_status({ job: ${JSON.stringify(job)}, waitMs: 5000 });` });
      expect(JSON.stringify(settled).includes('slow-done'), `the background body's value is not readable through job_status: ${JSON.stringify(settled).slice(0, 300)}`);
    }
  } finally {
    child.kill();
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
const wall = ((Date.now() - started) / 1000).toFixed(2);
if (failures.length > 0) {
  console.error(`${CHECK}: ${failures.length} failure(s) on ${target} (wall ${wall} s)\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`${CHECK}: ok (${target}: a background run_code is named in next_context while it runs, its end wakes a waiting next_context, and its value is readable through job_status; wall ${wall} s)`);
}
