#!/usr/bin/env node
// The gm-new core. tools/relay.mjs runs this file and passes the host's lines through it, so the host's connection never changes.
// The core runs the worker (src/mcp.mjs) as a child. When a module the worker loads changes (src/worker-modules.json) or a skill changes,
// the core holds new host requests,
// waits for the calls in flight to answer, pauses the worker (SIGTERM), starts a new one on the same run directory, replays the MCP
// handshake, and tells the host which of its lists changed, by comparing digests. The new worker resumes the run from its log. A call
// in flight is never interrupted or answered with an error.
// The core also runs the update check (tools/update.mjs). When a file under tools/ changes, the core replaces itself. The new code is
// checked and loaded first. Then this core pauses its worker, and the new core takes over this process's stdin and stdout, so the host's
// pipe stays open. The new core starts its worker and answers on fd 3, and this process exits with code 75. The relay reads that the
// pipe is still in use, so it starts no second core. Every exit of this file pauses the worker first, so the run stays open.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, watch, writeFileSync, writeSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_UPDATE_MS, loadedByWorker, startUpdates, workerModulesOf } from './update.mjs';
import { RELOADABLE } from '../src/hot-config.mjs';
import { currentRunDir } from '../src/run.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.GMNEW_ROOT ? resolve(process.env.GMNEW_ROOT) : resolve(HERE, '..');
const CORE_FILE = join(HERE, 'core.mjs');
const UPDATE_FILE = join(HERE, 'update.mjs');
const WORKER = join(ROOT, 'src', 'mcp.mjs');
const SKILLS_DIR = join(ROOT, 'skills');
const WATCHED = [join(ROOT, 'src'), SKILLS_DIR];
const WATCHED_FILE = /\.(mjs|md)$/;
const SESSIONS = join(ROOT, 'runs', '.sessions');
const DEBOUNCE_MS = 250;
const EXIT_MS = 5000;
const CHECK_MS = 10000;
const ACK_MS = 30000;
const LIST_MS = 5000;
const HANDSHAKE_MS = 10000;
const HANDSHAKE_ID = 'gm-new-core-handshake';
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30000;
const HANDOVER_EXIT = 75;
const MEMORY_LIMIT_MB = Number(process.env.GMNEW_MEMORY_LIMIT_MB ?? 512);
const UPDATE_MS = process.env.GMNEW_UPDATE_MS === undefined ? DEFAULT_UPDATE_MS : Number(process.env.GMNEW_UPDATE_MS);
const DEFAULT_INITIALIZE = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gm-new-core', version: '1' } };
const LISTS = { 'tools/list': 'tools', 'prompts/list': 'prompts', 'resources/list': 'resources' };
const NOTICE = { tools: 'notifications/tools/list_changed', prompts: 'notifications/prompts/list_changed', resources: 'notifications/resources/list_changed' };
const PAUSED_BEFORE_ANSWER = 'the worker paused before it answered this call; query_log shows what it did, then repeat the call if it did nothing';

const argv = process.argv.slice(2);
// The probe loads this file and its imports, then stops before any side effect. A handover runs it before the new code takes over.
if (argv.includes('--probe')) {
  process.stdout.write('probe ok\n');
  process.exit(0);
}

const TAKEOVER = argv.includes('--takeover');
const SESSION_OPT = optionValue(argv, '--session');
const HOST_ARGS = withoutOptions(argv.filter((arg) => arg !== '--takeover'), ['--session']);
// A session is one relay's run choice and host state. A respawned core finds it by the relay's pid and start time. A handover names it.
const SESSION_NAME = SESSION_OPT ?? `${process.ppid}-${startTimeOf(process.ppid)}`;
const SESSION_FILE = join(SESSIONS, `${SESSION_NAME}.json`);
const LOADED = digestOfFiles();

