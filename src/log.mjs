import { appendFileSync, closeSync, existsSync, openSync, readFileSync, readSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { dirname, join } from 'node:path';
import { appendPending, PENDING_KINDS } from './pending.mjs';

const QUERY_CAP = 20000;
const WINDOW = 512;
const BATCH = 256;
const writers = new Set();

// The log lives in its file, and its index lives beside it: one fixed record for each event, holding the event's byte offset and length in the
// log. The worker keeps the last WINDOW events in memory and reads any other event by seeking to its record, so memory does not grow with the
// length of the run. Events wait in memory only until the next flush point: before any reply is written, before a body, a shell command or a
// job starts, before the file is read, and at process exit. So nothing is replied before its events are in the file.
export function openLog(file) {
  const runDir = dirname(file);
  const indexFile = join(runDir, INDEX_FILE);
  const checked = checkIndex(file, indexFile);
  let count = checked.count;
  let size = checked.size;
  let inFlight = 0;
  const indexFd = openSync(indexFile, 'a+');
  const recordBuf = Buffer.alloc(RECORD_BYTES);
  const locate = (seq) => {
    readSync(indexFd, recordBuf, 0, RECORD_BYTES, (seq - 1) * RECORD_BYTES);
    return [recordBuf.readDoubleLE(0), recordBuf.readUInt32LE(8)];
  };
  const tail = checked.tail ?? readWindow(file, count, size, locate);
  // The lines and the records not yet written. Each record is written after its line, so the index never names bytes the log lacks.
  let unwritten = [];
  let pendingRecords = 0;
  const pendingIndex = Buffer.alloc(RECORD_BYTES * BATCH);
  const flush = () => {
    if (unwritten.length > 0) {
      appendFileSync(file, unwritten.join(''));
      unwritten = [];
    }
    if (pendingRecords > 0) {
      writeAll(indexFd, pendingIndex, pendingRecords * RECORD_BYTES);
      pendingRecords = 0;
    }
  };
  writers.add(flush);
  const offset = tail.length ? tail.at(-1).mono : 0;
  const now = () => round(offset + performance.now());
  const firstInWindow = () => count - tail.length + 1;
  const at = (seq) => {
    if (seq < 1 || seq > count) return undefined;
    if (seq >= firstInWindow()) return tail[seq - firstInWindow()];
    flush();
    const [begin, length] = locate(seq);
    return JSON.parse(readRange(file, begin, begin + length));
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
      const event = { seq: count + 1, t: new Date().toISOString(), mono, inFlight, kind, ...data };
      if (typeof data.startMono === 'number') event.durMs = round(mono - data.startMono);
      const line = `${JSON.stringify(event)}\n`;
      const bytes = Buffer.byteLength(line);
      const slot = pendingRecords * RECORD_BYTES;
      pendingIndex.writeDoubleLE(size, slot);
      pendingIndex.writeUInt32LE(bytes, slot + 8);
      pendingIndex.writeUInt32LE(0, slot + 12);
      pendingRecords += 1;
      unwritten.push(line);
      count += 1;
      if (unwritten.length >= BATCH) flush();
      size += bytes;
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
      for (let s = Math.max(1, seq); s <= count; s += 1) out.push(at(s));
      return out;
    },
    // The first events after seq that match, in order. The window ends after limit matches, or once it has read budget bytes of lines, and
    // last is the seq of the last event it read, so a caller that continues from last misses no event. The file is read from the first
    // event after seq, so a window costs the lines it reads, not the whole log. after is a whole number of events.
    window: (after, limit, match, budget) => {
      flush();
      if (after >= count) return { events: [], last: after };
      return scanWindow(file, locate(after + 1)[0], size, after, limit, match, budget);
    },
    // The newest events after seq that match, in order, at most limit. The walk goes back from the newest event, so it reads only the
    // events it needs, and a tail of recent events costs little whatever the length of the log.
    tail: (after, limit, match) => {
      flush();
      const out = [];
      for (let seq = count; seq > after && out.length < limit; seq -= 1) {
        const event = at(seq);
        if (match(event)) out.push(event);
      }
      return out.reverse();
    },
    // The whole history, read from the file. Only the callers that need every event use it.
    events: () => {
      flush();
      return readEvents(file);
    },
    flush,
    recent: (n) => tail.slice(-n),
    count: () => count,
  };
}

const INDEX_FILE = 'log.index';
const RECORD_BYTES = 16;

function checkIndex(file, indexFile) {
  const logSize = existsSync(file) ? statSync(file).size : 0;
  if (existsSync(indexFile)) {
    const indexSize = statSync(indexFile).size;
    if (indexSize % RECORD_BYTES === 0) {
      const count = indexSize / RECORD_BYTES;
      if (count === 0 ? logSize === 0 : lastEnd(indexFile, count) === logSize) return { count, size: logSize, tail: null };
    }
  }
  const scanned = scanLog(file);
  const records = Buffer.alloc(scanned.offsets.length * RECORD_BYTES);
  scanned.offsets.forEach((begin, i) => {
    const end = i + 1 < scanned.offsets.length ? scanned.offsets[i + 1] : scanned.size;
    records.writeDoubleLE(begin, i * RECORD_BYTES);
    records.writeUInt32LE(end - begin, i * RECORD_BYTES + 8);
  });
  writeFileSync(indexFile, records);
  return { count: scanned.offsets.length, size: scanned.size, tail: scanned.tail };
}

function lastEnd(indexFile, count) {
  const fd = openSync(indexFile, 'r');
  try {
    const record = Buffer.alloc(RECORD_BYTES);
    readSync(fd, record, 0, RECORD_BYTES, (count - 1) * RECORD_BYTES);
    return record.readDoubleLE(0) + record.readUInt32LE(8);
  } finally {
    closeSync(fd);
  }
}

function readWindow(file, count, size, locate) {
  if (count === 0) return [];
  const [begin] = locate(Math.max(1, count - WINDOW + 1));
  return readRange(file, begin, size)
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

function writeAll(fd, buffer, length) {
  let at = 0;
  while (at < length) at += writeSync(fd, buffer, at, length - at);
}

// Writes every open log's events to its file. The worker calls it before a reply, and the exit of the process calls it too.
export function flushAllLogs() {
  for (const flush of writers) flush();
}
process.on('exit', flushAllLogs);

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

function scanWindow(file, begin, end, after, limit, match, budget) {
  const out = [];
  const fd = openSync(file, 'r');
  const chunk = Buffer.alloc(1 << 16);
  let pending = Buffer.alloc(0);
  let position = begin;
  let last = after;
  const visit = (bytes) => {
    const line = bytes.toString('utf8');
    if (line.trim() === '') return;
    const event = JSON.parse(line);
    last = event.seq;
    if (match(event)) out.push(event);
  };
  try {
    while (position < end && out.length < limit && (position - begin < budget || last === after)) {
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
    // The last line has no newline only at the end of the file, so an open line is read only once the file is read to its end.
    if (position >= end && pending.length > 0 && out.length < limit) visit(pending);
  } finally {
    closeSync(fd);
  }
  return { events: out, last };
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
