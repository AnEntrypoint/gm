#!/usr/bin/env node
// Attributes one dispatch's wait from the dispatch wait ledger, the reply it recorded, and the dispatches that
// shared its window. A dispatch reply carries dispatch_waited_ms and a dispatch_wait_split (admission_ms,
// claim_wait_ms, exec_ms, daemon_span_ms, reply_poll_ms); a split whose whole wait lands in a residual bucket
// (older builds called it unattributed_ms) says only that the wait was not spent inside the daemon, so this
// script discriminates the three candidates the ledger can settle: spool queue pressure, foreign git-lane
// holders, and gm-mcp pre-dispatch work that never reaches a daemon stamp.
//
// Usage: node scripts/triage/dispatch-wait-attribute.mjs [--root <repo>] [--json] <dispatch-id>
//
// The ledger keeps only its newest entries, so a dispatch older than its window is answered from the id alone:
// every dispatch id starts with its mint time in epoch ms, which is enough to say it rotated out.
// Output: one "key: value" line per fact, then a verdict line naming the dominant phase and its cause.
// Exit 0 when the id is attributed or proven rotated out, 1 when the id is malformed or the repo has no ledger.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
let asJson = false;
let rootArg = process.cwd();
let idArg = '';
const positional = [];
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === '--json') { asJson = true; continue; }
  if (a === '--root' || a === '--id') {
    const v = args[i + 1];
    if (v === undefined) continue;
    if (a === '--root') rootArg = v; else idArg = v;
    i += 1;
    continue;
  }
  if (a.startsWith('--')) continue;
  positional.push(a);
}
const root = path.resolve(rootArg);
const id = positional[0] ?? idArg;

const out = [];
const say = (k, v) => out.push([k, v]);

function fail(msg) {
  if (asJson) console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
  else console.error(msg);
  process.exit(1);
}

if (!/^[0-9]{10,}-/.test(id ?? '')) fail(`usage: dispatch-wait-attribute.mjs [--root <repo>] [--json] <dispatch-id>; got ${JSON.stringify(id ?? null)}`);

const ledgerPath = path.join(root, '.gm', 'exec-spool', '.dispatch-ledger.json');
if (!fs.existsSync(ledgerPath)) fail(`no dispatch ledger at ${ledgerPath}`);

function readLedger(file) {
  const rows = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t);
      if (o && typeof o === 'object') rows.push(o);
    } catch {
      // a partially written last line is not a finding; the ledger is append-only and the head file is separate
    }
  }
  return rows;
}

const rows = readLedger(ledgerPath);
const tsList = rows.map((r) => Number(r.ts)).filter((n) => Number.isFinite(n));
const window = tsList.length ? { first: Math.min(...tsList), last: Math.max(...tsList), entries: rows.length } : null;

// A dispatch id is "<epoch-ms>-<seq>-<hex>", so its mint time survives the ledger rotating the record out.
function tsFromDispatchId(value) {
  const head = String(value).split('-')[0];
  const n = Number(head);
  return Number.isFinite(n) && n > 1e12 ? n : null;
}

const mintedAt = tsFromDispatchId(id);
const own = rows.find((r) => r.dispatch_id === id);

say('dispatch_id', id);
say('minted_at_ms', mintedAt);
say('in_ledger', Boolean(own));
if (window) {
  say('ledger_entries', window.entries);
  say('ledger_window_ms', `${window.first}..${window.last}`);
  say('ledger_window_span_h', ((window.last - window.first) / 3_600_000).toFixed(2));
}
if (!own) {
  say('rotated_out', mintedAt !== null && window ? mintedAt < window.first : null);
  say('verdict', mintedAt !== null && window && mintedAt < window.first
    ? `rotated out: the id was minted ${((window.first - mintedAt) / 3_600_000).toFixed(1)} h before the ledger's oldest retained entry, so no reply or ledger row for it survives; attribute it from the reply text a witness recorded, not from this ledger`
    : 'absent: no ledger row for this id inside the retained window');
  emit();
  process.exit(0);
}

say('verb', own.verb ?? null);
say('session_id', own.session_id ?? null);
say('exit_code', own.exit_code ?? null);

const reply = readReply(own, id);
const split = reply && typeof reply.dispatch_wait_split === 'object' ? reply.dispatch_wait_split : null;
const waited = Number(reply?.dispatch_waited_ms);
say('reply_found', Boolean(reply));
say('dispatch_waited_ms', Number.isFinite(waited) ? waited : null);
say('admission_band', reply?.admission_band ?? null);
say('admission_decision', reply?.admission_decision ?? null);
if (split) for (const [k, v] of Object.entries(split)) say(`split.${k}`, v);

