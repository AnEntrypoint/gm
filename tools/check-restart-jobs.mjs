#!/usr/bin/env node
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { removeTree, stopTree } from './lib/tree.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ?? null;
if (target === null) {
  console.error('restart-jobs-check: failed: give the target: node, or the path of the native gm binary');
  process.exit(1);
}
const onNode = target === 'node';
if (onNode && process.platform === 'win32') {
  console.log('restart-jobs-check: skipped (node: tools/relay.mjs makes its input pipe with mkfifo, which win32 lacks, so the Node relay exits 1 there; the native variant witnesses the relay restart on win32)');
  process.exit(0);
}
if (!onNode && !existsSync(resolve(target))) {
  console.error(`restart-jobs-check: failed: no native binary at ${resolve(target)}`);
  process.exit(1);
}

const JOB = 'carry';
const CALL_MS = 90000;
const WATCHDOG_MS = 240000;
const watchdog = setTimeout(() => {
  console.error(`restart-jobs-check: failed: no completion within ${WATCHDOG_MS} ms`);
  process.exit(1);
}, WATCHDOG_MS);
watchdog.unref();

const workspace = mkdtempSync(join(tmpdir(), 'gm-restart-jobs-'));
const configDir = mkdtempSync(join(tmpdir(), 'gm-restart-jobs-config-'));
const gate = join(configDir, 'carry.gate');
const JOB_COMMAND = process.platform === 'win32' ? 'sleep 90 & echo done' : `while [ ! -f "${gate}" ]; do sleep 1; done; echo done`;
const binDir = onNode ? null : mkdtempSync(join(tmpdir(), 'gm-restart-jobs-bin-'));
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
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return new Promise((done) => pending.set(id, done));
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const call = async (name, args = {}) => {
  const reply = await Promise.race([rpc('tools/call', { name, arguments: args }), sleep(CALL_MS).then(() => ({ timeout: true }))]);
  if (reply.timeout) return { error: `no answer to ${name} within ${CALL_MS} ms` };
  if (reply.error) return { error: reply.error.message };
  const text = reply.result?.content?.[0]?.text ?? '';
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
};
const unwrap = (value) => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};
const runCode = async (body) => {
  const reply = await call('run_code', { format: 'esm', timeoutMs: 120000, body });
  if (reply.error) return { error: reply.error };
  return unwrap(reply.output);
};
const statusBody = (waitMs) => `return await gm.job_status({ job: ${JSON.stringify(JOB)}, waitMs: ${waitMs} });`;
const listOf = (value) => {
  const body = value?.output !== undefined ? unwrap(value.output) : value;
  if (Array.isArray(body)) return body;
  return body?.events ?? body?.records ?? [];
};

const windowsProcesses = () => {
  const script = 'Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress';
  const reply = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 30000 });
  if (reply.error || reply.status !== 0) {
    throw new Error(`cannot read the process table: ${reply.error?.message ?? `powershell.exe exit ${reply.status}: ${reply.stderr.trim()}`}`);
  }
  const out = reply.stdout.trim();
  const rows = out === '' ? [] : [JSON.parse(out)].flat();
  return rows.map((row) => ({ pid: Number(row.ProcessId), args: String(row.CommandLine ?? '') }));
};

const processOf = (pid) => {
  if (process.platform === 'win32') return windowsProcesses().some((row) => row.pid === pid) ? { pgid: null, stat: 'R' } : null;
  const out = spawnSync('ps', ['-o', 'pid=,pgid=,stat=', '-p', String(pid)], { encoding: 'utf8', timeout: 5000 }).stdout ?? '';
  const [, pgid, stat] = out.trim().split(/\s+/);
  if (pgid === undefined || stat === undefined || stat.startsWith('Z')) return null;
  return { pgid: Number(pgid), stat };
};

const engineProcesses = () => {
  if (process.platform === 'win32') {
    return windowsProcesses()
      .filter((row) => row.args.includes(workspace) && (onNode ? row.args.includes('mcp.mjs') : /(^|\s)worker(\s|$)/.test(row.args)))
      .map((row) => row.pid);
  }
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
    return `SIGTERM to the Node worker pid ${worker} (the supervisor's pause signal)`;
  }
  const future = new Date(Date.now() + 60000);
  utimesSync(copied, future, future);
  return `binary mtime changed at ${copied} (the relay's binary-change restart)`;
};

const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};

