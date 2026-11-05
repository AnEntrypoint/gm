export const NEXT_CONTEXT_EVENTS_CAP = 20000;
export const NEXT_CONTEXT_EVENT_CAP = 2000;
export const H1 = 14;
export const H2 = 12;

const LINE_CAP = 400;
const ARG_CAP = 200;
const ARG_HEAD = 80;
const ERROR = /\b(error|errors|fail|failed|failure|fatal|warn|warning|exception|traceback|denied|not ok)\b/i;
const SKIP = new Set(['t', 'mono', 'inFlight', 'startMono', 'durMs', 'actionSeq', 'step']);
const KEEP_WHOLE = new Set(['witness', 'error', 'reason', 'gate', 'gaps', 'paths']);
const KEEP_ZONE2 = new Set(['end', 'commit', 'refusal', 'error', 'restart', 'job-killed', 'review', 'review-packet', 'review-refused', 'lint', 'wiki', 'recovery', 'parse_error']);
const EVENT_HEAD = 160;
const EVENT_TAIL = 80;
const EVENT_TEXT_CAP = 200;
const EVENT_ARGS_CAP = 8;
const DIGEST_LINES = 2;
const DIGEST_LINE_CAP = 120;
const FEED_REACH = 'query_log reads any event (after: seq - 1 returns it first)';
const TEXT_KEYS = ['body', 'error', 'witness', 'reason', 'gate', 'gaps', 'paths', 'task', 'source', 'sourceNew'];

export function clip(text, cap = LINE_CAP) {
  if (typeof text !== 'string' || text.length <= cap) return text;
  return `${text.slice(0, cap)} ...[${text.length} chars]`;
}

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

export function resultZone1(event, action) {
  const record = { seq: event.seq, tool: event.tool, ok: event.ok, args: argsOf(action?.args) };
  if (event.exitCode !== undefined) record.exit = event.exitCode;
  if (event.error !== undefined) record.error = event.error;
  const digest = digestOf(event);
  if (digest !== undefined) record.out = digest;
  record.full = { seq: event.seq, bytes: fullBytesOf(event) };
  return record;
}

export function resultZone2(event, action) {
  const record = { seq: event.seq, tool: event.tool, ok: event.ok, args: argsOf(action?.args) };
  if (event.exitCode !== undefined) record.exit = event.exitCode;
  if (event.error !== undefined) record.error = event.error;
  record.full = { seq: event.seq, bytes: fullBytesOf(event) };
  return record;
}

export function shortKind(event) {
  const record = { seq: event.seq, kind: event.kind };
  for (const [key, value] of Object.entries(event)) {
    if (SKIP.has(key) || key === 'seq' || key === 'kind') continue;
    record[key] = typeof value === 'string' ? clip(value, ARG_CAP) : value;
  }
  return record;
}

export function keptKind(event) {
  if (!KEEP_ZONE2.has(event.kind)) return null;
  const record = { seq: event.seq, kind: event.kind };
  for (const [key, value] of Object.entries(event)) {
    if (SKIP.has(key) || key === 'seq' || key === 'kind') continue;
    record[key] = KEEP_WHOLE.has(key) || typeof value !== 'string' ? value : clip(value, ARG_CAP);
  }
  return record;
}

export function registryOf(...compacts) {
  const tools = {};
  const kinds = {};
  for (const compact of compacts) {
    Object.assign(tools, compact?.tools ?? {});
    Object.assign(kinds, compact?.kinds ?? {});
  }
  return { tools, kinds };
}

export function sourceOf(events) {
  return { count: () => events.length, at: (seq) => events[seq - 1] };
}
const asSource = (events) => (Array.isArray(events) ? sourceOf(events) : events);

export function shownTotalOf(events) {
  const source = asSource(events);
  for (let seq = source.count(); seq >= 1; seq -= 1) {
    const event = source.at(seq);
    if (event.kind === 'result' && event.tool === 'next_context' && event.ok === true && typeof event.total === 'number') return event.total;
  }
  return 0;
}

const ARRAY_OVERHEAD = 2;
const NO_ANSWERS = new Set();

const costOf = (value) => JSON.stringify(value).length + 1;
const sumCost = (items) => items.reduce((sum, item) => sum + costOf(item), 0);

function headTail(text) {
  const length = text.length;
  if (length <= EVENT_HEAD + EVENT_TAIL) return text;
  return `${text.slice(0, EVENT_HEAD)} ...[${length - EVENT_HEAD - EVENT_TAIL} chars cut; ${FEED_REACH}] ...${text.slice(-EVENT_TAIL)}`;
}

