import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { runQuery } from './log.mjs';
import { foregroundGroups, killBody, killGroup, runCommand, signalGroup, spawnGroup } from './exec.mjs';
import * as gitModule from './git.mjs';
import * as rowsModule from './rows.mjs';
import { createSearchVerbs } from './search.mjs';
import * as fetchModule from './fetch.mjs';
import * as astModule from './code-ast.mjs';
import * as wikiModule from './wiki-tools.mjs';
import { failedOf, outputDigest, resultZone1, resultZone2 } from './compact.mjs';
import { condenseOutput } from './condense.mjs';
import * as reviewModule from './review-tools.mjs';

// The leaf modules (src/hot-config.mjs) as they were at boot. A worker passes the modules of its current generation to createTools; the CLI
// and the gate use these.
const BOOT_LEAVES = { 'git.mjs': gitModule, 'rows.mjs': rowsModule, 'fetch.mjs': fetchModule, 'code-ast.mjs': astModule, 'wiki-tools.mjs': wikiModule, 'review-tools.mjs': reviewModule };

// read_file reads its file through one buffer that every call reuses. The buffer starts at READ_BUFFER_BYTES, the size of a page, and grows to
// the largest file read so far, which is the peak, and never shrinks. A file bigger than READ_SYNC_LIMIT is read asynchronously, so a large
// read does not hold the event loop.
const READ_BUFFER_BYTES = 4096;
const LIST_PAGE = 500;
const READ_SYNC_LIMIT = 1024 * 1024;
const BINARY_PROBE = 8000;
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
    return readBuffer.toString('utf8', 0, got);
  } finally {
    closeSync(fd);
  }
}

function cutNotice(size, rest) {
  return { truncated: rest !== null, totalBytes: size, ...(rest === null ? {} : { hint: rest }) };
}

function isBinary(path) {
  statSync(path);
  const fd = openSync(path, 'r');
  try {
    const probe = Buffer.alloc(BINARY_PROBE);
    return probe.subarray(0, readSync(fd, probe, 0, BINARY_PROBE, 0)).includes(0);
  } finally {
    closeSync(fd);
  }
}

async function readCharPage(path, offset, limit) {
  if (!Number.isInteger(offset) || offset < 0) return { ok: false, error: 'offset must be a whole number of characters, zero or more' };
  if (!Number.isInteger(limit) || limit < 1 || limit > OUTPUT_PAGE) return { ok: false, error: `limit must be a whole number from 1 to ${OUTPUT_PAGE}` };
  const text = await readText(path);
  const size = statSync(path).size;
  const end = Math.min(offset + limit, text.length);
  const next = end < text.length ? end : null;
  return { ok: true, output: text.slice(offset, end), total: text.length, offset, next, ...cutNotice(size, next === null ? null : `pass unit: "chars", offset: ${next} and limit: ${OUTPUT_PAGE} to read the rest`) };
}

async function readLinePage(path, offset, limit) {
  if (!Number.isInteger(offset) || offset < 0) return { ok: false, error: 'offset must be a whole number of lines, zero or more' };
  if (limit !== Infinity && (!Number.isInteger(limit) || limit < 1)) return { ok: false, error: 'limit must be a whole number of lines, one or more' };
  const text = await readText(path);
  const size = statSync(path).size;
  const starts = lineStarts(text);
  const total = starts.length;
  if (offset >= total) return { ok: true, unit: 'lines', output: '', total, offset, next: null, ...cutNotice(size, null) };
  const lineEnd = (line) => (line + 1 < total ? starts[line + 1] : text.length);
  const begin = starts[offset];
  if (lineEnd(offset) - begin > OUTPUT_PAGE) {
    return { ok: true, unit: 'lines', output: text.slice(begin, begin + OUTPUT_PAGE), cutLine: true, total, offset, next: offset + 1 < total ? offset + 1 : null, ...cutNotice(size, `line ${offset} is longer than a page: pass unit: "chars", offset: ${begin + OUTPUT_PAGE} and limit: ${OUTPUT_PAGE} to read the rest`) };
  }
  let last = offset + 1;
  while (last < total && last - offset < limit && lineEnd(last) - begin <= OUTPUT_PAGE) last += 1;
  const next = last < total ? last : null;
  return { ok: true, unit: 'lines', output: text.slice(begin, lineEnd(last - 1)), total, offset, next, ...cutNotice(size, next === null ? null : `pass offset: ${next} and limit: ${total - next} to read the rest`) };
}

function lineStarts(text) {
  const starts = [0];
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) starts.push(at + 1);
  if (starts.at(-1) === text.length) starts.pop();
  return starts;
}

