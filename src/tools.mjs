import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { runQuery } from './log.mjs';
import { foregroundGroups, killBody, killGroup, runCommand, signalGroup, spawnGroup } from './exec.mjs';
import { createGitVerbs } from './git.mjs';
import { createRowVerbs, openRows, rowSummary } from './rows.mjs';
import { createSearchVerbs } from './search.mjs';
import { createFetchVerbs } from './fetch.mjs';
import { createAstVerbs } from './code-ast.mjs';
import { createWikiVerbs } from './wiki-tools.mjs';
import { resultZone1, resultZone2 } from './compact.mjs';
import { createReviewVerbs } from './review-tools.mjs';

// read_file reads its file through one buffer that every call reuses. The buffer starts at READ_BUFFER_BYTES, the size of a page, and grows to
// the largest file read so far, which is the peak, and never shrinks. A file bigger than READ_SYNC_LIMIT is read asynchronously, so a large
// read does not hold the event loop.
const READ_BUFFER_BYTES = 4096;
const READ_SYNC_LIMIT = 1024 * 1024;
let readBuffer = Buffer.allocUnsafe(READ_BUFFER_BYTES);
async function readText(path) {
  if (statSync(path).size > READ_SYNC_LIMIT) return readFile(path, 'utf8');
  const fd = openSync(path, 'r');
  try {
    let got = 0;
    for (;;) {
      if (got === readBuffer.length) {
        const bigger = Buffer.allocUnsafe(readBuffer.length * 2);
        readBuffer.copy(bigger, 0, 0, got);
        readBuffer = bigger;
      }
      const n = readSync(fd, readBuffer, got, readBuffer.length - got, null);
      if (n === 0) break;
      got += n;
    }
    // The bytes are decoded once. The text is the reply's output and the logged output alike.
    return readBuffer.toString('utf8', 0, got);
  } finally {
    closeSync(fd);
  }
}

const DEFAULT_TIMEOUT_MS = 60000;
const MAX_TIMEOUT_MS = 600000;
const TAIL_CAP = 2000;
export const OUTPUT_PAGE = 20000;
const MAX_WAIT_MS = 30000;
const JOB_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const BARRIER = { barrier: true };
const DEFAULT_JOB_LIFETIME_MS = 1800000;
// A background run reports that it is still running at each multiple of this, once per multiple. Each report carries the open PRD rows: the
// first NOTICE_PRD_WINDOW of them, and the counts, read when the report is made.
export const BODY_NOTICE_MS = 180000;
const NOTICE_PRD_WINDOW = 5;
// A running job with no progress for this long is stuck, and the agent is told once. Progress is output a shell job writes, a verb call a
// body makes or has in flight, and the start of the job. The check runs every monitorMs.
export const DEFAULT_STUCK_MS = 180000;
export const DEFAULT_MONITOR_MS = 15000;
const PATH_TOOLS = new Set(['read_file', 'write_file', 'edit_file', 'list_dir', 'stat_file']);
const WRITE_TOOLS = new Set(['write_file', 'edit_file']);
const READ_ONLY = new Set(['job_status', 'search', 'wiki_search', 'grep', 'fetch', 'callers', 'impact', 'review_join']);

// The tools this module owns, with their strategies. A file write keeps its path and its size, and an edit keeps its path and the sizes
// of the old and new text. A listing or a log query is cut in the second horizon. finish keeps its witness and its gaps whole in both
// horizons, because the gate and the next step depend on them. run_shell keeps its exit code and its error lines.
const compactBytes = (text) => (typeof text === 'string' ? Buffer.byteLength(text) : undefined);
const compactWrite = (action) => ({ path: action?.args?.path, bytes: compactBytes(action?.args?.content) });
const compactEdit = (action) => ({ path: action?.args?.path, oldBytes: compactBytes(action?.args?.old), newBytes: compactBytes(action?.args?.new) });
const compactFinish = (event, action) => ({ seq: event.seq, tool: 'finish', ok: event.ok, witness: action?.args?.witness, gaps: action?.args?.gaps, full: { seq: event.seq, bytes: compactBytes(event.output) ?? 0 } });
export const COMPACT = {
  tools: {
    read_file: { zone1: resultZone1, zone2: resultZone2 },
    write_file: { zone1: (event, action) => ({ ...resultZone1(event, action), args: compactWrite(action) }), zone2: (event, action) => ({ ...resultZone2(event, action), args: compactWrite(action) }) },
    edit_file: { zone1: (event, action) => ({ ...resultZone1(event, action), args: compactEdit(action) }), zone2: (event, action) => ({ ...resultZone2(event, action), args: compactEdit(action) }) },
    stat_file: { zone1: resultZone1, zone2: resultZone2 },
    list_dir: { zone1: resultZone1, zone2: () => null },
    run_shell: { zone1: resultZone1, zone2: resultZone2 },
    job_start: { zone1: resultZone1, zone2: resultZone2 },
    job_status: { zone1: resultZone1, zone2: resultZone2 },
    query_log: { zone1: resultZone1, zone2: () => null },
    finish: { zone1: compactFinish, zone2: compactFinish },
  },
};

