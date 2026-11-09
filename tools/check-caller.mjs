#!/usr/bin/env node
import { withoutPlaywriter } from './lib/no-playwriter.mjs';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import readline from 'node:readline';
import { once } from 'node:events';

const exited = (child) => (child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit'));

const binary = process.argv[2] ? resolve(process.argv[2]) : null;
const WATCHDOG_MS = 90000;
const watchdog = setTimeout(() => {
  console.error(`caller-check: failed: no completion within ${WATCHDOG_MS} ms`);
  process.exit(1);
}, WATCHDOG_MS);
watchdog.unref();

if (binary === null || !existsSync(binary)) {
  console.log('caller-check: skipped (no binary given)');
  process.exit(0);
}

const workspace = withoutPlaywriter(mkdtempSync(join(tmpdir(), 'gm-caller-check-')));
const failures = [];
const child = spawn(binary, ['serve', '--workspace', workspace], { stdio: ['pipe', 'pipe', 'pipe'] });
child.stderr.resume();
const pending = new Map();
let nextId = 1;
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
const rpc = (method, params) => {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return new Promise((resolveReply) => pending.set(id, resolveReply));
};

try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'caller-check', version: '1' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  await rpc('tools/call', { name: 'next_context', arguments: { task: 'caller check' } });
  await rpc('tools/call', { name: 'run_code', arguments: { body: "return await gm.write_file({ path: 'probe.txt', content: 'x' });" } });
  const runs = join(workspace, 'runs');
  const logs = existsSync(runs) ? readdirSync(runs).map((name) => join(runs, name, 'log.jsonl')).filter((path) => existsSync(path)) : [];
  if (logs.length === 0) failures.push('no run log was written under runs/');
  const actions = logs.flatMap((path) => readFileSync(path, 'utf8').split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line))).filter((event) => event.kind === 'action');
  if (actions.length === 0) failures.push('the run log has no action event');
  for (const action of actions) {
    if (!Number.isInteger(action.caller?.connection) || action.caller.connection <= 0) failures.push(`action ${action.seq} carries no caller.connection pid`);
    if (process.platform !== 'win32' && action.caller?.parent !== child.pid) failures.push(`action ${action.seq} carries caller.parent ${action.caller?.parent ?? 'none'}, not the serve pid ${child.pid}`);
  }
  console.log(JSON.stringify({ actions: actions.length, servePid: child.pid, sample: actions[0]?.caller ?? null }));
} catch (error) {
  failures.push(error.message);
} finally {
  child.kill();
  await exited(child);
  rmSync(workspace, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`caller-check: failed: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('caller-check: passed: every action event names the server connection and the process that issued the call');
