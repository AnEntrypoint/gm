import { appendFileSync, closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const QUERY_CAP = 20000;
// The events kept in memory, the last ones. Any other event is read from the file at its offset.
const WINDOW = 512;

// The log lives in its file. The worker keeps the byte offset of every event and the last WINDOW events, so the memory does not grow
// with the length of the run. A restart rebuilds the offsets and the window from the file.
export function openLog(file) {
  const { offsets, tail, size: start } = scanLog(file);
  let size = start;
  let inFlight = 0;
  const offset = tail.length ? tail.at(-1).mono : 0;
  const now = () => round(offset + performance.now());
  const firstInWindow = () => offsets.length - tail.length + 1;
  const at = (seq) => {
    if (seq < 1 || seq > offsets.length) return undefined;
    if (seq >= firstInWindow()) return tail[seq - firstInWindow()];
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
      appendFileSync(file, line);
      size += Buffer.byteLength(line);
      tail.push(event);
      if (tail.length > WINDOW) tail.shift();
      return event;
    },
    at,
    eventsFrom: (seq) => {
      const out = [];
      for (let s = Math.max(1, seq); s <= offsets.length; s += 1) out.push(at(s));
      return out;
    },
    // The whole history, read from the file. Only the callers that need every event use it.
    events: () => readEvents(file),
    recent: (n) => tail.slice(-n),
    count: () => offsets.length,
  };
}

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