let child = null;
let state = 'starting'; // starting, running, draining, restarting, handing-over, stopping, or failed
let swapping = false; // true while a restart decides which list notices the host gets
let runDir = null;
let hostInitialize = null;
let seen = {}; // a digest of each list as the host last fetched it, by kind
let heldLines = []; // host lines held while the worker starts, restarts or the core hands over
let inputBuffer = ''; // host input after its last line break
let inputOn = false;
const inflight = new Map(); // ids of host requests sent to the worker, with their methods
const shellCalls = new Set(); // ids of the host's run_shell calls in flight, which a cancel ends with no answer (see cancelShell)
const coreRequests = new Map(); // ids the core sent to the worker itself, with the function that takes each reply
let handshake = null;
let onDrained = null;
let failure = '';
let stderrTail = '';
let retryDelay = RETRY_MIN_MS;
let retryTimer = null;
const workerWaiters = [];
const pending = []; // transitions waiting to run: a restart of the worker, or a handover to new code
let pumping = false;
let sourceTimer = null;
let skillTimer = null;
let coreTimer = null;
let updatesStarted = false;

function say(message) {
  process.stderr.write(`gm-new core: ${message}\n`);
}

function writeHost(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function writeLine(line) {
  process.stdout.write(`${line}\n`);
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

function digestOf(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function digestOfFiles() {
  return createHash('sha256').update(readFileSync(CORE_FILE)).update(readFileSync(UPDATE_FILE)).digest('hex');
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

function newRunId() {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `${stamp}-${randomBytes(3).toString('hex')}`;
}

// The run directory of a fresh session. --run-dir names it; --runs with --resume resumes it; --runs alone starts a new one under it. With none
// of them, the run is <workspace>/runs/<session>, so a run never lands in the checkout that holds this code.
function chooseRunDir(args) {
  const explicit = optionValue(args, '--run-dir');
  if (explicit !== undefined) return resolve(explicit);
  const runsRoot = optionValue(args, '--runs');
  const resumeId = optionValue(args, '--resume');
  if (runsRoot === undefined) {
    if (resumeId !== undefined) throw new Error('--resume needs --runs');
    const workspace = optionValue(args, '--workspace');
    if (workspace === undefined) throw new Error('a run needs --workspace, --run-dir or --runs');
    return join(resolve(workspace), 'runs', SESSION_NAME);
  }
  const root = resolve(runsRoot);
  if (resumeId !== undefined) {
    if (!/^[A-Za-z0-9_-]+$/.test(resumeId)) throw new Error('--resume takes a run id');
    const dir = join(root, resumeId);
    if (!existsSync(join(dir, 'log.jsonl'))) throw new Error(`no run ${resumeId} under ${root}`);
    return dir;
  }
  return join(root, newRunId());
}

// The start time of a process, in clock ticks since boot, from /proc. It tells a reused pid from the relay that started the session.
function startTimeOf(pid) {
  try {
    const text = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return text.slice(text.lastIndexOf(')') + 2).split(' ')[19] ?? '0';
  } catch {
    return '0';
  }
}

function loadSession() {
  try {
    return JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
  } catch {
    return null;
  }
}

// The held lines and the input after the last line break are written only by a handover, so a respawn never replays them twice.
function saveSession(extra = {}) {
  if (runDir === null) return;
  mkdirSync(SESSIONS, { recursive: true });
  const tmp = `${SESSION_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify({ runDir, hostInitialize, seen, held: [], leftover: '', ...extra }));
  renameSync(tmp, SESSION_FILE);
}

// The resident memory of a child process in MB, read from /proc. Zero where /proc is missing, so the limit is not applied there.
function residentMB(proc) {
  try {
    const match = /VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${proc.pid}/status`, 'utf8'));
    return match ? Number(match[1]) / 1024 : 0;
  } catch {
    return 0;
  }
}

function firstLine(text) {
  return String(text).split('\n').find((line) => line.trim() !== '') ?? '';
}

// Host input. The core frames it itself, so the input after the last line break can be handed to a new core.
function startInput() {
  if (inputOn) return;
  inputOn = true;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', onInput);
  process.stdin.on('end', shutdown);
  process.stdin.resume();
  onInput('');
}

function stopInput() {
  if (!inputOn) return;
  inputOn = false;
  process.stdin.off('data', onInput);
  process.stdin.off('end', shutdown);
  process.stdin.pause();
}

function onInput(chunk) {
  inputBuffer += chunk;
  for (;;) {
    const at = inputBuffer.indexOf('\n');
    if (at < 0) return;
    const line = inputBuffer.slice(0, at).replace(/\r$/, '');
    inputBuffer = inputBuffer.slice(at + 1);
    if (line.trim() !== '') onHostLine(line);
  }
}

function onHostLine(line) {
  const message = parse(line);
  if (message?.method === 'initialize') {
    hostInitialize = message.params ?? {};
    saveSession();
  }
  if (state !== 'running') {
    hold(line, message);
    return;
  }
  if (message?.id !== undefined && message.method) {
    inflight.set(message.id, message.method);
    if (isShellCall(message)) shellCalls.add(message.id);
  }
  if (message?.method === 'notifications/cancelled') cancelShell(message.params?.requestId);
  child.stdin.write(`${line}\n`);
}

// A run_shell call is killed by a cancel, and the worker sends no answer for it (src/mcp.mjs, cancelRequest). The core stops counting such a
// request when its cancel passes, or a restart would wait for an answer that never comes. Any other request is answered by the worker, so it
// stays counted until that answer.
function isShellCall(message) {
  return message.method === 'tools/call' && message.params?.name === 'run_shell';
}

function cancelShell(requestId) {
  if (!shellCalls.delete(requestId)) return;
  inflight.delete(requestId);
  if (onDrained && inflight.size === 0) onDrained();
}

function hold(line, message) {
  if (state === 'failed') {
    if (message?.id !== undefined && message.method) writeHost(errorReply(message.id, failure));
    return;
  }
  heldLines.push(line);
}

function flushHeld() {
  const lines = heldLines.splice(0);
  for (const line of lines) onHostLine(line);
}

// The worker's output. A reply to a host request passes to the host; a reply to a core request goes to the function that asked; the
// list digests of the host's own list requests are recorded; and the worker's list notices are dropped while a restart decides them.
function onChildLine(line) {
  if (line.trim() === '') return;
  const message = parse(line);
  if (message?.id === HANDSHAKE_ID) {
    handshake?.answer(message);
    return;
  }
  if (message?.id !== undefined && coreRequests.has(message.id)) {
    coreRequests.get(message.id)(message);
    return;
  }
  if (message?.id !== undefined && message?.id !== null) {
    const method = inflight.get(message.id);
    inflight.delete(message.id);
    shellCalls.delete(message.id);
    if (LISTS[method] !== undefined && message.result !== undefined) {
      seen[LISTS[method]] = digestOf(message.result);
      saveSession();
    }
  }
  if (swapping && typeof message?.method === 'string' && message.method.endsWith('list_changed')) return;
  writeLine(line);
  if (onDrained && inflight.size === 0) onDrained();
  if (state === 'running' && child !== null && residentMB(child) > MEMORY_LIMIT_MB) {
    requestTransition('restart', `memory limit ${MEMORY_LIMIT_MB} MB passed`);
  }
}

function workerArgs(reason) {
  const args = [WORKER, ...withoutOptions(HOST_ARGS, ['--runs', '--resume', '--run-dir']), '--run-dir', runDir];
  if (reason) args.push('--restart-reason', reason);
  args.push('--supervised', 'yes');
  return args;
}

function startWorker(reason) {
  const proc = spawn(process.execPath, workerArgs(reason), { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
  child = proc;
  proc.stdin.on('error', () => {});
  proc.stderr.on('data', (chunk) => {
    const text = String(chunk);
    stderrTail = (stderrTail + text).slice(-4000);
    process.stderr.write(text);
  });
  createInterface({ input: proc.stdout }).on('line', onChildLine);
  proc.on('exit', (code, signal) => onWorkerExit(proc, code, signal));
}

function onWorkerExit(proc, code, signal) {
  if (proc !== child) return;
  child = null;
  const how = signal ?? `code ${code}`;
  if (handshake) {
    handshake.fail(new Error(`the worker exited (${how}) before the handshake`));
    return;
  }
  if (state !== 'running') return;
  // A worker that exits 0 with the run open paused itself on SIGTERM (src/mcp.mjs pauseRun), so a restart follows at once and new calls are held.
  if (signal === null && code === 0) {
    state = 'restarting';
    for (const id of inflight.keys()) writeHost(errorReply(id, PAUSED_BEFORE_ANSWER));
    inflight.clear();
    shellCalls.clear();
    requestTransition('restart', 'the worker paused itself');
    return;
  }
  failWith(`the worker exited unexpectedly (${how})`);
}

async function stopWorker() {
  const proc = child;
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  const exited = new Promise((resolveExit) => proc.once('exit', resolveExit));
  proc.kill('SIGTERM');
  const force = setTimeout(() => proc.kill('SIGKILL'), EXIT_MS);
  await exited;
  clearTimeout(force);
}

// The handshake replays the host's initialize to the new worker, as a restart does. With no initialize from the host yet, there is none.
function replayHandshake() {
  if (hostInitialize === null) return Promise.resolve();
  return new Promise((resolveHandshake, rejectHandshake) => {
    const timer = setTimeout(() => {
      handshake = null;
      rejectHandshake(new Error('the worker did not answer the handshake'));
    }, HANDSHAKE_MS);
    handshake = {
      answer(message) {
        clearTimeout(timer);
        handshake = null;
        if (message.error) {
          rejectHandshake(new Error(message.error.message));
          return;
        }
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
        resolveHandshake();
      },
      fail(err) {
        clearTimeout(timer);
        handshake = null;
        rejectHandshake(err);
      },
    };
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: HANDSHAKE_ID, method: 'initialize', params: hostInitialize ?? DEFAULT_INITIALIZE })}\n`);
  });
}

// The worker's state for the update check. A report is taken once, by the next wait that is still open.
function setWorkerState(next, reason) {
  for (const waiter of workerWaiters.splice(0)) waiter.resolve(reason === undefined ? { state: next } : { state: next, reason });
}

function nextWorkerEvent(timeoutMs) {
  return new Promise((resolveNext) => {
    const waiter = {
      resolve: (event) => {
        clearTimeout(timer);
        resolveNext(event);
      },
    };
    const timer = setTimeout(() => {
      const at = workerWaiters.indexOf(waiter);
      if (at >= 0) workerWaiters.splice(at, 1);
      resolveNext(null);
    }, timeoutMs);
    workerWaiters.push(waiter);
  });
}

function markRunning() {
  state = 'running';
  retryDelay = RETRY_MIN_MS;
  clearTimeout(retryTimer);
  retryTimer = null;
  setWorkerState('running');
  say(`worker running (pid ${child.pid})`);
}

function failWith(reason) {
  state = 'failed';
  setWorkerState('failed', reason);
  failure = `${reason}. Last stderr of the worker:\n${stderrTail.slice(-1500)}`;
  for (const id of inflight.keys()) writeHost(errorReply(id, failure));
  inflight.clear();
  shellCalls.clear();
  for (const line of heldLines.splice(0)) {
    const message = parse(line);
    if (message?.id !== undefined && message.method) writeHost(errorReply(message.id, failure));
  }
  scheduleRetry();
}

// A failed start retries by itself, with no change needed: 1 s, then doubling to a 30 s cap. Calls that arrive while it is failed are
// answered with the failure text at once, so none is held silently.
function scheduleRetry() {
  clearTimeout(retryTimer);
  const delay = retryDelay;
  retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
  say(`retrying the worker start in ${delay} ms`);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (state === 'failed') requestTransition('restart', 'retry after a failed start');
  }, delay);
}

// No timeout: a restart waits until every call in flight has its result logged.
function waitForDrain() {
  if (inflight.size === 0) return Promise.resolve();
  return new Promise((resolveDrain) => {
    onDrained = () => {
      onDrained = null;
      resolveDrain();
    };
  });
}

// The core asks the worker for a list itself. The reply is compared with the digest the host last fetched.
function askWorker(method) {
  const id = `gm-new-core:${method}`;
  return new Promise((resolveAsk) => {
    const timer = setTimeout(() => {
      coreRequests.delete(id);
      resolveAsk(null);
    }, LIST_MS);
    coreRequests.set(id, (message) => {
      clearTimeout(timer);
      coreRequests.delete(id);
      resolveAsk(message.error === undefined ? (message.result ?? null) : null);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params: {} })}\n`);
  });
}

