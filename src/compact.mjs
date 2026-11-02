// The feed's compaction. The log is never changed. The feed is a view of it: the last FULL events in full, the events of the first
// horizon as records, the events of the second horizon as shorter records, and nothing older, which query_log still reaches. A module
// that owns a tool or an event kind exports COMPACT next to that code, with its own strategy for it:
//   COMPACT = { tools: { name: { zone1, zone2 } }, kinds: { kind: { zone1, zone2 } } }
// A zone function takes (event, action) or (event), and returns a record, or null to drop the event from that zone. Every record
// names its full event by seq, so query_log reaches all of it. The functions here are deterministic: they read the events and nothing
// else, no clock and no path outside the log, so identical runs give identical feeds.

export const FULL = 20;
// The horizons, in events back from the full part. Measured on the scripted session of 151 steps at 7.14 events per step, with the
// code-call results logged in full (DESIGN.md, "Feed compaction"). H1 is two steps of events. H2 is 12, the largest second horizon
// that keeps the average feed per step within the old window's average (4997 bytes against 5030), with H1 at two steps.
export const H1 = 14;
export const H2 = 12;

const EVENT_CAP = 4000;
const LINE_CAP = 400;
const ARG_CAP = 200;
const ARG_HEAD = 80;
const ERROR = /\b(error|errors|fail|failed|failure|fatal|warn|warning|exception|traceback|denied|not ok)\b/i;
const SKIP = new Set(['t', 'mono', 'inFlight', 'startMono', 'durMs', 'actionSeq', 'step']);
// Kinds whose records keep their text whole in the second horizon: the witness, the error, the refusal reason, the gate outcome.
const KEEP_WHOLE = new Set(['witness', 'error', 'reason', 'gate', 'gaps', 'paths']);
// Kinds that the second horizon still shows. Everything else is cut there.
const KEEP_ZONE2 = new Set(['end', 'commit', 'refusal', 'error', 'restart', 'job-killed', 'review', 'review-packet', 'review-refused', 'lint', 'wiki', 'recovery', 'parse_error']);

export function clip(text, cap = LINE_CAP) {
  if (typeof text !== 'string' || text.length <= cap) return text;
  return `${text.slice(0, cap)} ...[${text.length} chars]`;
}

// The full event as the window shows it: capped as before, so one event cannot fill the feed.
export function compactEvent(event) {
  const text = JSON.stringify(event);
  return text.length <= EVENT_CAP ? event : { seq: event.seq, kind: event.kind, truncated: text.slice(0, EVENT_CAP), bytes: text.length };
}

// Input compaction for a call's arguments: a long string keeps its size and its first characters, a long list keeps its length.
export function argsOf(args) {
  const out = {};
  for (const [key, value] of Object.entries(args ?? {})) {
    if (typeof value === 'string') out[key] = value.length <= ARG_CAP ? value : { chars: value.length, head: clip(value, ARG_HEAD) };
    else if (Array.isArray(value)) out[key] = value.length <= 10 ? value : { items: value.length };
    else out[key] = value;
  }
  return out;
}

// Output compaction for a result text. It keeps the sizes, the first two lines and the last two, and every line that names an error,
// a failure or a warning. Nothing is dropped that a reader needs to see a failure.
export function outputDigest(text, failed = false) {
  if (typeof text !== 'string' || text === '') return { lines: 0, bytes: 0 };
  const lines = text.split('\n');
  const digest = { lines: lines.length, bytes: Buffer.byteLength(text), head: lines.slice(0, 2).map((line) => clip(line)), tail: lines.slice(-2).map((line) => clip(line)) };
  const errors = lines.filter((line) => ERROR.test(line)).map((line) => clip(line));
  if (errors.length > 0) digest.errors = errors;
  // A failed call keeps its output whole up to 60 lines. A failure's lines are not all marked by a keyword, so none is cut before that.
  if (failed) {
    const FAIL_LINES = 60;
    digest.all = lines.slice(0, FAIL_LINES).map((line) => clip(line));
    if (lines.length > FAIL_LINES) digest.more = lines.length - FAIL_LINES;
  }
  return digest;
}

// A result in the first horizon: its arguments in compact form, its exit code, its error text whole, and the digest of its output.
export function resultZone1(event, action) {
  const record = { seq: event.seq, tool: event.tool, ok: event.ok, args: argsOf(action?.args) };
  if (event.exitCode !== undefined) record.exit = event.exitCode;
  if (event.error !== undefined) record.error = event.error;
  if (typeof event.output === 'string') record.out = outputDigest(event.output, event.ok === false || (typeof event.exitCode === 'number' && event.exitCode !== 0));
  record.full = { seq: event.seq, bytes: Buffer.byteLength(typeof event.output === 'string' ? event.output : '') };
  return record;
}

