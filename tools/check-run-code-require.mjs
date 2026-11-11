#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import readline from 'node:readline';

const CHECK = 'run-code-require-check';
const target = process.argv[2] ?? null;
if (target === null || !existsSync(resolve(target))) {
  console.error(`${CHECK}: usage: node tools/check-run-code-require.mjs <path-to-native-binary>`);
  process.exit(2);
}
const REPLY_MS = 120000;
const started = Date.now();
const scratch = mkdtempSync(join(tmpdir(), 'gm-run-code-require-'));
const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};

try {
  const workspace = mkdtempSync(join(scratch, 'ws-'));
  writeFileSync(join(workspace, 'README.md'), 'readme-text\n');
  const quiet = join(scratch, 'quiet-mcp.json');
  writeFileSync(quiet, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
  const child = spawn(resolve(target), ['serve', '--workspace', workspace, '--run-dir', join(workspace, 'run'), '--mcp-config', quiet], { stdio: ['pipe', 'pipe', 'pipe'] });
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
  try {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CHECK, version: '1' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
    await rpc('tools/call', { name: 'next_context', arguments: {} });
    const reply = (await rpc('tools/call', { name: 'run_code', arguments: { body: "const readme = await gm.read_file({ path: 'README.md' }); return { kind: typeof require, read: readme.output };" } }))?.result?.structuredContent ?? {};
    const value = reply.output ?? {};
    expect(reply.ok === true, `run_code did not run: ${JSON.stringify(reply).slice(0, 300)}`);
    expect(value.kind === 'function', `require is not a function in a run_code body: ${JSON.stringify(value).slice(0, 200)}`);
    expect(String(value.read ?? '').includes('readme-text'), `gm.read_file did not return the file from a run_code body: ${JSON.stringify(value).slice(0, 200)}`);
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
  console.log(`${CHECK}: ok (${target}: require is a function in a run_code body and gm.read_file returns the file it names; wall ${wall} s)`);
}
