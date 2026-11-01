import { spawn } from 'node:child_process';

const OUTPUT_CAP = 200000;
const KILL_GRACE_MS = 500;
export const foregroundGroups = new Set();

export function childEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.ANTHROPIC_API_KEY;
  return env;
}

export function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

export function spawnGroup(file, args, cwd, stdio, { shell = false, env = {} } = {}) {
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

export function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

// Runs one command in its own process group and waits for it. With shell true, file is a shell command line.
// The group is killed when the command returns, so no child outlives the call.
export function runCommand(file, args, { cwd, timeoutMs, shell = false, env = {} }) {
  return new Promise((done) => {
    let output = '';
    let timedOut = false;
    const collect = (chunk) => {
      if (output.length < OUTPUT_CAP) output += chunk;
    };
    const child = spawnGroup(file, args, cwd, ['ignore', 'pipe', 'pipe'], { shell, env });
    if (child.pid !== undefined) foregroundGroups.add(child.pid);
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
      foregroundGroups.delete(child.pid);
      done({ ok: false, error: err.message });
    });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      foregroundGroups.delete(child.pid);
      if (timedOut) return;
      done({ ok: exitCode === 0, exitCode, signal, output: output.slice(0, OUTPUT_CAP) });
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
