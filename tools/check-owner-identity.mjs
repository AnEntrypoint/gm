#!/usr/bin/env node
import { spawn } from './lib/group.mjs';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import readline from 'node:readline';

const CHECK = 'owner-identity-check';
const binary = process.argv[2] ? resolve(process.argv[2]) : '';
if (!binary || !existsSync(binary)) {
  console.error(`${CHECK}: usage: node tools/check-owner-identity.mjs <gm binary>`);
  process.exit(2);
}
const started = Date.now();
const scratch = mkdtempSync(join(tmpdir(), 'gm-owner-identity-'));
const workspace = join(scratch, 'ws');
const runDir = join(scratch, 'run');
const quiet = join(scratch, 'quiet-mcp.json');
mkdirSync(workspace);
writeFileSync(quiet, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
const spawned = [];
const sleeper = () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore', detached: true });
  spawned.push(child);
  return child;
};

const serve = () => {
  const child = spawn(binary, ['serve', '--workspace', workspace, '--run-dir', runDir, '--mcp-config', quiet], { stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  spawned.push(child);
  child.stdin.on('error', () => {});
  const pending = new Map();
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
      }, 60000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        done(message);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  return { child, rpc };
};

const nextContext = async (rpc) => {
  const reply = await rpc('tools/call', { name: 'next_context', arguments: {} });
  return reply?.result?.content?.[0]?.text ?? '';
};

const exited = (child) => new Promise((done) => child.once('exit', done));

try {
  const first = serve();
  await first.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CHECK, version: '1' } });
  first.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const openText = await nextContext(first.rpc);
  const runId = JSON.parse(openText || '{}').run ?? '';
  expect(runId !== '', `the first server did not open a run: ${openText.slice(0, 200)}`);
  const ended = exited(first.child);
  first.child.kill('SIGKILL');
  await ended;

  const holder = sleeper();
  writeFileSync(join(runDir, 'owner'), `${holder.pid}:1\n`);

  const second = serve();
  await second.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CHECK, version: '1' } });
  second.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const resumedText = await nextContext(second.rpc);
  expect(!resumedText.includes('belongs to another live connection'), `run ${runId} was not adopted: its owner pid ${holder.pid} has another start time, so it is not alive, but the server called it foreign: ${resumedText.slice(0, 240)}`);
  expect(JSON.parse(resumedText || '{}').run === runId, `the restarted server did not resume run ${runId}: ${resumedText.slice(0, 240)}`);
  second.child.kill('SIGKILL');
} finally {
  for (const child of spawned) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
  rmSync(scratch, { recursive: true, force: true });
}

const wall = ((Date.now() - started) / 1000).toFixed(2);
if (failures.length > 0) {
  console.error(`${CHECK}: ${failures.length} failure(s) (wall ${wall} s)\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`${CHECK}: ok (a run whose owner names a live pid with another start time is adopted after a restart; wall ${wall} s)`);
}
