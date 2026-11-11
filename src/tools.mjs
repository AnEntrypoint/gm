import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { checkKey, runQuery } from './log.mjs';
import { foregroundGroups, killBody, killGroup, runCommand, shellLauncher, signalGroup, spawnGroup } from './exec.mjs';
import * as gitModule from './git.mjs';
import * as rowsModule from './rows.mjs';
import { createSearchVerbs } from './search.mjs';
import * as fetchModule from './fetch.mjs';
import * as astModule from './code-ast.mjs';
import * as wikiModule from './wiki-tools.mjs';
import { failedOf, outputDigest, resultZone1, resultZone2 } from './compact.mjs';
import { condenseOutput } from './condense.mjs';
import * as reviewModule from './review-tools.mjs';

const BOOT_LEAVES = { 'git.mjs': gitModule, 'rows.mjs': rowsModule, 'fetch.mjs': fetchModule, 'code-ast.mjs': astModule, 'wiki-tools.mjs': wikiModule, 'review-tools.mjs': reviewModule };

const READ_BUFFER_BYTES = 4096;
const LIST_PAGE = 500;
const READ_SYNC_LIMIT = 1024 * 1024;
const WHOLE_FILE_CAP = 1024 * 1024;
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

function fnv1a64Hex(text) {
  let hi = 0xcbf29ce4;
  let lo = 0x84222325;
  for (const byte of Buffer.from(text, 'utf8')) {
    lo = (lo ^ byte) >>> 0;
    const low = lo * 0x1b3;
    hi = (hi * 0x1b3 + lo * 0x100 + Math.floor(low / 0x100000000)) >>> 0;
    lo = low >>> 0;
  }
  return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0');
}

function unitBoundary(text, index) {
  const high = index > 0 && index < text.length && text.charCodeAt(index - 1) >= 0xd800 && text.charCodeAt(index - 1) <= 0xdbff;
  const low = index > 0 && index < text.length && text.charCodeAt(index) >= 0xdc00 && text.charCodeAt(index) <= 0xdfff;
  return high && low ? index - 1 : index;
}

function cutPage(page, size, rest, text) {
  const digest = fnv1a64Hex(text);
  const nextOffset = page.next ?? null;
  if (rest === null) return { ...page, truncated: false, totalBytes: size, nextOffset, digest };
  const shown = Buffer.byteLength(page.output, 'utf8');
  return { ...page, truncated: true, totalBytes: size, hint: rest, notice: `truncated at ${shown} of ${size} bytes; ${rest}`, nextOffset, digest };
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

async function wholeFileReply(path, lines, source = null) {
  const bytes = source === null ? statSync(path).size : Buffer.byteLength(source);
  if (bytes > WHOLE_FILE_CAP) return { ok: false, error: `file is ${bytes} bytes, over the ${WHOLE_FILE_CAP}-byte whole-file read; page it with offset and limit, and read on from next until next is null` };
  const text = source ?? (await readText(path));
  const reply = { ok: true, output: text, total: lines ? lineStarts(text).length : text.length, offset: 0, next: null, truncated: false, totalBytes: bytes, digest: fnv1a64Hex(text) };
  if (lines) reply.unit = 'lines';
  return reply;
}

export async function readCharPage(path, offset, limit, source = null) {
  if (!Number.isInteger(offset) || offset < 0) return { ok: false, error: 'offset must be a whole number of characters, zero or more' };
  if (!Number.isInteger(limit) || limit < 1 || limit > OUTPUT_PAGE) return { ok: false, error: `limit must be a whole number from 1 to ${OUTPUT_PAGE}` };
  const text = source ?? (await readText(path));
  const size = source === null ? statSync(path).size : Buffer.byteLength(source);
  const end = Math.min(offset + limit, text.length);
  const next = end < text.length ? end : null;
  const output = text.slice(unitBoundary(text, offset), unitBoundary(text, end));
  return cutPage({ ok: true, output, total: text.length, offset, next }, size, next === null ? null : `pass unit: "chars", offset: ${next} and limit: ${OUTPUT_PAGE} to read the rest`, text);
}

export async function readLinePage(path, offset, limit, source = null) {
  if (!Number.isInteger(offset) || offset < 0) return { ok: false, error: 'offset must be a whole number of lines, zero or more' };
  if (limit !== Infinity && (!Number.isInteger(limit) || limit < 1)) return { ok: false, error: 'limit must be a whole number of lines, one or more' };
  const text = source ?? (await readText(path));
  const size = source === null ? statSync(path).size : Buffer.byteLength(source);
  const starts = lineStarts(text);
  const total = starts.length;
  if (offset >= total) return cutPage({ ok: true, unit: 'lines', output: '', total, offset, next: null }, size, null, text);
  const lineEnd = (line) => (line + 1 < total ? starts[line + 1] : text.length);
  const begin = starts[offset];
  if (lineEnd(offset) - begin > OUTPUT_PAGE) {
    return cutPage({ ok: true, unit: 'lines', output: text.slice(begin, unitBoundary(text, begin + OUTPUT_PAGE)), cutLine: true, total, offset, next: offset + 1 < total ? offset + 1 : null }, size, `line ${offset} is longer than a page: pass unit: "chars", offset: ${begin + OUTPUT_PAGE} and limit: ${OUTPUT_PAGE} to read the rest`, text);
  }
  let last = offset + 1;
  while (last < total && last - offset < limit && lineEnd(last) - begin <= OUTPUT_PAGE) last += 1;
  const next = last < total ? last : null;
  return cutPage({ ok: true, unit: 'lines', output: text.slice(begin, lineEnd(last - 1)), total, offset, next }, size, next === null ? null : `pass offset: ${next} and limit: ${total - next} to read the rest`, text);
}

function lineStarts(text) {
  const starts = [0];
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) starts.push(at + 1);
  if (starts.at(-1) === text.length) starts.pop();
  return starts;
}

