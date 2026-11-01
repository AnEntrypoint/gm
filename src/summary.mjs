// The run summary: one event at the end of every run, computed only from the log's own events.
// Times are the monotonic clock the log stamps on each event: mono, and startMono for a span.
// A span is [startMono, mono] for an event that carries startMono.

export function summarize(events, endMono) {
  const first = events[0];
  const wall = first ? endMono - first.mono : 0;
  // A tool span is one action from enter to leave, so the integral of inFlight is the sum of the tool spans.
  const tool = spans(events, (event) => event.kind === 'result' || event.kind === 'refusal');
  // A model span is one attempt, from its startMono to its reply, retry or error. Backoff sleeps are idle.
  const model = spans(events, (event) => event.kind === 'reply' || event.kind === 'retry' || event.kind === 'error');
  const mcp = events.find((event) => event.kind === 'start')?.mode === 'mcp';
  return {
    maxInFlight: events.reduce((max, event) => Math.max(max, event.inFlight ?? 0), 0),
    meanInFlight: wall > 0 ? ms(total(tool) / wall) : 0,
    modelMs: ms(total(merge(model))),
    toolMs: ms(total(merge(tool))),
    idleMs: ms(Math.max(0, wall - total(merge([...tool, ...model])))),
    contextCalls: mcp
      ? events.filter((event) => event.kind === 'result' && event.tool === 'next_context').length
      : events.filter((event) => event.kind === 'reply').length,
  };
}

// Writes the summary once, before the end event. Its mono is the end time the summary was computed at,
// so the summary can be recomputed from the events before it.
export function writeSummary(log) {
  if (log.events().some((event) => event.kind === 'summary')) return;
  const endMono = log.now();
  log.append('summary', summarize(log.events(), endMono), endMono);
}

function spans(events, picks) {
  return events.filter((event) => picks(event) && typeof event.startMono === 'number').map((event) => [event.startMono, event.mono]);
}

function merge(intervals) {
  const merged = [];
  for (const [from, to] of [...intervals].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged;
}

function total(intervals) {
  return intervals.reduce((sum, [from, to]) => sum + (to - from), 0);
}

function ms(value) {
  return Math.round(value * 1000) / 1000;
}
