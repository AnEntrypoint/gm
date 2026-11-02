#!/usr/bin/env node
// Host-facing relay for the gm-new worker. The host (Claude Code) starts this file from .mcp.json and holds its stdio.
// The relay runs tools/supervise.mjs as a child and forwards lines both ways. This file never changes in normal work, so
// a change to tools/supervise.mjs needs no reconnect. When tools/supervise.mjs changes, the relay refuses it if it has a
// syntax error, and otherwise holds new host lines, waits for every request it sent to the supervisor to be answered,
// stops the supervisor with SIGTERM (the supervisor pauses the worker), and starts a new one on the same run. The host
// sees no disconnect. If a supervisor cannot start, host requests are answered with the failure text, and the start is
// retried with backoff. Edit this file only when a reconnect is acceptable: every change here needs one.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, watch } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_UPDATE_MS, startUpdates } from './update.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.GMNEW_ROOT ? resolve(process.env.GMNEW_ROOT) : resolve(HERE, '..');
// Updates from origin main: a check at start and then every GMNEW_UPDATE_MS (0 turns them off). The relay runs the checks, because the relay
// outlives supervisor swaps.
const UPDATE_MS = process.env.GMNEW_UPDATE_MS === undefined ? DEFAULT_UPDATE_MS : Number(process.env.GMNEW_UPDATE_MS);
const SUPERVISOR = join(HERE, 'supervise.mjs');
const DEBOUNCE_MS = 250;
const CHECK_MS = 10000;
const EXIT_MS = 5000;
const READY_MS = 20000;
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30000;
const READY_ID = 'gm-new-relay-ready';
const READY_METHOD = 'gm-new/ready';

// The run is chosen once here, so every supervisor this session starts resumes the same run. The supervisor is not
// given the run options. newRunId is copied from src/run.mjs, so a broken src cannot stop the relay from starting.
const argv = chooseRun(process.argv.slice(2));

function chooseRun(args) {
  const runsRoot = optionValue(args, '--runs');
  const resumeId = optionValue(args, '--resume');
  const rest = withoutOptions(args, ['--runs', '--resume']);
  if (optionValue(args, '--run-dir') !== undefined) return [...rest, '--run-dir', resolve(optionValue(args, '--run-dir'))];
  if (runsRoot === undefined) {
    if (resumeId !== undefined) throw new Error('--resume needs --runs');
    return [...rest, '--run-dir', join(ROOT, 'runs', newRunId())];
  }
  const root = resolve(runsRoot);
  if (resumeId !== undefined) {
    if (!/^[A-Za-z0-9_-]+$/.test(resumeId)) throw new Error('--resume takes a run id');
    const dir = join(root, resumeId);
    if (!existsSync(join(dir, 'log.jsonl'))) throw new Error(`no run ${resumeId} under ${root}`);
    return [...rest, '--run-dir', dir];
  }
  return [...rest, '--run-dir', join(root, newRunId())];
}

function newRunId() {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `${stamp}-${randomBytes(3).toString('hex')}`;
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function withoutOptions(args, names) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    if (names.includes(args[i])) i += 1;
    else out.push(args[i]);
  }
  return out;
}

let supervisor = null;
let state = 'starting'; // starting, running, stopping, or failed
let hostInitialize = null;
let failure = '';
let stderrTail = '';
let ready = null; // the pending probe of a new supervisor
const inflight = new Map(); // request ids sent to the supervisor and not yet answered, with their method
const held = []; // host lines held while the supervisor starts or is replaced
const relayRequests = new Map(); // ids the relay sent to the supervisor itself, for the list comparison after a swap
const hostSeen = {}; // a digest of each list as the host last fetched it, by kind
let swapping = false; // true from the start of a swap until its list notices are decided
const LIST_MS = 5000;
const LISTS = { 'tools/list': 'tools', 'prompts/list': 'prompts', 'resources/list': 'resources' };
const NOTICE = { tools: 'notifications/tools/list_changed', prompts: 'notifications/prompts/list_changed', resources: 'notifications/resources/list_changed' };
let onDrained = null;
let retryDelay = RETRY_MIN_MS;
let retryTimer = null;
let busy = null;
let queued = null;