const DEFAULT_TIMEOUT_MS = 300000;
const DEFAULT_JOB_TIMEOUT_MS = 300000;
const MAX_TIMEOUT_MS = 3600000;
const MAX_JOB_TIMEOUT_MS = 7200000;
const TAIL_CAP = 2000;
const ADOPT_POLL_MS = 200;
const BODY_BUDGET_POLL_MS = 100;
const ADOPT_KILL_CHECK_MS = 2000;
const EXIT_SCRIPT = '(eval "$1"); s=$?; echo $s > "$2"; exit $s';
export const OUTPUT_PAGE = 20000;
const CLOCK_SCALE = process.env.GMNEW_TEST_CLOCK === '1' && Number(process.env.GM_CLOCK_SCALE) > 0 && Number(process.env.GM_CLOCK_SCALE) <= 1 ? Number(process.env.GM_CLOCK_SCALE) : 1;
const MAX_WAIT_MS = 100000 * CLOCK_SCALE;
const PID_POLL_MS = 100;
const JOB_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const BARRIER = { barrier: true };
const DEFAULT_JOB_LIFETIME_MS = 3600000;
export const BODY_NOTICE_MS = 180000;
const NOTICE_PRD_WINDOW = 5;
export const DEFAULT_STUCK_MS = 180000;
export const DEFAULT_MONITOR_MS = 15000;
const FIND_SKIP = new Set(['.git', '.gm', '.agentplug', '.agentplug-kv', '.playwriter', 'runs', 'node_modules']);
const FIND_KINDS = ['file', 'dir', 'any'];

function globMatch(pattern, text) {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] === '*') {
      star = p;
      p += 1;
      mark = t;
    } else if (p < pattern.length && pattern[p] === text[t]) {
      p += 1;
      t += 1;
    } else if (star >= 0 && text[mark] !== '/') {
      p = star + 1;
      mark += 1;
      t = mark;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === '*') p += 1;
  return p === pattern.length;
}

function findMatch(glob, kind) {
  return (name, rel, directory, plain) => (kind === 'any' || (kind === 'file' ? plain : directory)) && (glob === undefined || globMatch(glob, glob.includes('/') ? rel : name));
}

async function findWalk(dir, prefix, match, found) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (FIND_SKIP.has(entry.name)) continue;
    const rel = prefix + entry.name;
    const directory = entry.isDirectory();
    if (match(entry.name, rel, directory, entry.isFile())) found.push(directory ? rel + '/' : rel);
    if (directory) await findWalk(join(dir, entry.name), rel + '/', match, found);
  }
  return true;
}

