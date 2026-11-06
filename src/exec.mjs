import { spawn } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync } from 'node:fs';

const POSIX_SHELL = process.platform !== 'win32' && existsSync('/bin/bash') ? '/bin/bash' : null;
const OUTPUT_CAP = 200000;
const KILL_GRACE_MS = 500;
export const foregroundGroups = new Set();
export const bodyContext = new AsyncLocalStorage();
const bodyGroups = new Map();

export function childEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.ANTHROPIC_API_KEY;
  return env;
}

export function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

export function spawnGroup(file, args, cwd, stdio, { shell = false, env = {} } = {}) {
  if (shell && POSIX_SHELL) return spawn(POSIX_SHELL, ['-c', [file, ...args].join(' ')], { cwd, env: childEnv(env), detached: true, windowsHide: true, stdio });
  return spawn(file, args, { cwd, env: childEnv(env), shell, detached: true, windowsHide: true, stdio });
}

export async function killGroup(pid) {
  if (process.platform === 'win32') return taskkillTree(pid);
  if (!signalGroup(pid, 'SIGTERM')) return;
  await sleep(KILL_GRACE_MS);
  signalGroup(pid, 'SIGKILL');
}

export function killGroupNow(pid) {
  if (process.platform === 'win32') return taskkillTree(pid);
  signalGroup(pid, 'SIGKILL');
  return undefined;
}

export function killBody(body) {
  for (const [pid, owner] of bodyGroups) if (owner === body) killGroupNow(pid);
}

export function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

export function runCommand(file, args, { cwd, timeoutMs, shell = false, env = {}, signal: abort = undefined }) {
  return new Promise((done) => {
    let output = '';
    let timedOut = false;
    let cancelled = false;
    const collect = (chunk) => {
      if (output.length < OUTPUT_CAP) output += chunk;
    };
    const child = spawnGroup(file, args, cwd, ['ignore', 'pipe', 'pipe'], { shell, env });
    if (child.pid !== undefined) foregroundGroups.add(child.pid);
    const body = bodyContext.getStore()?.body;
    if (child.pid !== undefined && body !== undefined) bodyGroups.set(child.pid, body);
    const stopOnCancel = () => {
      cancelled = true;
      killGroup(child.pid);
    };
    if (abort?.aborted === true) stopOnCancel();
    else abort?.addEventListener('abort', stopOnCancel, { once: true });
    child.on('exit', () => killGroupNow(child.pid));
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid).then(() => {
        done({ ok: false, timedOut: true, error: `timed out after ${timeoutMs} ms`, output: output.slice(0, OUTPUT_CAP) });
      });
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      abort?.removeEventListener('abort', stopOnCancel);
      foregroundGroups.delete(child.pid);
      bodyGroups.delete(child.pid);
      done({ ok: false, error: err.message });
    });
    child.on('close', (exitCode, exitSignal) => {
      clearTimeout(timer);
      abort?.removeEventListener('abort', stopOnCancel);
      foregroundGroups.delete(child.pid);
      bodyGroups.delete(child.pid);
      if (timedOut) return;
      if (cancelled) {
        done({ ok: false, cancelled: true, error: 'cancelled by the host', exitCode, signal: exitSignal, output: output.slice(0, OUTPUT_CAP) });
        return;
      }
      done({ ok: exitCode === 0, exitCode, signal: exitSignal, output: output.slice(0, OUTPUT_CAP) });
    });
  });
}

function taskkillTree(pid) {
  return new Promise((done) => {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', done);
    killer.on('close', done);
  });
}