function compactDigest(digest) {
  if (!digest || typeof digest !== 'object') return { lines: 0, bytes: 0, head: [], tail: [] };
  const linesOf = (values, fromTail = false) => {
    if (!Array.isArray(values)) return [];
    const part = fromTail ? values.slice(-DIGEST_LINES) : values.slice(0, DIGEST_LINES);
    return part.map((value) => clip(typeof value === 'string' ? value : JSON.stringify(value), DIGEST_LINE_CAP));
  };
  const out = { lines: Number(digest.lines) || 0, bytes: Number(digest.bytes) || 0, head: linesOf(digest.head), tail: linesOf(digest.tail, true) };
  if (Array.isArray(digest.errors)) {
    out.errors = linesOf(digest.errors);
    const more = Math.max(0, digest.errors.length - DIGEST_LINES) + (Number(digest.moreErrors) || 0);
    if (more > 0) out.moreErrors = more;
  }
  if (Array.isArray(digest.all)) {
    out.all = linesOf(digest.all);
    const more = Math.max(0, digest.all.length - DIGEST_LINES) + (Number(digest.more) || 0);
    if (more > 0) out.more = more;
  }
  return out;
}

function boundedArgs(args) {
  const compact = argsOf(args);
  const keys = Object.keys(compact);
  if (keys.length <= EVENT_ARGS_CAP) return compact;
  const out = {};
  for (const key of keys.slice(0, EVENT_ARGS_CAP)) out[key] = compact[key];
  out.more = keys.length - EVENT_ARGS_CAP;
  return out;
}

export function boundedItem(item, cap = NEXT_CONTEXT_EVENT_CAP) {
  const original = costOf(item);
  if (original <= cap) return item;
  let out = {};
  const put = (key, value) => {
    if (value === undefined) return;
    const candidate = { ...out, [key]: value };
    if (costOf(candidate) <= cap) out = candidate;
  };
  for (const key of ['seq', 't', 'kind', 'tool', 'ok', 'exitCode', 'exit', 'signal', 'actionSeq', 'step', 'full', 'unanswered']) put(key, item[key]);
  put('feedCut', { seq: item.seq ?? null, chars: original, reach: FEED_REACH });
  if (typeof item.output === 'string') {
    put('output', headTail(item.output));
    put('outputChars', item.outputChars ?? item.outputDigest?.bytes ?? item.output.length);
    put('outputDigest', compactDigest(digestOf(item)));
  } else {
    const text = JSON.stringify(item);
    put('head', text.slice(0, EVENT_HEAD));
    put('tail', text.slice(-EVENT_TAIL));
    put('textChars', text.length);
    put('textDigest', compactDigest(outputDigest(text, failedOf(item))));
  }
  if (item.out !== undefined) put('out', compactDigest(item.out));
  if (item.args !== undefined) put('args', boundedArgs(item.args));
  for (const key of TEXT_KEYS) {
    if (typeof item[key] === 'string') put(key, clip(item[key], EVENT_TEXT_CAP));
    else if (Array.isArray(item[key])) put(key, { items: item[key].length });
    else if (typeof item[key] === 'number' || typeof item[key] === 'boolean') put(key, item[key]);
  }
  return out;
}

export function feedOf(events, registry, { shown = 0, cap = NEXT_CONTEXT_EVENTS_CAP, eventCap = NEXT_CONTEXT_EVENT_CAP, h1 = H1, h2 = H2 } = {}) {
  const source = asSource(events);
  const n = source.count();
  const itemCap = Math.min(cap, eventCap);
  const newStart = Math.min(shown, n);
  const zone1Start = Math.max(0, newStart - h1);
  const zone2Start = Math.max(0, zone1Start - h2);
  const answered = new Set();
  for (let seq = zone2Start + 1; seq <= n; seq += 1) {
    const event = source.at(seq);
    if (event.actionSeq !== undefined) answered.add(event.actionSeq);
  }
  const seen = [];
  for (let i = zone2Start; i < newStart; i += 1) {
    const record = recordOf(source.at(i + 1), i >= zone1Start ? 1 : 2, source, answered, registry);
    if (record !== null) {
      const bounded = boundedItem(record, itemCap);
      seen.push({ index: i, item: bounded, cost: costOf(bounded) });
    }
  }
  const fresh = [];
  for (let i = newStart; i < n; i += 1) {
    const event = source.at(i + 1);
    const shown = boundedItem(event, itemCap);
    const record = boundedItem(freshRecordOf(event, source, registry), itemCap);
    fresh.push({ index: i, shown, cost: costOf(shown), record, recordCost: costOf(record) });
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
    while (full < fresh.length && Math.max(0, fresh[full].cost - fresh[full].recordCost) <= spare) {
      spare -= Math.max(0, fresh[full].cost - fresh[full].recordCost);
      full += 1;
    }
    const items = [...fresh.slice(0, full).map((entry) => entry.shown), ...fresh.slice(full).map((entry) => entry.record)];
    return { full, items, used: room - spare };
  }
  let used = 0;
  let full = 0;
  while (full < fresh.length && used + fresh[full].cost + sumCost(tailOf(full + 1)) <= room) {
    used += fresh[full].cost;
    full += 1;
  }
  const tail = tailOf(full);
  return { full, items: [...fresh.slice(0, full).map((entry) => entry.shown), ...tail], used: used + sumCost(tail) };
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
