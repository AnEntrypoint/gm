#!/usr/bin/env node
// Hot-reload supervisor, run as a plain local process. It holds the host's stdio connection and runs the worker
// (src/mcp.mjs) as a child. When a file under src/ or skills/ changes, it holds new host requests, waits for calls in
// flight to answer, asks the worker to pause (SIGTERM, then SIGKILL after EXIT_MS), starts a new worker on the same run
// directory, replays the MCP handshake, and tells the host that its tool, prompt and resource lists may have changed.
// The new worker resumes the run from its log. A call in flight is never interrupted or answered with an error: the
// restart waits until its result is logged.
import { spawn } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newRunId } from '../src/run.mjs';

const ROOT = process.env.GMNEW_ROOT ? resolve(process.env.GMNEW_ROOT) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = join(ROOT, 'src', 'mcp.mjs');
const WATCHED = [join(ROOT, 'src'), join(ROOT, 'skills')];
const WATCHED_FILE = /\.(mjs|md)$/;
const DEBOUNCE_MS = 250;
const EXIT_MS = 5000;
const HANDSHAKE_MS = 10000;
const HANDSHAKE_ID = 'gm-new-supervisor-handshake';
const HOST_CHANGED = ['notifications/tools/list_changed', 'notifications/prompts/list_changed', 'notifications/resources/list_changed'];
const DEFAULT_INITIALIZE = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gm-new-supervisor', version: '1' } };

// Each server start gets its own run under --runs, unless --resume names an existing run. The run is chosen once per
// session, so every restart of this session's worker resumes the same run. --run-dir still names a run directly.
const { argv, runDir } = chooseRun(process.argv.slice(2));

function chooseRun(args) {
  const runsRoot = optionValue(args, '--runs');
  const resumeId = optionValue(args, '--resume');
  const rest = withoutOptions(args, ['--runs', '--resume']);
  if (optionValue(args, '--run-dir') !== undefined) return { argv: rest, runDir: resolve(optionValue(args, '--run-dir')) };
  if (runsRoot === undefined) {
    if (resumeId !== undefined) throw new Error('--resume needs --runs');
    const dir = join(ROOT, 'runs', newRunId());
    return { argv: [...rest, '--run-dir', dir], runDir: dir };
  }
  const root = resolve(runsRoot);
  if (resumeId !== undefined) {
    if (!/^[A-Za-z0-9_-]+$/.test(resumeId)) throw new Error('--resume takes a run id');
    const dir = join(root, resumeId);
    if (!existsSync(join(dir, 'log.jsonl'))) throw new Error(`no run ${resumeId} under ${root}`);
    return { argv: [...rest, '--run-dir', dir], runDir: dir };
  }
  const dir = join(root, newRunId());
  return { argv: [...rest, '--run-dir', dir], runDir: dir };
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

let child = null;
let state = 'starting'; // running, draining, restarting, or failed
let hostInitialize = null;
let failure = '';
let stderrTail = '';
const inflight = new Map(); // request ids sent to the worker and not yet answered
const held = []; // host lines held while the worker restarts
let handshake = null;
let onDrained = null;
let restartBusy = null;
let restartQueued = null;

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
  if (state !== 'running') {
    hold(line, message);
    return;
  }
  if (message?.id !== undefined && message.method) inflight.set(message.id, true);
  child.stdin.write(`${line}\n`);
}

function hold(line, message) {
  if (state === 'failed') {
    if (message?.id !== undefined && message.method) writeHost(errorReply(message.id, failure));
    return;
  }
  held.push(line);
}

function onChildLine(line) {
  if (line.trim() === '') return;
  const message = parse(line);
  if (message?.id === HANDSHAKE_ID) {
    if (handshake) handshake.answer(message);
    return;
  }
  if (message?.id !== undefined && message?.id !== null) inflight.delete(message.id);
  process.stdout.write(`${line}\n`);
  if (onDrained && inflight.size === 0) onDrained();
}

function startWorker(reason) {
  const args = [WORKER, ...argv];
  if (reason) args.push('--restart-reason', reason);
  const proc = spawn(process.execPath, args, { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
  child = proc;
  proc.stdin.on('error', () => {});
  proc.stderr.on('data', (chunk) => {
    const text = String(chunk);
    stderrTail = (stderrTail + text).slice(-4000);
    process.stderr.write(text);
  });
  createInterface({ input: proc.stdout }).on('line', onChildLine);
  proc.on('exit', (code, signal) => onWorkerExit(proc, code, signal));
  return proc;
}

function onWorkerExit(proc, code, signal) {
  if (proc !== child) return;
  child = null;
  const how = signal ?? `code ${code}`;
  if (handshake) {
    handshake.fail(new Error(`the worker exited (${how}) before the handshake`));
    return;
  }
  if (state === 'running') failWith(`the worker exited unexpectedly (${how})`);
}

function failWith(reason) {
  state = 'failed';
  failure = `${reason}. Last stderr of the worker:\n${stderrTail.slice(-1500)}`;
  for (const id of inflight.keys()) writeHost(errorReply(id, failure));
  inflight.clear();
  for (const line of held.splice(0)) {
    const message = parse(line);
    if (message?.id !== undefined && message.method) writeHost(errorReply(message.id, failure));
  }
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

async function stopWorker() {
  const proc = child;
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  const exited = new Promise((resolveExit) => proc.once('exit', resolveExit));
  proc.kill('SIGTERM');
  const force = setTimeout(() => proc.kill('SIGKILL'), EXIT_MS);
  await exited;
  clearTimeout(force);
}

function replayHandshake() {
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

async function restart(reason) {
  process.stderr.write(`gm-new dev: restarting the worker (${reason})\n`);
  if (state === 'running') {
    state = 'draining';
    await waitForDrain();
  }
  state = 'restarting';
  await stopWorker();
  try {
    startWorker(reason);
    await replayHandshake();
    state = 'running';
    for (const method of HOST_CHANGED) writeHost({ jsonrpc: '2.0', method });
    for (const line of held.splice(0)) onHostLine(line);
  } catch (err) {
    failWith(`the worker failed to restart (${err.message})`);
  }
}

function scheduleRestart(reason) {
  if (restartBusy) {
    restartQueued = reason;
    return;
  }
  restartBusy = restart(reason).finally(() => {
    restartBusy = null;
    if (restartQueued) {
      const next = restartQueued;
      restartQueued = null;
      scheduleRestart(next);
    }
  });
}

let watchTimer = null;
function onSourceChange(_event, file) {
  if (!file || !WATCHED_FILE.test(file)) return;
  clearTimeout(watchTimer);
  watchTimer = setTimeout(() => scheduleRestart(`changed: ${file}`), DEBOUNCE_MS);
}

function shutdown() {
  if (!child) process.exit(0);
  child.once('exit', () => process.exit(0));
  child.stdin.end();
}

startWorker(null);
state = 'running';
for (const dir of WATCHED) if (existsSync(dir)) watch(dir, { recursive: true }, onSourceChange);
createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', onHostLine).on('close', shutdown);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, shutdown);