const PATH_TOOLS = new Set(['read_file', 'write_file', 'edit_file', 'list_dir', 'stat_file']);
const WRITE_TOOLS = new Set(['write_file', 'edit_file']);
const READ_ONLY = new Set(['job_status', 'search', 'wiki_search', 'grep', 'fetch', 'callers', 'impact', 'review_join']);
const SKILL_URI = /^skill:\/\//;
const unservedSkill = (uri) => ({ ok: false, error: `no served skill file has the uri ${uri}` });

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
    task_set: { zone1: resultZone1, zone2: resultZone2 },
    finish: { zone1: compactFinish, zone2: compactFinish },
  },
};

async function readServedSkill(args, serveSkill) {
  const unit = args.unit ?? 'lines';
  if (unit !== 'lines' && unit !== 'chars') return { ok: false, error: 'unit must be lines or chars' };
  const served = serveSkill(args.path);
  if (!served.ok) return served;
  if (args.offset === undefined && args.limit === undefined) return wholeFileReply(args.path, unit === 'lines', served.output);
  if (unit === 'chars') {
    const page = await readCharPage(args.path, args.offset ?? 0, args.limit ?? OUTPUT_PAGE, served.output);
    return page.ok ? { unit, ...page } : page;
  }
  return readLinePage(args.path, args.offset ?? 0, args.limit ?? Infinity, served.output);
}

