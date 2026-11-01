import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { runQuery } from './log.mjs';

const DEFAULT_TIMEOUT_MS = 60000;
const MAX_TIMEOUT_MS = 600000;
const OUTPUT_CAP = 200000;
const TAIL_CAP = 2000;
const POLL_MS = 100;
const MAX_WAIT_MS = 30000;
const JOB_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const BARRIER = { barrier: true };
const KILL_GRACE_MS = 500;
const foregroundGroups = new Set();

export function createTools({ workspace, runDir, log, background = true }) {
  const root = resolve(workspace);
  const realRoot = realpathSync(root);
  const jobs = new Map();

  const confine = (rel) => {
    if (typeof rel !== 'string' || rel === '') return { refused: 'path must be a non-empty string' };
    if (rel.split(/[\\/]+/).includes('..')) return { refused: 'path has a .. segment' };
    const target = resolve(root, rel);
    if (!inside(root, target)) return { refused: 'path is outside the workspace' };
    const real = realpathOrNull(nearestExisting(target));
    if (real === null) return { refused: 'path leads through a link that does not resolve' };
    if (!inside(realRoot, real)) return { refused: 'path leads through a link outside the workspace' };
    return { path: target };
  };

  const handlers = {
    async read_file(args) {
      const at = confine(args.path);
      if (at.refused) return refusal(at.refused);
      return { ok: true, output: await readFile(at.path, 'utf8') };
    },

    async write_file(args) {
      const at = confine(args.path);
      if (at.refused) return refusal(at.refused);
      if (typeof args.content !== 'string') return { ok: false, error: 'content must be a string' };
      await mkdir(dirname(at.path), { recursive: true });
      await writeFile(at.path, args.content);
      return { ok: true, output: `wrote ${relative(root, at.path)} (${args.content.length} chars)` };
    },

    async list_dir(args) {
      const at = confine(args.path ?? '.');
      if (at.refused) return refusal(at.refused);
      const entries = (await readdir(at.path, { withFileTypes: true }))
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
        .sort();
      return { ok: true, output: entries.join('\n') };
    },

    run_shell(args) {
      if (typeof args.command !== 'string' || args.command.trim() === '') {
        return { ok: false, error: 'command must be a non-empty string' };
      }
      const timeoutMs = Math.min(Number(args.timeoutMs) || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
      if (args.background !== true || !background) return shell(root, args.command, timeoutMs);
      if (!JOB_NAME.test(args.job ?? '')) return { ok: false, error: 'a background job needs job: 1 to 64 letters, digits, _ or -' };
      return startJob(args.job, args.command, timeoutMs);
    },

    async job_status(args) {
      if (!JOB_NAME.test(args.job ?? '')) return { ok: false, error: 'job must be a job name' };
      const waitMs = Math.min(Math.max(Number(args.waitMs) || 0, 0), MAX_WAIT_MS);
      const deadline = Date.now() + waitMs;
      let status = readStatus(args.job);
      while (status?.state === 'running' && Date.now() < deadline) {
        await sleep(POLL_MS);
        status = readStatus(args.job);
      }
      if (!status) return { ok: false, error: `no job named ${args.job}` };
      const tail = readTail(status.output, TAIL_CAP);
      return { ok: true, state: status.state, output: JSON.stringify({ ...status, tail }) };
    },

    query_log(args) {
      if (typeof args.js !== 'string') return { ok: false, error: 'js must be a string' };
      return runQuery(log.events(), args.js);
    },

    finish(args) {
      if (typeof args.witness !== 'string' || args.witness.trim() === '') {
        return { ok: false, error: 'finish needs a non-empty witness string' };
      }
      return { ok: true, finished: true, output: args.witness };
    },
  };

  function startJob(name, command, timeoutMs) {
    if (jobs.has(name)) return { ok: false, error: `job ${name} already exists` };
    const outputFile = join(runDir, 'jobs', `${name}.out`);
    mkdirSync(join(runDir, 'jobs'), { recursive: true });
    const out = openSync(outputFile, 'w');
    const startMono = log.now();
    const child = spawnGroup(command, root, ['ignore', out, out]);
    closeSync(out);
    const status = { job: name, command, state: 'running', pid: child.pid, startMono, output: outputFile };
    writeStatus(name, status);

    const job = { child, killRequested: false, settled: false };
    const timer = setTimeout(() => {
      job.killRequested = true;
      killGroup(child.pid);
    }, timeoutMs);
    job.done = new Promise((settle) => {
      const finish = (exitCode, signal) => {
        if (job.settled) return;
        job.settled = true;
        clearTimeout(timer);
        const state = exitCode !== null && !job.killRequested ? 'exited' : 'killed';
        const ended = { ...status, state, exitCode, signal };
        writeStatus(name, ended);
        log.append('job', { job: name, state, exitCode, signal, startMono });
        settle();
      };
      child.on('error', (err) => finish(null, err.message));
      child.on('close', (exitCode, signal) => finish(exitCode, signal));
    });
    jobs.set(name, job);
    log.append('job', { job: name, state: 'running', pid: child.pid });
    return { ok: true, state: 'running', output: `started job ${name} (pid ${child.pid})` };
  }

  return {
    access(name, args) {
      if (name === 'job_status') return { items: [] };
      if (name !== 'read_file' && name !== 'list_dir' && name !== 'write_file') return BARRIER;
      const rel = name === 'list_dir' ? (args.path ?? '.') : args.path;
      const at = planPath(root, rel);
      if (!at) return BARRIER;
      return { items: [{ path: at.path, group: at.group, write: name === 'write_file' }] };
    },

    async run(name, args) {
      if (!Object.hasOwn(handlers, name)) return { ok: false, error: `unknown tool: ${name}` };
      try {
        return await handlers[name](args);
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    async close() {
      const running = [...jobs.values()].filter((job) => !job.settled);
      for (const job of running) job.killRequested = true;
      await Promise.all(liveGroups().map((pid) => killGroup(pid)));
      await Promise.all(running.map((job) => job.done));
    },
    killAllNow() {
      for (const pid of liveGroups()) {
        if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        else signalGroup(pid, 'SIGKILL');
      }
    },
  };

  function liveGroups() {
    return [...jobs.values()].map((job) => job.child.pid).concat([...foregroundGroups]);
  }

  function writeStatus(name, status) {
    const file = join(runDir, 'jobs', `${name}.json`);
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(status)}\n`);
    renameSync(temp, file);
  }

  function readStatus(name) {
    const file = join(runDir, 'jobs', `${name}.json`);
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8'));
  }
}

function readTail(file, cap) {
  if (!existsSync(file)) return '';
  return readFileSync(file, 'utf8').slice(-cap);
}

function planPath(root, rel) {
  if (typeof rel !== 'string' || rel === '' || rel.split(/[\\/]+/).includes('..')) return null;
  const target = resolve(root, rel);
  if (!inside(root, target)) return null;
  try {
    const nearest = nearestExisting(target);
    const full = join(realpathSync(nearest), relative(nearest, target));
    const group = nearest === target ? groupOf(full) : undefined;
    return { path: full.split(sep), group };
  } catch {
    return null;
  }
}

function groupOf(file) {
  const { dev, ino } = statSync(file);
  return `${dev}:${ino}`;
}

export function conflicts(a, b) {
  if (a.barrier || b.barrier) return true;
  return a.items.some((x) => b.items.some((y) => (x.write || y.write) && (sameFile(x, y) || isPrefix(x.path, y.path) || isPrefix(y.path, x.path))));
}

function sameFile(a, b) {
  return a.group !== undefined && a.group === b.group;
}

function isPrefix(a, b) {
  return a.length <= b.length && a.every((part, i) => part === b[i]);
}

function refusal(reason) {
  return { ok: false, refused: true, error: `refused: ${reason}` };
}

function inside(root, target) {
  const rel = relative(root, target);
  return rel === '' || (rel.split(sep)[0] !== '..' && !isAbsolute(rel));
}

function nearestExisting(target) {
  let current = target;
  while (!entryExists(current) && dirname(current) !== current) current = dirname(current);
  return current;
}

function entryExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function realpathOrNull(path) {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function childEnv() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  return env;
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

function spawnGroup(command, cwd, stdio) {
  return spawn(command, { cwd, env: childEnv(), shell: true, detached: true, windowsHide: true, stdio });
}

async function killGroup(pid) {
  if (process.platform === 'win32') return taskkillTree(pid);
  if (!signalGroup(pid, 'SIGTERM')) return;
  await sleep(KILL_GRACE_MS);
  signalGroup(pid, 'SIGKILL');
}

function killGroupNow(pid) {
  if (process.platform === 'win32') return taskkillTree(pid);
  signalGroup(pid, 'SIGKILL');
  return undefined;
}

function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

function taskkillTree(pid) {
  return new Promise((done) => {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', done);
    killer.on('close', done);
  });
}

function shell(cwd, command, timeoutMs) {
  return new Promise((done) => {
    let output = '';
    let timedOut = false;
    const collect = (chunk) => {
      if (output.length < OUTPUT_CAP) output += chunk;
    };
    const child = spawnGroup(command, cwd, ['ignore', 'pipe', 'pipe']);
    foregroundGroups.add(child.pid);
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