// After a restart, the lists the new worker serves are compared with the lists the host last fetched. A kind that differs gets its list
// notice. A kind the host has never fetched gets none. Nothing is sent when nothing differs.
async function announceChanges() {
  const now = {};
  for (const [method, kind] of Object.entries(LISTS)) {
    const result = await askWorker(method);
    if (result !== null) now[kind] = digestOf(result);
  }
  for (const [kind, digest] of Object.entries(now)) {
    if (seen[kind] !== undefined && seen[kind] !== digest) writeHost({ jsonrpc: '2.0', method: NOTICE[kind] });
  }
}

// A change to reloadable modules is applied in the running worker. The worker builds the new code beside the old and swaps it in only when
// every module loads. A refused reload leaves the old code serving, and the core says why. A worker that does not answer is restarted.
async function reload(reason) {
  if (state !== 'running') return { ok: false, reason: `the worker is ${state}` };
  say(`reloading in place (${reason})`);
  const answer = await askWorker('core/reload');
  if (answer === null) return restart('the reload did not answer');
  if (answer.ok !== true) {
    say(`reload refused, the old code keeps serving: ${answer.error}`);
    return { ok: false, reason: answer.error };
  }
  say(`reloaded in place: generation ${answer.generation}`);
  await announceChanges().catch(() => {});
  return { ok: true };
}

