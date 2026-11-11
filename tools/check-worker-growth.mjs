#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { spawn } from './lib/group.mjs';

const CHECK = 'check-worker-growth';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(process.argv[2] ?? join(root, 'build', 'release', 'native', 'components', 'host', 'gm'));
const WARM = 100;
const CALLS = 400;
const LIMIT_KB = 2048;
const started = Date.now();
const sandbox = mkdtempSync(join(tmpdir(), 'gm-worker-growth-'));
const workspace = join(sandbox, 'ws');
mkdirSync(workspace);
const quiet = join(sandbox, 'quiet.json');
writeFileSync(quiet, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
const relay = spawn(target, ['serve', '--workspace', workspace, '--run-dir', join(workspace, 'runs', 'growth'), '--mcp-config', quiet], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HOME: sandbox } });
relay.stdin.on('error', () => {});
relay.stderr.resume();
const waiting = new Map();
let nextId = 1;
readline.createInterface({ input: relay.stdout }).on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id !== undefined && waiting.has(message.id)) {
    waiting.get(message.id)(message);
    waiting.delete(message.id);
  }
});
const rpc = (method, params) =>
  new Promise((done) => {
    const id = nextId++;
    waiting.set(id, done);
    relay.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
const workerKb = () => {
  const worker = Number(execFileSync('pgrep', ['-P', String(relay.pid)], { encoding: 'utf8' }).trim().split('\n')[0]);
  const line = readFileSync(`/proc/${worker}/status`, 'utf8').split('\n').find((text) => text.startsWith('VmRSS:'));
  return Number(line.split(/\s+/)[1]);
};
const failures = [];

try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CHECK, version: '1' } });
  relay.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  await rpc('tools/call', { name: 'next_context', arguments: {} });
  for (let i = 0; i < WARM; i += 1) await rpc('tools/call', { name: 'run_code', arguments: { body: 'return 1;' } });
  const before = workerKb();
  for (let i = 0; i < CALLS; i += 1) await rpc('tools/call', { name: 'run_code', arguments: { body: 'return 1;' } });
  const after = workerKb();
  const growth = after - before;
  if (growth > LIMIT_KB) failures.push(`the worker grew ${growth} KB over ${CALLS} run_code calls (limit ${LIMIT_KB} KB; ${before} KB then ${after} KB)`);
} finally {
  relay.kill('SIGKILL');
  rmSync(sandbox, { recursive: true, force: true });
}

const wall = ((Date.now() - started) / 1000).toFixed(2);
if (failures.length > 0) {
  console.error(`${CHECK}: ${failures.length} failure(s) (wall ${wall} s)\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`${CHECK}: ok (the worker's resident memory held within ${LIMIT_KB} KB over ${CALLS} run_code calls after ${WARM} warm calls; wall ${wall} s)`);
}