export function createTools({ workspace, runDir, log, background = true, jobLifetimeMs = DEFAULT_JOB_LIFETIME_MS, stuckMs = DEFAULT_STUCK_MS, monitorMs = DEFAULT_MONITOR_MS, noticeMs = BODY_NOTICE_MS }) {
  const root = resolve(workspace);
  const realRoot = realpathSync(root);
  const jobs = new Map();
  // The verb calls a body has in flight, by the body's seq. A body with a call in flight is progressing.
  const inFlightByBody = new Map();

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
      const text = await readText(at.path);
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
        const text = outputOf(status);
        const end = Math.min(offset + OUTPUT_PAGE, text.length);
        return { ok: true, state: status.state, output: JSON.stringify({ ...status, chunk: text.slice(offset, end), total: text.length, offset, next: end < text.length ? end : null }) };
      }
      return { ok: true, state: status.state, output: JSON.stringify({ ...status, tail: outputOf(status, TAIL_CAP) }) };
    },

    query_log(args = {}) {
      const unknown = Object.keys(args).filter((name) => !QUERY_ARGS.includes(name));
      if (unknown.length > 0) return refusal(`unknown argument ${unknown.join(', ')}; query_log takes ${QUERY_ARGS.join(', ')}`);
      if (args.js !== undefined && typeof args.js !== 'string') return { ok: false, error: 'js must be a string' };
      if (args.kind !== undefined && typeof args.kind !== 'string') return { ok: false, error: 'kind must be a string' };
      for (const name of ['after', 'fromMono', 'toMono']) {
        if (args[name] !== undefined && !Number.isFinite(args[name])) return { ok: false, error: `${name} must be a number` };
      }
      if (args.last !== undefined && (!Number.isInteger(args.last) || args.last < 1 || args.last > QUERY_PAGE_EVENTS)) {
        return { ok: false, error: `last must be a whole number from 1 to ${QUERY_PAGE_EVENTS}` };
      }
      const after = Math.max(0, Math.floor(args.after ?? 0));
      const match = (event) =>
        (args.kind === undefined || event.kind === args.kind) &&
        (args.fromMono === undefined || event.mono >= args.fromMono) &&
        (args.toMono === undefined || event.mono <= args.toMono);
      const js = args.js ?? 'events';
      // last is the newest matching events, oldest first. It is the end of the list, so it has no next.
      if (args.last !== undefined) {
        const newest = log.tail(after, args.last, match);
        if (args.js !== undefined) return runQuery(newest, js);
        const kept = newestOf(newest);
        return { ...runQuery(kept.events, js), ...(kept.omitted === 0 ? {} : { omitted: kept.omitted }) };
      }
      // The expression sees one window of matching events. A reply without js is a page of that window. When the window ends before the end of
      // the log, next is the seq to pass back as after, and the next call reads on from it.
      const scan = log.window(after, QUERY_WINDOW_EVENTS, match, QUERY_WINDOW_BYTES);
      const more = scan.last < log.count();
      if (args.js !== undefined) return { ...runQuery(scan.events, js), ...(more ? { next: scan.last } : {}) };
      const page = pageOf(scan.events);
      const next = page.length < scan.events.length ? page.at(-1).seq : more ? scan.last : null;
      return { ...runQuery(page, js), ...(next === null ? {} : { next }) };
    },

    finish(args) {
      if (typeof args.witness !== 'string' || args.witness.trim() === '') {
        return { ok: false, error: 'finish needs a non-empty witness string' };
      }
      return { ok: true, finished: true, output: args.witness };
    },
  };
  Object.assign(handlers, createGitVerbs({ root, confine, log }), createRowVerbs({ root, confine, log }), createSearchVerbs({ root, confine }), createWikiVerbs({ root, log }), createReviewVerbs({ root, log }),createFetchVerbs({ log, root }), createAstVerbs({ root, confine }));

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

    const job = { name, child, outputFile, startWall: Date.now(), stuck: false, killRequested: false, killReason: undefined, settled: false };
    job.lifetimeKilled = jobLifetimeMs < timeoutMs;
    const timer = setTimeout(() => {
      job.killRequested = true;
      if (job.lifetimeKilled) job.killReason = 'lifetime';
      killGroup(child.pid);
    }, Math.min(timeoutMs, jobLifetimeMs));
    job.done = new Promise((settle) => {
      const finish = (exitCode, signal) => {
        if (job.settled) return;
        job.settled = true;
        clearTimeout(timer);
        const state = exitCode !== null && !job.killRequested ? 'exited' : 'killed';
        const ended = { ...status, state, exitCode, signal };
        writeStatus(name, ended);
        log.append('job', { job: name, state, exitCode, signal, startMono });
        if (job.killReason !== undefined) {
          log.append('job-killed', { job: name, reason: job.killReason, ...(job.killReason === 'lifetime' ? { lifetimeMs: jobLifetimeMs } : {}), tail: readTail(outputFile, TAIL_CAP) });
        }
        settle();
      };
      child.on('error', (err) => finish(null, err.message));
      child.on('close', (exitCode, signal) => finish(exitCode, signal));
    });
    jobs.set(name, job);
    watchJobs();
    log.append('job', { job: name, state: 'running', pid: child.pid });
    return { ok: true, state: 'running', output: `started job ${name} (pid ${child.pid})` };
  }

  // A body that ran past its foreground budget becomes a background job, named body-<seq> after its first log event. It has a status file
  // like a shell job, but no process: its output is its verb calls, read back from the log, and it ends with its result. A stop settles the
  // job at once and kills the shells the body started; the body's next verb call refuses, so a reply that comes late changes nothing.
  // A body that waits for a slot is adopted in state queued, and it starts when its slot is granted (started resolves then). Its lifetime and
  // its notices count from that start, so a body is not killed for the time it waited.
  function adoptBody({ result, cleanup, kill, body, queued = false, started = Promise.resolve() }) {
    let name = `body-${body}`;
    for (let n = 2; jobs.has(name); n += 1) name = `body-${body}-${n}`;
    const startMono = log.now();
    const status = { job: name, body, state: queued ? 'queued' : 'running', startMono };
    mkdirSync(join(runDir, 'jobs'), { recursive: true });
    writeStatus(name, status);
    const job = { name, body, settled: false, queued, stuck: false, startWall: Date.now() };
    job.done = new Promise((resolve) => {
      job.resolve = resolve;
    });
    const settle = (state, fields) => {
      if (job.settled) return;
      job.settled = true;
      clearInterval(reminder);
      clearTimeout(lifetime);
      writeStatus(name, { ...status, state, ...fields });
      // The result stays in the status file, as a shell job's output stays in its file, and reaches the agent once, in the exited notice.
      const { value, error, ...rest } = fields;
      log.append('job', { job: name, body, state, startMono, ...rest });
      cleanup();
      job.resolve();
    };
    job.stop = (reason) => {
      if (job.settled) return;
      kill();
      killBody(body);
      const tail = bodyText(log, body, TAIL_CAP);
      settle('killed', { reason });
      log.append('job-killed', { job: name, reason, tail, ...(reason === 'lifetime' ? { lifetimeMs: jobLifetimeMs } : {}) });
    };
    let lifetime;
    let reminder;
    const begin = () => {
      // The clock of progress and of the lifetime starts with the thread, not with the adoption, so a body that waited is not stuck for the wait.
      job.queued = false;
      job.startWall = Date.now();
      lifetime = setTimeout(() => job.stop('lifetime'), jobLifetimeMs);
      reminder = setInterval(() => {
        const runningMs = Math.round(log.now() - startMono);
        // The row read is asynchronous, so the job may settle before it returns. A report for a job that has settled is dropped.
        rowSummary(confine, 'prd', NOTICE_PRD_WINDOW)
          .catch((err) => ({ error: err.message }))
          .then((prd) => {
            if (!job.settled) log.append('job-running', { job: name, body, runningMs, prd });
          });
      }, noticeMs);
    };
    result.then((reply) => (reply.ok ? settle('exited', { value: reply.output, truncated: reply.truncated }) : settle('failed', { error: reply.error })));
    jobs.set(name, job);
    watchJobs();
    log.append('job', { job: name, body, state: status.state });
    if (queued) {
      // The job starts when its slot is granted. A stop before that leaves the queue, so the job never starts.
      started.then(() => {
        if (job.settled) return;
        status.state = 'running';
        writeStatus(name, status);
        log.append('job', { job: name, body, state: 'running' });
        begin();
      });
    } else {
      begin();
    }
    return name;
  }

  // The output of a job, as text: a body's verb calls from the log, or a shell job's output file. cap keeps the last cap characters.
  function outputOf(status, cap = Infinity) {
    if (status.body !== undefined) return bodyText(log, status.body, cap);
    const text = existsSync(status.output) ? readFileSync(status.output, 'utf8') : '';
    return text.length > cap ? text.slice(text.length - cap) : text;
  }

  // A job whose status file still says running was started by a worker that stopped without ending it, such as a crash. Its shell group is
  // killed and it is logged as killed with reason restart, so no child outlives the worker and the next context names it.
  function stopOrphans() {
    const dir = join(runDir, 'jobs');
    if (!existsSync(dir)) return;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const status = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      if (status.state !== 'running' && status.state !== 'queued') continue;
      const tail = status.body !== undefined ? bodyText(log, status.body, TAIL_CAP) : readTail(status.output, TAIL_CAP);
      if (status.body === undefined) signalGroup(status.pid, 'SIGKILL');
      writeStatus(status.job, { ...status, state: 'killed', reason: 'restart' });
      log.append('job', { job: status.job, body: status.body, state: 'killed', startMono: status.startMono, reason: 'restart' });
      log.append('job-killed', { job: status.job, reason: 'restart', tail });
    }
  }

  // The progress of a running job: now while a verb call of its body is in flight, otherwise the newest verb call the body made, or the last
  // write to a shell job's output, or the start, whichever is latest.
  function progressAt(job) {
    if ((inFlightByBody.get(job.body) ?? 0) > 0) return Date.now();
    if (job.body !== undefined) return Math.max(job.startWall, lastCallWall(log, job.body));
    return Math.max(job.startWall, existsSync(job.outputFile) ? statSync(job.outputFile).mtimeMs : 0);
  }

  // The stuck check. A running job that has made no progress for stuckMs is stuck. The agent is told once when a job becomes stuck, and once
  // when it progresses again, so a stuck job is never reported twice in a row. A queued job is waiting for a slot, not stuck.
  function checkStuck() {
    const now = Date.now();
    for (const job of jobs.values()) {
      if (job.settled || job.queued) continue;
      const sinceProgressMs = Math.round(now - progressAt(job));
      const body = job.body !== undefined ? { body: job.body } : {};
      if (!job.stuck && sinceProgressMs > stuckMs) {
        job.stuck = true;
        log.append('job-stuck', { job: job.name, ...body, sinceProgressMs });
      } else if (job.stuck && sinceProgressMs <= stuckMs) {
        job.stuck = false;
        log.append('job-unstuck', { job: job.name, ...body, sinceProgressMs });
      }
    }
    if (monitor !== null && ![...jobs.values()].some((job) => !job.settled)) {
      clearInterval(monitor);
      monitor = null;
    }
  }
  // The check runs only while a job or a body is open. checkStuck stops it when none is, so an idle worker does not wake for it.
  let monitor = null;
  function watchJobs() {
    if (monitor === null) monitor = setInterval(checkStuck, monitorMs);
    monitor.unref();
  }

  // The jobs still open, for the status the agent reads at each step: how long each has run and how long since it progressed.
  function activeJobs() {
    const now = Date.now();
    return [...jobs.values()].filter((job) => !job.settled).map((job) => ({
      job: job.name,
      ...(job.body !== undefined ? { body: job.body } : {}),
      state: job.queued ? 'queued' : 'running',
      runningMs: now - job.startWall,
      ...(job.queued ? {} : { sinceProgressMs: Math.round(now - progressAt(job)) }),
      stuck: job.stuck,
    }));
  }

  stopOrphans();

  return {
    adoptBody,
    activeJobs,
    openRows: () => openRows(confine),
    callStarted(body) {
      inFlightByBody.set(body, (inFlightByBody.get(body) ?? 0) + 1);
    },
    callEnded(body) {
      inFlightByBody.set(body, Math.max(0, (inFlightByBody.get(body) ?? 0) - 1));
    },
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

    async close(reason = 'run-ended') {
      clearInterval(monitor);
      for (const job of jobs.values()) if (!job.settled && job.body !== undefined) job.stop(reason);
      const running = [...jobs.values()].filter((job) => !job.settled && job.child !== undefined);
      for (const job of running) {
        job.killRequested = true;
        job.killReason ??= reason;
      }
      await Promise.all(liveGroups().map((pid) => killGroup(pid)));
      await Promise.all(running.map((job) => job.done));
    },
    runningBodies,
    stopBodies(reason) {
      const names = runningBodies();
      for (const name of names) jobs.get(name).stop(reason);
      return names;
    },
    killAllNow() {
      for (const pid of liveGroups()) {
        if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        else signalGroup(pid, 'SIGKILL');
      }
    },
  };

  function liveGroups() {
    return [...jobs.values()].filter((job) => job.child !== undefined).map((job) => job.child.pid).concat([...foregroundGroups]);
  }

  function runningBodies() {
    return [...jobs.values()].filter((job) => job.body !== undefined && !job.settled).map((job) => job.name);
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

// A query_log reply holds at most 50 events and stays within 20 KB once serialized, because the reply escapes the JSON it carries. When a
// page of events is cut short, next is the seq of the last event returned, and the caller passes it as after. An event too large for a
// reply of its own is cut to its head, so the reply is always valid JSON. A log that holds earlier query results has such events.
// A js expression sees one window of matching events: at most QUERY_WINDOW_EVENTS, read from at most QUERY_WINDOW_BYTES of the log.
const QUERY_PAGE_EVENTS = 50;
const QUERY_REPLY_CHARS = 20000;
const QUERY_WINDOW_EVENTS = 1000;
const QUERY_WINDOW_BYTES = 4 * 1024 * 1024;
const QUERY_ARGS = ['js', 'kind', 'fromMono', 'toMono', 'after', 'last'];

function pageOf(events) {
  const page = [];
  for (const event of events) {
    if (page.length === QUERY_PAGE_EVENTS) break;
    if (replyChars([...page, event]) <= QUERY_REPLY_CHARS) {
      page.push(event);
      continue;
    }
    if (page.length === 0) page.push(clipped(event));
    break;
  }
  return page;
}

// The newest events of a tail that fit a reply: the oldest are dropped first, and omitted counts them. An event too large for a reply of its
// own is cut to its head, as pageOf does.
function newestOf(events) {
  let from = 0;
  while (from < events.length - 1 && replyChars(events.slice(from)) > QUERY_REPLY_CHARS) from += 1;
  if (replyChars(events.slice(from)) <= QUERY_REPLY_CHARS) return { events: events.slice(from), omitted: from };
  return { events: [clipped(events[events.length - 1])], omitted: events.length - 1 };
}

// The length of the reply a page would make: the page as JSON, escaped once more inside the reply.
function replyChars(page) {
  return JSON.stringify({ ok: true, output: JSON.stringify(page) }).length;
}

// The head of an event's JSON, cut until a page of that one event fits the reply.
function clipped(event) {
  const text = JSON.stringify(event);
  let size = Math.min(text.length, QUERY_REPLY_CHARS);
  let shown = { seq: event.seq, kind: event.kind, truncated: text.slice(0, size) };
  while (replyChars([shown]) > QUERY_REPLY_CHARS) {
    size = Math.floor(size * 0.8);
    shown = { seq: event.seq, kind: event.kind, truncated: text.slice(0, size) };
  }
  return shown;
}

// A query_log reply is a copy of events already in the log. The log keeps its first LOGGED_REPLY_CHARS and the full length. A full copy
// would add up to 20 KB to the log for each query, and a page that reads the copies would never reach the end of the log. The events the
// query reads are logged in full. Every path that logs a result uses this, so the log does not depend on the path that wrote it.
const LOGGED_REPLY_CHARS = 1000;
export function loggedReply(result) {
  if (typeof result?.output !== 'string' || result.output.length <= LOGGED_REPLY_CHARS) return result;
  return { ...result, output: result.output.slice(0, LOGGED_REPLY_CHARS), outputChars: result.output.length };
}

// Waits for the job's completion event, with a deadline. The job settles when its process exits, so no timer polls it.
function waitOrTimeout(promise, ms) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

// The verb calls of a background body, from the log, as JSON lines, oldest first. The calls are found by walking back from the newest
// event, so a tail reads only the events it needs. cap keeps the last cap characters.
function bodyText(log, body, cap = Infinity) {
  const lines = [];
  let size = 0;
  for (let seq = log.count(); seq > body && size < cap; seq -= 1) {
    const event = log.at(seq);
    if (event.kind !== 'code-call' || event.body !== body) continue;
    const line = JSON.stringify({ seq: event.seq, tool: event.tool, ok: event.ok, output: event.output, error: event.error });
    lines.push(line);
    size += line.length + 1;
  }
  const text = lines.reverse().join('\n');
  return text.length > cap ? text.slice(text.length - cap) : text;
}

// The wall time of the newest verb call a body made, from the log, or 0 when it made none. The walk stops at the first call it finds.
function lastCallWall(log, body) {
  for (let seq = log.count(); seq > body; seq -= 1) {
    const event = log.at(seq);
    if (event.kind === 'code-call' && event.body === body) return Date.parse(event.t);
  }
  return 0;
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

