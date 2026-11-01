import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const QUERY_CAP = 20000;

export function openLog(file) {
  const events = [];
  let inFlight = 0;
  const now = () => round(performance.now());
  return {
    now,
    enter() {
      inFlight += 1;
      return inFlight;
    },
    leave() {
      inFlight -= 1;
    },
    append(kind, data) {
      const mono = now();
      const event = { seq: events.length + 1, t: new Date().toISOString(), mono, inFlight, kind, ...data };
      if (typeof data.startMono === 'number') event.durMs = round(mono - data.startMono);
      events.push(event);
      appendFileSync(file, `${JSON.stringify(event)}\n`);
      return event;
    },
    events: () => events.slice(),
    recent: (n) => events.slice(-n),
    count: () => events.length,
  };
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