function writeHost(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function errorReply(id, message) {
  return { jsonrpc: '2.0', id, error: { code: -32000, message } };
}

function parse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function onHostLine(line) {
  if (line.trim() === '') return;
  const message = parse(line);
  if (message?.method === 'initialize') hostInitialize = message.params ?? {};
  if (state === 'running') forward(line, message);
  else hold(line, message);
}

function forward(line, message) {
  if (message?.id !== undefined && message.method) inflight.set(message.id, message.method);
  supervisor.stdin.write(`${line}\n`);
}

function hold(line, message) {
  if (state === 'failed') {
    if (message?.id !== undefined && message.method) writeHost(errorReply(message.id, failure));
    return;
  }
  held.push(line);
}

function onSupervisorLine(line) {
  if (line.trim() === '') return;
  const message = parse(line);
  // The supervisor's worker state. It goes to the update check and not to the host.
  if (message?.method === 'gm-new/worker') {
    for (const waiter of workerWaiters.splice(0)) waiter.resolve(message.params ?? null);
    return;
  }
  if (message?.id === READY_ID) {
    ready?.answer();
    return;
  }
  if (message?.id !== undefined && relayRequests.has(message.id)) {
    onRelayReply(message);
    return;
  }
  // During a swap the relay decides which list notices the host gets, so the supervisor's own copies are dropped here.
  if (swapping && typeof message?.method === 'string' && message.method.endsWith('list_changed')) return;
  if (message?.id !== undefined && message?.id !== null) {
    const method = inflight.get(message.id);
    inflight.delete(message.id);
    // The host's own list requests record what the host has seen, so a later comparison is against that.
    if (LISTS[method] !== undefined && message.result !== undefined) hostSeen[LISTS[method]] = digestOf(message.result);
  }
  process.stdout.write(`${line}\n`);
  if (onDrained && inflight.size === 0) onDrained();
}

function digestOf(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function askWorker(method) {
  const id = `gm-new-relay:${method}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      relayRequests.delete(id);
      resolve(null);
    }, LIST_MS);
    relayRequests.set(id, { resolve, timer });
    supervisor.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params: {} })}\n`);
  });
}

function onRelayReply(message) {
  const pending = relayRequests.get(message.id);
  relayRequests.delete(message.id);
  clearTimeout(pending.timer);
  pending.resolve(message.error === undefined ? (message.result ?? null) : null);
}

// After a swap, the lists the new worker serves are compared with the lists the host last fetched, and a kind that differs gets its
// list_changed notice. A kind the host has never fetched gets none. Nothing is sent when nothing differs.
async function announceChanges() {
  const now = {};
  for (const [method, kind] of Object.entries(LISTS)) {
    const result = await askWorker(method);
    if (result !== null) now[kind] = digestOf(result);
  }
  for (const [kind, digest] of Object.entries(now)) {
    if (hostSeen[kind] !== undefined && hostSeen[kind] !== digest) writeHost({ jsonrpc: '2.0', method: NOTICE[kind] });
  }
}

function spawnSupervisor(reason) {
  const env = {
    ...process.env,
    GMNEW_CORE_REASON: reason ?? '',
    GMNEW_HOST_INITIALIZE: hostInitialize ? JSON.stringify(hostInitialize) : '',
  };
  const proc = spawn(process.execPath, [SUPERVISOR, ...argv], { cwd: ROOT, env, stdio: ['pipe', 'pipe', 'pipe'] });
  proc.stdin.on('error', () => {});
  proc.stderr.on('data', (chunk) => {
    const text = String(chunk);
    stderrTail = (stderrTail + text).slice(-4000);
    process.stderr.write(text);
  });
  createInterface({ input: proc.stdout }).on('line', (line) => {
    if (proc === supervisor) onSupervisorLine(line);
  });
  proc.on('exit', (code, signal) => onSupervisorExit(proc, code, signal));
  proc.on('error', (err) => onSupervisorExit(proc, null, err.code ?? err.message));
  return proc;
}

function onSupervisorExit(proc, code, signal) {
  if (proc !== supervisor) return;
  supervisor = null;
  const how = signal ?? `code ${code}`;
  if (ready) {
    ready.fail(new Error(`the supervisor exited (${how}) before it answered`));
    return;
  }
  if (state === 'running') {
    failWith(`the supervisor exited unexpectedly (${how})`);
    return;
  }
  // A swap is waiting for these calls to answer. The supervisor took them with it, so they are answered here, and the swap goes on.
  for (const id of inflight.keys()) writeHost(errorReply(id, `the supervisor exited (${how}) with this call in flight`));
  inflight.clear();
  if (onDrained) onDrained();
}

// The next worker state the supervisor reports ({ state, reason? }), or null after timeoutMs. The update check uses it to wait for the outcome of
// the restart its pull caused.
const workerWaiters = [];
function nextWorkerEvent(timeoutMs) {
  return new Promise((resolve) => {
    const waiter = { resolve: (params) => { clearTimeout(timer); resolve(params); } };
    const timer = setTimeout(() => {
      const at = workerWaiters.indexOf(waiter);
      if (at >= 0) workerWaiters.splice(at, 1);
      resolve(null);
    }, timeoutMs);
    workerWaiters.push(waiter);
  });
}

// Why the worker's work must not be interrupted now, or null when it may be restarted. A tool call in flight is work. So is a body or job
// that the current run still has running or queued, which its status files say.
function busyReason() {
  let calls = 0;
  for (const method of inflight.values()) if (method === 'tools/call') calls += 1;
  if (calls > 0) return `${calls} tool call(s) in flight`;
  const runDir = argv[argv.indexOf('--run-dir') + 1];
  const jobsDir = join(runDir, 'jobs');
  if (!existsSync(jobsDir)) return null;
  let open = 0;
  for (const name of readdirSync(jobsDir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const status = JSON.parse(readFileSync(join(jobsDir, name), 'utf8'));
      if (status.state === 'running' || status.state === 'queued') open += 1;
    } catch {
      // A status file that is being written is read again at the next check.
    }
  }
  return open > 0 ? `${open} body or job(s) running or queued` : null;
}