let jobPid = null;
const timings = {};
try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gm-restart-jobs-check', version: '1' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  await call('next_context');

  const started = await runCode(`return await gm.job_start({ job: ${JSON.stringify(JOB)}, command: ${JSON.stringify(JOB_COMMAND)}, timeoutMs: 120000 });`);
  expect(started?.ok === true, `job_start: ${JSON.stringify(started).slice(0, 200)}`);
  const beforeStatus = await runCode(statusBody(0));
  jobPid = typeof beforeStatus?.pid === 'number' ? beforeStatus.pid : null;
  expect(jobPid !== null && processOf(jobPid) !== null, `before the restart the job's process ${jobPid} was not alive`);

  const workersBefore = engineProcesses();
  const triggeredAt = Date.now();
  const how = triggerRestart();
  timings.trigger = how;
  let replacement = [];
  while (Date.now() - triggeredAt < CALL_MS) {
    replacement = engineProcesses().filter((pid) => !workersBefore.includes(pid));
    if (replacement.length > 0) break;
    await sleep(50);
  }
  timings.workerReplacedMs = Date.now() - triggeredAt;
  expect(replacement.length > 0, `no replacement worker appeared within ${CALL_MS} ms of the trigger`);
  let answered = null;
  while (replacement.length > 0 && Date.now() - triggeredAt < CALL_MS) {
    answered = await runCode(statusBody(0));
    if (answered?.state !== undefined) break;
    await sleep(200);
  }
  timings.restartMs = Date.now() - triggeredAt;
  expect(answered?.state !== undefined, `after the restart job_status did not answer: ${JSON.stringify(answered).slice(0, 200)}`);

  const alive = jobPid === null ? null : processOf(jobPid);
  timings.aliveMs = Date.now() - triggeredAt;
  const windows = process.platform === 'win32';
  expect(windows ? alive === null : alive !== null, windows ? `after the restart the job's process ${jobPid} is still alive on Windows, which has no job wrapper` : `after the restart the job's process ${jobPid} is gone (ps reports no live row)`);
  expect(windows ? (answered?.state === 'killed' && answered?.reason === 'restart') : answered?.state === 'running', windows ? `after the restart on Windows job_status reports ${JSON.stringify(answered).slice(0, 240)}, expected killed with reason restart` : `after the restart job_status reports ${JSON.stringify(answered?.state)}, expected running`);

  if (!windows) writeFileSync(gate, 'go\n');
  let ended = answered;
  const waitStart = Date.now();
  while (!windows && ended?.state === 'running' && Date.now() - waitStart < 60000) {
    ended = await runCode(statusBody(5000));
  }
  timings.endMs = Date.now() - triggeredAt;
  if (!windows) {
    expect(ended?.state === 'exited' && ended?.exitCode === 0, `the job ended ${JSON.stringify(ended).slice(0, 240)}, expected exited with exitCode 0`);
    expect(String(ended?.output ?? '').includes('done'), `the job output was ${JSON.stringify(ended?.output)}, expected done`);
  }

  const logs = await runCode(`return { job: await gm.query_log({ kind: 'job' }), killed: await gm.query_log({ kind: 'job-killed' }), restart: await gm.query_log({ kind: 'restart' }) };`);
  const jobEvents = listOf(logs?.job).filter((event) => event.job === JOB);
  const killedEvents = listOf(logs?.killed).filter((event) => event.job === JOB);
  const restarts = listOf(logs?.restart);
  const carried = jobEvents.filter((event) => event.carried === true);
  const killedOnRestart = [...jobEvents, ...killedEvents].filter((event) => event.reason === 'restart');
  expect(restarts.length > 0, `the log has no restart event: ${JSON.stringify(logs?.restart).slice(0, 300)}`);
  if (windows) {
    expect(killedOnRestart.length > 0, `the log records no ${JOB} killed with reason restart on Windows: ${JSON.stringify([...jobEvents, ...killedEvents]).slice(0, 300)}`);
  } else {
    expect(carried.length > 0, `the log has no carry-over event for ${JOB}: ${JSON.stringify(jobEvents).slice(0, 300)}`);
    expect(killedOnRestart.length === 0, `the log records ${JOB} killed with reason restart: ${JSON.stringify(killedOnRestart).slice(0, 300)}`);
  }

  if (failures.length) {
    console.error(`restart-jobs-check: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
    console.error(`restart-jobs-check: timings ${JSON.stringify(timings)}`);
    process.exitCode = 1;
  } else {
    console.log(windows
      ? `restart-jobs-check: ok (${onNode ? 'node' : 'native'}: ${how}; Windows has no job wrapper, so the job's process ${jobPid} was settled as killed with reason restart; the restart answered in ${timings.restartMs} ms; the restart is logged)`
      : `restart-jobs-check: ok (${onNode ? 'node' : 'native'}: ${how}; the job's process ${jobPid} was alive ${timings.aliveMs} ms after the trigger; the restart answered in ${timings.restartMs} ms; the job exited 0 with output "done" at ${timings.endMs} ms; carry-over events ${carried.length}; killed with reason restart 0)`);
  }
} finally {
  await stopTree(child);
  if (jobPid !== null && processOf(jobPid) !== null) process.kill(process.platform === 'win32' ? jobPid : -jobPid, 'SIGKILL');
  for (const pid of engineProcesses()) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
  const sessions = join(root, 'runs', '.sessions');
  if (onNode && existsSync(sessions)) {
    for (const entry of readdirSync(sessions)) if (entry.startsWith(`${child.pid}-`)) rmSync(join(sessions, entry), { force: true });
  }
  await removeTree(workspace);
  await removeTree(configDir);
  if (binDir !== null) await removeTree(binDir);
}
process.exit(process.exitCode ?? 0);