const DEFAULT_TIMEOUT_MS = 60000;
const MAX_TIMEOUT_MS = 600000;
const MAX_JOB_TIMEOUT_MS = 3600000;
const TAIL_CAP = 2000;
export const OUTPUT_PAGE = 20000;
const MAX_WAIT_MS = 30000;
const JOB_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const BARRIER = { barrier: true };
const DEFAULT_JOB_LIFETIME_MS = 3600000;
// A background run reports that it is still running at each multiple of this, once per multiple. Each report carries the open PRD rows: the
// first NOTICE_PRD_WINDOW of them, and the counts, read when the report is made.
export const BODY_NOTICE_MS = 180000;
const NOTICE_PRD_WINDOW = 5;
export const DEFAULT_STUCK_MS = 180000;
export const DEFAULT_MONITOR_MS = 15000;
const PATH_TOOLS = new Set(['read_file', 'write_file', 'edit_file', 'list_dir', 'stat_file']);
const WRITE_TOOLS = new Set(['write_file', 'edit_file']);
const READ_ONLY = new Set(['job_status', 'search', 'wiki_search', 'grep', 'fetch', 'callers', 'impact', 'review_join']);
const SKILL_URI = /^skill:\/\//;
const unservedSkill = (uri) => ({ ok: false, error: `no served skill file has the uri ${uri}` });

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