// A change the worker serves in place: nothing restarts, and the host is told of any list whose content changed.
async function refresh(reason) {
  if (state !== 'running') return { ok: false, reason: `the worker is ${state}` };
  say(`refreshing the lists (${reason})`);
  await announceChanges().catch(() => {});
  return { ok: true };
}

async function restart(reason) {
  say(`restarting the worker (${reason})`);
  if (state === 'running') {
    state = 'draining';
    await waitForDrain();
  }
  state = 'restarting';
  swapping = true;
  try {
    await stopWorker();
    startWorker(reason);
    await replayHandshake();
    markRunning();
    await announceChanges().catch(() => {});
    flushHeld();
  } catch (err) {
    failWith(`the worker failed to restart (${err.message})`);
  } finally {
    swapping = false;
  }
  return { ok: state === 'running' };
}

// Why the worker's work must not be interrupted now, or null when it may be restarted. A tool call in flight is work. So is a body or job
// that the current run still has running or queued, which its status files say.
function busyReason() {
  let calls = 0;
  for (const method of inflight.values()) if (method === 'tools/call') calls += 1;
  if (calls > 0) return `${calls} tool call(s) in flight`;
  if (runDir === null) return null;
  const jobsDir = join(currentRunDir(runDir), 'jobs');
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

// The checks of the new code: a syntax check of both files, then a load of this file, which stops before any side effect.
async function probeNewCore() {
  for (const file of [CORE_FILE, UPDATE_FILE]) {
    const syntax = await runNode(['--check', file]);
    if (syntax.code !== 0) return `syntax error in ${relative(ROOT, file)}: ${firstLine(syntax.err)}`;
  }
  const load = await runNode([CORE_FILE, '--probe']);
  if (load.code !== 0 || !load.out.includes('probe ok')) return `the new code does not load: ${firstLine(load.err) || 'no output'}`;
  return null;
}

function runNode(args) {
  return new Promise((resolveRun) => {
    const proc = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout.on('data', (chunk) => {
      out += chunk;
    });
    proc.stderr.on('data', (chunk) => {
      err += chunk;
    });
    const timer = setTimeout(() => proc.kill('SIGKILL'), CHECK_MS);
    proc.on('error', (error) => {
      clearTimeout(timer);
      resolveRun({ code: -1, out, err: error.message });
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      resolveRun({ code, out, err });
    });
  });
}

// The new core's answer on fd 3: ready when its worker runs, or failed with the reason. A new core that exits first has failed.
function waitForAck(next) {
  return new Promise((resolveAck) => {
    let text = '';
    const done = (answer) => {
      clearTimeout(timer);
      resolveAck(answer);
    };
    const timer = setTimeout(() => {
      next.kill('SIGKILL');
      done(`no answer within ${ACK_MS} ms`);
    }, ACK_MS);
    next.on('error', (err) => done(err.message));
    next.on('exit', (code, signal) => done(`exited (${signal ?? `code ${code}`})`));
    next.stdio[3].on('data', (chunk) => {
      text += chunk;
      const at = text.indexOf('\n');
      if (at >= 0) done(text.slice(0, at));
    });
  });
}

function acknowledge(message) {
  try {
    writeSync(3, `${message}\n`);
  } catch (err) {
    say(`cannot acknowledge the handover: ${err.message}`);
  }
}

// Replaces this core with the code on disk. It returns { ok: false, reason } when the new code did not take over; this core then goes on.
// On success this process exits, and the new core owns the host's pipe.
async function handOver(reason) {
  if (digestOfFiles() === LOADED) return { ok: true, unchanged: true };
  const problem = await probeNewCore();
  if (problem !== null) {
    say(`not handing over: ${problem}`);
    return { ok: false, reason: problem };
  }
  say(`handing over to the new code (${reason})`);
  if (state === 'running') {
    state = 'draining';
    await waitForDrain();
  }
  state = 'handing-over';
  await stopWorker();
  stopInput();
  saveSession({ held: heldLines, leftover: inputBuffer });
  const next = spawn(process.execPath, [CORE_FILE, ...HOST_ARGS, '--session', SESSION_NAME, '--takeover'], { cwd: ROOT, stdio: [0, 1, 2, 'pipe'] });
  const answer = await waitForAck(next);
  if (answer === 'ready') {
    say('the new code took over; this process exits');
    process.exit(HANDOVER_EXIT);
  }
  say(`the new code did not take over (${answer}); this core goes on`);
  saveSession();
  startInput();
  await restart(`the handover did not complete (${answer})`);
  return { ok: false, reason: answer };
}

// Transitions run one at a time. A restart is not queued twice, and a queued handover makes a queued restart unneeded, because the new
// code starts its worker itself.
function requestTransition(kind, reason) {
  if (kind === 'restart' && pending.some((job) => job.kind === 'restart' || job.kind === 'handover')) return Promise.resolve(null);
  // A refresh is redundant when a transition is queued: a restart announces the lists itself, and a queued refresh already covers this change.
  if (kind === 'refresh' && pending.length > 0) return Promise.resolve(null);
  if (kind === 'reload' && pending.some((job) => job.kind === 'restart' || job.kind === 'handover')) return Promise.resolve(null);
  return new Promise((resolveJob) => {
    pending.push({ kind, reason, resolve: resolveJob });
    pump();
  });
}

const TRANSITIONS = {
  restart: (reason) => restart(reason),
  refresh: (reason) => refresh(reason),
  reload: (reason) => reload(reason),
  handover: (reason) => handOver(reason),
};

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (pending.length > 0) {
      const job = pending.shift();
      try {
        job.resolve(await TRANSITIONS[job.kind](job.reason));
      } catch (err) {
        say(`the ${job.kind} failed: ${err.message}`);
        job.resolve({ ok: false, reason: err.message });
      }
    }
  } finally {
    pumping = false;
  }
}