export function createTools({ workspace, runDir, log, background = true, jobLifetimeMs = DEFAULT_JOB_LIFETIME_MS, stuckMs = DEFAULT_STUCK_MS, monitorMs = DEFAULT_MONITOR_MS, noticeMs = BODY_NOTICE_MS, leaves = BOOT_LEAVES, serveSkill = unservedSkill }) {
  const root = resolve(workspace);
  const realRoot = realpathSync(root);
  const jobs = new Map();
  const inFlightByBody = new Map();
  const pausedMs = new Map();
  const pausedSince = new Map();

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
      if (SKILL_URI.test(args.path ?? '')) return readServedSkill(args, serveSkill);
      const at = locate(args.path);
      if (at.refused) return refusal(at.refused);
      const unit = args.unit ?? 'lines';
      if (unit !== 'lines' && unit !== 'chars') return { ok: false, error: 'unit must be lines or chars' };
      if (isBinary(at.path)) return { ok: false, refused: true, error: 'refused: binary file; read_file serves text only' };
      if (args.offset === undefined && args.limit === undefined) return wholeFileReply(at.path, unit === 'lines');
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

    async fs_op(args) {
      if (!['mkdir', 'cp', 'mv', 'rm'].includes(args.op)) return { ok: false, error: 'op must be mkdir, cp, mv or rm' };
      const at = locate(args.path);
      if (at.refused) return refusal(at.refused);
      const target = at.path;
      let text = relative(root, target);
      if (args.op === 'mkdir') await mkdir(target, { recursive: true });
      else if (args.op === 'rm') {
        if (dirname(target) === target || target === root) return refusal('refusing to remove the filesystem root or the workspace root');
        await rm(target, { recursive: true, force: true });
      } else {
        const to = locate(args.to);
        if (to.refused || !to.path) return refusal(`to must be a non-empty string for ${args.op}`);
        text += ` to ${relative(root, to.path)}`;
        if (args.op === 'cp') await cp(target, to.path, { recursive: true, force: true });
        else await rename(target, to.path);
      }
      return { ok: true, output: `${args.op} ${text}` };
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

    async find(args) {
      const at = locate(args.path ?? '.');
      if (at.refused) return refusal(at.refused);
      if (args.glob !== undefined && typeof args.glob !== 'string') return { ok: false, error: 'glob must be a string' };
      if (args.kind !== undefined && !FIND_KINDS.includes(args.kind)) return { ok: false, error: 'kind must be file, dir or any' };
      if (args.offset !== undefined && (!Number.isInteger(args.offset) || args.offset < 0)) return { ok: false, error: 'offset must be a whole number, zero or more' };
      if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > LIST_PAGE)) return { ok: false, error: 'limit must be a whole number from 1 to ' + LIST_PAGE };
      const found = [];
      if (!(await findWalk(at.path, '', findMatch(args.glob, args.kind ?? 'any'), found))) return { ok: false, error: 'find: cannot read ' + (args.path ?? '.') };
      found.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
      const offset = args.offset ?? 0;
      const page = found.slice(offset, offset + (args.limit ?? LIST_PAGE));
      const next = offset + page.length < found.length ? offset + page.length : null;
      return { ok: true, output: page.join('\n'), total: found.length, next };
    },

    run_shell(args, ctx) {
      if (typeof args.command !== 'string' || args.command.trim() === '') {
        return { ok: false, error: 'command must be a non-empty string', launcher: shellLauncher(args.command, [], true) };
      }
      if (args.background !== true || !background) {
        const timeoutMs = Math.min(Number(args.timeoutMs) || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
        const launcher = shellLauncher(args.command, [], true);
        const withLauncher = (r) => ({ launcher, ...(r.timedOut === true ? { statement: shellTimeoutStatement(r.output, timeoutMs) } : {}), ...r });
        const startMono = log.now();
        const logged = (r) => {
          log.append('check', { command: checkKey(args.command), exitCode: r.exitCode ?? null, startMono });
          return r;
        };
        const result = runCommand(args.command, [], { cwd: root, timeoutMs, shell: true, signal: ctx?.signal });
        if (result && typeof result.then === 'function') return result.then((r) => condenseShell(withLauncher(logged(r)), args.raw === true, runDir));
        return condenseShell(withLauncher(logged(result)), args.raw === true, runDir);
      }
      if (!JOB_NAME.test(args.job ?? '')) return { ok: false, error: 'a background job needs job: 1 to 64 letters, digits, _ or -' };
      const timeoutMs = Math.min(Number(args.timeoutMs) || DEFAULT_JOB_TIMEOUT_MS, MAX_JOB_TIMEOUT_MS);
      return startJob(args.job, args.command, timeoutMs, args.progress);
    },

    async job_status(args) {
      const waitMs = Math.min(Math.max(Number(args.waitMs) || 0, 0), MAX_WAIT_MS);
      if (args.pid !== undefined && args.job === undefined) return waitForPid(args.pid, waitMs);
      if (!JOB_NAME.test(args.job ?? '')) return { ok: false, error: 'job must be a job name' };
      const job = jobs.get(args.job);
      if (job && !job.settled && waitMs > 0) await waitOrTimeout(job.done, waitMs);
      const status = readStatus(args.job);
      if (!status) return { ok: false, error: `no job named ${args.job}` };
      if (args.offset !== undefined && (!Number.isInteger(args.offset) || args.offset < 0)) {
        return { ok: false, error: 'offset must be a whole number of characters, zero or more' };
      }
      const { output: logPath, ...meta } = status;
      const text = outputOf(status);
      if (args.tail !== undefined && (!Number.isInteger(args.tail) || args.tail < 0)) {
        return { ok: false, error: 'tail must be a whole number of characters, zero or more' };
      }
      const page = args.tail === undefined ? OUTPUT_PAGE : Math.min(args.tail, OUTPUT_PAGE);
      const from = args.offset ?? Math.max(0, text.length - page);
      const end = Math.min(from + page, text.length);
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

    async job_stop(args) {
      if (!JOB_NAME.test(args.job ?? '')) return { ok: false, error: 'job must be a job name' };
      const job = jobs.get(args.job);
      if (job === undefined) return { ok: false, error: `no job named ${args.job}` };
      if (job.body !== undefined) return { ok: false, error: `${args.job} is a background run, not a shell job; finish with stopBackground: true stops it` };
      if (job.settled) return { ok: false, error: `job ${args.job} already ended (${readStatus(args.job)?.state})` };
      job.killRequested = true;
      job.killReason ??= 'cancelled';
      killGroup(job.pid);
      await job.done;
      return { ok: true, state: 'killed', reason: job.killReason, statement: jobKillStatement(args.job, job.killReason, 0, jobLifetimeMs), output: `stopped job ${args.job}` };
    },

    query_log(args = {}) {
      const unknown = Object.keys(args).filter((name) => !QUERY_ARGS.includes(name));
      if (unknown.length > 0) return refusal(`unknown argument ${unknown.join(', ')}; query_log takes ${QUERY_ARGS.join(', ')}`);
      if (args.field !== undefined) return queryField(args, log);
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
  function leafVerbsOf(modules) {
    const verbs = { ...modules['git.mjs'].createGitVerbs({ root, confine, log }), ...modules['rows.mjs'].createRowVerbs({ root, confine, log }), ...modules['wiki-tools.mjs'].createWikiVerbs({ root, log }), ...modules['review-tools.mjs'].createReviewVerbs({ root, log }), ...modules['fetch.mjs'].createFetchVerbs({ log, root, runDir }), ...modules['code-ast.mjs'].createAstVerbs({ root, confine }) };
    return { verbs, rowQueries: { openRows: modules['rows.mjs'].openRows, parkedRows: modules['rows.mjs'].parkedRows, rowSummary: modules['rows.mjs'].rowSummary } };
  }
  const boot = leafVerbsOf(leaves);
  Object.assign(handlers, boot.verbs, createSearchVerbs({ root, confine }));
  let leafNames = Object.keys(boot.verbs);
  let rowQueries = boot.rowQueries;

  function setLeaves(modules) {
    const next = leafVerbsOf(modules);
    for (const name of leafNames) delete handlers[name];
    Object.assign(handlers, next.verbs);
    leafNames = Object.keys(next.verbs);
    rowQueries = next.rowQueries;
  }

  function startJob(name, command, timeoutMs, progress) {
    if (jobs.has(name)) return { ok: false, error: `job ${name} already exists` };
    const outputFile = join(runDir, 'jobs', `${name}.out`);
    const exitFile = exitFileOf(name);
    mkdirSync(join(runDir, 'jobs'), { recursive: true });
    rmSync(exitFile, { force: true });
    const out = openSync(outputFile, 'w');
    const startMono = log.now();
    const startWall = Date.now();
    const child = spawnGroup(process.platform === 'win32' ? command : wrapShell(command, exitFile), [], root, ['ignore', out, out], { shell: true });
    closeSync(out);
    const status = { job: name, command, state: 'running', pid: child.pid, startMono, startWall, output: outputFile, timeoutMs: Math.min(timeoutMs, jobLifetimeMs) };
    writeStatus(name, status);

    const job = { name, pid: child.pid, status, outputFile, exitFile, startMono, progressFile: progress === undefined ? undefined : resolve(root, progress), startWall, stuck: false, killRequested: false, killReason: undefined, settled: false };
    job.lifetimeKilled = jobLifetimeMs < timeoutMs;
    job.timer = setTimeout(() => expireShell(job), Math.min(timeoutMs, jobLifetimeMs));
    job.done = new Promise((resolveDone) => {
      job.resolve = resolveDone;
    });
    child.on('error', (err) => endShell(job, null, err.message));
    child.on('close', (exitCode, signal) => endShell(job, exitCode, signal));
    jobs.set(name, job);
    watchJobs();
    log.append('job', { job: name, state: 'running', pid: child.pid });
    return { ok: true, state: 'running', output: `started job ${name} (pid ${child.pid})`, pid: child.pid, doneFile: exitFile, logPath: outputFile };
  }

  function exitFileOf(name) {
    return join(runDir, 'jobs', `${name}.exit`);
  }

  function endShell(job, exitCode, signal) {
    if (job.settled) return;
    job.settled = true;
    clearTimeout(job.timer);
    clearInterval(job.poll);
    const { name, status, startMono, outputFile } = job;
    const state = exitCode !== null && !job.killRequested ? 'exited' : 'killed';
    const reason = state === 'killed' ? job.killReason : undefined;
    const statementFields = reason === undefined ? {} : { statement: jobKillStatement(name, reason, status.timeoutMs, jobLifetimeMs) };
    const timeoutFields = reason === 'timeout' ? { timedOut: true, timeoutMs: status.timeoutMs } : {};
    const ended = { ...status, state, exitCode, signal, ...(reason === undefined ? {} : { reason }), ...statementFields, ...timeoutFields, durMs: Math.round(log.now() - startMono) };
    writeStatus(name, ended);
    log.append('job', { job: name, state, exitCode, signal, startMono, ...(reason === undefined ? {} : { reason }), ...statementFields, ...timeoutFields });
    log.append('check', { command: checkKey(status.command), job: name, exitCode, startMono });
    if (job.killReason !== undefined) {
      log.append('job-killed', { job: name, reason: job.killReason, statement: jobKillStatement(name, job.killReason, status.timeoutMs, jobLifetimeMs), ...(job.killReason === 'lifetime' ? { lifetimeMs: jobLifetimeMs } : {}), tail: readTail(outputFile, TAIL_CAP) });
    }
    job.resolve();
  }

  function expireShell(job) {
    job.killRequested = true;
    job.killReason = job.lifetimeKilled ? 'lifetime' : 'timeout';
    killGroup(job.pid);
  }

  function adoptShell(status) {
    const name = status.job;
    const startWall = status.startWall ?? Date.now() - Math.max(0, log.now() - status.startMono);
    const job = { name, pid: status.pid, status, outputFile: status.output, exitFile: exitFileOf(name), startMono: status.startMono, startWall, stuck: false, killRequested: false, killReason: undefined, settled: false };
    job.lifetimeKilled = status.timeoutMs >= jobLifetimeMs;
    job.done = new Promise((resolveDone) => {
      job.resolve = resolveDone;
    });
    job.timer = setTimeout(() => {
      expireShell(job);
      job.timer = setTimeout(() => {
        if (processAlive(job.pid)) endShell(job, null, null);
      }, ADOPT_KILL_CHECK_MS);
    }, Math.max(0, status.timeoutMs - (Date.now() - startWall)));
    job.poll = setInterval(() => pollShell(job), ADOPT_POLL_MS);
    jobs.set(name, job);
    watchJobs();
    log.append('job', { job: name, state: 'running', carried: true, pid: status.pid });
  }

  function pollShell(job) {
    if (job.settled) return;
    const exitCode = readExitCode(job.exitFile);
    if (exitCode !== null) endShell(job, exitCode, null);
    else if (!processAlive(job.pid)) endShell(job, null, null);
  }

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
      clearInterval(lifetime);
      writeStatus(name, { ...status, state, ...fields });
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
      log.append('job-killed', { job: name, reason, statement: jobKillStatement(name, reason, 0, jobLifetimeMs), tail, ...(reason === 'lifetime' ? { lifetimeMs: jobLifetimeMs } : {}) });
    };
    let lifetime;
    let reminder;
    const begin = () => {
      job.queued = false;
      job.startWall = Date.now();
      lifetime = setInterval(() => {
        if (budgetSpent(body, job.startWall) >= jobLifetimeMs) job.stop('lifetime');
      }, BODY_BUDGET_POLL_MS);
      reminder = setInterval(() => {
        const runningMs = Math.round(log.now() - startMono);
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

  function stopOrphans() {
    const dir = join(runDir, 'jobs');
    if (!existsSync(dir)) return;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const status = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      if (status.state !== 'running' && status.state !== 'queued') continue;
      if (status.body === undefined) {
        if (processAlive(status.pid)) {
          adoptShell(status);
          continue;
        }
        const exitCode = readExitCode(exitFileOf(status.job));
        if (exitCode !== null) {
          writeStatus(status.job, { ...status, state: 'exited', exitCode, signal: null });
          log.append('job', { job: status.job, state: 'exited', exitCode, signal: null, startMono: status.startMono });
          continue;
        }
        signalGroup(status.pid, 'SIGKILL');
      }
      const tail = status.body !== undefined ? bodyText(log, status.body, TAIL_CAP) : readTail(status.output, TAIL_CAP);
      const statement = jobKillStatement(status.job, 'restart', 0, 0);
      writeStatus(status.job, { ...status, state: 'killed', reason: 'restart', statement });
      log.append('job', { job: status.job, body: status.body, state: 'killed', startMono: status.startMono, reason: 'restart', statement });
      log.append('job-killed', { job: status.job, reason: 'restart', statement, tail });
    }
  }

  const mtimeOf = (file) => (file !== undefined && existsSync(file) ? statSync(file).mtimeMs : 0);
  function progressAt(job) {
    if ((inFlightByBody.get(job.body) ?? 0) > 0) return Date.now();
    if (job.body !== undefined) return Math.max(job.startWall, lastCallWall(log, job.body));
    return Math.max(job.startWall, mtimeOf(job.outputFile), mtimeOf(job.progressFile));
  }

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
      if ((inFlightByBody.get(body) ?? 0) === 0) pausedSince.set(body, Date.now());
      inFlightByBody.set(body, (inFlightByBody.get(body) ?? 0) + 1);
    },
    callEnded(body) {
      inFlightByBody.set(body, Math.max(0, (inFlightByBody.get(body) ?? 0) - 1));
      if ((inFlightByBody.get(body) ?? 0) === 0) pausedMs.set(body, (pausedMs.get(body) ?? 0) + Date.now() - pausedSince.get(body));
    },
    access(name, args) {
      if (READ_ONLY.has(name) || name === 'run_code') return { items: [] };
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
      const shells = [...jobs.values()].filter((job) => !job.settled && job.pid !== undefined);
      const stopping = reason === 'restart' ? [] : shells;
      for (const job of stopping) {
        job.killRequested = true;
        job.killReason ??= reason;
      }
      await Promise.all([...stopping.map((job) => job.pid), ...foregroundGroups].map((pid) => killGroup(pid)));
      await Promise.all(stopping.map((job) => job.done));
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
    return [...jobs.values()].filter((job) => job.pid !== undefined).map((job) => job.pid).concat([...foregroundGroups]);
  }

  function budgetSpent(body, startWall) {
    const inCall = (inFlightByBody.get(body) ?? 0) > 0 ? Date.now() - pausedSince.get(body) : 0;
    return Date.now() - startWall - (pausedMs.get(body) ?? 0) - inCall;
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

const QUERY_PAGE_EVENTS = 50;
const QUERY_REPLY_CHARS = 20000;
const QUERY_WINDOW_EVENTS = 1000;
const QUERY_WINDOW_BYTES = 4 * 1024 * 1024;
const QUERY_ARGS = ['js', 'kind', 'fromMono', 'toMono', 'after', 'last', 'limit', 'seq', 'field', 'offset', 'unit', 'pageLimit'];
const QUERY_FIELD_LIMIT = 20000;

function fieldAt(event, path) {
  let value = event;
  for (const key of String(path).split('.')) {
    if (key === '') return undefined;
    if (value === null || typeof value !== 'object') return undefined;
    value = value[key];
    if (value === undefined) return undefined;
  }
  return value;
}

function queryField(args, log) {
  if (!Number.isInteger(args.seq) || args.seq < 1) return { ok: false, error: 'seq must be a whole number from 1' };
  if (typeof args.field !== 'string' || args.field.trim() === '') return { ok: false, error: 'field must be a non-empty string' };
  if (args.unit !== undefined && args.unit !== 'chars') return { ok: false, error: 'unit must be chars' };
  const offset = args.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) return { ok: false, error: 'offset must be a whole number from 0' };
  const limit = args.pageLimit ?? args.limit ?? QUERY_FIELD_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > QUERY_FIELD_LIMIT) return { ok: false, error: 'limit must be a whole number from 1 to 20000' };
  const event = log.events().find((entry) => entry.seq === args.seq) ?? null;
  if (event === null) return { ok: false, error: 'no event with seq ' + args.seq };
  const value = fieldAt(event, args.field);
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  const end = Math.min(text.length, offset + limit);
  const next = end < text.length ? end : null;
  return {
    ok: true,
    output: text.slice(offset, end),
    total: text.length,
    offset,
    next,
    truncated: next !== null,
    seq: args.seq,
    field: args.field,
    unit: 'chars',
    digest: createHash('sha256').update(text).digest('hex').slice(0, 12),
  };
}

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

export function headChars(text, count) {
  const cut = count < text.length && /[\uD800-\uDBFF]/.test(text[count - 1]) ? count - 1 : count;
  return text.slice(0, cut);
}

export function redactArtifact(text) {
  return text
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/access_token=[^\s&]+/gi, 'access_token=[redacted]')
    .replace(/refresh_token=[^\s&]+/gi, 'refresh_token=[redacted]')
    .replace(/api_key=[^\s&]+/gi, 'api_key=[redacted]')
    .replace(/password=[^\s&]+/gi, 'password=[redacted]');
}

export function storeArtifact(text, runDir, label) {
  const clean = redactArtifact(text);
  const digest = createHash('sha256').update(clean).digest('hex').slice(0, 12);
  const dir = join(runDir, 'outputs');
  mkdirSync(dir, { recursive: true });
  const outputPath = join(dir, digest + '-' + label + '.txt');
  writeFileSync(outputPath, clean);
  return { outputPath, totalChars: clean.length, digest, offset: 0, next: 0, truncated: true, notice: '[gm: full output at ' + outputPath + '; page with gm.read_file({ path: ' + JSON.stringify(outputPath) + ', unit: "chars", offset: 0, limit: 20000 }) and read on from next until next is null]' };
}

function condenseShell(result, raw, runDir) {
  if (typeof result?.output !== 'string') return result;
  const condensed = raw ? null : condenseOutput(result.output);
  if (condensed === null) return cutShellOutput(result, runDir);
  const artifact = storeArtifact(result.output, runDir, 'run_shell');
  return { ...result, ...condensed, ...artifact, output: condensed.output + '\n' + artifact.notice };
}

function cutShellOutput(result, runDir) {
  if (result.output.length <= OUTPUT_PAGE) return result;
  const artifact = storeArtifact(result.output, runDir, 'run_shell');
  const page = headChars(redactArtifact(result.output), OUTPUT_PAGE);
  return { ...result, output: page, outputPath: artifact.outputPath, totalChars: artifact.totalChars, digest: artifact.digest, offset: 0, next: page.length, truncated: true, notice: `[gm: output is ${artifact.totalChars} characters; the first ${page.length} are in output. Read on with gm.read_file({ path: ${JSON.stringify(artifact.outputPath)}, unit: "chars", offset: ${page.length}, limit: ${OUTPUT_PAGE} }) until next is null]` };
}

const LOGGED_REPLY_CHARS = 1000;
async function waitForPid(pid, waitMs) {
  if (!Number.isInteger(pid) || pid < 1) return { ok: false, error: 'pid must be a whole number above zero' };
  if (process.platform === 'win32') return { ok: false, error: 'a pid wait is not served on Windows; start the command with job_start and pass job' };
  const started = Date.now();
  while (pidAlive(pid) && Date.now() - started < waitMs) await new Promise((done) => setTimeout(done, PID_POLL_MS));
  return { ok: true, pid, state: pidAlive(pid) ? 'running' : 'gone', exitCode: null, waitedMs: Date.now() - started, output: 'gm did not start this process, so it has no exit code or output for it' };
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function jobKillStatement(name, reason, timeoutMs, lifetimeMs) {
  if (reason === 'timeout') return `job ${name} stopped: timeout after ${timeoutMs} ms. The limit is job_start's timeoutMs (default ${DEFAULT_JOB_TIMEOUT_MS}); pass timeoutMs, up to the job lifetime of ${lifetimeMs} ms, for a longer run`;
  if (reason === 'lifetime') return `job ${name} stopped: the job lifetime of ${lifetimeMs} ms ended before it finished`;
  if (reason === 'cancelled') return `job ${name} stopped by job_stop`;
  if (reason === 'restart') return `job ${name} killed: the gm worker restarted while it ran, and a restart kills the process group of every job that was running`;
  if (reason === 'run-ended') return `job ${name} killed: its run ended while it ran (the run finished or its host closed), and ending a run kills the process group of every running job`;
  return `job ${name} killed: ${reason}`;
}

function quoteArg(text) {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

function wrapShell(command, exitFile) {
  return `sh -c '${EXIT_SCRIPT}' sh ${quoteArg(command)} ${quoteArg(exitFile)}`;
}

function readExitCode(file) {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8');
  return /^-?\d+\n$/.test(text) ? Number(text) : null;
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
  } catch (err) {
    return err.code === 'EPERM';
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return !stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z');
  } catch {
    return existsSync('/proc') === false;
  }
}

function shellTimeoutStatement(output, timeoutMs) {
  if (output === '') return `run_shell stopped: timeout after ${timeoutMs} ms with no output; the command was still running and printed nothing before the deadline (a sleep or wait prints nothing until it ends). Pass timeoutMs (up to 3600000) or start it with job_start.`;
  return `run_shell stopped: timeout after ${timeoutMs} ms; the output shown is what it printed before the deadline. Pass timeoutMs (up to 3600000) or start it with job_start.`;
}

const LOGGED_OUTPUT_TOOLS = new Set(['query_log', 'job_status', 'run_shell', 'run_code']);
export function loggedFor(tool, result) {
  if (!LOGGED_OUTPUT_TOOLS.has(tool) || result?.output === undefined) return result;
  const text = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
  const shown = { ...result, output: text };
  if (text.length <= LOGGED_REPLY_CHARS) return shown;
  return { ...shown, output: text.slice(0, LOGGED_REPLY_CHARS), outputChars: text.length, outputDigest: outputDigest(text, failedOf(result)) };
}

function waitOrTimeout(promise, ms) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

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

