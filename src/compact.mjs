// The feed's compaction. The log is never changed. The feed is a view of it: the events new since the last step, in full up to a cap and
// as records after that, the seen events of the first horizon as records, the seen events of the second horizon as shorter records, and
// nothing older, which query_log still reaches. A module
// that owns a tool or an event kind exports COMPACT next to that code, with its own strategy for it:
//   COMPACT = { tools: { name: { zone1, zone2 } }, kinds: { kind: { zone1, zone2 } } }
// A zone function takes (event, action) or (event), and returns a record, or null to drop the event from that zone. Every record
// names its full event by seq, so query_log reaches all of it. The functions here are deterministic: they read the events and nothing
// else, no clock and no path outside the log, so identical runs give identical feeds.

export const NEXT_CONTEXT_EVENTS_CAP = 20000;
// The horizons, in events back from the new events. Measured on the scripted session of 151 steps at 7.14 events per step, with the
// code-call results logged in full (DESIGN.md, "Feed compaction"). H1 is two steps of events. H2 is 12, the largest second horizon
// that keeps the average feed per step within the old window's average (4997 bytes against 5030), with H1 at two steps.
export const H1 = 14;
export const H2 = 12;

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

const DIGEST_ERRORS = 10;
const FAILED_HEAD_CHARS = 1000;
export const failedOf = (event) => event.ok === false || (typeof event.exitCode === 'number' && event.exitCode !== 0);

export function outputDigest(text, failed = false) {
  if (typeof text !== 'string' || text === '') return { lines: 0, bytes: 0 };
  const lines = text.split('\n');
  const digest = { lines: lines.length, bytes: Buffer.byteLength(text), head: lines.slice(0, 2).map((line) => clip(line)), tail: lines.slice(-2).map((line) => clip(line)) };
  const errors = lines.filter((line) => ERROR.test(line));
  if (errors.length > 0) {
    digest.errors = errors.slice(0, DIGEST_ERRORS).map((line) => clip(line));
    if (errors.length > DIGEST_ERRORS) digest.moreErrors = errors.length - DIGEST_ERRORS;
  }
  if (failed) {
    let shown = 0;
    let chars = 0;
    while (shown < lines.length && (shown === 0 || chars + lines[shown].length <= FAILED_HEAD_CHARS)) {
      chars += lines[shown].length;
      shown += 1;
    }
    digest.all = lines.slice(0, shown).map((line) => clip(line));
    if (shown < lines.length) digest.more = lines.length - shown;
  }
  return digest;
}

function digestOf(event) {
  if (event.outputDigest !== undefined) return event.outputDigest;
  return typeof event.output === 'string' ? outputDigest(event.output, failedOf(event)) : undefined;
}
const fullBytesOf = (event) => event.outputDigest?.bytes ?? Buffer.byteLength(typeof event.output === 'string' ? event.output : '');

// A result in the first horizon: its arguments in compact form, its exit code, its error text whole, and the digest of its output.
export function resultZone1(event, action) {
  const record = { seq: event.seq, tool: event.tool, ok: event.ok, args: argsOf(action?.args) };
  if (event.exitCode !== undefined) record.exit = event.exitCode;
  if (event.error !== undefined) record.error = event.error;
  const digest = digestOf(event);
  if (digest !== undefined) record.out = digest;
  record.full = { seq: event.seq, bytes: fullBytesOf(event) };
  return record;
}

