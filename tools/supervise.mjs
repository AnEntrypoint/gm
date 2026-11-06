#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, watch } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.GMNEW_ROOT ? resolve(process.env.GMNEW_ROOT) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = join(ROOT, 'src', 'mcp.mjs');
const WATCHED = [join(ROOT, 'src'), join(ROOT, 'skills')];
const WATCHED_FILE = /\.(mjs|md)$/;
const DEBOUNCE_MS = 250;
const EXIT_MS = 5000;
const MEMORY_LIMIT_MB = Number(process.env.GMNEW_MEMORY_LIMIT_MB ?? 512);
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30000;
const HANDSHAKE_MS = 10000;
const HANDSHAKE_ID = 'gm-supervisor-handshake';
const HOST_CHANGED = ['notifications/tools/list_changed', 'notifications/prompts/list_changed', 'notifications/resources/list_changed'];
const DEFAULT_INITIALIZE = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gm-supervisor', version: '1' } };
const READY_METHOD = 'gm/ready';

const argv = process.argv.slice(2);
const START_REASON = process.env.GMNEW_CORE_REASON || null;
const INITIAL_INITIALIZE = process.env.GMNEW_HOST_INITIALIZE ? JSON.parse(process.env.GMNEW_HOST_INITIALIZE) : null;
delete process.env.GMNEW_CORE_REASON;
delete process.env.GMNEW_HOST_INITIALIZE;

let retryDelay = RETRY_MIN_MS;
let retryTimer = null;
let child = null;
let state = 'starting';
let hostInitialize = INITIAL_INITIALIZE;
let failure = '';
let stderrTail = '';
const inflight = new Map();
const held = [];
let handshake = null;
let onDrained = null;
let restartBusy = null;
let restartQueued = null;

function writeHost(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reportWorker(next, reason) {
  writeHost({ jsonrpc: '2.0', method: 'gm/worker', params: reason === undefined ? { state: next } : { state: next, reason } });
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
  if (message?.method === READY_METHOD) {
    if (state === 'running') writeHost({ jsonrpc: '2.0', id: message.id, result: {} });
    else hold(line, message);
    return;
  }
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

function residentMB(proc) {
  try {
    const match = /VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${proc.pid}/status`, 'utf8'));
    return match ? Number(match[1]) / 1024 : 0;
  } catch {
    return 0;
  }
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
  if (state === 'running' && child !== null && residentMB(child) > MEMORY_LIMIT_MB) scheduleRestart(`memory limit ${MEMORY_LIMIT_MB} MB passed`);
}

function startWorker(reason) {
  const args = [WORKER, ...argv];
  if (reason) args.push('--restart-reason', reason);
  args.push('--supervised', 'yes');
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

function scheduleRetry() {
  clearTimeout(retryTimer);
  const delay = retryDelay;
  retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
  process.stderr.write(`gm dev: retrying the restart in ${delay} ms\n`);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (state === 'failed') scheduleRestart('retry after a failed restart');
  }, delay);
}

function failWith(reason) {
  state = 'failed';
  reportWorker('failed', reason);
  failure = `${reason}. Last stderr of the worker:\n${stderrTail.slice(-1500)}`;
  for (const id of inflight.keys()) writeHost(errorReply(id, failure));
  inflight.clear();
  for (const line of held.splice(0)) {
    const message = parse(line);
    if (message?.id !== undefined && message.method) writeHost(errorReply(message.id, failure));
  }
  scheduleRetry();
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
  process.stderr.write(`gm dev: restarting the worker (${reason})\n`);
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
    reportWorker('running');
    retryDelay = RETRY_MIN_MS;
    clearTimeout(retryTimer);
    retryTimer = null;
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
  pause(0);
}

if (hostInitialize === null) {
  startWorker(START_REASON);
  state = 'running';
  reportWorker('running');
} else {
  scheduleRestart(START_REASON ?? 'the supervisor was replaced');
}
for (const dir of WATCHED) if (existsSync(dir)) watch(dir, { recursive: true }, onSourceChange);
createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', onHostLine).on('close', shutdown);
process.once('SIGINT', shutdown);
process.once('SIGTERM', () => pause(0));
process.on('uncaughtException', (err) => crash(err));
process.on('unhandledRejection', (err) => crash(err));

async function pause(code) {
  await stopWorker();
  process.exit(code);
}

async function crash(err) {
  process.stderr.write(`gm dev: the supervisor crashed: ${err?.stack ?? err}\n`);
  await pause(1);
}