// Starts this core. A fresh start chooses the run. A respawn resumes the run and the host state of its session, and a takeover does the same
// for a core that handed over, then acknowledges it on fd 3 once its worker runs and it can read the host's input.
async function begin(mode) {
  const saved = mode === 'fresh' ? null : loadSession();
  if (mode !== 'fresh' && saved === null) throw new Error(`no session ${SESSION_NAME} to resume`);
  runDir = saved?.runDir ?? chooseRunDir(HOST_ARGS);
  hostInitialize = saved?.hostInitialize ?? null;
  seen = saved?.seen ?? {};
  heldLines = mode === 'takeover' ? [...(saved.held ?? [])] : [];
  inputBuffer = mode === 'takeover' ? (saved.leftover ?? '') : '';
  saveSession();
  say(`${mode === 'fresh' ? 'starting' : mode === 'takeover' ? 'took over' : 'restarted'} on run ${runDir} (pid ${process.pid})`);
  if (!updatesStarted) {
    updatesStarted = true;
    startUpdates({ root: ROOT, everyMs: UPDATE_MS, log: (message) => say(`update: ${message}`), busy: busyReason, nextWorkerEvent, replaceCore: (reason) => requestTransition('handover', reason) });
  }
  if (mode !== 'takeover') startInput();
  startWorker(mode === 'fresh' ? null : mode === 'takeover' ? 'core replaced' : 'core restarted after its exit');
  try {
    await replayHandshake();
  } catch (err) {
    if (mode === 'takeover') {
      acknowledge(`failed ${err.message}`);
      await stopWorker();
      process.exit(1);
    }
    failWith(`the worker did not start (${err.message})`);
    return;
  }
  markRunning();
  if (mode === 'takeover') {
    acknowledge('ready');
    startInput();
  }
  if (mode !== 'fresh') await announceChanges().catch(() => {});
  flushHeld();
}

