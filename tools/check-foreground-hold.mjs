#!/usr/bin/env node
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ?? 'node';
if (!existsSync(resolve(target))) {
  console.error('foreground-hold-check: failed: no native binary at ' + resolve(target));
  process.exit(1);
}
const CLIENT_LIMIT_MS = 120000;
const BODY_SECONDS = 150;
const HOLD_MS = 100000;
const HOLDS = 4;
const WATCHDOG_MS = 900000;
const watchdog = setTimeout(() => {
  console.error('foreground-hold-check: failed: no completion within ' + WATCHDOG_MS + ' ms');
  process.exit(1);
}, WATCHDOG_MS);
watchdog.unref();

const workspace = mkdtempSync(join(tmpdir(), 'gm-foreground-hold-'));
const configDir = mkdtempSync(join(tmpdir(), 'gm-foreground-hold-config-'));
const mcpConfig = join(configDir, 'no-default-mcp.json');
writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
const common = ['--workspace', workspace, '--mcp-config', mcpConfig];
const file = resolve(target);
const argv = ['serve', ...common];

const child = spawn(file, argv, { stdio: ['pipe', 'pipe', 'pipe'] });
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
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((done) => pending.set(id, done));
};
const timed = async (name, args) => {
  const started = Date.now();
  const reply = await rpc('tools/call', { name, arguments: args });
  return { elapsed: Date.now() - started, text: reply.result?.content?.[0]?.text ?? JSON.stringify(reply.error ?? null) };
};
const valueOf = (text) => {
  let value = JSON.parse(text);
  if (value && value.output !== undefined) value = value.output;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
};

const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
let summary = '';
try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gm-foreground-hold-check', version: '1' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  await timed('next_context', {});

  const body = "const r = await gm.run_shell({ command: 'sleep " + BODY_SECONDS + "; echo done', timeoutMs: 400000 }); return r.output;";
  const first = await timed('run_code', { format: 'esm', body });
  const jobMatch = /body-\d+/.exec(first.text);
  const job = jobMatch === null ? null : jobMatch[0];
  expect(job !== null, 'run_code with the default timeoutMs did not return a background job: ' + first.text.slice(0, 200));
  expect(first.elapsed < CLIENT_LIMIT_MS - 10000, 'run_code with the default timeoutMs returned after ' + first.elapsed + ' ms, not before the client limit of ' + CLIENT_LIMIT_MS + ' ms');

  const holds = [];
  let state = 'running';
  let final = null;
  for (let index = 0; index < HOLDS && state === 'running' && job !== null; index += 1) {
    const hold = await timed('next_context', { waitMs: HOLD_MS });
    holds.push(hold.elapsed);
    const status = await timed('run_code', { format: 'esm', body: "const s = await gm.job_status({ job: '" + job + "', waitMs: 0 }); return { state: s.state, exitCode: s.exitCode, output: s.output };" });
    final = valueOf(status.text);
    state = final?.state ?? 'unknown';
  }
  expect(holds.every((ms) => ms < CLIENT_LIMIT_MS), 'a next_context hold ran to ' + Math.max(...holds) + ' ms, over the client limit of ' + CLIENT_LIMIT_MS + ' ms');
  expect(state === 'exited', 'the job ended ' + JSON.stringify(final).slice(0, 200) + ', expected exited');
  expect(String(final?.output ?? '').includes('done'), 'the job output was ' + JSON.stringify(final?.output) + ', expected done');
  summary = 'run_code with the default timeoutMs returned job ' + job + ' after ' + first.elapsed + ' ms; next_context holds ran ' + holds.join(', ') + ' ms; the job ended ' + state + ' with output done';
} catch (error) {
  failures.push(String(error?.stack ?? error));
} finally {
  child.kill();
  rmSync(workspace, { recursive: true, force: true });
  rmSync(configDir, { recursive: true, force: true });
}
if (failures.length > 0) {
  console.error('foreground-hold-check: failed: ' + failures.join('; '));
  process.exit(1);
}
console.log('foreground-hold-check: ok (' + target + ': ' + summary + ')');
process.exit(0);