// A result in the second horizon: the path and the sizes, the exit code and the error text, and no output.
export function resultZone2(event, action) {
  const record = { seq: event.seq, tool: event.tool, ok: event.ok, args: argsOf(action?.args) };
  if (event.exitCode !== undefined) record.exit = event.exitCode;
  if (event.error !== undefined) record.error = event.error;
  record.full = { seq: event.seq, bytes: Buffer.byteLength(typeof event.output === 'string' ? event.output : '') };
  return record;
}

// An event of a kind that no module owns, in the first horizon: its fields, short.
export function shortKind(event) {
  const record = { seq: event.seq, kind: event.kind };
  for (const [key, value] of Object.entries(event)) {
    if (SKIP.has(key) || key === 'seq' || key === 'kind') continue;
    record[key] = typeof value === 'string' ? clip(value, ARG_CAP) : value;
  }
  return record;
}

// The same event in the second horizon: kept only when a kind the agent still needs, with its witness, error and reason whole.
export function keptKind(event) {
  if (!KEEP_ZONE2.has(event.kind)) return null;
  const record = { seq: event.seq, kind: event.kind };
  for (const [key, value] of Object.entries(event)) {
    if (SKIP.has(key) || key === 'seq' || key === 'kind') continue;
    record[key] = KEEP_WHOLE.has(key) || typeof value !== 'string' ? value : clip(value, ARG_CAP);
  }
  return record;
}

// Merges the COMPACT exports of the modules into one registry, keyed by tool and by kind.
export function registryOf(...compacts) {
  const tools = {};
  const kinds = {};
  for (const compact of compacts) {
    Object.assign(tools, compact?.tools ?? {});
    Object.assign(kinds, compact?.kinds ?? {});
  }
  return { tools, kinds };
}

// The events of a log, by seq: count() and at(seq). A log object has both. An array is wrapped, for a caller that holds one.
export function sourceOf(events) {
  return { count: () => events.length, at: (seq) => events[seq - 1] };
}
const asSource = (events) => (Array.isArray(events) ? sourceOf(events) : events);

// The log's count when the last feed was made. Every event up to it has been transferred, so only the events after it are new.
export function shownTotalOf(events) {
  const source = asSource(events);
  for (let seq = source.count(); seq >= 1; seq -= 1) {
    const event = source.at(seq);
    if (event.kind === 'result' && event.tool === 'next_context' && event.ok === true && typeof event.total === 'number') return event.total;
  }
  return 0;
}

// The feed. An event is transferred in full the first time the agent sees it, so the full part is the events after the last feed, at
// most FULL of them. The events before that are seen already, and they come as the registry's compact records: the first horizon, then
// the second. Events older than the second horizon are not in the feed, and query_log reaches them. Events come oldest first.
export function feedOf(events, registry, { shown = 0, full = FULL, h1 = H1, h2 = H2 } = {}) {
  const source = asSource(events);
  const n = source.count();
  const fullStart = Math.max(shown, n - full);
  const zone1Start = Math.max(0, fullStart - h1);
  const zone2Start = Math.max(0, zone1Start - h2);
  // An answer comes after its action, so every answer to an action in the feed's range is in the range.
  const answered = new Set();
  for (let seq = zone2Start + 1; seq <= n; seq += 1) {
    const event = source.at(seq);
    if (event.actionSeq !== undefined) answered.add(event.actionSeq);
  }
  const out = [];
  for (let i = zone2Start; i < n; i += 1) {
    const zone = i >= fullStart ? 0 : i >= zone1Start ? 1 : 2;
    const event = source.at(i + 1);
    if (zone === 0) {
      out.push(compactEvent(event));
      continue;
    }
    const record = recordOf(event, zone, source, answered, registry);
    if (record !== null) out.push(record);
  }
  return { older: zone2Start, records: out.length, events: out };
}

function recordOf(event, zone, source, answered, registry) {
  if (event.kind === 'action') {
    if (answered.has(event.seq)) return null;
    return zone === 1 ? { seq: event.seq, kind: 'action', tool: event.tool, args: argsOf(event.args), unanswered: true } : null;
  }
  if (event.kind === 'result' || event.kind === 'code-call') {
    // A verb called in a body is its own action: its arguments are on the event, so its tool's strategy applies to it as to a result.
    const action = event.kind === 'code-call' ? event : event.actionSeq !== undefined ? source.at(event.actionSeq) : undefined;
    const owned = registry.tools[event.tool];
    const fn = owned ? (zone === 1 ? owned.zone1 : owned.zone2) : undefined;
    if (fn) return fn(event, action);
    return zone === 1 ? resultZone1(event, action) : resultZone2(event, action);
  }
  const owned = registry.kinds[event.kind];
  const fn = owned ? (zone === 1 ? owned.zone1 : owned.zone2) : undefined;
  if (fn) return fn(event);
  return zone === 1 ? shortKind(event) : keptKind(event);
}