function shutdown() {
  say('the host closed the input; pausing the worker');
  pause(0);
}

// The end of this process: the worker is paused first, with SIGTERM, so its run stays open for the next start.
async function pause(code) {
  state = 'stopping';
  await stopWorker();
  process.exit(code);
}

// Changes under src/ are gathered for one debounce window. Only a module the worker loads counts: a module it does not load restarts nothing.
// A window of those that are all reloadable modules is applied in place. Any other window restarts the worker.
const changedSource = new Set();
function onSourceChange(_event, file) {
  if (!file || !WATCHED_FILE.test(file)) return;
  changedSource.add(file);
  clearTimeout(sourceTimer);
  sourceTimer = setTimeout(() => {
    const changed = [...changedSource];
    changedSource.clear();
    const files = loadedByWorker(changed, workerModulesOf(ROOT));
    if (files.length === 0) {
      say(`not loaded by the worker, so nothing restarts: ${changed.map((name) => `src/${name}`).join(', ')}`);
      return;
    }
    const inPlace = files.every((name) => RELOADABLE.includes(name));
    requestTransition(inPlace ? 'reload' : 'restart', `changed: ${files.join(', ')}`);
  }, DEBOUNCE_MS);
}

// A skill file is served in place, so a change to it only refreshes the host's lists. Its own timer, so a change to src/ is not lost.
function onSkillChange(_event, file) {
  if (!file || !WATCHED_FILE.test(file)) return;
  clearTimeout(skillTimer);
  skillTimer = setTimeout(() => requestTransition('refresh', `changed: skills/${file}`), DEBOUNCE_MS);
}

function onCoreChange(_event, file) {
  if (file !== 'core.mjs' && file !== 'update.mjs') return;
  clearTimeout(coreTimer);
  coreTimer = setTimeout(() => requestTransition('handover', `changed: tools/${file}`), DEBOUNCE_MS);
}

for (const dir of WATCHED) if (existsSync(dir)) watch(dir, { recursive: true }, dir === SKILLS_DIR ? onSkillChange : onSourceChange);
watch(HERE, onCoreChange);
process.once('SIGINT', () => pause(0));
process.once('SIGTERM', () => pause(0));
// A crash this file can catch pauses the worker before it exits, so the run stays open for the respawn.
process.on('uncaughtException', (err) => {
  say(`crashed: ${err?.stack ?? err}`);
  pause(1);
});
process.on('unhandledRejection', (err) => {
  say(`crashed: ${err?.stack ?? err}`);
  pause(1);
});

const MODE = TAKEOVER ? 'takeover' : existsSync(SESSION_FILE) ? 'respawn' : 'fresh';
begin(MODE).catch((err) => {
  say(`cannot start: ${err.message}`);
  process.exit(1);
});
