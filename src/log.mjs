import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const QUERY_CAP = 20000;

export function openLog(file) {
  const events = [];
  return {
    append(kind, data) {
      const event = { seq: events.length + 1, t: new Date().toISOString(), kind, ...data };
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

function compile(js) {
  try {
    return new Function('events', `return (${js});`);
  } catch {
    return new Function('events', js);
  }
}