// A result in the second horizon: the path and the sizes, the exit code and the error text, and no output.
export function resultZone2(event, action) {
  const record = { seq: event.seq, tool: event.tool, ok: event.ok, args: argsOf(action?.args) };
  if (event.exitCode !== undefined) record.exit = event.exitCode;
  if (event.error !== undefined) record.error = event.error;
  record.full = { seq: event.seq, bytes: fullBytesOf(event) };
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

// The feed's events array is capped by its serialized length. The new events come first, oldest first: the longest prefix of them in full
// that fits, and the rest as records after it. When the records of the rest would not fit, the rest is one range record, and query_log
// reaches each event in it. The seen events come after, newest first, within the two horizons, as far as the cap still has room. The
// cap is two characters short of its value, for the brackets of the array. Events come oldest first.
const ARRAY_OVERHEAD = 2;
const NO_ANSWERS = new Set();

const costOf = (value) => JSON.stringify(value).length + 1;
const sumCost = (items) => items.reduce((sum, item) => sum + costOf(item), 0);

export function feedOf(events, registry, { shown = 0, cap = NEXT_CONTEXT_EVENTS_CAP, h1 = H1, h2 = H2 } = {}) {
  const source = asSource(events);
  const n = source.count();
  const newStart = Math.min(shown, n);
  const zone1Start = Math.max(0, newStart - h1);
  const zone2Start = Math.max(0, zone1Start - h2);
  // An answer comes after its action, so every answer to an action in the feed's range is in the range.
  const answered = new Set();
  for (let seq = zone2Start + 1; seq <= n; seq += 1) {
    const event = source.at(seq);
    if (event.actionSeq !== undefined) answered.add(event.actionSeq);
  }
  const seen = [];
  for (let i = zone2Start; i < newStart; i += 1) {
    const record = recordOf(source.at(i + 1), i >= zone1Start ? 1 : 2, source, answered, registry);
    if (record !== null) seen.push({ index: i, item: record, cost: costOf(record) });
  }
  const fresh = [];
  for (let i = newStart; i < n; i += 1) {
    const event = source.at(i + 1);
    const record = freshRecordOf(event, source, registry);
    fresh.push({ index: i, event, cost: costOf(event), record, recordCost: costOf(record) });
  }
  const room = cap - ARRAY_OVERHEAD;
  const plan = planFresh(fresh, n, room);
  const kept = keptSeen(seen, room - plan.used);
  const items = [...kept.map((entry) => entry.item), ...plan.items];
  return {
    older: kept.length > 0 ? kept[0].index : newStart,
    records: items.length,
    fullEvents: plan.full,
    compactFrom: plan.full < fresh.length ? fresh[plan.full].index + 1 : null,
    events: items,
  };
}

// A new event as a record. An action always has one, even when its answer is in the feed, so no new event is dropped.
function freshRecordOf(event, source, registry) {
  if (event.kind === 'action') return { seq: event.seq, kind: 'action', tool: event.tool, args: argsOf(event.args) };
  return recordOf(event, 1, source, NO_ANSWERS, registry) ?? shortKind(event);
}

function planFresh(fresh, lastSeq, room) {
  const tailOf = (k) => (k === fresh.length ? [] : [{ kind: 'range', seqs: [fresh[k].index + 1, lastSeq], count: lastSeq - fresh[k].index }]);
  const recordTotal = fresh.reduce((sum, entry) => sum + entry.recordCost, 0);
  if (recordTotal <= room) {
    let spare = room - recordTotal;
    let full = 0;
    while (full < fresh.length && fresh[full].cost - fresh[full].recordCost <= spare) {
      spare -= fresh[full].cost - fresh[full].recordCost;
      full += 1;
    }
    const items = [...fresh.slice(0, full).map((entry) => entry.event), ...fresh.slice(full).map((entry) => entry.record)];
    return { full, items, used: room - spare };
  }
  let used = 0;
  let full = 0;
  while (full < fresh.length && used + fresh[full].cost + sumCost(tailOf(full + 1)) <= room) {
    used += fresh[full].cost;
    full += 1;
  }
  const tail = tailOf(full);
  return { full, items: [...fresh.slice(0, full).map((entry) => entry.event), ...tail], used: used + sumCost(tail) };
}

function keptSeen(seen, room) {
  const kept = [];
  let spare = room;
  for (let j = seen.length - 1; j >= 0 && seen[j].cost <= spare; j -= 1) {
    spare -= seen[j].cost;
    kept.unshift(seen[j]);
  }
  return kept;
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
