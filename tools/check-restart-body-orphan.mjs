#!/usr/bin/env node
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ?? 'node';
const onNode = target === 'node';
if (!onNode && !existsSync(resolve(target))) {
  console.error('restart-body-orphan-check: failed: no native binary at ' + resolve(target));
  process.exit(1);
}
const CALL_MS = 90000;
const WATCHDOG_MS = 240000;
const watchdog = setTimeout(() => {
  console.error('restart-body-orphan-check: failed: no completion within ' + WATCHDOG_MS + ' ms');
  process.exit(1);
}, WATCHDOG_MS);
watchdog.unref();

const workspace = mkdtempSync(join(tmpdir(), 'gm-restart-orphan-'));
const configDir = mkdtempSync(join(tmpdir(), 'gm-restart-orphan-config-'));
const binDir = onNode ? null : mkdtempSync(join(tmpdir(), 'gm-restart-orphan-bin-'));
const mcpConfig = join(configDir, 'no-default-mcp.json');
writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
const copied = onNode ? null : join(binDir, basename(resolve(target)));
if (!onNode) {
  copyFileSync(resolve(target), copied);
  chmodSync(copied, 0o755);
}
const common = ['--workspace', workspace, '--mcp-config', mcpConfig];
const file = onNode ? process.execPath : copied;
const argv = onNode ? [join(root, 'tools', 'relay.mjs'), ...common] : ['serve', ...common];

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
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const call = async (name, args = {}) => {
  const reply = await Promise.race([rpc('tools/call', { name, arguments: args }), sleep(CALL_MS).then(() => ({ timeout: true }))]);
  if (reply.timeout) return { error: 'no answer to ' + name + ' within ' + CALL_MS + ' ms' };
  if (reply.error) return { error: reply.error.message };
  const text = reply.result?.content?.[0]?.text ?? '';
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
};

const processStat = (pid) => {
  const out = spawnSync('ps', ['-o', 'pid=,stat=', '-p', String(pid)], { encoding: 'utf8', timeout: 5000 }).stdout ?? '';
  const [, stat] = out.trim().split(/\s+/);
  return stat === undefined || stat.startsWith('Z') ? null : stat;
};
const engineProcesses = () => {
  const out = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8', timeout: 5000 }).stdout ?? '';
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes(workspace) && (onNode ? line.includes('mcp.mjs') : /(^|\s)worker(\s|$)/.test(line)))
    .map((line) => Number(line.split(/\s+/)[0]));
};
const triggerRestart = () => {
  if (onNode) {
    const [worker] = engineProcesses();
    if (worker === undefined) throw new Error('no Node worker process found for the workspace');
    process.kill(worker, 'SIGTERM');
    return 'SIGTERM to the Node worker pid ' + worker;
  }
  const future = new Date(Date.now() + 60000);
  utimesSync(copied, future, future);
  return 'binary mtime changed at ' + copied + ' (the relay binary-change restart)';
};
const readPid = (name) => {
  const path = join(workspace, name);
  return existsSync(path) ? Number(readFileSync(path, 'utf8').trim()) : null;
};

const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
let leaderPid = null;
let sleepPid = null;
let how = '';
try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gm-restart-orphan-check', version: '1' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  await call('next_context');

  const body = "const r = await gm.run_shell({ command: 'echo $$ > leader.pid; sleep 600 & echo $! > orphan.pid; wait', timeoutMs: 900000 }); return r;";
  rpc('tools/call', { name: 'run_code', arguments: { format: 'esm', body } });
  const waited = Date.now();
  while (readPid('orphan.pid') === null && Date.now() - waited < CALL_MS) await sleep(100);
  leaderPid = readPid('leader.pid');
  sleepPid = readPid('orphan.pid');
  expect(leaderPid !== null && processStat(leaderPid) !== null, 'before the restart the body shell ' + leaderPid + ' was not alive');
  expect(sleepPid !== null && processStat(sleepPid) !== null, 'before the restart the body sleep ' + sleepPid + ' was not alive');

  const workersBefore = engineProcesses();
  how = triggerRestart();
  const triggeredAt = Date.now();
  let replacement = [];
  while (Date.now() - triggeredAt < CALL_MS) {
    replacement = engineProcesses().filter((pid) => !workersBefore.includes(pid));
    if (replacement.length > 0) break;
    await sleep(50);
  }
  expect(replacement.length > 0, 'no replacement worker appeared within ' + CALL_MS + ' ms of the trigger (' + how + ')');
  let answered = null;
  while (Date.now() - triggeredAt < CALL_MS) {
    answered = await call('next_context', {});
    if (answered?.ok === true) break;
    await sleep(200);
  }
  expect(answered?.ok === true, 'next_context after the restart did not answer: ' + JSON.stringify(answered).slice(0, 200));
  const restartMs = Date.now() - triggeredAt;

  const sleepAfter = sleepPid === null ? null : processStat(sleepPid);
  const leaderAfter = leaderPid === null ? null : processStat(leaderPid);
  expect(sleepAfter === null, 'after the restart the body sleep ' + sleepPid + ' is still alive (stat ' + sleepAfter + ')');
  expect(leaderAfter === null, 'after the restart the body shell ' + leaderPid + ' is still alive (stat ' + leaderAfter + ')');
  if (failures.length === 0) {
    console.log('restart-body-orphan-check: ok (' + target + ': the body shell ' + leaderPid + ' and its sleep ' + sleepPid + ' were alive before the restart (' + how + ') and are gone after it; next_context answered the restarted run in ' + restartMs + ' ms)');
  }
} catch (error) {
  failures.push(String(error?.stack ?? error));
} finally {
  for (const pid of [sleepPid, leaderPid]) {
    if (pid !== null && processStat(pid) !== null) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        failures.push('could not stop the leftover pid ' + pid);
      }
    }
  }
  child.kill();
  rmSync(workspace, { recursive: true, force: true });
  rmSync(configDir, { recursive: true, force: true });
  if (binDir !== null) rmSync(binDir, { recursive: true, force: true });
}
if (failures.length > 0) {
  console.error('restart-body-orphan-check: failed: ' + failures.join('; '));
  process.exit(1);
}
process.exit(0);
