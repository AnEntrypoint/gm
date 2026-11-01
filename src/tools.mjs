import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { runQuery } from './log.mjs';
import { foregroundGroups, killGroup, runCommand, signalGroup, spawnGroup } from './exec.mjs';
import { createGitVerbs } from './git.mjs';
import { createRowVerbs } from './rows.mjs';
import { createSearchVerbs } from './search.mjs';
import { createFetchVerbs } from './fetch.mjs';
import { createCodeVerbs } from './code.mjs';

const DEFAULT_TIMEOUT_MS = 60000;
const MAX_TIMEOUT_MS = 600000;
const TAIL_CAP = 2000;
const OUTPUT_PAGE = 20000;
const MAX_WAIT_MS = 30000;
const JOB_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const BARRIER = { barrier: true };
const PATH_TOOLS = new Set(['read_file', 'write_file', 'edit_file', 'list_dir', 'stat_file']);
const WRITE_TOOLS = new Set(['write_file', 'edit_file']);
const READ_ONLY = new Set(['job_status', 'search', 'grep', 'fetch', 'callers', 'impact']);

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
      const offset = args.offset ?? 0;
      const limit = args.limit ?? OUTPUT_PAGE;
      if (!Number.isInteger(offset) || offset < 0) return { ok: false, error: 'offset must be a whole number of characters, zero or more' };
      if (!Number.isInteger(limit) || limit < 1 || limit > OUTPUT_PAGE) return { ok: false, error: `limit must be a whole number from 1 to ${OUTPUT_PAGE}` };
      const text = await readFile(at.path, 'utf8');
      const end = Math.min(offset + limit, text.length);
      return { ok: true, output: text.slice(offset, end), total: text.length, offset, next: end < text.length ? end : null };
    },

    async write_file(args) {
      const at = confine(args.path);
      if (at.refused) return refusal(at.refused);
      if (typeof args.content !== 'string') return { ok: false, error: 'content must be a string' };
      await mkdir(dirname(at.path), { recursive: true });
      await writeFile(at.path, args.content);
      return { ok: true, output: `wrote ${relative(root, at.path)} (${args.content.length} chars)` };
    },

    async edit_file(args) {
      const at = confine(args.path);
      if (at.refused) return refusal(at.refused);
      if (typeof args.old !== 'string' || args.old === '') return { ok: false, error: 'old must be a non-empty string' };
      if (typeof args.new !== 'string') return { ok: false, error: 'new must be a string' };
      const text = await readFile(at.path, 'utf8');
      const count = text.split(args.old).length - 1;
      if (count === 0) return { ok: false, error: `old text not found in ${args.path}` };
      if (count > 1 && args.replaceAll !== true) {
        return { ok: false, error: `old text occurs ${count} times in ${args.path}; add context to make it unique, or set replaceAll` };
      }
      await writeFile(at.path, text.split(args.old).join(args.new));
      return { ok: true, output: `edited ${relative(root, at.path)} (${count} replacement${count === 1 ? '' : 's'})` };
    },

    async stat_file(args) {
      const at = confine(args.path);
      if (at.refused) return refusal(at.refused);
      const info = await stat(at.path);
      const type = info.isDirectory() ? 'dir' : info.isFile() ? 'file' : 'other';
      return { ok: true, output: JSON.stringify({ type, size: info.size, mtime: info.mtime.toISOString() }) };
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
      if (args.background !== true || !background) return runCommand(args.command, [], { cwd: root, timeoutMs, shell: true });
      if (!JOB_NAME.test(args.job ?? '')) return { ok: false, error: 'a background job needs job: 1 to 64 letters, digits, _ or -' };
      return startJob(args.job, args.command, timeoutMs);
    },

    async job_status(args) {
      if (!JOB_NAME.test(args.job ?? '')) return { ok: false, error: 'job must be a job name' };
      const waitMs = Math.min(Math.max(Number(args.waitMs) || 0, 0), MAX_WAIT_MS);
      const job = jobs.get(args.job);
      if (job && !job.settled && waitMs > 0) await waitOrTimeout(job.done, waitMs);
      const status = readStatus(args.job);
      if (!status) return { ok: false, error: `no job named ${args.job}` };
      if (args.offset !== undefined) {
        const offset = args.offset;
        if (!Number.isInteger(offset) || offset < 0) return { ok: false, error: 'offset must be a whole number of characters, zero or more' };
        const text = existsSync(status.output) ? readFileSync(status.output, 'utf8') : '';
        const end = Math.min(offset + OUTPUT_PAGE, text.length);
        return { ok: true, state: status.state, output: JSON.stringify({ ...status, chunk: text.slice(offset, end), total: text.length, offset, next: end < text.length ? end : null }) };
      }
      const tail = readTail(status.output, TAIL_CAP);
      return { ok: true, state: status.state, output: JSON.stringify({ ...status, tail }) };
    },

    query_log(args) {
      if (args.js !== undefined && typeof args.js !== 'string') return { ok: false, error: 'js must be a string' };
      let events = log.events();
      if (args.kind !== undefined) events = events.filter((event) => event.kind === args.kind);
      if (args.fromMono !== undefined) events = events.filter((event) => event.mono >= args.fromMono);
      if (args.toMono !== undefined) events = events.filter((event) => event.mono <= args.toMono);
      if (args.after !== undefined) events = events.filter((event) => event.seq > args.after);
      const page = pageOf(events);
      return { ...runQuery(page.events, args.js ?? 'events'), ...(page.next === null ? {} : { next: page.next }) };
    },

    finish(args) {
      if (typeof args.witness !== 'string' || args.witness.trim() === '') {
        return { ok: false, error: 'finish needs a non-empty witness string' };
      }
      return { ok: true, finished: true, output: args.witness };
    },
  };
  Object.assign(handlers, createGitVerbs({ root, confine, log }), createRowVerbs({ root, confine, log }), createSearchVerbs({ root, confine }), createFetchVerbs(), createCodeVerbs({ root, confine }));

  function startJob(name, command, timeoutMs) {
    if (jobs.has(name)) return { ok: false, error: `job ${name} already exists` };
    const outputFile = join(runDir, 'jobs', `${name}.out`);
    mkdirSync(join(runDir, 'jobs'), { recursive: true });
    const out = openSync(outputFile, 'w');
    const startMono = log.now();
    const child = spawnGroup(command, [], root, ['ignore', out, out], { shell: true });
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
      if (READ_ONLY.has(name)) return { items: [] };
      if (!PATH_TOOLS.has(name)) return BARRIER;
      const rel = name === 'list_dir' ? (args.path ?? '.') : args.path;
      const at = planPath(root, rel);
      if (!at) return BARRIER;
      return { items: [{ path: at.path, group: at.group, write: WRITE_TOOLS.has(name) }] };
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

// A query_log reply holds at most 50 events and stays within about 20 KB once serialized, because the reply escapes the
// JSON it carries. When events remain, next is the seq of the last event returned, and the caller passes it as after.
const QUERY_PAGE_EVENTS = 50;
const QUERY_REPLY_CHARS = 20000;

function pageOf(events) {
  const page = [];
  for (const event of events) {
    if (page.length === QUERY_PAGE_EVENTS) break;
    const text = JSON.stringify(event);
    const next = text.length > QUERY_REPLY_CHARS ? { seq: event.seq, kind: event.kind, truncated: text.slice(0, QUERY_REPLY_CHARS) } : event;
    const candidate = [...page, next];
    if (page.length > 0 && JSON.stringify({ ok: true, output: JSON.stringify(candidate) }).length > QUERY_REPLY_CHARS) break;
    page.push(next);
  }
  return { events: page, next: page.length < events.length ? page.at(-1).seq : null };
}

// Waits for the job's completion event, with a deadline. The job settles when its process exits, so no timer polls it.
function waitOrTimeout(promise, ms) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
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