function probeSupervisor() {
  return new Promise((resolveProbe, rejectProbe) => {
    const timer = setTimeout(() => {
      ready = null;
      rejectProbe(new Error(`the supervisor did not answer within ${READY_MS} ms`));
    }, READY_MS);
    ready = {
      answer() {
        clearTimeout(timer);
        ready = null;
        resolveProbe();
      },
      fail(err) {
        clearTimeout(timer);
        ready = null;
        rejectProbe(err);
      },
    };
    supervisor.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: READY_ID, method: READY_METHOD })}\n`);
  });
}

function waitForDrain() {
  if (inflight.size === 0) return Promise.resolve();
  return new Promise((resolveDrain) => {
    onDrained = () => {
      onDrained = null;
      resolveDrain();
    };
  });
}

async function stopSupervisor() {
  const proc = supervisor;
  supervisor = null;
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  const exited = new Promise((resolveExit) => proc.once('exit', resolveExit));
  proc.kill('SIGTERM');
  const force = setTimeout(() => proc.kill('SIGKILL'), EXIT_MS);
  await exited;
  clearTimeout(force);
}

async function startSupervisor(reason) {
  state = 'starting';
  supervisor = spawnSupervisor(reason);
  try {
    await probeSupervisor();
  } catch (err) {
    await stopSupervisor();
    failWith(err.message);
    return;
  }
  state = 'running';
  retryDelay = RETRY_MIN_MS;
  clearTimeout(retryTimer);
  retryTimer = null;
  for (const line of held.splice(0)) onHostLine(line);
}

function failWith(reason) {
  state = 'failed';
  failure = `${reason}. Last stderr of the supervisor:\n${stderrTail.slice(-1500)}`;
  for (const id of inflight.keys()) writeHost(errorReply(id, failure));
  inflight.clear();
  for (const line of held.splice(0)) {
    const message = parse(line);
    if (message?.id !== undefined && message.method) writeHost(errorReply(message.id, failure));
  }
  scheduleRetry();
}

// A failed start retries by itself, 1 s then doubling to 30 s, with no file change needed.
function scheduleRetry() {
  clearTimeout(retryTimer);
  const delay = retryDelay;
  retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
  process.stderr.write(`gm-new dev: retrying the supervisor start in ${delay} ms\n`);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (state === 'failed') scheduleSwap('retry after a failed start');
  }, delay);
}

function syntaxOk() {
  return new Promise((resolveCheck) => {
    const check = spawn(process.execPath, ['--check', SUPERVISOR], { stdio: ['ignore', 'ignore', 'pipe'], timeout: CHECK_MS });
    let report = '';
    check.stderr.on('data', (chunk) => {
      report += chunk;
    });
    check.on('error', () => resolveCheck(false));
    check.on('exit', (code) => {
      if (code !== 0) process.stderr.write(`gm-new dev: tools/supervise.mjs has a syntax error, so the running supervisor stays\n${report}`);
      resolveCheck(code === 0);
    });
  });
}

async function swap(reason) {
  if (reason?.startsWith('changed') && !(await syntaxOk())) return;
  process.stderr.write(`gm-new dev: replacing the supervisor (${reason ?? 'start'})\n`);
  swapping = true;
  try {
    if (state === 'running') {
      state = 'stopping';
      await waitForDrain();
    }
    state = 'stopping';
    await stopSupervisor();
    await startSupervisor(reason);
    if (state === 'running') await announceChanges();
  } finally {
    swapping = false;
  }
}

// Swaps run one at a time. A request that arrives during a swap is kept and runs after it.
function scheduleSwap(reason) {
  if (busy) {
    queued = reason;
    return;
  }
  busy = swap(reason).finally(() => {
    busy = null;
    if (queued !== null) {
      const next = queued;
      queued = null;
      scheduleSwap(next);
    }
  });
}

let watchTimer = null;
watch(HERE, (_event, file) => {
  if (file !== 'supervise.mjs') return;
  clearTimeout(watchTimer);
  watchTimer = setTimeout(() => scheduleSwap('changed: supervise.mjs'), DEBOUNCE_MS);
});

function shutdown() {
  if (!supervisor) process.exit(0);
  supervisor.once('exit', () => process.exit(0));
  supervisor.stdin.end();
}

startUpdates({ root: ROOT, everyMs: UPDATE_MS, log: (message) => process.stderr.write(`gm-new update: ${message}\n`), busy: busyReason, nextWorkerEvent });
scheduleSwap(null);
createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', onHostLine).on('close', shutdown);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, shutdown);