// Dispatches that were recorded inside the wait window shared the queue with this one.
const end = Number(own.ts);
const start = Number.isFinite(waited) ? end - waited : end;
const overlap = rows.filter((r) => r.dispatch_id !== id && Number.isFinite(Number(r.ts)) && Number(r.ts) >= start && Number(r.ts) <= end);
const gitLane = overlap.filter((r) => String(r.verb ?? '').startsWith('git'));
say('window_ms', `${start}..${end}`);
say('concurrent_dispatches', overlap.length);
say('concurrent_git_lane', gitLane.length);
say('concurrent_git_verbs', gitLane.length ? [...new Set(gitLane.map((r) => r.verb))].join(',') : '');

const residual = split
  ? (Number(split.unattributed_ms) || 0) + Math.max(0, (Number.isFinite(waited) ? waited : 0) - attributed(split))
  : null;
say('residual_ms', residual);

let verdict;
if (!split && !Number.isFinite(waited)) {
  verdict = 'the reply carries no wait split (no dispatch_waited_ms), so the wait was below the disclosure floor or predates it; nothing here is slow';
} else if (residual !== null && residual > 1000) {
  const cause = gitLane.length > 0
    ? `foreign git-lane holders: ${gitLane.length} git verb dispatch(es) finished inside the window (${[...new Set(gitLane.map((r) => r.verb))].join(',')}) and the git lane is claimed once per top-level dispatch`
    : overlap.length > 8
      ? `spool queue: ${overlap.length} dispatches were recorded inside the same window, so the wait is queue position, not execution`
      : 'gm-mcp pre-dispatch or admission without a daemon stamp: no git-lane holder and no queue pressure inside the window';
  verdict = `${residual} ms of ${Number.isFinite(waited) ? waited : residual} ms is outside every attributed phase -> ${cause}`;
} else {
  const top = split ? Object.entries(split).filter(([, v]) => typeof v === 'number').sort((a, b) => b[1] - a[1])[0] : null;
  verdict = top ? `dominant phase ${top[0]} = ${top[1]} ms of ${Number.isFinite(waited) ? waited : '?'} ms` : 'no wait split to attribute';
}
say('verdict', verdict);
emit();

const SKIP_IN_SUM = new Set([
  'unattributed_ms', // the residual itself
  'lane_wait_ms', // the same claim wait reported under its lane name
  'post_claim_ms', // a container: claim wait plus everything after it
  'daemon_span_ms', // a container that overlaps exec
  'reply_poll_ms', // a container that is the tail of post_claim
  'daemon_handoff_ms', // a container that is a slice of daemon_span
]);

function attributed(s) {
  let sum = 0;
  for (const [k, v] of Object.entries(s)) {
    if (SKIP_IN_SUM.has(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) sum += v;
  }
  return sum;
}

function readReply(row, dispatchId) {
  const outDir = path.join(root, '.gm', 'exec-spool', 'out');
  const candidates = [
    row.spill_file && path.isAbsolute(row.spill_file) ? row.spill_file : null,
    path.join(outDir, `${row.verb ?? ''}-${dispatchId}.json`),
    path.join(outDir, `${dispatchId}.json`),
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, 'utf8').trim();
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // a spill is a text projection, not JSON; the next candidate decides
    }
  }
  return scanOutByDispatchId(row, dispatchId);
}

// Replies are kept as out/<verb>-<session>-<seq>-<ts>-<rand>.json, so the request number is not in the ledger;
// the reply body does carry dispatch_id, so the matching file is found by content inside the recorded window.
function scanOutByDispatchId(row, dispatchId) {
  const outDir = path.join(root, '.gm', 'exec-spool', 'out');
  let names = [];
  try {
    names = fs.readdirSync(outDir);
  } catch {
    return null;
  }
  const anchor = Number(row.ts);
  const prefix = `${row.verb ?? ''}-`;
  for (const name of names) {
    if (!name.endsWith('.json') || (prefix !== '-' && !name.startsWith(prefix))) continue;
    const file = path.join(outDir, name);
    try {
      const st = fs.statSync(file);
      if (Number.isFinite(anchor) && Math.abs(st.mtimeMs - anchor) > 600_000) continue;
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.dispatch_id === dispatchId) return parsed;
    } catch {
      // an unreadable or mid-write file is not a finding; the next candidate decides
    }
  }
  return null;
}

function emit() {
  if (asJson) {
    console.log(JSON.stringify(Object.fromEntries(out), null, 2));
    return;
  }
  for (const [k, v] of out) console.log(`${k}: ${v === null || v === undefined ? '' : v}`);
}