export function createTools({ workspace, runDir, log, background = true, jobLifetimeMs = DEFAULT_JOB_LIFETIME_MS, stuckMs = DEFAULT_STUCK_MS, monitorMs = DEFAULT_MONITOR_MS, noticeMs = BODY_NOTICE_MS, leaves = BOOT_LEAVES, serveSkill = unservedSkill }) {
  const root = resolve(workspace);
  const realRoot = realpathSync(root);
  const jobs = new Map();
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
  const locate = (rel) => {
    if (typeof rel !== 'string' || rel === '') return { refused: 'path must be a non-empty string' };
    return { path: resolve(root, rel) };
  };

  const handlers = {
    async read_file(args) {
      if (SKILL_URI.test(args.path ?? '')) return serveSkill(args.path);
      const at = locate(args.path);
      if (at.refused) return refusal(at.refused);
      const unit = args.unit ?? 'lines';
      if (unit !== 'lines' && unit !== 'chars') return { ok: false, error: 'unit must be lines or chars' };
      if (isBinary(at.path)) return { ok: false, refused: true, error: 'refused: binary file; read_file serves text only' };
      if (unit === 'chars') return readCharPage(at.path, args.offset ?? 0, args.limit ?? OUTPUT_PAGE);
      return readLinePage(at.path, args.offset ?? 0, args.limit ?? Infinity);
    },

    async write_file(args) {
      const at = locate(args.path);
      if (at.refused) return refusal(at.refused);
      if (typeof args.content !== 'string') return { ok: false, error: 'content must be a string' };
      const prior = statSync(at.path, { throwIfNoEntry: false });
      const priorBytes = prior && prior.isFile() ? prior.size : null;
      const afterBytes = Buffer.byteLength(args.content);
      await mkdir(dirname(at.path), { recursive: true });
      await writeFile(at.path, args.content);
      const reply = { ok: true, output: `wrote ${relative(root, at.path)} (${args.content.length} chars)` };
      if (priorBytes !== null && afterBytes * 2 < priorBytes) {
        reply.shrunkByBytes = priorBytes - afterBytes;
        reply.shrinkRatio = Math.round((afterBytes / priorBytes) * 1000) / 1000;
        reply.shrinkWarning = 'content is under half the prior file; check gm.read_file truncated:true before writing back';
      }
      return reply;
    },

    async edit_file(args) {
      const at = locate(args.path);
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
      const at = locate(args.path);
      if (at.refused) return refusal(at.refused);
      const info = await stat(at.path);
      const type = info.isDirectory() ? 'dir' : info.isFile() ? 'file' : 'other';
      return { ok: true, output: JSON.stringify({ type, size: info.size, mtime: info.mtime.toISOString() }) };
    },

    async list_dir(args) {
      const at = locate(args.path ?? '.');
      if (at.refused) return refusal(at.refused);
      if (args.prefix !== undefined && typeof args.prefix !== 'string') return { ok: false, error: 'prefix must be a string' };
      if (args.offset !== undefined && (!Number.isInteger(args.offset) || args.offset < 0)) return { ok: false, error: 'offset must be a whole number, zero or more' };
      if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > LIST_PAGE)) return { ok: false, error: `limit must be a whole number from 1 to ${LIST_PAGE}` };
      const entries = (await readdir(at.path, { withFileTypes: true }))
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
        .filter((name) => args.prefix === undefined || name.startsWith(args.prefix))
        .sort();
      const offset = args.offset ?? 0;
      const page = entries.slice(offset, offset + (args.limit ?? LIST_PAGE));
      const next = offset + page.length < entries.length ? offset + page.length : null;
      return { ok: true, output: page.join('\n'), total: entries.length, next };
    },

    run_shell(args, ctx) {
      if (typeof args.command !== 'string' || args.command.trim() === '') {
        return { ok: false, error: 'command must be a non-empty string' };
      }
      if (args.background !== true || !background) {
        const timeoutMs = Math.min(Number(args.timeoutMs) || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
        const result = runCommand(args.command, [], { cwd: root, timeoutMs, shell: true, signal: ctx?.signal });
        if (result && typeof result.then === 'function') return result.then((r) => condenseShell(r, args.raw === true));
        return condenseShell(result, args.raw === true);
      }
      if (!JOB_NAME.test(args.job ?? '')) return { ok: false, error: 'a background job needs job: 1 to 64 letters, digits, _ or -' };
      const timeoutMs = Math.min(Number(args.timeoutMs) || DEFAULT_TIMEOUT_MS, MAX_JOB_TIMEOUT_MS);
      return startJob(args.job, args.command, timeoutMs);
    },

    async job_status(args) {
      if (!JOB_NAME.test(args.job ?? '')) return { ok: false, error: 'job must be a job name' };
      const waitMs = Math.min(Math.max(Number(args.waitMs) || 0, 0), MAX_WAIT_MS);
      const job = jobs.get(args.job);
      if (job && !job.settled && waitMs > 0) await waitOrTimeout(job.done, waitMs);
      const status = readStatus(args.job);
      if (!status) return { ok: false, error: `no job named ${args.job}` };
      if (args.offset !== undefined && (!Number.isInteger(args.offset) || args.offset < 0)) {
        return { ok: false, error: 'offset must be a whole number of characters, zero or more' };
      }
      const { output: logPath, ...meta } = status;
      const text = outputOf(status);
      const from = args.offset ?? Math.max(0, text.length - OUTPUT_PAGE);
      const end = Math.min(from + OUTPUT_PAGE, text.length);
      return {
        ok: true,
        ...meta,
        exitCode: status.exitCode ?? null,
        signal: status.signal ?? null,
        output: text.slice(from, end),
        total: text.length,
        truncated: from > 0 || end < text.length,
        offset: from,
        next: end < text.length ? end : null,
        logPath: logPath ?? null,
      };
    },

    // A shell job is stopped by its process group. It ends killed with reason cancelled, and the job event is logged before this answers
    // (finish writes it when the group has closed). A job that already ended, and a background run, are error results, not throws.
    async job_stop(args) {
      if (!JOB_NAME.test(args.job ?? '')) return { ok: false, error: 'job must be a job name' };
      const job = jobs.get(args.job);
      if (job === undefined) return { ok: false, error: `no job named ${args.job}` };
      if (job.body !== undefined) return { ok: false, error: `${args.job} is a background run, not a shell job; finish with stopBackground: true stops it` };
      if (job.settled) return { ok: false, error: `job ${args.job} already ended (${readStatus(args.job)?.state})` };
      job.killRequested = true;
      job.killReason ??= 'cancelled';
      killGroup(job.child.pid);
      await job.done;
      return { ok: true, state: 'killed', reason: job.killReason, output: `stopped job ${args.job}` };
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
      if (args.limit !== undefined) {
        if (args.last !== undefined) return refusal('limit cannot be used with last, which already sets how many events a reply returns');
        if (args.js !== undefined) return refusal('limit cannot be used with js, whose expression sees the whole window of matching events');
        if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > QUERY_PAGE_EVENTS) {
          return { ok: false, error: `limit must be a whole number from 1 to ${QUERY_PAGE_EVENTS}` };
        }
      }
      const after = Math.max(0, Math.floor(args.after ?? 0));
      const match = (event) =>
        (args.kind === undefined || event.kind === args.kind) &&
        (args.fromMono === undefined || event.mono >= args.fromMono) &&
        (args.toMono === undefined || event.mono <= args.toMono);
      const js = args.js ?? 'events';
      if (args.last !== undefined) {
        const newest = log.tail(after, args.last, match);
        if (args.js !== undefined) return runQuery(newest, js);
        const kept = newestOf(newest);
        return { ...runQuery(kept.events, js), ...(kept.omitted === 0 ? {} : { omitted: kept.omitted }) };
      }
      const scan = log.window(after, QUERY_WINDOW_EVENTS, match, QUERY_WINDOW_BYTES);
      const more = scan.last < log.count();
      if (args.js !== undefined) return { ...runQuery(scan.events, js), ...(more ? { next: scan.last } : {}) };
      const page = pageOf(scan.events, args.limit);
      if (args.kind !== undefined && page.length === 0 && !log.events().some((event) => event.kind === args.kind)) {
        return refusal(`no event has kind ${args.kind}; kinds in this run: ${[...new Set(log.events().map((event) => event.kind))].sort().join(', ')}`);
      }
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
  // The verbs of a set of leaf modules (src/hot-config.mjs), and the row queries the job reminder and the finish refusal read. The whole set is
  // built before it is returned, so a module that fails to build throws before anything is replaced.
  function leafVerbsOf(modules) {
    const verbs = { ...modules['git.mjs'].createGitVerbs({ root, confine, log }), ...modules['rows.mjs'].createRowVerbs({ root, confine, log }), ...modules['wiki-tools.mjs'].createWikiVerbs({ root, log }), ...modules['review-tools.mjs'].createReviewVerbs({ root, log }), ...modules['fetch.mjs'].createFetchVerbs({ log, root }), ...modules['code-ast.mjs'].createAstVerbs({ root, confine }) };
    return { verbs, rowQueries: { openRows: modules['rows.mjs'].openRows, parkedRows: modules['rows.mjs'].parkedRows, rowSummary: modules['rows.mjs'].rowSummary } };
  }
  // Search keeps its own paging state, so it is not a leaf and a reload keeps it as it is.
  const boot = leafVerbsOf(leaves);
  Object.assign(handlers, boot.verbs, createSearchVerbs({ root, confine }));
  let leafNames = Object.keys(boot.verbs);
  let rowQueries = boot.rowQueries;

  // Replaces the leaf verbs and the row queries in one step, after the new set is built. A reload calls it between tool calls.
  function setLeaves(modules) {
    const next = leafVerbsOf(modules);
    for (const name of leafNames) delete handlers[name];
    Object.assign(handlers, next.verbs);
    leafNames = Object.keys(next.verbs);
    rowQueries = next.rowQueries;
  }

  function startJob(name, command, timeoutMs) {
    if (jobs.has(name)) return { ok: false, error: `job ${name} already exists` };
    const outputFile = join(runDir, 'jobs', `${name}.out`);
    mkdirSync(join(runDir, 'jobs'), { recursive: true });
    const out = openSync(outputFile, 'w');
    const startMono = log.now();
    const child = spawnGroup(command, [], root, ['ignore', out, out], { shell: true });
    closeSync(out);
    const status = { job: name, command, state: 'running', pid: child.pid, startMono, output: outputFile, timeoutMs: Math.min(timeoutMs, jobLifetimeMs) };
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
        const reason = state === 'killed' ? job.killReason : undefined;
        const ended = { ...status, state, exitCode, signal, ...(reason === undefined ? {} : { reason }) };
        writeStatus(name, ended);
        log.append('job', { job: name, state, exitCode, signal, startMono, ...(reason === undefined ? {} : { reason }) });
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
        rowQueries.rowSummary(confine, 'prd', NOTICE_PRD_WINDOW)
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
    openRows: () => rowQueries.openRows(confine),
    parkedRows: () => rowQueries.parkedRows(confine),
    setLeaves,
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

    async run(name, args, ctx) {
      if (!Object.hasOwn(handlers, name)) return { ok: false, error: `unknown tool: ${name}` };
      try {
        return await handlers[name](args, ctx);
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
const QUERY_ARGS = ['js', 'kind', 'fromMono', 'toMono', 'after', 'last', 'limit'];

function pageOf(events, limit = QUERY_PAGE_EVENTS) {
  const page = [];
  for (const event of events) {
    if (page.length === limit) break;
    if (replyChars([...page, event]) <= QUERY_REPLY_CHARS) {
      page.push(event);
      continue;
    }
    if (page.length === 0) page.push(clipped(event));
    break;
  }
  return page;
}

function newestOf(events) {
  let from = 0;
  while (from < events.length - 1 && replyChars(events.slice(from)) > QUERY_REPLY_CHARS) from += 1;
  if (replyChars(events.slice(from)) <= QUERY_REPLY_CHARS) return { events: events.slice(from), omitted: from };
  return { events: [clipped(events[events.length - 1])], omitted: events.length - 1 };
}

function replyChars(page) {
  return JSON.stringify({ ok: true, output: JSON.stringify(page) }).length;
}

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

function condenseShell(result, raw) {
  if (raw || typeof result?.output !== 'string') return result;
  const condensed = condenseOutput(result.output);
  return condensed === null ? result : { ...result, ...condensed };
}

const LOGGED_REPLY_CHARS = 1000;
const LOGGED_OUTPUT_TOOLS = new Set(['query_log', 'job_status', 'run_shell', 'run_code']);
export function loggedFor(tool, result) {
  if (!LOGGED_OUTPUT_TOOLS.has(tool) || typeof result?.output !== 'string' || result.output.length <= LOGGED_REPLY_CHARS) return result;
  return { ...result, output: result.output.slice(0, LOGGED_REPLY_CHARS), outputChars: result.output.length, outputDigest: outputDigest(result.output, failedOf(result)) };
}

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
  if (typeof rel !== 'string' || rel === '') return null;
  const target = resolve(root, rel);
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

