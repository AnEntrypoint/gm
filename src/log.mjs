import { appendFileSync, closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { dirname } from 'node:path';
import { appendPending, PENDING_KINDS } from './pending.mjs';

const QUERY_CAP = 20000;
// The events kept in memory, the last ones. Any other event is read from the file at its offset.
const WINDOW = 512;
// Events are written to the file in batches of this many, and at every flush point (see flushAllLogs). A batch is one append, not one per event.
const BATCH = 256;
const writers = new Set();

// The log lives in its file. The worker keeps the byte offset of every event and the last WINDOW events, so the memory does not grow
// with the length of the run. A restart rebuilds the offsets and the window from the file. Events wait in memory only until the next flush
// point: before any reply is written, before a body, a shell command or a job starts, before the file is read, and at process exit. So
// nothing is replied before its events are in the file.
export function openLog(file) {
  const { offsets, tail, size: start } = scanLog(file);
  let size = start;
  let inFlight = 0;
  let unwritten = [];
  const runDir = dirname(file);
  const flush = () => {
    if (unwritten.length === 0) return;
    appendFileSync(file, unwritten.join(''));
    unwritten = [];
  };
  writers.add(flush);
  const offset = tail.length ? tail.at(-1).mono : 0;
  const now = () => round(offset + performance.now());
  const firstInWindow = () => offsets.length - tail.length + 1;
  const at = (seq) => {
    if (seq < 1 || seq > offsets.length) return undefined;
    if (seq >= firstInWindow()) return tail[seq - firstInWindow()];
    flush();
    const begin = offsets[seq - 1];
    const end = seq < offsets.length ? offsets[seq] : size;
    return JSON.parse(readRange(file, begin, end));
  };
  return {
    now,
    enter() {
      inFlight += 1;
      return inFlight;
    },
    leave() {
      inFlight -= 1;
    },
    append(kind, data, monoAt) {
      const mono = monoAt ?? now();
      const event = { seq: offsets.length + 1, t: new Date().toISOString(), mono, inFlight, kind, ...data };
      if (typeof data.startMono === 'number') event.durMs = round(mono - data.startMono);
      const line = `${JSON.stringify(event)}\n`;
      offsets.push(size);
      unwritten.push(line);
      if (unwritten.length >= BATCH) flush();
      size += Buffer.byteLength(line);
      tail.push(event);
      if (tail.length > WINDOW) tail.shift();
      // The log holds the event before the pending queue names it, so the queue never names an event the log lacks.
      if (PENDING_KINDS.has(kind)) {
        flush();
        appendPending(runDir, event);
      }
      return event;
    },
    at,
    eventsFrom: (seq) => {
      const out = [];
      for (let s = Math.max(1, seq); s <= offsets.length; s += 1) out.push(at(s));
      return out;
    },
    // The first events after seq that match, in order, at most limit. The file is read from the first of them, so a page costs the lines
    // it reads, not the whole log. after is a whole number of events.
    take: (after, limit, match) => {
      flush();
      return after >= offsets.length ? [] : scanFrom(file, offsets[after], size, limit, match);
    },
    // The whole history, read from the file. Only the callers that need every event use it.
    events: () => {
      flush();
      return readEvents(file);
    },
    flush,
    recent: (n) => tail.slice(-n),
    count: () => offsets.length,
  };
}

// Writes every open log's events to its file. The worker calls it before a reply, and the exit of the process calls it too.
export function flushAllLogs() {
  for (const flush of writers) flush();
}
process.on('exit', flushAllLogs);

// The offset of every event's line, the file size, and the last WINDOW events, read from the file in chunks.
function scanLog(file) {
  const offsets = [];
  if (!existsSync(file)) return { offsets, tail: [], size: 0 };
  const fd = openSync(file, 'r');
  const chunk = Buffer.alloc(1 << 16);
  let size = 0;
  let lineStart = 0;
  try {
    for (;;) {
      const n = readSync(fd, chunk, 0, chunk.length, size);
      if (n === 0) break;
      for (let i = 0; i < n; i += 1) {
        if (chunk[i] === 10) {
          offsets.push(lineStart);
          lineStart = size + i + 1;
        }
      }
      size += n;
    }
  } finally {
    closeSync(fd);
  }
  const from = offsets.length > WINDOW ? offsets[offsets.length - WINDOW] : 0;
  const tail = readRange(file, from, size)
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
  return { offsets, tail, size };
}

// The text of the bytes from begin to end of the file. A line read this way parses as its event.
function readRange(file, begin, end) {
  const fd = openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(end - begin);
    readSync(fd, buffer, 0, buffer.length, begin);
    return buffer.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

export function readEvents(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

// The events in the bytes from begin to end that match, in order, at most limit. It reads in chunks and stops at the limit.
function scanFrom(file, begin, end, limit, match) {
  const out = [];
  const fd = openSync(file, 'r');
  const chunk = Buffer.alloc(1 << 16);
  let pending = Buffer.alloc(0);
  let position = begin;
  const visit = (bytes) => {
    const line = bytes.toString('utf8');
    if (line.trim() === '') return;
    const event = JSON.parse(line);
    if (match(event)) out.push(event);
  };
  try {
    while (position < end && out.length < limit) {
      const n = readSync(fd, chunk, 0, Math.min(chunk.length, end - position), position);
      if (n === 0) break;
      position += n;
      pending = Buffer.concat([pending, chunk.subarray(0, n)]);
      let start = 0;
      for (let nl = pending.indexOf(10); nl !== -1 && out.length < limit; nl = pending.indexOf(10, start)) {
        visit(pending.subarray(start, nl));
        start = nl + 1;
      }
      pending = pending.subarray(start);
    }
    if (pending.length > 0 && out.length < limit) visit(pending);
  } finally {
    closeSync(fd);
  }
  return out;
}

export function runQuery(events, js) {
  try {
    const text = JSON.stringify(compile(js)(events)) ?? 'undefined';
    if (text.length <= QUERY_CAP) return { ok: true, output: text };
    return { ok: true, output: `${text.slice(0, QUERY_CAP)} ...[cut at ${QUERY_CAP} chars, narrow the filter]` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function round(ms) {
  return Math.round(ms * 1000) / 1000;
}

function compile(js) {
  try {
    return new Function('events', `return (${js});`);
  } catch {
    return new Function('events', js);
  }
}
