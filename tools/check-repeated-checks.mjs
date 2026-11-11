#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const CHECK = 'repeated-checks-check';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ?? null;
const onNode = target === 'node';
const binary = onNode ? process.execPath : target === null ? null : resolve(target);
if (binary === null || (!onNode && !existsSync(binary))) {
  console.error(`${CHECK}: usage: node tools/check-repeated-checks.mjs <path-to-native-binary | node>`);
  process.exit(2);
}
const lead = onNode ? [join(root, 'src', 'mcp.mjs')] : ['serve'];
const REPEATED = 'echo gm-repeated-check';
const ONCE = 'echo gm-single-check';
const JOB = 'echo gm-job-check';
const REPLY_MS = 120000;

const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
const started = Date.now();
const scratch = mkdtempSync(join(tmpdir(), 'gm-repeated-checks-'));

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
    const ran = await tool('run_code', {
      body: `for (let i = 0; i < 3; i += 1) await gm.run_shell({ command: ${JSON.stringify(REPEATED)} }); await gm.run_shell({ command: ${JSON.stringify(ONCE)} }); return 'ran';`,
    });
    expect(ran.ok === true, `run_code did not run: ${JSON.stringify(ran).slice(0, 300)}`);
    const jobs = await tool('run_code', {
      body: `for (const job of ['gm-job-a', 'gm-job-b']) await gm.job_start({ job, command: ${JSON.stringify(JOB)}, timeoutMs: 20000 }); for (const job of ['gm-job-a', 'gm-job-b']) await gm.job_status({ job, waitMs: 20000 }); return 'jobs';`,
    });
    expect(jobs.ok === true, `the jobs run did not run: ${JSON.stringify(jobs).slice(0, 300)}`);
    const reply = await tool('next_context', { full: true });
    const checks = Array.isArray(reply.checks) ? reply.checks : [];
    expect(!JSON.stringify(reply).includes('"kind":"check"'), 'a check event is in the raw feed of next_context');
    const repeated = checks.find((row) => row.command === REPEATED);
    expect(repeated !== undefined, `next_context does not list the repeated command: ${JSON.stringify(checks).slice(0, 400)}`);
    expect(repeated?.count === 3, `the repeated command's count is not 3: ${JSON.stringify(repeated).slice(0, 200)}`);
    expect(Number.isFinite(repeated?.totalMs) && Number.isFinite(repeated?.lastMs), `the repeated command has no wall time: ${JSON.stringify(repeated).slice(0, 200)}`);
    const job = checks.find((row) => row.command === JOB);
    expect(job?.count === 2, `the job command's count is not 2 after two job ends: ${JSON.stringify(job).slice(0, 200)}`);
    expect(Number.isFinite(job?.totalMs) && Number.isFinite(job?.lastMs), `the job command has no wall time: ${JSON.stringify(job).slice(0, 200)}`);
    expect(!checks.some((row) => row.command === ONCE), `a command run once is listed as repeated: ${JSON.stringify(checks).slice(0, 400)}`);
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
  console.log(`${CHECK}: ok (${target}: next_context lists a run_shell command run three times and a job command ended twice, each with its count and wall time, and leaves out a command run once; wall ${wall} s)`);
}
