#!/usr/bin/env node
import { withoutPlaywriter } from './lib/no-playwriter.mjs';
import { spawn } from './lib/group.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import readline from 'node:readline';
import { once } from 'node:events';

const binary = process.argv[2] ? resolve(process.argv[2]) : null;
if (binary === null || !existsSync(binary)) {
  console.log('grep-state-scope-check: skipped (no binary given)');
  process.exit(0);
}

const WATCHDOG_MS = 120000;
const watchdog = setTimeout(() => {
  console.error(`grep-state-scope-check: failed: no completion within ${WATCHDOG_MS} ms`);
  process.exit(1);
}, WATCHDOG_MS);
watchdog.unref();

const TOKEN = 'STATE_SCOPE_ALOOP_TOKEN';
const workspace = withoutPlaywriter(mkdtempSync(join(tmpdir(), 'gm-state-scope-')));
const failures = [];
spawnSync('git', ['init', '-q'], { cwd: workspace });
writeFileSync(join(workspace, '.gitignore'), '.gm/\n');
mkdirSync(join(workspace, 'src'), { recursive: true });
writeFileSync(join(workspace, 'src', 'app.js'), 'export const app = 1;\n');
spawnSync('git', ['add', '.gitignore', 'src'], { cwd: workspace });
mkdirSync(join(workspace, '.gm', 'witness-out'), { recursive: true });
writeFileSync(join(workspace, '.gm', 'witness-out', 'aloop.log'), `step 1 ${TOKEN} witnessed\n`);

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
  return new Promise((done) => pending.set(id, done));
};
const grepBody = async (label, body) => {
  const reply = await rpc('tools/call', { name: 'run_code', arguments: { body } });
  const parsed = JSON.parse(reply.result?.content?.[0]?.text ?? 'null');
  if (parsed?.ok !== true) {
    failures.push(`${label}: run_code refused: ${parsed?.error ?? 'no reply'}`);
    return null;
  }
  return typeof parsed.output === 'string' ? JSON.parse(parsed.output) : parsed.output;
};

try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'grep-state-scope-check', version: '1' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  await rpc('tools/call', { name: 'next_context', arguments: { task: 'grep state scope check' } });

  const named = await grepBody('named file, scope all', `return await gm.grep({ pattern: '${TOKEN}', path: '.gm/witness-out/aloop.log', scope: 'all', limit: 20 });`);
  if (named !== null && !String(named.output ?? '').includes(`${TOKEN} witnessed`)) failures.push(`named file, scope all: the state-directory file was not searched: ${JSON.stringify(named).slice(0, 300)}`);

  const dir = await grepBody('named directory, scope all', `return await gm.grep({ pattern: '${TOKEN}', path: '.gm/witness-out', scope: 'all', limit: 20 });`);
  if (dir !== null && !String(dir.output ?? '').includes(`${TOKEN} witnessed`)) failures.push(`named directory, scope all: the state-directory files were not searched: ${JSON.stringify(dir).slice(0, 300)}`);

  const whole = await grepBody('whole root, scope all', `return await gm.grep({ pattern: '${TOKEN}', scope: 'all', limit: 20 });`);
  if (whole !== null && String(whole.output ?? '').includes(TOKEN)) failures.push('whole root, scope all: the state directory is searched by a whole-root scan, which the documented skip forbids');

  const plain = await grepBody('named file, default scope', `return await gm.grep({ pattern: '${TOKEN}', path: '.gm/witness-out/aloop.log', limit: 20 });`);
  if (plain !== null && (plain.ok !== false || String(plain.output ?? '').includes(TOKEN))) failures.push(`named file, default scope: expected a refusal, got ${JSON.stringify(plain).slice(0, 300)}`);
} finally {
  child.kill();
  await Promise.race([once(child, 'exit').catch(() => {}), new Promise((done) => setTimeout(done, 5000))]);
  rmSync(workspace, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`grep-state-scope-check: failed: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('grep-state-scope-check: passed: scope all reads a state-directory file and directory named by path; a whole-root scope all still skips them; the default scope still refuses the file');
