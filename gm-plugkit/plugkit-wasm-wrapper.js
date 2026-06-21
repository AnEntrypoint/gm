import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import https from 'https';
import http from 'http';
import { watch } from 'fs';
import * as _childProcess from 'child_process';
import { spawn as _rawSpawn, spawnSync as _rawSpawnSync } from 'child_process';
import net from 'net';
const _netModule = net;
const _httpModule = http;
const _httpsModule = https;
import { fileURLToPath } from 'url';

let _writeStatusBusy = () => {};
let _lastBusyUntil = 0;
let _ownWrapperSha12 = '';

function spawnSync(cmd, args, opts) {
  return _rawSpawnSync(cmd, args, { windowsHide: true, ...(opts || {}) });
}
function spawn(cmd, args, opts) {
  return _rawSpawn(cmd, args, { windowsHide: true, ...(opts || {}) });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveGmToolsRoot() {
  const primary = path.join(os.homedir(), '.gm-tools');
  const fallback = path.join(os.homedir(), '.claude', 'gm-tools');
  if (fs.existsSync(primary)) return primary;
  if (fs.existsSync(fallback)) return fallback;
  return primary;
}
const GM_TOOLS_ROOT = resolveGmToolsRoot();
const KV_DIR = path.join(GM_TOOLS_ROOT, 'kv');
fs.mkdirSync(KV_DIR, { recursive: true });

const GM_LOG_ROOT = process.env.GM_LOG_DIR || path.join(os.homedir(), '.claude', 'gm-log');
const ORCHESTRATOR_VERBS = new Set(['instruction', 'transition', 'phase-status', 'prd-add', 'prd-resolve', 'prd-list', 'mutable-add', 'mutable-resolve', 'mutable-list', 'memorize-fire', 'residual-scan', 'auto-recall']);

const TURN_IDLE_MS = 30_000;
const _turns = new Map();

let __shutdownReasonWritten = false;
let __currentVerbContext = null;

function spoolDirForSentinel() {
  return process.env.CLAUDE_PROJECT_DIR
    ? path.join(process.env.CLAUDE_PROJECT_DIR, '.gm', 'exec-spool')
    : path.join(process.cwd(), '.gm', 'exec-spool');
}

function emitShutdownReason(reason, err) {
  if (__shutdownReasonWritten) return;
  __shutdownReasonWritten = true;
  try {
    const spoolDir = spoolDirForSentinel();
    fs.mkdirSync(spoolDir, { recursive: true });
    const body = {
      reason,
      ts: Date.now(),
      pid: process.pid,
      message: err && (err.message || String(err)),
      stack: err && err.stack ? String(err.stack).slice(0, 4000) : null,
      version: typeof PLUGKIT_VERSION !== 'undefined' ? PLUGKIT_VERSION : null,
      verb_in_flight: __currentVerbContext,
    };
    fs.writeFileSync(path.join(spoolDir, '.shutdown-reason.json'), JSON.stringify(body, null, 2));
    try { fs.unlinkSync(path.join(spoolDir, '.boot-active.json')); } catch (_) {}
    try { fs.unlinkSync(path.join(spoolDir, '.verb-active.json')); } catch (_) {}
  } catch (_) {}
}

function writeVerbActive(verb, task) {
  __currentVerbContext = { verb, task, started_at_ms: Date.now(), pid: process.pid };
  try {
    const spoolDir = spoolDirForSentinel();
    fs.mkdirSync(spoolDir, { recursive: true });
    fs.writeFileSync(path.join(spoolDir, '.verb-active.json'), JSON.stringify(__currentVerbContext));
  } catch (_) {}
}

function clearVerbActive() {
  __currentVerbContext = null;
  try { fs.unlinkSync(path.join(spoolDirForSentinel(), '.verb-active.json')); } catch (_) {}
}

process.on('uncaughtException', (err) => {
  try { console.error('[plugkit-wasm] uncaught:', err && err.stack || err); } catch (_) {}
  emitShutdownReason('uncaughtException', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  try { console.error('[plugkit-wasm] unhandled rejection:', reason && reason.stack || reason); } catch (_) {}
  emitShutdownReason('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)));
  process.exit(1);
});

process.on('exit', (code) => {
  if (__shutdownReasonWritten) return;
  try {
    const spoolDir = spoolDirForSentinel();
    fs.mkdirSync(spoolDir, { recursive: true });
    fs.writeFileSync(path.join(spoolDir, '.shutdown-reason.json'), JSON.stringify({
      reason: 'process-exit',
      exit_code: code,
      ts: Date.now(),
      pid: process.pid,
      verb_in_flight: __currentVerbContext,
    }, null, 2));
    __shutdownReasonWritten = true;
  } catch (_) {}
});

function applyDisciplineSigil(rawBody) {
  let parsed;
  try { parsed = JSON.parse(rawBody); } catch (_) { return rawBody; }
  if (!parsed || typeof parsed !== 'object') return rawBody;
  const SIGIL = /^@([A-Za-z0-9][A-Za-z0-9_-]{0,63})\s+/;
  for (const key of ['query', 'text']) {
    const v = parsed[key];
    if (typeof v !== 'string') continue;
    const m = v.match(SIGIL);
    if (!m) continue;
    if (!parsed.namespace) parsed.namespace = m[1];
    parsed[key] = v.slice(m[0].length);
    break;
  }
  return JSON.stringify(parsed);
}

function isInstructionTurnStart(sess) {
  const key = sess || '(no-session)';
  const now = Date.now();
  const t = _turns.get(key);
  if (!t) return true;
  if ((now - t.lastTs) > TURN_IDLE_MS) return true;
  return false;
}

function readUserPromptForRecall(cwd) {
  const root = cwd || process.cwd();
  try {
    const p = path.join(root, '.gm', 'last-prompt.txt');
    const txt = fs.readFileSync(p, 'utf8').trim();
    if (txt) return txt;
  } catch (_) {}
  try {
    const p = path.join(root, '.gm', 'turn-state.json');
    const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (obj && typeof obj.last_prompt === 'string' && obj.last_prompt.trim()) return obj.last_prompt.trim();
    if (obj && typeof obj.prompt === 'string' && obj.prompt.trim()) return obj.prompt.trim();
  } catch (_) {}
  return '';
}

function dispatchVerbToWasmInternal(instance, verb, body) {
  const dispatch = instance.exports.dispatch_verb;
  if (!dispatch) return null;
  const verbBytes = new TextEncoder().encode(verb);
  const bodyBytes = new TextEncoder().encode(body || '');
  const verbPtr = instance.exports.plugkit_alloc(verbBytes.length);
  const bodyPtr = instance.exports.plugkit_alloc(bodyBytes.length);
  if ((verbBytes.length > 0 && verbPtr === 0) || (bodyBytes.length > 0 && bodyPtr === 0)) {
    try { if (verbPtr !== 0) instance.exports.plugkit_free(verbPtr, verbBytes.length); } catch (_) {}
    try { if (bodyPtr !== 0) instance.exports.plugkit_free(bodyPtr, bodyBytes.length); } catch (_) {}
    throw new Error(`wasm-alloc-failed for dispatch_verb(${verb}): plugkit_alloc returned 0 (wasm OOM); refusing to write to a null offset and corrupt the heap`);
  }
  try {
    new Uint8Array(instance.exports.memory.buffer, verbPtr, verbBytes.length).set(verbBytes);
    new Uint8Array(instance.exports.memory.buffer, bodyPtr, bodyBytes.length).set(bodyBytes);
    const result = dispatch(verbPtr, verbBytes.length, bodyPtr, bodyBytes.length);
    const ptr = Number(result & 0xffffffffn);
    const len = Number(result >> 32n);
    const buffer = instance.exports.memory.buffer;
    guardWasmRange(buffer, ptr, len, `dispatch_verb(${verb})`);
    const out = new TextDecoder().decode(new Uint8Array(buffer, ptr, len));
    try { instance.exports.plugkit_free(ptr, len); } catch (_) {}
    return out;
  } finally {
    try { instance.exports.plugkit_free(verbPtr, verbBytes.length); } catch (_) {}
    try { instance.exports.plugkit_free(bodyPtr, bodyBytes.length); } catch (_) {}
  }
}

const AUTO_RECALL_STOPWORDS = new Set([
  'the','a','an','and','or','but','if','then','else','for','of','to','in','on','at','by','with','from','as','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','should','could','can','may','might','must','shall',
  'look','check','see','use','make','run','get','set','put','take','give','find','show','tell','let','keep','try','add','new','old','this','that','these','those','it','its','their','there','here','about','into','over','under','also','just','some','any','all','more','less','most','past','minutes','minute','hours','hour','seconds','second','days','day',
]);

function deriveFallbackQuery(prompt) {
  try {
    const tokens = String(prompt).toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
    const freq = new Map();
    for (const t of tokens) {
      if (t.length < 4) continue;
      if (AUTO_RECALL_STOPWORDS.has(t)) continue;
      freq.set(t, (freq.get(t) || 0) + 1);
    }
    const ranked = Array.from(freq.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const top = ranked.slice(0, 3).map(([w]) => w);
    return top.join(' ');
  } catch (_) { return ''; }
}

function dispatchAutoRecall(instance, queryPrompt) {
  try {
    const out = dispatchVerbToWasmInternal(instance, 'auto-recall', queryPrompt);
    if (!out) return null;
    let parsed;
    try { parsed = JSON.parse(out); } catch (_) { return null; }
    if (!parsed || parsed.ok !== true) return null;
    let inner = parsed.data;
    if (typeof parsed.stdout === 'string' && parsed.stdout.length > 0) {
      try { inner = JSON.parse(parsed.stdout); } catch (_) {}
    }
    if (!inner || typeof inner !== 'object') return null;
    const hits = Array.isArray(inner.results) ? inner.results : (Array.isArray(inner.hits) ? inner.hits : []);
    return { query: inner.query || '', hits };
  } catch (_) { return null; }
}

function promptFromInstructionBody(body) {
  try {
    const obj = JSON.parse(body);
    if (obj && typeof obj.prompt === 'string' && obj.prompt.trim()) return obj.prompt.trim();
  } catch (_) {}
  return '';
}

function tryAutoRecallForTurnEntry(instance, sess, cwd, bodyPrompt) {
  try {
    const prompt = (typeof bodyPrompt === 'string' && bodyPrompt.trim())
      ? bodyPrompt.trim()
      : readUserPromptForRecall(cwd);
    let emptyPromptFallback = false;
    let effectivePrompt = prompt;
    if (!prompt || !String(prompt).trim()) {
      emptyPromptFallback = true;
      const key = sess || '(no-session)';
      const t = _turns.get(key);
      const phase = (t && t.lastPhase) || 'PLAN';
      const phaseQueryMap = {
        PLAN: 'PLAN orient',
        EXECUTE: 'EXECUTE work',
        EMIT: 'EMIT closure',
        VERIFY: 'VERIFY trajectory',
        COMPLETE: 'COMPLETE residual',
      };
      effectivePrompt = phaseQueryMap[phase] || 'PLAN orient';
    }
    const primary = dispatchAutoRecall(instance, effectivePrompt);
    const fallbackQuery = deriveFallbackQuery(effectivePrompt);
    let fallback = null;
    if (fallbackQuery && fallbackQuery !== (primary && primary.query)) {
      fallback = dispatchAutoRecall(instance, fallbackQuery);
    }
    const seen = new Set();
    const merged = [];
    for (const src of [primary, fallback]) {
      if (!src || !Array.isArray(src.hits)) continue;
      for (const h of src.hits) {
        const id = h && (h.id || h.hash || h.key || JSON.stringify(h));
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        merged.push(h);
      }
    }
    const queries = [];
    if (primary && primary.query) queries.push(primary.query);
    if (fallback && fallback.query && !queries.includes(fallback.query)) queries.push(fallback.query);
    const payload = {
      query: (primary && primary.query) || effectivePrompt || '',
      queries,
      hits: merged.slice(0, 20),
      fired_at: new Date().toISOString(),
      turn_entry: true,
    };
    if (emptyPromptFallback) {
      payload.fallback_reason = 'empty-prompt';
      if (!payload.query) payload.query = effectivePrompt;
    }
    logEvent('plugkit', 'auto_recall.turn-entry', { sess, queries, count: merged.length });
    return payload;
  } catch (e) {
    logEvent('plugkit', 'auto_recall.error', { sess, error: String(e && e.message || e) });
    return null;
  }
}

function capHitText(hits, maxLen, maxCount) {
  if (!Array.isArray(hits)) return hits;
  return hits.slice(0, maxCount).map((h) => {
    if (!h || typeof h !== 'object' || typeof h.text !== 'string' || h.text.length <= maxLen) return h;
    return { ...h, text: h.text.slice(0, maxLen) + '...[+' + (h.text.length - maxLen) + 'ch]' };
  });
}

function capInstructionPacks(parsed) {
  const target = (parsed.data && typeof parsed.data === 'object') ? parsed.data : parsed;
  if (Array.isArray(target.recall_hits)) target.recall_hits = capHitText(target.recall_hits, 360, 8);
  if (target.auto_recall && Array.isArray(target.auto_recall.hits)) {
    target.auto_recall.hits = capHitText(target.auto_recall.hits, 360, 8);
  }
}

function injectUpdateWarning(parsed) {
  if (!parsed || typeof parsed !== 'object') return;
  let upd;
  try {
    upd = JSON.parse(fs.readFileSync(path.join(spoolDir, '.update-available.json'), 'utf-8'));
  } catch (_) { return; }
  if (!upd || !upd.installed || !upd.latest || upd.installed === upd.latest) return;
  const target = (parsed.data && typeof parsed.data === 'object') ? parsed.data : parsed;
  target.update_available = { installed: upd.installed, latest: upd.latest, update_url: upd.update_url || null };
  target.update_warning = `STALE RUNTIME: running plugkit ${upd.installed} but ${upd.latest} is published and not yet running. Restart onto the new version now: bun x gm-plugkit@latest --kill-stale-watchers; bun x gm-plugkit@latest spool. This warning repeats every turn until the running version catches up.`;
}

function mergeAutoRecallIntoInstructionResponse(resultStr, autoRecall) {
  if (!autoRecall) return resultStr;
  let parsed;
  try { parsed = JSON.parse(resultStr); } catch (_) { return resultStr; }
  if (!parsed || typeof parsed !== 'object') return resultStr;
  if (parsed.data && typeof parsed.data === 'object') {
    parsed.data.auto_recall = autoRecall;
  } else {
    parsed.auto_recall = autoRecall;
  }
  capInstructionPacks(parsed);
  if (typeof parsed.stdout === 'string' && parsed.stdout.length > 0) {
    try {
      const inner = JSON.parse(parsed.stdout);
      if (inner && typeof inner === 'object') {
        inner.auto_recall = autoRecall;
        parsed.stdout = JSON.stringify(inner);
      }
    } catch (_) {}
  }
  return JSON.stringify(parsed);
}

function endTurn(sess, t, idleSpanned) {
  logEvent('plugkit', 'turn.end', {
    sess, turn_idx: t.idx, dur_ms: t.lastTs - t.startTs,
    dispatches: t.dispatches, verbs: Object.fromEntries(t.verbs),
    phases_walked: [...t.phases], deviations: t.deviations,
    ended_in_phase: t.lastPhase || null,
    idle_spanned: !!idleSpanned,
  });
}

function turnTick(sess, verb, taskBase, phase, prdPending) {
  const key = sess || '(no-session)';
  const now = Date.now();
  let t = _turns.get(key);
  if (t && (now - t.lastTs) > TURN_IDLE_MS) {
    endTurn(sess, t, true);
    _turns.delete(key);
    t = null;
  }
  if (!t) {
    if (verb !== 'instruction') return;
    const idx = ((_turns.get(key + ':lastIdx') || 0) + 1);
    _turns.set(key + ':lastIdx', idx);
    t = { idx, startTs: now, lastTs: now, dispatches: 0, verbs: new Map(), phases: new Set(), deviations: 0, lastPhase: phase, prdPending: null, stallEmitted: false };
    _turns.set(key, t);
    logEvent('plugkit', 'turn.start', { sess, turn_idx: idx, phase: phase || null });
  }
  t.lastTs = now;
  t.dispatches++;
  t.stallEmitted = false;
  t.verbs.set(verb, (t.verbs.get(verb) || 0) + 1);
  if (phase) { t.phases.add(phase); t.lastPhase = phase; }
  if (typeof prdPending === 'number') t.prdPending = prdPending;
}

const STALL_MS = 300_000;
function scanStalledTurns() {
  const now = Date.now();
  if (_lastBusyUntil && _lastBusyUntil > now) return;
  for (const [key, t] of _turns) {
    if (!t || typeof t !== 'object' || !Number.isFinite(t.startTs)) continue;
    if (t.stallEmitted) continue;
    if ((now - t.lastTs) < STALL_MS) continue;
    const terminal = t.lastPhase === 'COMPLETE' && (t.prdPending === 0 || t.prdPending == null);
    if (terminal) continue;
    t.stallEmitted = true;
    const fields = {
      turn_idx: t.idx,
      ended_in_phase: t.lastPhase || null,
      prd_pending: t.prdPending,
      idle_ms: now - t.lastTs,
      dispatches: t.dispatches,
    };
    if (key && key !== '(no-session)') fields.sess = key;
    logEvent('hook', 'deviation.mid-chain-stall', fields);
  }
}

function touchActiveTurn(sess) {
  const t = _turns.get(sess || '(no-session)');
  if (!t) return;
  t.lastTs = Date.now();
  t.stallEmitted = false;
}

let __sessCache = { value: '', mtimeMs: 0, readAt: 0, srcMtimeMs: 0 };
function readCurrentSess() {
  const now = Date.now();
  if (now - __sessCache.readAt < 1000) return __sessCache.value;
  let found = '';
  try {
    const p = path.join(process.cwd(), '.gm', 'exec-spool', '.session-current');
    const st = fs.statSync(p);
    if (st.mtimeMs !== __sessCache.mtimeMs) {
      __sessCache.value = fs.readFileSync(p, 'utf8').trim();
      __sessCache.mtimeMs = st.mtimeMs;
    }
    found = __sessCache.value;
  } catch (_) {}
  if (!found) {
    try {
      const sp = path.join(process.cwd(), '.gm', 'turn-state.json');
      const st = fs.statSync(sp);
      if (st.mtimeMs !== __sessCache.srcMtimeMs) {
        const obj = JSON.parse(fs.readFileSync(sp, 'utf8'));
        if (obj && typeof obj.session_id === 'string') found = obj.session_id;
        __sessCache.srcMtimeMs = st.mtimeMs;
      } else if (__sessCache.value) {
        found = __sessCache.value;
      }
    } catch (_) {}
  }
  __sessCache.readAt = now;
  let resolved = found || process.env.CLAUDE_SESSION_ID || process.env.GM_SESSION_ID || '';
  if (!resolved) {
    if (!__sessCache.syntheticSess) {
      const cwdHash = crypto.createHash('sha1').update(process.cwd()).digest('hex').slice(0, 8);
      __sessCache.syntheticSess = `cwd-${cwdHash}-pid${process.pid}`;
    }
    resolved = __sessCache.syntheticSess;
  }
  __sessCache.value = resolved;
  return __sessCache.value;
}

const __lockRejectedEmitAt = new Map();


function logEvent(sub, event, fields) {
  if (process.env.GM_LOG_DISABLE) return;
  try {
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.join(GM_LOG_ROOT, day);
    fs.mkdirSync(dir, { recursive: true });
    const safeFields = { ...(fields || {}) };
    if (Object.prototype.hasOwnProperty.call(safeFields, 'pid')) {
      safeFields.child_pid = safeFields.pid;
      delete safeFields.pid;
    }
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      sub,
      event,
      pid: process.pid,
      cwd: process.cwd(),
      sess: readCurrentSess(),
      ...safeFields,
    });
    fs.appendFileSync(path.join(dir, `${sub}.jsonl`), line + '\n');
  } catch (_) {}
}

function emitOrchestratorEvents(verb, taskBase, resultStr) {
  let parsed;
  try { parsed = JSON.parse(resultStr); } catch (_) { parsed = null; }
  if (!ORCHESTRATOR_VERBS.has(verb)) {
    if (parsed && parsed.ok === true) { try { touchActiveTurn(readCurrentSess()); } catch (_) {} }
    return;
  }
  if (!parsed) return;
  if (parsed.ok !== true) {
    let errData = null;
    if (parsed && typeof parsed.stdout === 'string' && parsed.stdout.length > 0) {
      try { errData = JSON.parse(parsed.stdout); } catch (_) {}
    }
    if (verb === 'prd-resolve' && errData && errData.deviation_kind === 'prd-resolve-unknown-id') {
      logEvent('hook', 'deviation.prd-resolve-unknown-id', { task: taskBase, prd_id: errData.prd_id, reason: errData.error });
    }
    const reason = (parsed && (parsed.reason || parsed.error)) ||
                   (parsed && parsed.data && (parsed.data.reason || parsed.data.error)) ||
                   (errData && (errData.reason || errData.error)) ||
                   (parsed && parsed.stderr) ||
                   'unknown';
    logEvent('plugkit', 'orchestrator.error', {
      verb,
      task: taskBase,
      error: String(reason).slice(0, 500),
      gate_denied: !!(parsed && parsed.gate_denied),
      next_dispatch: parsed && parsed.next_dispatch || null,
    });
    return;
  }
  const data = parsed.data || {};
  const sess = readCurrentSess();
  turnTick(sess, verb, taskBase, data.phase, typeof data.prd_pending_count === 'number' ? data.prd_pending_count : undefined);
  switch (verb) {
    case 'transition':
      logEvent('plugkit', 'phase.transitioned', { task: taskBase, phase: data.phase, next_skill: data.nextSkill, recall_count: Array.isArray(data.recall_hits) ? data.recall_hits.length : 0 });
      break;
    case 'instruction':
      logEvent('plugkit', 'instruction.served', { task: taskBase, phase: data.phase, prd_pending: data.prd_pending_count, mutables_pending: Array.isArray(data.mutables_pending) ? data.mutables_pending.length : 0, next_phase_hint: data.next_phase_hint });
      break;
    case 'phase-status':
      logEvent('plugkit', 'phase.status', { task: taskBase, phase: data.phase, last_skill: data.last_skill });
      break;
    case 'prd-add':
      logEvent('plugkit', 'prd.added', { task: taskBase, id: data.added });
      break;
    case 'prd-resolve':
      if (data && data.deviation_kind === 'prd-resolve-unknown-id') {
        logEvent('hook', 'deviation.prd-resolve-unknown-id', { task: taskBase, prd_id: data.prd_id, reason: data.error });
      } else {
        logEvent('plugkit', 'prd.resolved', { task: taskBase, id: data.resolved });
      }
      break;
    case 'mutable-add':
      logEvent('plugkit', 'mutable.added', { task: taskBase, id: data.added });
      break;
    case 'mutable-resolve':
      logEvent('plugkit', 'mutable.resolved', { task: taskBase, id: data.resolved, memorize_spool: data.memorize_spool });
      break;
    case 'memorize-fire':
      logEvent('plugkit', 'memorize.fired', { task: taskBase, key: data.key, namespace: data.namespace, bytes: data.bytes });
      break;
    case 'residual-scan':
      if (data.scan === 'fired') logEvent('plugkit', 'residual.fired', { task: taskBase, marker: data.marker });
      else {
        logEvent('plugkit', 'residual.skipped', { task: taskBase, reason: data.reason });
        if (data.deviation_kind === 'residual-premature') {
          logEvent('hook', 'deviation.residual-premature', { task: taskBase, reason: data.reason });
        }
      }
      break;
    case 'auto-recall':
      logEvent('plugkit', 'auto_recall.hits', { task: taskBase, count: Array.isArray(data.hits) ? data.hits.length : 0 });
      break;
    default:
      break;
  }
}

const TMP_DIR = os.tmpdir();
const LEGACY_BROWSER_PORTS_FILE = path.join(TMP_DIR, 'plugkit-browser-ports.json');
const LEGACY_BROWSER_SESSIONS_FILE = path.join(TMP_DIR, 'plugkit-browser-sessions.json');

function browserStateDir(cwd) {
  const dir = path.join(cwd || process.cwd(), '.gm', 'exec-spool');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return dir;
}
function browserPortsFile(cwd) { return path.join(browserStateDir(cwd), 'browser-ports.json'); }
function browserSessionsFile(cwd) { return path.join(browserStateDir(cwd), 'browser-sessions.json'); }

function selectIdleBrowserSessions(ports, now, limitMs) {
  const idle = [];
  if (!ports || typeof ports !== 'object') return idle;
  for (const [sid, entry] of Object.entries(ports)) {
    if (!entry || typeof entry !== 'object') continue;
    const lastUse = Number.isFinite(entry.lastUse) ? entry.lastUse : 0;
    const idleMs = now - lastUse;
    if (idleMs >= limitMs) idle.push({ sid, entry, idleMs });
  }
  return idle;
}

function stampBrowserLastUse(cwd, claudeSessionId) {
  try {
    const portsFile = browserPortsFile(cwd);
    const ports = readJsonFile(portsFile, {});
    const entry = ports[claudeSessionId];
    if (entry && typeof entry === 'object') {
      entry.lastUse = Date.now();
      ports[claudeSessionId] = entry;
      writeJsonFile(portsFile, ports);
    }
  } catch (_) {}
}

function atomicWriteJson(filePath, obj) {
  const tmp = filePath + '.tmp.' + process.pid + '.' + Date.now() + '.' + Math.random().toString(36).slice(2, 8);
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, filePath);
}

function migrateLegacyBrowserState(cwd) {
  const dst1 = browserPortsFile(cwd);
  const dst2 = browserSessionsFile(cwd);
  try {
    if (!fs.existsSync(dst1) && fs.existsSync(LEGACY_BROWSER_PORTS_FILE)) {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_BROWSER_PORTS_FILE, 'utf-8'));
      if (legacy && typeof legacy === 'object') atomicWriteJson(dst1, legacy);
    }
  } catch (_) {}
  try {
    if (!fs.existsSync(dst2) && fs.existsSync(LEGACY_BROWSER_SESSIONS_FILE)) {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_BROWSER_SESSIONS_FILE, 'utf-8'));
      if (legacy && typeof legacy === 'object') atomicWriteJson(dst2, legacy);
    }
  } catch (_) {}
}

function readJsonFile(fp, fallback) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch (_) { return fallback; }
}
function writeJsonFile(fp, value) {
  try { atomicWriteJson(fp, value); } catch (_) {}
}

const BROWSER_RUNNER_BIN = process.env.GM_BROWSER_RUNNER_BIN || 'playwriter';

function findBrowserRunner() {
  const npmR = spawnSync('npm', ['root', '-g'], { encoding: 'utf-8', shell: true });
  if (npmR.status === 0 && npmR.stdout.trim()) {
    const root = npmR.stdout.trim().split(/\r?\n/).pop();
    const binJs = path.join(root, BROWSER_RUNNER_BIN, 'bin.js');
    if (fs.existsSync(binJs)) return { cmd: process.execPath, baseArgs: [binJs], shell: false };
  }
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(whichCmd, [BROWSER_RUNNER_BIN], { encoding: 'utf-8', shell: true });
  if (r.status === 0 && r.stdout.trim()) {
    const candidates = r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const cmd = candidates.find(c => c.toLowerCase().endsWith('.cmd')) || candidates.find(c => !c.toLowerCase().endsWith('.ps1')) || candidates[0];
    if (cmd) return { cmd, baseArgs: [], shell: process.platform === 'win32' };
  }
  const bunR = spawnSync(whichCmd, ['bun'], { encoding: 'utf-8', shell: true });
  if (bunR.status === 0 && bunR.stdout.trim()) {
    return { cmd: 'bun', baseArgs: ['x', `${BROWSER_RUNNER_BIN}@latest`], shell: true };
  }
  const npxR = spawnSync(whichCmd, ['npx'], { encoding: 'utf-8', shell: true });
  if (npxR.status === 0 && npxR.stdout.trim()) {
    return { cmd: 'npx', baseArgs: ['-y', BROWSER_RUNNER_BIN], shell: true };
  }
  return null;
}

function ensureGitignored(cwd, entry) {
  try {
    const gi = path.join(cwd, '.gitignore');
    let content = '';
    if (fs.existsSync(gi)) content = fs.readFileSync(gi, 'utf-8');
    const lines = content.split(/\r?\n/);
    if (lines.some(l => l.trim() === entry)) return;
    const updated = (content && !content.endsWith('\n') ? content + '\n' : content) + entry + '\n';
    fs.writeFileSync(gi, updated);
  } catch (_) {}
}

function isProcessAliveSync(pid) {
  if (!pid || typeof pid !== 'number' || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e && e.code === 'EPERM';
  }
}

function readSingletonLockPid(profileDir) {
  const lock = path.join(profileDir, 'SingletonLock');
  try {
    let target;
    try {
      target = fs.readlinkSync(lock);
    } catch (_) {
      try { target = fs.readFileSync(lock, 'utf-8'); } catch (__) { return null; }
    }
    if (!target) return null;
    const m = String(target).match(/-(\d+)\s*$/);
    if (m) return parseInt(m[1], 10);
    const m2 = String(target).match(/(\d+)/);
    if (m2) return parseInt(m2[1], 10);
  } catch (_) {}
  return null;
}

function isProfileLocked(profileDir) {
  const lock = path.join(profileDir, 'SingletonLock');
  if (!fs.existsSync(lock)) return false;
  const holderPid = readSingletonLockPid(profileDir);
  if (holderPid != null && !isProcessAliveSync(holderPid)) {
    try { fs.unlinkSync(lock); } catch (_) {}
    try { fs.unlinkSync(path.join(profileDir, 'SingletonCookie')); } catch (_) {}
    try { fs.unlinkSync(path.join(profileDir, 'SingletonSocket')); } catch (_) {}
    try { fs.unlinkSync(path.join(profileDir, 'lockfile')); } catch (_) {}
    logEvent('bootstrap', 'browser-profile.lock-cleared', {
      profileDir, dead_pid: holderPid,
    });
    return false;
  }
  return true;
}

function sessionProfileSlug(claudeSessionId) {
  const s = String(claudeSessionId || 'default').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64);
  return s || 'default';
}

function sessionProfileDir(cwd, claudeSessionId) {
  return path.join(cwd, '.gm', `browser-profile-${sessionProfileSlug(claudeSessionId)}`);
}

function acquireProfileDir(cwd, claudeSessionId) {
  const gmDir = path.join(cwd, '.gm');
  try { fs.mkdirSync(gmDir, { recursive: true }); } catch (_) {}
  ensureGitignored(cwd, '.gm/browser-profile/');
  ensureGitignored(cwd, '.gm/browser-profile-*/');
  const primary = sessionProfileDir(cwd, claudeSessionId);
  try { fs.mkdirSync(primary, { recursive: true }); } catch (_) {}
  if (!isProfileLocked(primary)) return primary;
  const fallback = path.join(gmDir, `browser-profile-${sessionProfileSlug(claudeSessionId)}-${process.pid}`);
  try { fs.mkdirSync(fallback, { recursive: true }); } catch (_) {}
  return fallback;
}

function cleanDeadProfileFragments(cwd) {
  try {
    const gmDir = path.join(cwd, '.gm');
    if (!fs.existsSync(gmDir)) return { cleaned: 0 };
    let cleaned = 0;
    for (const name of fs.readdirSync(gmDir)) {
      if (!/^browser-profile($|-)/.test(name)) continue;
      const dir = path.join(gmDir, name);
      const pidM = name.match(/-(\d+)$/);
      if (pidM) {
        if (!isProcessAliveSync(parseInt(pidM[1], 10))) {
          try { fs.rmSync(dir, { recursive: true, force: true }); cleaned++; } catch (_) {}
        }
        continue;
      }
      try {
        if (fs.existsSync(dir) && !isProfileLocked(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
          cleaned++;
        }
      } catch (_) {}
    }
    if (cleaned > 0) {
      logEvent('bootstrap', 'browser-profile.hygiene', { cwd, cleaned });
    }
    return { cleaned };
  } catch (_) {
    return { cleaned: 0 };
  }
}

function parsePlaywriterSessionList(stdout) {
  const rows = [];
  if (!stdout) return rows;
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)\s+\S+\s+\S+\s+\S+\s+(\S+)/);
    if (!m) continue;
    const id = m[1];
    let cwd = m[2];
    if (cwd === '-') cwd = '';
    rows.push({ id, cwd });
  }
  return rows;
}

function reapOrphanBrowserSessions(pw, cwd, claudeSessionId, reason) {
  try {
    const ports = readJsonFile(browserPortsFile(cwd), {});
    const activeIds = new Set();
    for (const ent of Object.values(ports)) {
      if (ent && ent.pwSessionId) activeIds.add(String(ent.pwSessionId));
    }
    const r = runBrowserRunner(pw, ['session', 'list'], 15000, cwd, claudeSessionId);
    if (!r || r.status !== 0) return { reaped: 0 };
    const rows = parsePlaywriterSessionList(r.stdout || '');
    const norm = (p) => String(p || '').replace(/[\\/]+$/, '').toLowerCase();
    const wantCwd = norm(cwd);
    let reaped = 0;
    for (const { id, cwd: rowCwd } of rows) {
      if (rowCwd && norm(rowCwd) !== wantCwd) continue;
      if (activeIds.has(String(id))) continue;
      const d = runBrowserRunner(pw, ['session', 'delete', id], 15000, cwd, claudeSessionId);
      if (d && d.status === 0) {
        reaped++;
        try { logEvent('plugkit', 'browser.orphan-session-reaped', { session_id: id, reason: reason || 'boot', cwd }); } catch (_) {}
      }
    }
    return { reaped };
  } catch (_) {
    return { reaped: 0 };
  }
}

function resolveWindowsExeLocal(cmd) {
  if (process.platform !== 'win32') return cmd;
  try {
    const out = spawnSync('where', [cmd], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      timeout: 800,
    });
    if (out.status !== 0) return cmd;
    const lines = (out.stdout || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const exe = lines.find(l => /\.exe$/i.test(l));
    const shim = lines.find(l => /\.(cmd|bat)$/i.test(l));
    return exe || shim || cmd;
  } catch {
    return cmd;
  }
}

function isPortReachableSync(host, port, timeoutMs) {
  const r = spawnSync(process.execPath, ['-e', `
    const net = require('net');
    const s = net.connect({ port: ${port}, host: ${JSON.stringify(host)} });
    let done = false;
    s.on('connect', () => { done = true; s.destroy(); process.exit(0); });
    s.on('error', () => { if (!done) process.exit(1); });
    setTimeout(() => { if (!done) { s.destroy(); process.exit(1); } }, ${timeoutMs || 800});
  `], { timeout: (timeoutMs || 800) + 2000, windowsHide: true });
  return r.status === 0;
}

function findFreePortSync() {
  const r = spawnSync(process.execPath, ['-e', `
    const net = require('net');
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => { process.stdout.write(String(p)); }); });
    srv.on('error', e => { process.stderr.write(e.message); process.exit(1); });
  `], { encoding: 'utf-8', timeout: 5000 });
  if (r.status !== 0) throw new Error('could not allocate free port');
  return parseInt(r.stdout.trim(), 10);
}

function isPortAliveSync(port) {
  const r = spawnSync(process.execPath, ['-e', `
    const net = require('net');
    const s = net.connect({ port: ${port}, host: '127.0.0.1' });
    s.on('connect', () => { s.destroy(); process.exit(0); });
    s.on('error', () => process.exit(1));
    setTimeout(() => process.exit(1), 800);
  `], { timeout: 2000 });
  return r.status === 0;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ms | 0));
}

function playwriterHomeFor(cwd, claudeSessionId) {
  if (process.env.PLAYWRITER_HOME) return process.env.PLAYWRITER_HOME;
  if (!cwd) return path.join(GM_TOOLS_ROOT, `pw-sock-${sessionProfileSlug(claudeSessionId)}`);
  try { ensureGitignored(cwd, '.gm/pw-sock-*/'); } catch (_) {}
  return path.join(cwd, '.gm', `pw-sock-${sessionProfileSlug(claudeSessionId)}`);
}

function runBrowserRunner(pw, args, timeoutMs, cwd, claudeSessionId) {
  const allArgs = [...pw.baseArgs, ...args];
  const useShell = !!pw.shell;
  const spawnCmd = useShell && /\s/.test(pw.cmd) ? `"${pw.cmd}"` : pw.cmd;
  const spawnArgs = useShell ? allArgs.map(a => /[\s"]/.test(String(a)) ? `"${String(a).replace(/"/g, '\\"')}"` : a) : allArgs;
  const env = { ...process.env };
  const sockDir = playwriterHomeFor(cwd, claudeSessionId);
  try { fs.mkdirSync(sockDir, { recursive: true }); } catch (_) {}
  env.PLAYWRITER_HOME = sockDir;
  _writeStatusBusy((timeoutMs || 30000) + 5000);
  return spawnSync(spawnCmd, spawnArgs, {
    encoding: 'utf-8',
    timeout: timeoutMs,
    shell: useShell,
    windowsHide: true,
    env,
  });
}

function scrubBrowserRunnerText(s) {
  if (!s || typeof s !== 'string') return s;
  let t = s;
  t = t.replace(/(^|[^A-Za-z0-9_\\/.-])(playwriter|playwright|puppeteer)(?![A-Za-z0-9_\\/.-])/gi, (m, pre) => `${pre}managed browser session`);
  t = t.replace(/Click the[^.\n]*?extension[^.\n]*?icon[^.\n]*?\.?/gi, '');
  t = t.replace(/(connected\s+)?browser\s+extension(\s+is)?\s+not\s+connected\b[^.\n]*\.?/gi, '');
  t = t.replace(/no\s+connected\s+browsers?\b[^.\n]*\.?/gi, '');
  t = t.replace(/Install via:[^\n]*managed browser session[^\n]*/gi, '');
  return t;
}

function findSystemChromiumBinary() {
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Chromium', 'Application', 'chrome.exe'),
      ]
    : process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ]
      : [
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/opt/google/chrome/chrome',
          '/snap/bin/chromium',
        ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch (_) {}
  }
  return null;
}

function findInstalledChromiumBinary() {
  try {
    const explicit = process.env.GM_BROWSER_RUNNER_PATH || process.env.PLAYWRITER_BROWSER_PATH;
    if (explicit && fs.existsSync(explicit)) {
      return explicit;
    }
    const roots = [];
    const cacheDir = process.env.GM_BROWSER_RUNNER_CACHE_DIR || 'ms-playwright';
    if (process.platform === 'win32') {
      const lad = process.env.LOCALAPPDATA;
      if (lad) roots.push(path.join(lad, cacheDir));
    } else {
      const home = process.env.HOME || '';
      if (home) {
        roots.push(path.join(home, '.cache', cacheDir));
        roots.push(path.join(home, 'Library', 'Caches', cacheDir));
      }
    }
    const exeName = process.platform === 'win32' ? 'chrome.exe' : (process.platform === 'darwin' ? 'Chromium.app/Contents/MacOS/Chromium' : 'chrome');
    const subdirs = process.platform === 'win32'
      ? ['chrome-win64', 'chrome-win']
      : process.platform === 'darwin' ? ['chrome-mac'] : ['chrome-linux'];
    const found = [];
    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      for (const name of fs.readdirSync(root)) {
        if (!/^chromium-\d+$/.test(name)) continue;
        for (const sub of subdirs) {
          const candidate = path.join(root, name, sub, exeName);
          if (fs.existsSync(candidate)) {
            const ver = parseInt(name.split('-')[1], 10) || 0;
            found.push({ ver, candidate });
          }
        }
      }
    }
    if (found.length === 0) return findSystemChromiumBinary();
    found.sort((a, b) => b.ver - a.ver);
    return found[0].candidate;
  } catch (_) {
    return findSystemChromiumBinary();
  }
}

function fetchJsonSync(url, timeoutMs) {
  const r = spawnSync(process.execPath, ['-e', `
    const http = require('http');
    const req = http.get(${JSON.stringify(url)}, (res) => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        if (res.statusCode !== 200) { process.stderr.write('status ' + res.statusCode); process.exit(2); }
        process.stdout.write(buf);
      });
    });
    req.on('error', e => { process.stderr.write(e.message); process.exit(1); });
    req.setTimeout(${timeoutMs || 1500}, () => { req.destroy(new Error('timeout')); });
  `], { encoding: 'utf-8', timeout: (timeoutMs || 1500) + 1500, windowsHide: true });
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout); } catch (_) { return null; }
}

function startManagedBrowser(pw, profileDir) {
  const headless = process.env.GM_BROWSER_HEADLESS === '1';
  let browserBin = findInstalledChromiumBinary();
  if (!browserBin) {
    logEvent('plugkit', 'browser.chromium-installing', {});
    spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'playwright', 'install', 'chromium'], {
      encoding: 'utf-8',
      timeout: 300000,
      windowsHide: true,
      shell: process.platform === 'win32',
      stdio: 'ignore',
    });
    browserBin = findInstalledChromiumBinary();
  }
  if (!browserBin) {
    const err = new Error('chromium binary not found after install attempt');
    logEvent('plugkit', 'browser.launch-failed', { reason: 'chromium-missing' });
    throw err;
  }
  const port = findFreePortSync();
  const args = [
    '--user-data-dir=' + profileDir,
    '--remote-debugging-port=' + port,
    '--remote-debugging-address=127.0.0.1',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-default-apps',
    '--disable-gpu-process-crash-limit',
  ];
  if (headless) {
    args.push('--headless=new');
  } else {
    args.push('about:blank');
  }
  const chromeLogPath = path.join(profileDir, '.chrome-launch.log');
  let logFd;
  try { logFd = fs.openSync(chromeLogPath, 'a'); } catch (_) { logFd = null; }
  const child = spawn(browserBin, args, {
    detached: true,
    stdio: ['ignore', logFd != null ? logFd : 'ignore', logFd != null ? logFd : 'ignore'],
    windowsHide: false,
    env: process.env,
  });
  try { if (typeof logFd === 'number') fs.closeSync(logFd); } catch (_) {}
  const pid = child.pid;
  child.unref();
  logEvent('plugkit', 'browser.chromium-launched', { pid, port, profileDir, headless, binary: browserBin, chromeLogPath });
  const start = Date.now();
  const deadline = start + 30000;
  let wsEndpoint = null;
  let lastErr = null;
  while (Date.now() < deadline) {
    const info = fetchJsonSync(`http://127.0.0.1:${port}/json/version`, 1500);
    if (info && info.webSocketDebuggerUrl) {
      wsEndpoint = info.webSocketDebuggerUrl;
      break;
    }
    sleepSync(500);
  }
  if (!wsEndpoint) {
    logEvent('plugkit', 'browser.launch-failed', { reason: 'cdp-not-ready', pid, port, elapsed_ms: Date.now() - start });
    throw new Error(`chromium launched (pid=${pid}) but CDP at 127.0.0.1:${port} did not become ready within 30s${lastErr ? ' :: ' + lastErr : ''}`);
  }
  logEvent('plugkit', 'browser.cdp-ready', { pid, port, ms: Date.now() - start, wsEndpoint });
  return { pid, port, wsEndpoint };
}

function killPidQuiet(pid) {
  if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) return false;
  try { process.kill(pid, 'SIGTERM'); } catch (_) {}
  if (process.platform === 'win32') {
    try { spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore', timeout: 3000 }); } catch (_) {}
  }
  return true;
}

function purgeProfileLockFiles(profileDir) {
  if (!profileDir) return;
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try { fs.unlinkSync(path.join(profileDir, name)); } catch (_) {}
  }
}

function sleepSyncMs(ms) {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms | 0);
}

function gracefulCloseBrowser(entry, reason) {
  if (!entry) return;
  const { pid, port, profileDir } = entry;
  if (Number.isFinite(port) && port > 0) {
    try {
      const info = fetchJsonSync(`http://127.0.0.1:${port}/json/version`, 600);
      if (info && info.webSocketDebuggerUrl) {
        spawnSync(process.execPath, ['-e', `
          const http = require('http');
          const req = http.request({host:'127.0.0.1',port:${port},path:'/json/close/browser',method:'GET',timeout:1500},
            res => { res.resume(); res.on('end', () => process.exit(0)); });
          req.on('error', () => process.exit(1));
          req.on('timeout', () => { req.destroy(); process.exit(1); });
          req.end();
        `], { timeout: 3000, windowsHide: true });
      }
    } catch (_) {}
  }
  if (Number.isFinite(pid) && pid > 0) {
    const deadline = Date.now() + 1500;
    try { process.kill(pid, 'SIGTERM'); } catch (_) {}
    while (Date.now() < deadline && isProcessAliveSync(pid)) sleepSyncMs(Math.min(150, deadline - Date.now()));
    if (isProcessAliveSync(pid)) killPidQuiet(pid);
  }
  purgeProfileLockFiles(profileDir);
  try { logEvent('plugkit', 'browser.closed', { reason: reason || 'closed', pid, port, profileDir }); } catch (_) {}
}

function getOrCreateBrowserSession(cwd, claudeSessionId, pw) {
  migrateLegacyBrowserState(cwd);
  const portsFile = browserPortsFile(cwd);
  const sessionsFile = browserSessionsFile(cwd);
  const ports = readJsonFile(portsFile, {});
  const sessions = readJsonFile(sessionsFile, {});
  const existing = ports[claudeSessionId];
  if (existing && existing.pid && existing.wsEndpoint) {
    const wantProfile = sessionProfileDir(cwd, claudeSessionId);
    const pidOk = isProcessAliveSync(existing.pid);
    const profileOk = !existing.profileDir || existing.profileDir === wantProfile || existing.profileDir.startsWith(wantProfile);
    const cdpOk = pidOk && !!fetchJsonSync(`http://127.0.0.1:${existing.port}/json/version`, 1000);
    if (pidOk && profileOk && cdpOk) {
      const pwIds = sessions[claudeSessionId] || [];
      if (pwIds.length > 0 && existing.pwSessionId) return existing.pwSessionId;
      const r = runBrowserRunner(pw, ['session', 'new', '--direct', existing.wsEndpoint], 30000, cwd, claudeSessionId);
      if (r && r.status === 0) {
        const sid = parseSessionId(r.stdout || '');
        if (sid) {
          existing.pwSessionId = sid;
          existing.lastUse = Date.now();
          ports[claudeSessionId] = existing;
          sessions[claudeSessionId] = [sid];
          writeJsonFile(portsFile, ports);
          writeJsonFile(sessionsFile, sessions);
          logEvent('plugkit', 'browser.attached', { pwSessionId: sid, reused: true });
          return sid;
        }
      }
    } else {
      const reason = !pidOk ? 'pid-dead' : (!cdpOk ? 'cdp-dead' : 'profile-drift');
      if (reason === 'pid-dead') {
        logEvent('plugkit', 'browser.stale-reclaimed', {
          sid: claudeSessionId,
          stale_pid: existing.pid || null,
          stale_profile: existing.profileDir || null,
          want_profile: wantProfile,
        });
      } else {
        logEvent('hook', 'deviation.browser-profile-collision', {
          sid: claudeSessionId,
          stale_pid: existing.pid || null,
          stale_profile: existing.profileDir || null,
          want_profile: wantProfile,
          reason,
        });
      }
      if (typeof gracefulCloseBrowser === 'function') {
        try { gracefulCloseBrowser(existing, `collision:${reason}`); } catch (_) {}
      } else if (pidOk && Number.isFinite(existing.pid)) {
        try { killPidQuiet(existing.pid); } catch (_) {}
      }
      purgeProfileLockFiles(existing.profileDir);
      delete ports[claudeSessionId];
      delete sessions[claudeSessionId];
      try { writeJsonFile(portsFile, ports); } catch (_) {}
      try { writeJsonFile(sessionsFile, sessions); } catch (_) {}
    }
  }
  cleanDeadProfileFragments(cwd);
  reapOrphanBrowserSessions(pw, cwd, claudeSessionId, 'pre-spawn');
  const profileDir = acquireProfileDir(cwd, claudeSessionId);
  const aliveCdpForProfile = (() => {
    for (const key of Object.keys(ports)) {
      const ent = ports[key];
      if (!ent || !ent.pid || !ent.port || !ent.wsEndpoint) continue;
      if (ent.profileDir !== profileDir && !(ent.profileDir || '').startsWith(profileDir)) continue;
      if (!isProcessAliveSync(ent.pid)) continue;
      const info = fetchJsonSync(`http://127.0.0.1:${ent.port}/json/version`, 1000);
      if (info && info.webSocketDebuggerUrl) {
        return { pid: ent.pid, port: ent.port, wsEndpoint: ent.wsEndpoint };
      }
    }
    return null;
  })();
  let browserPid, port, wsEndpoint;
  if (aliveCdpForProfile) {
    ({ pid: browserPid, port, wsEndpoint } = aliveCdpForProfile);
    logEvent('plugkit', 'browser.reused-existing-chromium', { pid: browserPid, port, profileDir });
  } else {
    logEvent('plugkit', 'browser.start', { profileDir });
    ({ pid: browserPid, port, wsEndpoint } = startManagedBrowser(pw, profileDir));
  }
  const r = runBrowserRunner(pw, ['session', 'new', '--direct', wsEndpoint], 30000, cwd, claudeSessionId);
  if (!r || r.status !== 0) {
    const errTxt = scrubBrowserRunnerText((r && (r.stderr || r.stdout)) || 'unknown');
    logEvent('plugkit', 'browser.launch-failed', { reason: 'session-attach-failed', pid: browserPid, port, error: errTxt });
    throw new Error(`playwriter session new --direct failed: ${errTxt}`);
  }
  const pwSessionId = parseSessionId(r.stdout || '');
  if (!pwSessionId) {
    logEvent('plugkit', 'browser.launch-failed', { reason: 'session-id-unparseable', stdout: r.stdout });
    throw new Error(`could not parse managed browser session id from: ${scrubBrowserRunnerText(r.stdout || '')}`);
  }
  ports[claudeSessionId] = { profileDir, pid: browserPid, port, wsEndpoint, pwSessionId, lastUse: Date.now() };
  sessions[claudeSessionId] = [pwSessionId];
  writeJsonFile(portsFile, ports);
  writeJsonFile(sessionsFile, sessions);
  logEvent('plugkit', 'browser.attached', { pwSessionId, pid: browserPid, port });
  return pwSessionId;
}

function parseSessionId(rawOut) {
  const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
  const out = stripAnsi(rawOut || '').trim();
  const created = out.match(/Session\s+(\S+)\s+created/i);
  if (created) return created[1];
  const hex = out.match(/\b([a-f0-9-]{8,})\b/i);
  if (hex) return hex[1];
  try { const j = JSON.parse(out); return j.id || j.session_id || j.session || null; } catch (_) {}
  return null;
}

const VEC_K_DEFAULT = 10;
const EMBED_MODEL_DEFAULT = process.env.EMBED_MODEL || 'mistral/mistral-embed';
const INFERENCE_MODEL_DEFAULT = process.env.INFERENCE_MODEL || 'groq/llama-3.3-70b-versatile';

function cosineSim(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

let __wasmAbortFlag = { aborted: false, code: 0 };
function createWasiShim(instanceRef) {
  const getMemory = () => instanceRef.value.exports.memory.buffer;
  const shim = {
    proc_exit: (code) => {
      __wasmAbortFlag.aborted = true;
      __wasmAbortFlag.code = code;
      try {
        const spoolDir = spoolDirForSentinel();
        fs.mkdirSync(spoolDir, { recursive: true });
        fs.writeFileSync(path.join(spoolDir, '.wasm-abort.json'), JSON.stringify({
          ts: Date.now(),
          exit_code: code,
          verb_in_flight: __currentVerbContext,
        }));
      } catch (_) {}
      try { console.error(`[plugkit-wasm] wasm proc_exit(${code}) intercepted; throwing to abort current verb without killing watcher`); } catch (_) {}
      throw new Error(`wasm proc_exit(${code}) during verb ${__currentVerbContext && __currentVerbContext.verb}`);
    },
    fd_write: (fd, iovs_ptr, iovs_len, nwritten_ptr) => {
      try {
        const buf = getMemory();
        const dv = new DataView(buf);
        const chunks = [];
        let total = 0;
        for (let i = 0; i < iovs_len; i++) {
          const base = iovs_ptr + i * 8;
          const ptr = dv.getUint32(base, true);
          const len = dv.getUint32(base + 4, true);
          if (len > 0 && ptr + len <= buf.byteLength) {
            chunks.push(new Uint8Array(buf, ptr, len).slice());
            total += len;
          }
        }
        const merged = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { merged.set(c, off); off += c.length; }
        const text = new TextDecoder('utf-8').decode(merged);
        if (fd === 2) process.stderr.write(text);
        else process.stdout.write(text);
        new DataView(getMemory()).setUint32(nwritten_ptr, total, true);
        return 0;
      } catch (e) {
        return 28;
      }
    },
    random_get: (buf_ptr, buf_len) => {
      try {
        crypto.randomFillSync(new Uint8Array(getMemory(), buf_ptr, buf_len));
        return 0;
      } catch (e) {
        return 28;
      }
    },
    clock_time_get: (clock_id, precision, time_ptr) => {
      try {
        const ns = BigInt(Date.now()) * 1000000n;
        new DataView(getMemory()).setBigUint64(time_ptr, ns, true);
        return 0;
      } catch (e) {
        return 28;
      }
    },
    environ_get: () => 0,
    environ_sizes_get: () => 0,
    fd_prestat_get: () => 8,
    fd_prestat_dir_name: () => 8,
    fd_close: () => 0,
    fd_fdstat_get: () => 0,
    fd_fdstat_set_flags: () => 0,
    fd_filestat_get: () => 0,
    fd_seek: (_fd, _offset_lo, _offset_hi, _whence, newoffset_ptr) => {
      try { new DataView(getMemory()).setBigUint64(newoffset_ptr, 0n, true); } catch (_) {}
      return 0;
    },
    fd_read: (_fd, _iovs_ptr, _iovs_len, nread_ptr) => {
      try { new DataView(getMemory()).setUint32(nread_ptr, 0, true); } catch (_) {}
      return 0;
    },
    path_open: () => 8,
    path_filestat_get: () => 8,
    poll_oneoff: () => 0,
    sched_yield: () => 0,
  };
  return new Proxy(shim, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args) => {
        console.error(`[plugkit-wasm] unimplemented WASI call: ${String(prop)} args=${args.length}`);
        return 8;
      };
    }
  });
}

function guardWasmRange(buffer, ptr, len, where) {
  const total = buffer.byteLength;
  if (!Number.isInteger(ptr) || !Number.isInteger(len) || ptr < 0 || len < 0 || ptr + len > total) {
    throw new Error(`wasm-memory-read-out-of-bounds at ${where}: ptr=${ptr} len=${len} buffer=${total} -- corrupt (ptr,len) from wasm, refusing the read instead of crashing the dispatch loop`);
  }
}

function readWasmBytes(instance, ptr, len) {
  if (ptr === 0 || len === 0) return new Uint8Array(0);
  const buffer = instance.exports.memory.buffer;
  guardWasmRange(buffer, ptr, len, 'readWasmBytes');
  return new Uint8Array(buffer, ptr, len).slice();
}

function readWasmStr(instance, ptr, len) {
  if (ptr === 0 || len === 0) return '';
  const buffer = instance.exports.memory.buffer;
  guardWasmRange(buffer, ptr, len, 'readWasmStr');
  const bytes = new Uint8Array(buffer, ptr, len);
  return new TextDecoder('utf-8').decode(bytes);
}

function writeWasmBytes(instance, bytes) {
  if (bytes.length === 0) return 0n;
  const ptr = instance.exports.plugkit_alloc(bytes.length);
  if (ptr === 0) return 0n;
  new Uint8Array(instance.exports.memory.buffer, ptr, bytes.length).set(bytes);
  return (BigInt(ptr) & 0xffffffffn) | (BigInt(bytes.length) << 32n);
}

function writeWasmStr(instance, str) {
  if (!str) return 0n;
  return writeWasmBytes(instance, new TextEncoder().encode(str));
}

function writeWasmJson(instance, value) {
  return writeWasmStr(instance, JSON.stringify(value));
}

function safeName(s) { return String(s).replace(/[^A-Za-z0-9._-]/g, '_'); }

function projectKvDir(ns) {
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return path.join(projectRoot, '.gm', 'disciplines', safeName(ns));
}

function legacyKvDir(ns) {
  return path.join(KV_DIR, safeName(ns));
}

function kvFilePath(ns, key, ensureDir) {
  const dir = projectKvDir(ns);
  if (ensureDir) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, safeName(key) + '.json');
}

function kvReadResolve(ns, key) {
  const fp = kvFilePath(ns, key);
  if (fs.existsSync(fp)) return fp;
  const legacy = path.join(legacyKvDir(ns), safeName(key) + '.json');
  if (fs.existsSync(legacy)) return legacy;
  return null;
}

function kvNamespaceDirs(ns) {
  const out = [];
  const proj = projectKvDir(ns);
  if (fs.existsSync(proj)) out.push(proj);
  const legacy = legacyKvDir(ns);
  if (fs.existsSync(legacy)) out.push(legacy);
  return out;
}

function enabledDisciplineNamespaces(baseNs) {
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const set = new Set([baseNs]);
  try {
    const enabledPath = path.join(projectRoot, '.gm', 'disciplines', 'enabled.txt');
    if (fs.existsSync(enabledPath)) {
      const lines = fs.readFileSync(enabledPath, 'utf-8').split(/\r?\n/);
      for (const ln of lines) {
        const name = ln.trim();
        if (name && !name.startsWith('#')) set.add(name);
      }
    }
  } catch (_) {}
  return Array.from(set);
}

function jaccardOverlap(a, b) {
  if (!a || !b) return 0;
  const tokenize = (s) => new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 3));
  const A = tokenize(a), B = tokenize(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

const __tasks = new Map();

function tasksDir(cwd) {
  const d = path.join(cwd || process.cwd(), '.gm', 'exec-spool', 'tasks');
  try { fs.mkdirSync(d, { recursive: true }); } catch (_) {}
  return d;
}

function taskMetaPath(cwd, id) { return path.join(tasksDir(cwd), `${id}.json`); }
function taskOutPath(cwd, id, which) { return path.join(tasksDir(cwd), `${id}.${which}.log`); }

function writeTaskMeta(cwd, id, meta) {
  try { fs.writeFileSync(taskMetaPath(cwd, id), JSON.stringify(meta, null, 2)); } catch (_) {}
}

function nextTaskId(cwd) {
  const counterPath = path.join(tasksDir(cwd), '.counter');
  let n = 0;
  try { n = parseInt(fs.readFileSync(counterPath, 'utf-8'), 10) || 0; } catch (_) {}
  n += 1;
  try { fs.writeFileSync(counterPath, String(n)); } catch (_) {}
  return `t${n}`;
}

function langToCmd(lang, code) {
  if (lang === 'nodejs' || lang === 'js' || lang === 'javascript' || lang === 'node') return { cmd: process.execPath, args: ['-e', code], stdinCode: null };
  if (lang === 'python' || lang === 'py') return { cmd: 'python', args: ['-c', code], stdinCode: null };
  if (lang === 'bash' || lang === 'sh' || lang === 'shell' || lang === 'zsh') return { cmd: 'bash', args: ['-c', code], stdinCode: null };
  if (lang === 'powershell' || lang === 'ps1') return { cmd: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command', code], stdinCode: null };
  if (lang === 'deno') return { cmd: 'deno', args: ['eval', code], stdinCode: null };
  return null;
}

function spawnTask({ cwd, lang, code, timeoutMs }) {
  const id = nextTaskId(cwd);
  const built = langToCmd(lang, code);
  if (!built) return { ok: false, error: `unsupported lang: ${lang}` };
  const outLog = taskOutPath(cwd, id, 'stdout');
  const errLog = taskOutPath(cwd, id, 'stderr');
  let outFd = null, errFd = null;
  try { outFd = fs.openSync(outLog, 'a'); } catch (_) {}
  try { errFd = fs.openSync(errLog, 'a'); } catch (_) {}
  const startedMs = Date.now();
  const isPosix = process.platform !== 'win32';
  const child = spawn(built.cmd, built.args, {
    cwd: cwd || process.cwd(),
    detached: isPosix,
    stdio: ['ignore', outFd || 'ignore', errFd || 'ignore'],
    windowsHide: true,
    env: process.env,
  });
  try { if (outFd !== null) fs.closeSync(outFd); } catch (_) {}
  try { if (errFd !== null) fs.closeSync(errFd); } catch (_) {}
  const meta = {
    id,
    pid: child.pid,
    pgid: isPosix ? child.pid : null,
    lang,
    cmd: built.cmd,
    cwd: cwd || process.cwd(),
    started_ms: startedMs,
    timeout_ms: timeoutMs,
    deadline_ms: startedMs + timeoutMs,
    status: 'running',
    exit_code: null,
    stdout_log: outLog,
    stderr_log: errLog,
  };
  __tasks.set(id, { child, meta });
  writeTaskMeta(cwd, id, meta);
  child.on('exit', (code, signal) => {
    meta.status = signal ? 'killed' : (code === 0 ? 'completed' : 'failed');
    meta.exit_code = code;
    meta.signal = signal;
    meta.ended_ms = Date.now();
    writeTaskMeta(meta.cwd, id, meta);
  });
  child.on('error', (err) => {
    meta.status = 'error';
    meta.error = err.message;
    meta.ended_ms = Date.now();
    writeTaskMeta(meta.cwd, id, meta);
  });
  logEvent('plugkit', 'task.spawn', { task_id: id, pid: child.pid, lang, timeout_ms: timeoutMs });
  return { ok: true, task_id: id, pid: child.pid, started_ms: startedMs };
}

function stopTaskById(id) {
  const entry = __tasks.get(id);
  if (!entry) {
    return { ok: false, error: 'unknown task_id', task_id: id };
  }
  const { child, meta } = entry;
  if (meta.status !== 'running') return { ok: true, already: meta.status, task_id: id };
  const pid = meta.pid;
  const isPosix = process.platform !== 'win32';
  try {
    if (isPosix && meta.pgid) {
      try { process.kill(-meta.pgid, 'SIGTERM'); } catch (_) {}
    } else {
      try { child.kill('SIGTERM'); } catch (_) {}
    }
  } catch (_) {}
  const graceTimer = setTimeout(() => {
    if (meta.status !== 'running') return;
    if (isPosix && meta.pgid) {
      try { process.kill(-meta.pgid, 'SIGKILL'); } catch (_) {}
    } else if (process.platform === 'win32') {
      try { spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore', timeout: 3000 }); } catch (_) {}
    } else {
      try { child.kill('SIGKILL'); } catch (_) {}
    }
  }, 2000);
  graceTimer.unref && graceTimer.unref();
  logEvent('plugkit', 'task.stop', { task_id: id, pid });
  return { ok: true, task_id: id, pid };
}

function tailFile(filePath, maxBytes) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size <= maxBytes) return fs.readFileSync(filePath, 'utf-8');
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(maxBytes);
      fs.readSync(fd, buf, 0, maxBytes, stat.size - maxBytes);
      return buf.toString('utf-8');
    } finally { try { fs.closeSync(fd); } catch (_) {} }
  } catch (_) { return ''; }
}

function listTasks(cwd) {
  const d = tasksDir(cwd);
  const out = [];
  try {
    for (const entry of fs.readdirSync(d)) {
      if (!entry.endsWith('.json') || entry.startsWith('.')) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(d, entry), 'utf-8'));
        out.push(meta);
      } catch (_) {}
    }
  } catch (_) {}
  return out;
}

function reapTimedOutTasks() {
  const now = Date.now();
  for (const [id, entry] of __tasks) {
    const m = entry.meta;
    if (m.status === 'running' && m.deadline_ms && now > m.deadline_ms) {
      logEvent('plugkit', 'task.timeout', { task_id: id, pid: m.pid, deadline_ms: m.deadline_ms, now_ms: now });
      stopTaskById(id);
    }
  }
}

function killAllTasks(reason) {
  let killed = 0;
  for (const [id, entry] of __tasks) {
    if (entry.meta.status === 'running') {
      stopTaskById(id);
      killed += 1;
    }
  }
  if (killed > 0) logEvent('plugkit', 'task.killAll', { reason, count: killed });
  return killed;
}

function hostTaskProc(action, params) {
  switch (action) {
    case 'spawn': return spawnTask(params);
    case 'stop': return stopTaskById(params.id || params.task_id);
    case 'list': return { ok: true, tasks: listTasks(params.cwd) };
    case 'output': return {
      ok: true,
      task_id: params.id || params.task_id,
      stdout: tailFile(taskOutPath(params.cwd, params.id || params.task_id, 'stdout'), params.max_bytes || 65536),
      stderr: tailFile(taskOutPath(params.cwd, params.id || params.task_id, 'stderr'), params.max_bytes || 65536),
    };
    case 'reap': { reapTimedOutTasks(); return { ok: true }; }
    case 'killAll': { const n = killAllTasks(params.reason || 'host_task_proc'); return { ok: true, killed: n }; }
    default: return { ok: false, error: `unknown action: ${action}` };
  }
}

function makeHostFunctions(instanceRef) {
  return {
    host_fs_read: (pathPtr, pathLen) => {
      try {
        const filePath = readWasmStr(instanceRef.value, pathPtr, pathLen);
        if (!filePath) return 0n;
        const data = fs.readFileSync(filePath, 'utf-8');
        return writeWasmStr(instanceRef.value, data);
      } catch (e) {
        return 0n;
      }
    },

    host_fs_write: (pathPtr, pathLen, dataPtr, dataLen) => {
      try {
        const filePath = readWasmStr(instanceRef.value, pathPtr, pathLen);
        const data = readWasmStr(instanceRef.value, dataPtr, dataLen);
        if (!filePath) return 0;
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, data);
        return 1;
      } catch (e) {
        return 0;
      }
    },

    host_fs_readdir: (pathPtr, pathLen) => {
      try {
        const dirPath = readWasmStr(instanceRef.value, pathPtr, pathLen);
        if (!dirPath) return 0n;
        const entries = fs.readdirSync(dirPath, { withFileTypes: true }).map(e => ({
          name: e.name,
          is_dir: e.isDirectory(),
          is_file: e.isFile(),
        }));
        return writeWasmJson(instanceRef.value, entries);
      } catch (e) {
        return 0n;
      }
    },

    host_fs_stat: (pathPtr, pathLen) => {
      try {
        const filePath = readWasmStr(instanceRef.value, pathPtr, pathLen);
        if (!filePath) return 0n;
        const s = fs.statSync(filePath);
        return writeWasmJson(instanceRef.value, {
          is_dir: s.isDirectory(),
          is_file: s.isFile(),
          size: s.size,
          mtime_ms: s.mtimeMs,
        });
      } catch (e) {
        return 0n;
      }
    },

    host_fetch: (urlPtr, urlLen, optsPtr, optsLen) => {
      try {
        const url = readWasmStr(instanceRef.value, urlPtr, urlLen);
        const optsStr = readWasmStr(instanceRef.value, optsPtr, optsLen);
        const opts = optsStr ? JSON.parse(optsStr) : {};
        const result = spawnSync(process.execPath, ['-e', `
          const url = ${JSON.stringify(url)};
          const opts = ${JSON.stringify(opts)};
          fetch(url, opts).then(r => r.text().then(body => {
            process.stdout.write(JSON.stringify({ status: r.status, body }));
          })).catch(e => process.stdout.write(JSON.stringify({ status: 0, error: e.message })));
        `], { encoding: 'utf-8', timeout: 10000 });
        if (result.status !== 0) return writeWasmJson(instanceRef.value, { status: 0, error: result.stderr || 'fetch failed' });
        return writeWasmStr(instanceRef.value, result.stdout || '{}');
      } catch (e) {
        return writeWasmJson(instanceRef.value, { status: 0, error: e.message });
      }
    },

    host_kv_get: (nsPtr, nsLen, keyPtr, keyLen) => {
      try {
        const ns = readWasmStr(instanceRef.value, nsPtr, nsLen);
        const key = readWasmStr(instanceRef.value, keyPtr, keyLen);
        if (!ns || !key) return 0n;
        const fp = kvReadResolve(ns, key);
        if (!fp) return 0n;
        const data = fs.readFileSync(fp, 'utf-8');
        return writeWasmStr(instanceRef.value, data);
      } catch (e) {
        return 0n;
      }
    },

    host_kv_put: (nsPtr, nsLen, keyPtr, keyLen, valPtr, valLen) => {
      try {
        const ns = readWasmStr(instanceRef.value, nsPtr, nsLen);
        const key = readWasmStr(instanceRef.value, keyPtr, keyLen);
        const val = readWasmStr(instanceRef.value, valPtr, valLen);
        if (!ns || !key) return 0;
        fs.writeFileSync(kvFilePath(ns, key, true), val);
        return 1;
      } catch (e) {
        return 0;
      }
    },

    host_kv_delete: (nsPtr, nsLen, keyPtr, keyLen) => {
      try {
        const ns = readWasmStr(instanceRef.value, nsPtr, nsLen);
        const key = readWasmStr(instanceRef.value, keyPtr, keyLen);
        if (!ns || !key) return 0;
        let removed = 0;
        for (const baseNs of [ns, `${ns}-vec`]) {
          for (const dir of kvNamespaceDirs(baseNs)) {
            const fp = path.join(dir, safeName(key) + '.json');
            try { if (fs.existsSync(fp)) { fs.rmSync(fp, { force: true }); removed++; } } catch (_) {}
          }
        }
        return removed > 0 ? 1 : 0;
      } catch (e) {
        return 0;
      }
    },

    host_kv_query: (nsPtr, nsLen, qPtr, qLen) => {
      try {
        const ns = readWasmStr(instanceRef.value, nsPtr, nsLen);
        const q = readWasmStr(instanceRef.value, qPtr, qLen);
        if (!ns) return 0n;
        const dirs = kvNamespaceDirs(ns);
        if (dirs.length === 0) return writeWasmJson(instanceRef.value, []);
        const ql = q ? String(q).toLowerCase() : '';
        const seen = new Set();
        const results = [];
        for (const dir of dirs) {
          for (const f of fs.readdirSync(dir)) {
            if (!f.endsWith('.json')) continue;
            const key = f.replace(/\.json$/, '');
            if (seen.has(key)) continue;
            seen.add(key);
            const value = fs.readFileSync(path.join(dir, f), 'utf-8');
            if (ql && !value.toLowerCase().includes(ql) && !f.toLowerCase().includes(ql)) continue;
            results.push({ key, value });
          }
        }
        return writeWasmJson(instanceRef.value, results);
      } catch (e) {
        return 0n;
      }
    },

    host_vec_embed: (textPtr, textLen, outPtr, outLen) => {
      try {
        if (typeof globalThis.__hostEmbedSync === 'function') {
          return globalThis.__hostEmbedSync(textPtr, textLen, outPtr, outLen, instanceRef.value);
        }
      } catch (_) {}
      return -1;
    },

    host_vec_search: (qPtr, qLen, k) => {
      try {
        const raw = readWasmStr(instanceRef.value, qPtr, qLen);
        if (!raw) return writeWasmJson(instanceRef.value, []);
        let parsedQ;
        try { parsedQ = JSON.parse(raw); } catch (_) { parsedQ = { query: raw }; }
        const namespace = parsedQ.namespace || 'default';
        const sigil = parsedQ.sigil || parsedQ.discipline_sigil || null;
        const extractVec = (e) => {
          if (Array.isArray(e)) return e;
          if (Array.isArray(e?.data?.[0]?.embedding)) return e.data[0].embedding;
          if (Array.isArray(e?.embedding)) return e.embedding;
          return null;
        };
        const queryEmbedding = extractVec(parsedQ.embedding);
        const k_ = k > 0 ? k : VEC_K_DEFAULT;
        if (!queryEmbedding) {
          if (process.env.PLUGKIT_DEBUG) console.error('[plugkit-wasm] host_vec_search: no embedding in query, raw=', raw.slice(0, 200));
          return writeWasmJson(instanceRef.value, []);
        }
        const namespaces = sigil ? [namespace] : enabledDisciplineNamespaces(namespace);
        const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;
        const DEDUP_JACCARD = 0.7;
        const RECENCY_FLOOR = 0.4;
        const COS_FLOOR = namespace === 'codeinsight' ? 0.55 : 0;
        const nowMs = Date.now();
        const scored = [];
        const seen = new Set();
        for (const ns of namespaces) {
          const vecDirs = kvNamespaceDirs(`${ns}-vec`);
          const dataDirs = kvNamespaceDirs(ns);
          if (vecDirs.length === 0 || dataDirs.length === 0) continue;
          for (const vecDir of vecDirs) {
            for (const f of fs.readdirSync(vecDir)) {
              if (!f.endsWith('.json')) continue;
              const key = f.replace(/\.json$/, '');
              if (key === '__digest__') continue;
              const seenKey = `${ns}::${key}`;
              if (seen.has(seenKey)) continue;
              seen.add(seenKey);
              const vecPath = path.join(vecDir, f);
              let emb, mtimeMs;
              try {
                emb = JSON.parse(fs.readFileSync(vecPath, 'utf-8'));
                mtimeMs = fs.statSync(vecPath).mtimeMs;
              } catch (_) { continue; }
              const vector = Array.isArray(emb?.data?.[0]?.embedding) ? emb.data[0].embedding
                           : Array.isArray(emb?.embedding) ? emb.embedding
                           : Array.isArray(emb) ? emb : null;
              if (!vector) continue;
              const cos = cosineSim(queryEmbedding, vector);
              if (cos < COS_FLOOR) continue;
              const ageMs = Math.max(0, nowMs - mtimeMs);
              const recency = RECENCY_FLOOR + (1 - RECENCY_FLOOR) * Math.exp(-ageMs / HALF_LIFE_MS);
              const score = cos * recency;
              let text = '';
              for (const dataDir of dataDirs) {
                const valuePath = path.join(dataDir, `${key}.json`);
                if (fs.existsSync(valuePath)) { text = fs.readFileSync(valuePath, 'utf-8'); break; }
              }
              scored.push({ key, text, score, cos, recency, namespace: ns });
            }
          }
        }
        scored.sort((a, b) => b.score - a.score);
        const out = [];
        for (const hit of scored) {
          let dup = false;
          for (const kept of out) {
            if (jaccardOverlap(hit.text, kept.text) >= DEDUP_JACCARD) { dup = true; break; }
          }
          if (!dup) out.push(hit);
          if (out.length >= k_) break;
        }
        return writeWasmJson(instanceRef.value, out);
      } catch (e) {
        console.error('[plugkit-wasm] host_vec_search error:', e.message);
        return writeWasmJson(instanceRef.value, []);
      }
    },

    host_exec_js: (codePtr, codeLen, optsPtr, optsLen) => {
      try {
        const code = readWasmStr(instanceRef.value, codePtr, codeLen);
        const optsStr = readWasmStr(instanceRef.value, optsPtr, optsLen);
        const opts = optsStr ? JSON.parse(optsStr) : {};
        const lang = opts.lang || 'nodejs';
        const cwd = opts.cwd || process.cwd();
        const rawTimeout = opts.timeoutMs;
        const MIN_TIMEOUT_MS = 100;
        if (rawTimeout === undefined || rawTimeout === null || typeof rawTimeout !== 'number' || !Number.isFinite(rawTimeout) || rawTimeout <= 0 || !Number.isInteger(rawTimeout)) {
          return writeWasmJson(instanceRef.value, {
            ok: false,
            error: 'missing timeoutMs',
            required: 'positive integer milliseconds',
            paper_ref: 'section 20',
            received: rawTimeout === undefined ? null : rawTimeout,
          });
        }
        if (rawTimeout < MIN_TIMEOUT_MS) {
          return writeWasmJson(instanceRef.value, {
            ok: false,
            error: 'timeoutMs below floor',
            min: MIN_TIMEOUT_MS,
            received: rawTimeout,
            paper_ref: 'section 20',
          });
        }
        const timeoutMs = rawTimeout;
        let cmd, args;
        if (lang === 'nodejs' || lang === 'js') { cmd = process.execPath; args = ['-e', code]; }
        else if (lang === 'python') { cmd = 'python'; args = ['-c', code]; }
        else if (lang === 'bash') { cmd = 'bash'; args = ['-c', code]; }
        else if (lang === 'deno') { cmd = 'deno'; args = ['eval', code]; }
        else { return writeWasmJson(instanceRef.value, { ok: false, error: `unsupported lang: ${lang}` }); }
        const result = spawnSync(cmd, args, { encoding: 'utf-8', timeout: timeoutMs, cwd, env: process.env });
        return writeWasmJson(instanceRef.value, {
          ok: result.status === 0,
          stdout: result.stdout || '',
          stderr: result.stderr || '',
          exit_code: result.status === null ? -1 : result.status,
          timed_out: result.signal === 'SIGTERM',
        });
      } catch (e) {
        return writeWasmJson(instanceRef.value, { ok: false, error: e.message });
      }
    },

    host_log: (level, msgPtr, msgLen) => {
      try {
        const msg = readWasmStr(instanceRef.value, msgPtr, msgLen);
        const prefix = level >= 3 ? '[plugkit-wasm:err]' : level >= 2 ? '[plugkit-wasm:warn]' : '[plugkit-wasm]';
        if (level >= 2) console.error(`${prefix} ${msg}`);
        else console.log(`${prefix} ${msg}`);
        const evtMatch = msg.match(/^evt:\s*(\{.*\})\s*$/);
        if (evtMatch) {
          try {
            const ev = JSON.parse(evtMatch[1]);
            const eventName = ev.event || 'wasm.event';
            const { event: _e, ts: _ts, sess: _s, sub: _sub, ...fields } = ev;
            logEvent(ev.sub || 'plugkit', eventName, fields);
          } catch (_) {}
          return 0;
        }
        if (level >= 2) {
          if (/^plugkit gate:\s+[\w-]+\s+/.test(msg)) {
            return 0;
          }
          const noiseRe = /^(instruction::handle|recall::recall_hits|embed::|memorize::)/;
          if (!noiseRe.test(msg)) {
            logEvent('plugkit', level >= 3 ? 'wasm.err' : 'wasm.warn', { msg: msg.slice(0, 500) });
          }
        }
        return 0;
      } catch (e) {
        return 0;
      }
    },

    host_now_ms: () => BigInt(Date.now()),

    host_random_fill: (ptr, len) => {
      try {
        const buf = instanceRef.value.exports.memory.buffer;
        crypto.randomFillSync(new Uint8Array(buf, ptr, len));
        return 1;
      } catch (_) {
        return 0;
      }
    },

    host_browser_exec: (bodyPtr, bodyLen, cwdPtr, cwdLen, sidPtr, sidLen) => {
      try {
        const body = readWasmStr(instanceRef.value, bodyPtr, bodyLen);
        const cwd = readWasmStr(instanceRef.value, cwdPtr, cwdLen) || process.cwd();
        const sessionId = readWasmStr(instanceRef.value, sidPtr, sidLen) || 'default';
        const pw = findBrowserRunner();
        if (!pw) {
          throw new Error(`managed browser session runner '${BROWSER_RUNNER_BIN}' not found on PATH or in npm-global; install with 'bun add -g ${BROWSER_RUNNER_BIN}' or 'npm i -g ${BROWSER_RUNNER_BIN}'`);
        }

        const trimmed = body.trim();

        if (trimmed === 'session new' || trimmed === '') {
          const pwSessionId = getOrCreateBrowserSession(cwd, sessionId, pw);
          stampBrowserLastUse(cwd, sessionId);
          return writeWasmJson(instanceRef.value, {
            ok: true,
            stdout: `Session ${pwSessionId} attached to locally-profiled chromium at ${path.join(cwd, '.gm', 'browser-profile')}`,
            stderr: '',
            exit_code: 0,
            session_id: pwSessionId,
          });
        }

        if (trimmed.startsWith('session ')) {
          const parts = trimmed.slice(8).trim().split(/\s+/);
          if (parts[0] === 'close' || parts[0] === 'kill') parts[0] = 'delete';
          const r = runBrowserRunner(pw, ['session', ...parts], 30000, cwd, sessionId);
          if (r.status === 0 && (parts[0] === 'delete' || parts[0] === 'reset')) {
            try {
              const portsFile = browserPortsFile(cwd);
              const sessionsFile = browserSessionsFile(cwd);
              const ports = readJsonFile(portsFile, {});
              const sessions = readJsonFile(sessionsFile, {});
              const entry = ports[sessionId];
              if (entry && typeof entry === 'object') {
                if (Number.isFinite(entry.pid) && isProcessAliveSync(entry.pid)) {
                  gracefulCloseBrowser(entry, `session-${parts[0]}`);
                }
                delete ports[sessionId];
                delete sessions[sessionId];
                writeJsonFile(portsFile, ports);
                writeJsonFile(sessionsFile, sessions);
              }
            } catch (_) {}
          }
          return writeWasmJson(instanceRef.value, {
            ok: r.status === 0,
            stdout: scrubBrowserRunnerText(r.stdout || ''),
            stderr: scrubBrowserRunnerText(r.stderr || ''),
            exit_code: r.status === null ? -1 : r.status,
          });
        }

        const pwSessionId = getOrCreateBrowserSession(cwd, sessionId, pw);
        stampBrowserLastUse(cwd, sessionId);
        let evalBody = body;
        let timeoutMs = 120000;
        const timeoutMatch = body.match(/^timeout=(\d+)\s*\n([\s\S]*)$/);
        if (timeoutMatch) {
          const requested = parseInt(timeoutMatch[1], 10);
          if (Number.isFinite(requested) && requested > 0) {
            timeoutMs = Math.min(requested, 120000);
            evalBody = timeoutMatch[2];
          }
        }
        const outerTimeoutMs = Math.min(timeoutMs + 6000, 126000);
        const r = runBrowserRunner(pw, ['-s', pwSessionId, '--timeout', String(timeoutMs), '-e', evalBody], outerTimeoutMs, cwd, sessionId);
        const ok = r.status === 0;
        if (!ok && r.status === null) {
          logEvent('plugkit', 'browser.runner-timeout', { session_id: pwSessionId, timeout_ms: timeoutMs, body_bytes: evalBody.length });
        }
        return writeWasmJson(instanceRef.value, {
          ok,
          stdout: scrubBrowserRunnerText(r.stdout || ''),
          stderr: scrubBrowserRunnerText(r.stderr || ''),
          exit_code: r.status === null ? -1 : r.status,
          session_id: pwSessionId,
          timeout_ms_used: timeoutMs,
        });
      } catch (e) {
        return writeWasmJson(instanceRef.value, { ok: false, error: scrubBrowserRunnerText(e.message) });
      }
    },

    host_env_get: (keyPtr, keyLen) => {
      try {
        const key = readWasmStr(instanceRef.value, keyPtr, keyLen);
        if (!key) return 0n;
        const v = process.env[key];
        if (v === undefined) return 0n;
        return writeWasmStr(instanceRef.value, v);
      } catch (e) {
        return 0n;
      }
    },

    host_task_proc: (actionPtr, actionLen, paramsPtr, paramsLen) => {
      try {
        const action = readWasmStr(instanceRef.value, actionPtr, actionLen);
        const paramsStr = readWasmStr(instanceRef.value, paramsPtr, paramsLen);
        const params = paramsStr ? JSON.parse(paramsStr) : {};
        if (!params.cwd) params.cwd = process.cwd();
        const result = hostTaskProc(action, params);
        return writeWasmJson(instanceRef.value, result);
      } catch (e) {
        return writeWasmJson(instanceRef.value, { ok: false, error: e.message });
      }
    },

    host_git: (argsPtr, argsLen, cwdPtr, cwdLen) => {
      try {
        const args = readWasmStr(instanceRef.value, argsPtr, argsLen);
        const cwdStr = readWasmStr(instanceRef.value, cwdPtr, cwdLen);
        const cwd = cwdStr || process.cwd();
        let argv;
        const trimmed = args.trim();
        if (trimmed.startsWith('[')) {
          try { argv = JSON.parse(trimmed); } catch { argv = trimmed.split(/\s+/); }
          if (!Array.isArray(argv)) argv = String(argv).split(/\s+/);
        } else {
          argv = trimmed.split(/\s+/);
        }
        const gitBin = resolveWindowsExeLocal('git');
        const result = _rawSpawnSync(gitBin, argv, { encoding: 'utf-8', timeout: 60000, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        return writeWasmJson(instanceRef.value, {
          stdout: result.stdout || '',
          stderr: result.stderr || '',
          exit_code: result.status === null ? -1 : result.status,
        });
      } catch (e) {
        return writeWasmJson(instanceRef.value, { stdout: '', stderr: String(e && e.message || e), exit_code: 1 });
      }
    },
  };
}

function resolveVersion(instance) {
  try {
    return fs.readFileSync(path.join(GM_TOOLS_ROOT, 'plugkit.version'), 'utf8').trim();
  } catch (_) {}
  const fromInstance = readInstanceVersion(instance);
  return fromInstance || 'unknown';
}

function readFileVersionOnly() {
  try { return fs.readFileSync(path.join(GM_TOOLS_ROOT, 'plugkit.version'), 'utf8').trim(); } catch (_) { return null; }
}

function readInstanceVersion(instance) {
  try {
    const fn = instance && instance.exports && instance.exports.plugkit_version;
    if (typeof fn !== 'function') return null;
    const result = fn();
    let ptr, len;
    if (typeof result === 'bigint') {
      ptr = Number(result & 0xffffffffn);
      len = Number(result >> 32n);
    } else {
      ptr = Number(result) & 0xffffffff;
      len = 0;
    }
    const buf = new Uint8Array(instance.exports.memory.buffer, ptr, 64);
    if (len === 0) {
      let end = 0;
      while (end < buf.length && buf[end] !== 0) end++;
      len = end;
    }
    if (len === 0) return null;
    return new TextDecoder().decode(buf.subarray(0, len)).trim() || null;
  } catch (_) { return null; }
}

async function runSpoolWatcher(instance, spoolDir) {
  const inDir = path.join(spoolDir, 'in');
  const outDir = path.join(spoolDir, 'out');
  fs.mkdirSync(inDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  try {
    const gmDir = path.dirname(spoolDir);
    fs.writeFileSync(path.join(gmDir, 'last-instruction-ts'), String(Date.now()));
    fs.writeFileSync(path.join(gmDir, 'long-gap-retry-state'), '');
  } catch (_) {}

  try { reapOrphanBrowserSessions(findBrowserRunner(), process.cwd(), process.env.CLAUDE_SESSION_ID || 'claude-loop-iter', 'watcher-boot'); } catch (_) {}


  const LOCK_PATH = path.join(spoolDir, '.watcher.lock');
  try {
    const _wp = path.join(GM_TOOLS_ROOT, 'plugkit-wasm-wrapper.js');
    _ownWrapperSha12 = crypto.createHash('sha256').update(fs.readFileSync(_wp)).digest('hex').slice(0, 12);
  } catch (e) {
    try { logEvent('plugkit', 'watcher.own-wrapper-sha-failed', { error: String(e && e.message || e), gm_tools_root: GM_TOOLS_ROOT }); } catch (_) {}
  }
  function lockBody() { return `${process.pid}|${Date.now()}|${_ownWrapperSha12}`; }
  function acquireLock() {
    function checkExistingHolder() {
      try {
        const content = fs.readFileSync(LOCK_PATH, 'utf-8').trim();
        const parts = content.split('|');
        const pidStr = parts[0];
        const tsStr = parts[1];
        const holderSha = parts[2] || '';
        const lockTs = parseInt(tsStr, 10);
        const age = Date.now() - lockTs;
        const holderPidNum = parseInt(pidStr, 10);
        const holderAlive = Number.isFinite(holderPidNum) && isProcessAliveSync(holderPidNum);
        if (age < 15000 && holderAlive) {
          if (_ownWrapperSha12 && holderSha && holderSha !== _ownWrapperSha12) {
            try { logEvent('plugkit', 'peer.stale-wrapper-takeover', { holder_pid: pidStr, holder_sha: holderSha, own_sha: _ownWrapperSha12, lock_age_ms: age }); } catch (_) {}
            console.error(`[plugkit-wasm] peer wrapper-sha mismatch (holder=${holderSha} own=${_ownWrapperSha12}); killing pid=${pidStr} and taking over`);
            try {
              fs.writeFileSync(path.join(spoolDir, '.shutdown-reason.json'), JSON.stringify({
                reason: 'peer-stale-takeover',
                ts: Date.now(),
                taker_pid: process.pid,
                taker_sha: _ownWrapperSha12,
                holder_sha: holderSha,
              }));
            } catch (_) {}
            try { process.kill(parseInt(pidStr, 10), 'SIGTERM'); } catch (_) {}
            return 'takeover';
          } else {
            const msg = JSON.stringify({ ok: false, reason: 'another-watcher-active', pid: pidStr, age_ms: age });
            console.error(`[plugkit-wasm] ${msg}; refusing to start`);
            try { fs.writeFileSync(path.join(spoolDir, '.lock-rejection.json'), msg); } catch (_) {}
            try {
              const __now = Date.now();
              const __last = __lockRejectedEmitAt.get(pidStr) || 0;
              if (__now - __last > 60000) {
                __lockRejectedEmitAt.set(pidStr, __now);
                logEvent('plugkit', 'watcher.lock-rejected', { severity: 'info', holder_pid: pidStr, lock_age_ms: age });
              }
            } catch (_) {}
            process.exit(75);
          }
        } else if (!holderAlive) {
          console.error(`[plugkit-wasm] stale lock (holder pid=${pidStr} dead, age=${age}ms); taking over`);
          try { logEvent('plugkit', 'watcher.lock-pid-dead-takeover', { stale_pid: pidStr, lock_age_ms: age }); } catch (_) {}
          return 'takeover';
        } else {
          console.error(`[plugkit-wasm] stale lock (age=${age}ms); taking over`);
          return 'takeover';
        }
      } catch (_) {
        return 'takeover';
      }
    }
    try {
      let fd;
      try {
        fd = fs.openSync(LOCK_PATH, 'wx');
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        const action = checkExistingHolder();
        if (action !== 'takeover') return;
        try { fs.unlinkSync(LOCK_PATH); } catch (_) {}
        fd = fs.openSync(LOCK_PATH, 'wx');
      }
      try {
        const body = Buffer.from(lockBody(), 'utf-8');
        fs.writeSync(fd, body);
      } finally {
        fs.closeSync(fd);
      }
    } catch (e) {
      console.error(`[plugkit-wasm] lock acquire failed: ${e.message}`);
      process.exit(1);
    }
  }
  function refreshLock() {
    try { fs.writeFileSync(LOCK_PATH, lockBody()); } catch (_) {}
  }
  function releaseLock() {
    try {
      const content = fs.readFileSync(LOCK_PATH, 'utf-8').trim();
      const [pidStr] = content.split('|');
      if (pidStr === String(process.pid)) fs.unlinkSync(LOCK_PATH);
    } catch (_) {}
  }
  acquireLock();
  setInterval(refreshLock, 5000);

  const BOOT_ACTIVE_PATH = path.join(spoolDir, '.boot-active.json');
  const VERB_ACTIVE_PATH = path.join(spoolDir, '.verb-active.json');
  const STATUS_PATH_FOR_VERB_ABORT = path.join(spoolDir, '.status.json');
  const SHUTDOWN_REASON_PATH_EARLY = path.join(spoolDir, '.shutdown-reason.json');
  try {
    let priorVerb = null;
    let priorStatusForVerb = null;
    try { priorVerb = JSON.parse(fs.readFileSync(VERB_ACTIVE_PATH, 'utf-8')); } catch (_) {}
    try { priorStatusForVerb = JSON.parse(fs.readFileSync(STATUS_PATH_FOR_VERB_ABORT, 'utf-8')); } catch (_) {}
    if (priorVerb && priorVerb.pid && priorVerb.pid !== process.pid) {
      const statusAge = priorStatusForVerb && Number.isFinite(priorStatusForVerb.ts) ? Date.now() - priorStatusForVerb.ts : null;
      const statusFresh = statusAge !== null && statusAge < 30_000;
      if (!statusFresh) {
        logEvent('plugkit', 'watcher.verb-abort', {
          prior_pid: priorVerb.pid,
          verb: priorVerb.verb,
          task: priorVerb.task,
          started_at_ms: priorVerb.started_at_ms,
          dur_ms_at_death: priorVerb.started_at_ms ? Date.now() - priorVerb.started_at_ms : null,
          status_age_ms: statusAge,
          detected_at: Date.now(),
        });
        try { console.error(`[plugkit-wasm] VERB ABORT detected: prior watcher pid=${priorVerb.pid} died inside verb=${priorVerb.verb} task=${priorVerb.task}`); } catch (_) {}
        if (priorVerb.verb && priorVerb.task) {
          try {
            const abortBody = JSON.stringify({
              ok: false,
              error: `verb aborted: watcher pid=${priorVerb.pid} died mid-verb; side effects may be partial -- verify state, then re-dispatch`,
              verb_aborted: true,
              verb: priorVerb.verb,
              task: priorVerb.task,
            });
            const abortOutDir = path.join(path.dirname(STATUS_PATH_FOR_VERB_ABORT), 'out');
            fs.mkdirSync(abortOutDir, { recursive: true });
            const nestedName = path.join(abortOutDir, `${priorVerb.verb}-${priorVerb.task}.json`);
            if (!fs.existsSync(nestedName)) fs.writeFileSync(nestedName, abortBody);
            if (priorVerb.verb !== priorVerb.task) {
              const rootName = path.join(abortOutDir, `${priorVerb.task}.json`);
              if (!fs.existsSync(rootName)) fs.writeFileSync(rootName, abortBody);
            }
          } catch (_) {}
        }
      }
      try { fs.unlinkSync(VERB_ACTIVE_PATH); } catch (_) {}
    }
  } catch (_) {}
  try {
    let priorBoot = null;
    let priorShutdownForAbort = null;
    try { priorBoot = JSON.parse(fs.readFileSync(BOOT_ACTIVE_PATH, 'utf-8')); } catch (_) {}
    try { priorShutdownForAbort = JSON.parse(fs.readFileSync(SHUTDOWN_REASON_PATH_EARLY, 'utf-8')); } catch (_) {}
    if (priorBoot && Number.isFinite(priorBoot.ts) && priorBoot.pid !== process.pid) {
      const ageMs = Date.now() - priorBoot.ts;
      const shutdownIsNewer = priorShutdownForAbort && Number.isFinite(priorShutdownForAbort.ts) && priorShutdownForAbort.ts >= priorBoot.ts;
      if (ageMs > 30_000 && !shutdownIsNewer) {
        let priorVerbSnap = null;
        let priorStatusSnap = null;
        let priorPidAlive = null;
        try { priorVerbSnap = JSON.parse(fs.readFileSync(VERB_ACTIVE_PATH, 'utf-8')); } catch (_) {}
        try { priorStatusSnap = JSON.parse(fs.readFileSync(path.join(path.dirname(BOOT_ACTIVE_PATH), '.status.json'), 'utf-8')); } catch (_) {}
        try { process.kill(priorBoot.pid, 0); priorPidAlive = true; } catch (e) { priorPidAlive = e.code === 'EPERM'; }
        const forensics = {
          prior_pid: priorBoot.pid,
          prior_ts: priorBoot.ts,
          prior_sha: priorBoot.wrapper_sha || null,
          prior_version: priorBoot.version || null,
          detected_at: Date.now(),
          age_ms: ageMs,
          shutdown_reason_present: !!priorShutdownForAbort,
          shutdown_reason_ts: priorShutdownForAbort ? priorShutdownForAbort.ts : null,
          prior_verb_active: priorVerbSnap,
          prior_status: priorStatusSnap,
          prior_pid_alive: priorPidAlive,
        };
        logEvent('plugkit', 'watcher.silent-abort', forensics);
        try {
          fs.writeFileSync(path.join(path.dirname(BOOT_ACTIVE_PATH), '.silent-abort-forensics.json'), JSON.stringify(forensics, null, 2));
        } catch (_) {}
        try { console.error(`[plugkit-wasm] SILENT ABORT detected: prior watcher pid=${priorBoot.pid} sha=${priorBoot.wrapper_sha} died without writing .shutdown-reason.json (age=${ageMs}ms, prior_pid_alive=${priorPidAlive})`); } catch (_) {}
      }
    }
  } catch (_) {}
  function writeBootActive() {
    try {
      const _v = readInstanceVersion(instance);
      fs.writeFileSync(BOOT_ACTIVE_PATH, JSON.stringify({
        pid: process.pid,
        ts: Date.now(),
        wrapper_sha: _ownWrapperSha12 || null,
        version: _v || null,
      }));
    } catch (_) {}
  }
  function clearBootActive() {
    try { fs.unlinkSync(BOOT_ACTIVE_PATH); } catch (_) {}
  }
  writeBootActive();

  const PEER_REGISTRY_PATH = path.join(GM_TOOLS_ROOT, 'peer-registry.json');
  function registerSelfAsPeer() {
    try {
      let reg = {};
      try { reg = JSON.parse(fs.readFileSync(PEER_REGISTRY_PATH, 'utf-8')); } catch (_) {}
      reg[process.cwd()] = { pid: process.pid, ts: Date.now(), sha: _ownWrapperSha12 };
      fs.writeFileSync(PEER_REGISTRY_PATH, JSON.stringify(reg, null, 2));
    } catch (_) {}
  }
  registerSelfAsPeer();
  setInterval(registerSelfAsPeer, 30_000);

  function sweepStalePeers() {
    if (!_ownWrapperSha12) return;
    let reg = {};
    try { reg = JSON.parse(fs.readFileSync(PEER_REGISTRY_PATH, 'utf-8')); } catch (_) { return; }
    for (const peerCwd of Object.keys(reg)) {
      if (peerCwd === process.cwd()) continue;
      const peerLock = path.join(peerCwd, '.gm', 'exec-spool', '.watcher.lock');
      let content = '';
      try { content = fs.readFileSync(peerLock, 'utf-8').trim(); } catch (_) { continue; }
      const parts = content.split('|');
      const peerPid = parseInt(parts[0], 10);
      const peerTs = parseInt(parts[1], 10);
      const peerSha = parts[2] || '';
      if (!peerPid || !peerSha) continue;
      const age = Date.now() - peerTs;
      if (age > 15000) continue;
      if (peerSha === _ownWrapperSha12) continue;
      try {
        process.kill(peerPid, 0);
      } catch (_) { continue; }
      logEvent('plugkit', 'peer.stale-wrapper-killed', { peer_cwd: peerCwd, peer_pid: peerPid, peer_sha: peerSha, own_sha: _ownWrapperSha12, lock_age_ms: age });
      console.error(`[plugkit-wasm] peer-sweep killing stale-wrapper watcher pid=${peerPid} cwd=${peerCwd} sha=${peerSha} (own=${_ownWrapperSha12})`);
      try {
        fs.writeFileSync(path.join(peerCwd, '.gm', 'exec-spool', '.shutdown-reason.json'), JSON.stringify({
          reason: 'peer-stale-takeover',
          ts: Date.now(),
          killer_pid: process.pid,
          killer_sha: _ownWrapperSha12,
          peer_sha: peerSha,
        }));
      } catch (_) {}
      try { process.kill(peerPid, 'SIGTERM'); } catch (_) {}
    }
  }
  setInterval(sweepStalePeers, 60_000);
  setTimeout(sweepStalePeers, 5000);

  const IDLE_LIMIT_MS = parseInt(process.env.PLUGKIT_IDLE_LIMIT_MS, 10) || 60 * 60 * 1000;
  const IDLE_CHECK_MS = 60_000;
  const SHUTDOWN_REASON_PATH = path.join(spoolDir, '.shutdown-reason.json');
  const STATUS_PATH_FOR_TEARDOWN = path.join(spoolDir, '.status.json');
  let lastActivityMs = Date.now();
  function markActivity(source) {
    lastActivityMs = Date.now();
  }

  function teardownAll(reason) {
    try {
      logEvent('plugkit', 'watcher.teardown', { reason, idle_ms: Date.now() - lastActivityMs });
      console.log(`[plugkit-wasm] teardown reason=${reason}`);
    } catch (_) {}

    try { killAllTasks(`teardown:${reason}`); } catch (_) {}

    try {
      const portsFile = browserPortsFile(process.cwd());
      const sessionsFile = browserSessionsFile(process.cwd());
      const ports = readJsonFile(portsFile, {});
      for (const [sid, entry] of Object.entries(ports)) {
        gracefulCloseBrowser(entry, `teardown:${reason}`);
      }
      try { fs.unlinkSync(portsFile); } catch (_) {}
      try { fs.unlinkSync(sessionsFile); } catch (_) {}
    } catch (_) {}

    try {
      fs.writeFileSync(SHUTDOWN_REASON_PATH, JSON.stringify({
        reason,
        ts: Date.now(),
        pid: process.pid,
        idle_ms: Date.now() - lastActivityMs,
      }));
      __shutdownReasonWritten = true;
    } catch (_) {}

    try { fs.unlinkSync(STATUS_PATH_FOR_TEARDOWN); } catch (_) {}
    try { clearBootActive(); } catch (_) {}
    try { clearVerbActive(); } catch (_) {}
    try { releaseLock(); } catch (_) {}
    process.exit(0);
  }

  setInterval(() => {
    try { reapTimedOutTasks(); } catch (_) {}
  }, 5000);

  let _selfStaleLoggedOnce = false;
  let _selfStaleProbeErrorLogged = false;
  function probeGmPlugkitSelfStale() {
    try {
      const ownPkgVersionFile = path.join(GM_TOOLS_ROOT, 'gm-plugkit.version');
      const ownPkgJsonFile = path.join(__dirname, 'package.json');
      let own = null;
      if (fs.existsSync(ownPkgVersionFile)) {
        try { own = fs.readFileSync(ownPkgVersionFile, 'utf-8').trim(); } catch (_) {}
      }
      if (!own && fs.existsSync(ownPkgJsonFile)) {
        try { own = JSON.parse(fs.readFileSync(ownPkgJsonFile, 'utf-8')).version; } catch (_) {}
      }
      if (!own) return;
      const https = _httpsModule;
      let _probeErrored = false;
      const req = https.get('https://registry.npmjs.org/gm-plugkit/latest', { timeout: 10000, headers: { 'user-agent': 'plugkit-watcher' } }, (res) => {
        let body = '';
        res.on('data', (c) => body += c);
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              if (!_selfStaleProbeErrorLogged) {
                _selfStaleProbeErrorLogged = true;
                try { logEvent('plugkit', 'gm-plugkit.self-stale-probe-error', { reason: `http-${res.statusCode}` }); } catch (_) {}
              }
              return;
            }
            const latest = JSON.parse(body).version;
            const stalePath = path.join(spoolDir, '.gm-plugkit-stale.json');
            const respawnGuardPath = path.join(spoolDir, '.gm-plugkit-respawn-guard.json');
            if (!latest || latest === own) {
              if (fs.existsSync(stalePath)) { try { fs.unlinkSync(stalePath); } catch (_) {} }
              if (fs.existsSync(respawnGuardPath)) { try { fs.unlinkSync(respawnGuardPath); } catch (_) {} }
              return;
            }
            let respawnGuard = { attempts: 0, last_own: null, last_latest: null, first_ts: Date.now() };
            try {
              if (fs.existsSync(respawnGuardPath)) respawnGuard = JSON.parse(fs.readFileSync(respawnGuardPath, 'utf8'));
            } catch (_) {}
            const sameStaleAsBefore = respawnGuard.last_own === own && respawnGuard.last_latest === latest;
            const cameFromSelfRespawn = process.env.PLUGKIT_BOOT_REASON === 'self-respawn-from-self-stale';
            if (sameStaleAsBefore && respawnGuard.attempts >= 3) {
              try { fs.writeFileSync(stalePath, JSON.stringify({
                ts: new Date().toISOString(),
                reason: 'gm-plugkit-self-stale-respawn-exhausted',
                running_version: own,
                latest_version: latest,
                respawn_attempts: respawnGuard.attempts,
                instruction: `gm-plugkit ${own} cannot self-upgrade to ${latest}: ${respawnGuard.attempts} respawns all came up ${own} (bun/npx cache is serving the stale tarball). Respawn loop halted to keep this watcher alive and serving verbs. Fix manually: bun pm cache rm; npm cache clean --force; rm -rf ~/AppData/Local/npm-cache/_npx ~/.bun/install/cache; then bun x gm-plugkit@latest --kill-stale-watchers; bun x gm-plugkit@latest spool`,
                detected_by: 'watcher-periodic-probe',
              }, null, 2)); } catch (_) {}
              if (!_selfStaleLoggedOnce) {
                _selfStaleLoggedOnce = true;
                try { logEvent('plugkit', 'gm-plugkit.self-stale-respawn-exhausted', { running_version: own, latest_version: latest, attempts: respawnGuard.attempts }); } catch (_) {}
                console.error(`[plugkit-wasm] gm-plugkit self-stale respawn EXHAUSTED after ${respawnGuard.attempts} attempts (cache serving stale ${own} for latest ${latest}); halting respawn loop and staying alive to serve verbs`);
              }
              return;
            }
            const marker = {
              ts: new Date().toISOString(),
              reason: 'gm-plugkit-self-stale',
              running_version: own,
              latest_version: latest,
              instruction: `gm-plugkit running ${own} but npm has ${latest}. The npx/bun cache served a stale copy. Run 'bun x gm-plugkit@latest --kill-stale-watchers' then re-bootstrap. Or clear the cache directly: bun pm cache rm; or rm -rf ~/.npm/_npx ~/AppData/Local/npm-cache/_npx`,
              detected_by: 'watcher-periodic-probe',
            };
            try { fs.writeFileSync(stalePath, JSON.stringify(marker, null, 2)); } catch (_) {}
            if (!_selfStaleLoggedOnce) {
              _selfStaleLoggedOnce = true;
              try { logEvent('plugkit', 'gm-plugkit.self-stale', { running_version: own, latest_version: latest, detected_by: 'watcher-periodic-probe' }); } catch (_) {}
              console.error(`[plugkit-wasm] gm-plugkit self-stale: running ${own}, latest npm ${latest} -> spawning replacement via bun x gm-plugkit@latest spool and exiting`);
              try {
                const cp = _childProcess;
                const bunPath = process.env.GM_BUN_PATH || 'bun';
                const bustCache = sameStaleAsBefore || cameFromSelfRespawn;
                if (bustCache) {
                  try { cp.execFileSync(bunPath, ['pm', 'cache', 'rm'], { stdio: 'ignore', timeout: 30000, windowsHide: true }); } catch (_) {}
                  try {
                    const home = process.env.USERPROFILE || process.env.HOME || '';
                    for (const rel of ['AppData/Local/npm-cache/_npx', '.npm/_npx', '.bun/install/cache']) {
                      try { fs.rmSync(path.join(home, rel), { recursive: true, force: true }); } catch (_) {}
                    }
                  } catch (_) {}
                  try { logEvent('plugkit', 'gm-plugkit.self-stale-cache-busted', { running_version: own, latest_version: latest, attempt: (respawnGuard.attempts || 0) + 1 }); } catch (_) {}
                }
                try { fs.writeFileSync(respawnGuardPath, JSON.stringify({
                  attempts: (sameStaleAsBefore ? (respawnGuard.attempts || 0) : 0) + 1,
                  last_own: own,
                  last_latest: latest,
                  first_ts: respawnGuard.first_ts || Date.now(),
                  last_ts: Date.now(),
                  cache_busted: bustCache,
                }, null, 2)); } catch (_) {}
                const child = cp.spawn(bunPath, ['x', `gm-plugkit@${latest}`, 'spool'], {
                  cwd: process.cwd(),
                  detached: true,
                  stdio: 'ignore',
                  windowsHide: true,
                  env: { ...process.env, PLUGKIT_BOOT_REASON: 'self-respawn-from-self-stale' },
                });
                child.unref();
                try { logEvent('plugkit', 'gm-plugkit.self-stale-respawn', { running_version: own, latest_version: latest, cache_busted: bustCache, attempt: (respawnGuard.attempts || 0) + 1 }); } catch (_) {}
                try { fs.writeFileSync(path.join(spoolDir, '.shutdown-reason.json'), JSON.stringify({ reason: 'gm-plugkit-self-stale', ts: Date.now(), pid: process.pid, running_version: own, latest_version: latest })); } catch (_) {}
                const myPid = process.pid;
                const respawnDeadline = Date.now() + 90000;
                const exitSelfStale = () => { try { process.exit(0); } catch (_) {} };
                const ownVersionFile = path.join(GM_TOOLS_ROOT, 'gm-plugkit.version');
                const pollSelfStaleReplacement = () => {
                  try {
                    const st = JSON.parse(fs.readFileSync(STATUS_PATH_FOR_TEARDOWN, 'utf8'));
                    const freshHeartbeat = st && st.ts && (Date.now() - st.ts) < 15000;
                    const differentProc = st && st.pid && st.pid !== myPid;
                    let replacementOnLatest = false;
                    try { replacementOnLatest = fs.readFileSync(ownVersionFile, 'utf-8').trim() === latest; } catch (_) {}
                    if (freshHeartbeat && differentProc && replacementOnLatest) {
                      try { fs.unlinkSync(respawnGuardPath); } catch (_) {}
                      try { logEvent('plugkit', 'gm-plugkit.self-stale-respawn-confirmed', { old_pid: myPid, new_pid: st.pid, new_version: st.version, latest_version: latest, replacement_gm_plugkit: latest }); } catch (_) {}
                      return exitSelfStale();
                    }
                  } catch (_) {}
                  if (Date.now() > respawnDeadline) {
                    try { logEvent('plugkit', 'gm-plugkit.self-stale-respawn-timeout', { old_pid: myPid, waited_ms: 90000 }); } catch (_) {}
                    return exitSelfStale();
                  }
                  setTimeout(pollSelfStaleReplacement, 1500);
                };
                setTimeout(pollSelfStaleReplacement, 3000);
              } catch (e) {
                console.error(`[plugkit-wasm] failed to spawn replacement on self-stale: ${e.message}`);
              }
            }
          } catch (e) {
            if (!_selfStaleProbeErrorLogged) {
              _selfStaleProbeErrorLogged = true;
              try { logEvent('plugkit', 'gm-plugkit.self-stale-probe-error', { reason: 'parse', error: String(e && e.message || e).slice(0, 200) }); } catch (_) {}
            }
          }
        });
      });
      req.on('error', (e) => {
        if (_probeErrored) return;
        _probeErrored = true;
        if (!_selfStaleProbeErrorLogged) {
          _selfStaleProbeErrorLogged = true;
          try { logEvent('plugkit', 'gm-plugkit.self-stale-probe-error', { reason: 'network', error: String(e && e.message || e).slice(0, 200) }); } catch (_) {}
        }
      });
      req.on('timeout', () => {
        if (_probeErrored) { try { req.destroy(); } catch (_) {} return; }
        _probeErrored = true;
        try { req.destroy(); } catch (_) {}
        if (!_selfStaleProbeErrorLogged) {
          _selfStaleProbeErrorLogged = true;
          try { logEvent('plugkit', 'gm-plugkit.self-stale-probe-error', { reason: 'timeout' }); } catch (_) {}
        }
      });
    } catch (_) {}
  }
  setTimeout(probeGmPlugkitSelfStale, 5000);
  setInterval(probeGmPlugkitSelfStale, 300_000);

  function _supervisorIsDead() {
    try {
      const sp = parseInt(fs.readFileSync(path.join(spoolDir, '.supervisor.pid'), 'utf8').trim(), 10);
      return !(Number.isFinite(sp) && isProcessAliveSync(sp));
    } catch (_) { return true; }
  }
  const _instanceVersionAtBoot = readInstanceVersion(instance);
  let _driftLoggedOnce = false;
  setInterval(() => {
    try {
      const fileV = readFileVersionOnly();
      const instV = _instanceVersionAtBoot;
      if (!fileV || !instV || fileV === instV) return;
      const bootReason = process.env.PLUGKIT_BOOT_REASON || 'unknown';
      const unsupervised = bootReason === 'direct-no-supervisor' || _supervisorIsDead();
      if (unsupervised) {
        if (_driftLoggedOnce) return;
        _driftLoggedOnce = true;
        logEvent('plugkit', 'version.drift-self-respawn', {
          instance_version: instV,
          file_version: fileV,
          action: 'spawn-replacement-and-exit',
          boot_reason: bootReason,
        });
        console.error(`[plugkit-wasm] version drift detected: instance=${instV} file=${fileV} -- spawning replacement via bun x gm-plugkit@latest spool, waiting for its heartbeat before exiting`);
        let spawnOk = false;
        try {
          const cp = _childProcess;
          const bunPath = process.env.GM_BUN_PATH || 'bun';
          const child = cp.spawn(bunPath, ['x', 'gm-plugkit@latest', 'spool'], {
            cwd: process.cwd(),
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
            env: { ...process.env, PLUGKIT_BOOT_REASON: 'self-respawn-from-drift' },
          });
          child.unref();
          spawnOk = true;
        } catch (e) {
          console.error(`[plugkit-wasm] failed to spawn replacement: ${e.message}; exiting anyway so next agent dispatch boots fresh`);
        }
        try { fs.writeFileSync(path.join(spoolDir, '.shutdown-reason.json'), JSON.stringify({ reason: 'version-change-unsupervised', ts: Date.now(), pid: process.pid, instance_version: instV, file_version: fileV })); } catch (_) {}
        const exitNow = () => {
          try { releaseLock(); } catch (_) {}
          try { fs.unlinkSync(STATUS_PATH_FOR_TEARDOWN); } catch (_) {}
          try { clearBootActive(); } catch (_) {}
          process.exit(0);
        };
        if (!spawnOk) { setTimeout(exitNow, 2000); return; }
        const myPid = process.pid;
        const respawnDeadline = Date.now() + 90000;
        const pollReplacement = () => {
          try {
            const raw = fs.readFileSync(STATUS_PATH_FOR_TEARDOWN, 'utf8');
            const st = JSON.parse(raw);
            const freshHeartbeat = st && st.ts && (Date.now() - st.ts) < 15000;
            const differentProc = st && st.pid && st.pid !== myPid;
            if (freshHeartbeat && differentProc) {
              try { logEvent('plugkit', 'version.drift-respawn-confirmed', { old_pid: myPid, new_pid: st.pid, new_version: st.version }); } catch (_) {}
              try { releaseLock(); } catch (_) {}
              try { clearBootActive(); } catch (_) {}
              process.exit(0);
              return;
            }
          } catch (_) {}
          if (Date.now() > respawnDeadline) {
            try { logEvent('plugkit', 'version.drift-respawn-timeout', { old_pid: myPid, waited_ms: 90000 }); } catch (_) {}
            exitNow();
            return;
          }
          setTimeout(pollReplacement, 1500);
        };
        setTimeout(pollReplacement, 3000);
        return;
      }
      logEvent('plugkit', 'version.drift', {
        instance_version: instV,
        file_version: fileV,
        action: 'exit-for-respawn',
      });
      console.error(`[plugkit-wasm] version drift detected: instance=${instV} file=${fileV} -> exiting so supervisor reloads fresh wasm`);
      try {
        fs.writeFileSync(path.join(spoolDir, '.shutdown-reason.json'), JSON.stringify({
          reason: 'version-change',
          ts: Date.now(),
          pid: process.pid,
          instance_version: instV,
          file_version: fileV,
        }));
      } catch (_) {}
      try { releaseLock(); } catch (_) {}
      try { fs.unlinkSync(STATUS_PATH_FOR_TEARDOWN); } catch (_) {}
      try { clearBootActive(); } catch (_) {}
      process.exit(0);
    } catch (e) {
      console.error(`[version-drift-check] error: ${e.message}`);
    }
  }, 60_000);

  const _wrapperPathInstalled = path.join(GM_TOOLS_ROOT, 'plugkit-wasm-wrapper.js');
  let _wrapperShaAtBoot = '';
  try {
    _wrapperShaAtBoot = crypto.createHash('sha256').update(fs.readFileSync(_wrapperPathInstalled)).digest('hex');
  } catch (_) {}
  let _wrapperDriftLoggedOnce = false;
  setInterval(() => {
    try {
      if (!_wrapperShaAtBoot) return;
      const cur = crypto.createHash('sha256').update(fs.readFileSync(_wrapperPathInstalled)).digest('hex');
      if (cur === _wrapperShaAtBoot) return;
      const bootReason = process.env.PLUGKIT_BOOT_REASON || 'unknown';
      const unsupervised = bootReason === 'direct-no-supervisor' || _supervisorIsDead();
      if (unsupervised) {
        if (_wrapperDriftLoggedOnce) return;
        _wrapperDriftLoggedOnce = true;
        logEvent('plugkit', 'wrapper.drift-self-respawn', {
          boot_sha: _wrapperShaAtBoot.slice(0, 12),
          file_sha: cur.slice(0, 12),
          action: 'spawn-replacement-and-exit',
          boot_reason: bootReason,
        });
        console.error(`[plugkit-wasm] wrapper.js drift detected -- spawning replacement directly from installed wrapper then exiting`);
        try {
          const cp = _childProcess;
          const child = cp.spawn(process.execPath, [_wrapperPathInstalled, 'spool'], {
            cwd: process.cwd(),
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
            env: { ...process.env, PLUGKIT_BOOT_REASON: 'self-respawn-from-wrapper-drift' },
          });
          child.unref();
        } catch (e) {
          console.error(`[plugkit-wasm] direct node spawn failed: ${e.message}; falling back to bun x`);
          try {
            const cp = _childProcess;
            const bunPath = process.env.GM_BUN_PATH || 'bun';
            const child = cp.spawn(bunPath, ['x', 'gm-plugkit@latest', 'spool'], {
              cwd: process.cwd(),
              detached: true,
              stdio: 'ignore',
              windowsHide: true,
              env: { ...process.env, PLUGKIT_BOOT_REASON: 'self-respawn-from-wrapper-drift-fallback' },
            });
            child.unref();
          } catch (e2) {
            console.error(`[plugkit-wasm] fallback bun-x also failed: ${e2.message}`);
          }
        }
        try { fs.writeFileSync(path.join(spoolDir, '.shutdown-reason.json'), JSON.stringify({ reason: 'wrapper-drift-unsupervised', ts: Date.now(), pid: process.pid, boot_sha: _wrapperShaAtBoot.slice(0, 12), file_sha: cur.slice(0, 12) })); } catch (_) {}
        try { releaseLock(); } catch (_) {}
        try { fs.unlinkSync(STATUS_PATH_FOR_TEARDOWN); } catch (_) {}
        try { clearBootActive(); } catch (_) {}
        setTimeout(() => process.exit(0), 2000);
        return;
      }
      logEvent('plugkit', 'wrapper.drift', {
        boot_sha: _wrapperShaAtBoot.slice(0, 12),
        file_sha: cur.slice(0, 12),
        action: 'exit-for-respawn',
      });
      console.error(`[plugkit-wasm] wrapper.js drift detected -> exiting so supervisor reloads fresh wrapper`);
      try {
        fs.writeFileSync(path.join(spoolDir, '.shutdown-reason.json'), JSON.stringify({
          reason: 'wrapper-change',
          ts: Date.now(),
          pid: process.pid,
          boot_sha: _wrapperShaAtBoot.slice(0, 12),
          file_sha: cur.slice(0, 12),
        }));
      } catch (_) {}
      try { releaseLock(); } catch (_) {}
      try { fs.unlinkSync(STATUS_PATH_FOR_TEARDOWN); } catch (_) {}
      try { clearBootActive(); } catch (_) {}
      process.exit(0);
    } catch (e) {
      console.error(`[wrapper-drift-check] error: ${e.message}`);
    }
  }, 60_000);

  const BROWSER_IDLE_LIMIT_MS = parseInt(process.env.PLUGKIT_BROWSER_IDLE_LIMIT_MS, 10) || 10 * 60 * 1000;
  setInterval(() => {
    try {
      const portsFile = browserPortsFile(process.cwd());
      const sessionsFile = browserSessionsFile(process.cwd());
      const ports = readJsonFile(portsFile, {});
      const sessions = readJsonFile(sessionsFile, {});
      const now = Date.now();
      const idle = selectIdleBrowserSessions(ports, now, BROWSER_IDLE_LIMIT_MS);
      const idleSids = new Set(idle.map((x) => x.sid));
      let mutated = false;
      for (const { sid, entry, idleMs } of idle) {
        if (Number.isFinite(entry.pid) && isProcessAliveSync(entry.pid)) {
          try { gracefulCloseBrowser(entry, 'browser-idle'); } catch (_) {}
        }
        delete ports[sid];
        delete sessions[sid];
        mutated = true;
        logEvent('plugkit', 'browser.idle-closed', { sid, pid: entry.pid || null, idle_ms: idleMs });
      }
      for (const [sid, entry] of Object.entries(ports)) {
        if (idleSids.has(sid) || !entry || typeof entry !== 'object') continue;
        const pidAlive = Number.isFinite(entry.pid) && isProcessAliveSync(entry.pid);
        if (!pidAlive) {
          delete ports[sid];
          delete sessions[sid];
          mutated = true;
          logEvent('plugkit', 'browser.stale-reclaimed', { sid, pid: entry.pid || null, reason: 'pid-dead' });
          continue;
        }
        const cdpOk = !!fetchJsonSync(`http://127.0.0.1:${entry.port}/json/version`, 1000);
        if (!cdpOk) {
          try { gracefulCloseBrowser(entry, 'orphan-cdp-dead'); } catch (_) {}
          delete ports[sid];
          delete sessions[sid];
          mutated = true;
          logEvent('plugkit', 'browser.stale-reclaimed', { sid, pid: entry.pid || null, reason: 'cdp-dead' });
        }
      }
      if (mutated) {
        try { writeJsonFile(portsFile, ports); } catch (_) {}
        try { writeJsonFile(sessionsFile, sessions); } catch (_) {}
      }
      try { reapOrphanBrowserSessions(findBrowserRunner(), process.cwd(), process.env.CLAUDE_SESSION_ID || 'claude-loop-iter', 'idle-sweep'); } catch (_) {}
    } catch (e) {
      console.error(`[browser-idle] error: ${e.message}`);
    }
  }, 60_000);

  setInterval(() => {
    try {
      const idleMs = Date.now() - lastActivityMs;
      if (idleMs < IDLE_LIMIT_MS) return;
      try {
        const ports = readJsonFile(browserPortsFile(process.cwd()), {});
        let browserAlive = false;
        for (const entry of Object.values(ports)) {
          if (entry && Number.isFinite(entry.pid) && isProcessAliveSync(entry.pid)) { browserAlive = true; break; }
        }
        if (browserAlive) { markActivity('browser-pid-alive'); return; }
      } catch (_) {}
      try {
        let anyRunning = false;
        for (const entry of __tasks.values()) {
          if (entry.meta.status === 'running') { anyRunning = true; break; }
        }
        if (anyRunning) { markActivity('task-running'); return; }
      } catch (_) {}
      teardownAll('idle');
    } catch (e) {
      console.error(`[idle-check] error: ${e.message}`);
    }
  }, IDLE_CHECK_MS);

  const SHUTDOWN_REQUEST_PATH = path.join(spoolDir, '.shutdown-requested');
  setInterval(() => {
    try {
      if (!fs.existsSync(SHUTDOWN_REQUEST_PATH)) return;
      let reqReason = 'shutdown-requested';
      try {
        const raw = fs.readFileSync(SHUTDOWN_REQUEST_PATH, 'utf-8').trim();
        if (raw) {
          try { const j = JSON.parse(raw); if (j && j.reason) reqReason = String(j.reason); }
          catch (_) { reqReason = raw.slice(0, 64); }
        }
      } catch (_) {}
      try { fs.unlinkSync(SHUTDOWN_REQUEST_PATH); } catch (_) {}
      handleSignalShutdown(reqReason.toUpperCase());
    } catch (e) {
      console.error(`[shutdown-request] error: ${e.message}`);
    }
  }, 2000);

  let _signalShutdownInFlight = false;
  function handleSignalShutdown(sig) {
    if (_signalShutdownInFlight) return;
    _signalShutdownInFlight = true;
    try { teardownAll(sig.toLowerCase()); } catch (_) {
      try {
        fs.writeFileSync(SHUTDOWN_REASON_PATH, JSON.stringify({
          reason: sig.toLowerCase(),
          ts: Date.now(),
          pid: process.pid,
          teardown_failed: true,
        }));
        __shutdownReasonWritten = true;
      } catch (__) {}
      try { clearBootActive(); } catch (__) {}
      try { releaseLock(); } catch (__) {}
      process.exit(0);
    }
  }
  process.on('SIGINT', () => handleSignalShutdown('SIGINT'));
  process.on('SIGTERM', () => handleSignalShutdown('SIGTERM'));
  process.on('SIGBREAK', () => handleSignalShutdown('SIGBREAK'));
  process.on('SIGHUP', () => handleSignalShutdown('SIGHUP'));
  process.on('exit', () => { try { clearBootActive(); } catch (_) {} releaseLock(); });

  try {
    const wrapperDst = path.join(GM_TOOLS_ROOT, 'plugkit-wasm-wrapper.js');
    if (path.resolve(__filename) !== path.resolve(wrapperDst)) {
      let same = false;
      if (fs.existsSync(wrapperDst)) {
        try {
          const a = fs.readFileSync(__filename);
          const b = fs.readFileSync(wrapperDst);
          if (a.length === b.length && crypto.createHash('sha256').update(a).digest('hex') === crypto.createHash('sha256').update(b).digest('hex')) same = true;
        } catch (_) {}
      }
      if (!same) {
        fs.copyFileSync(__filename, wrapperDst);
        console.log(`[plugkit-wasm] installed wrapper at ${wrapperDst}`);
      }
    }
  } catch (e) { console.error(`[plugkit-wasm] wrapper self-install failed: ${e.message}`); }

  const _bootVersion = resolveVersion(instance);
  console.log(`[plugkit-wasm] plugkit v${_bootVersion} (wasm)`);
  console.log(`[plugkit-wasm] watching ${inDir}`);

  let _priorShutdown = null;
  let _priorStatus = null;
  try { _priorShutdown = JSON.parse(fs.readFileSync(SHUTDOWN_REASON_PATH, 'utf-8')); } catch (_) {}
  try { _priorStatus = JSON.parse(fs.readFileSync(STATUS_PATH_FOR_TEARDOWN, 'utf-8')); } catch (_) {}
  const _bootReason = process.env.PLUGKIT_BOOT_REASON || 'unknown';
  const _supervisorPid = parseInt(process.env.PLUGKIT_SUPERVISOR_PID, 10) || null;
  const restartContext = {
    boot_reason: _bootReason,
    supervisor_pid: _supervisorPid,
    prior_shutdown: _priorShutdown,
    prior_status: _priorStatus,
    prior_status_age_ms: _priorStatus && Number.isFinite(_priorStatus.ts) ? Date.now() - _priorStatus.ts : null,
  };
  const _UNPLANNED_REASONS = new Set(['uncaughtexception', 'unhandledrejection', 'wasm-abort', 'wasm-abort-graceful']);
  const _normalizedShutdownReason = _priorShutdown && _priorShutdown.reason ? String(_priorShutdown.reason).toLowerCase() : null;
  const _isPlannedBoot = !!_normalizedShutdownReason && !_UNPLANNED_REASONS.has(_normalizedShutdownReason);
  const _isFirstBoot = !_priorShutdown && !_priorStatus;
  const UNPLANNED_RESTART_MARKER = path.join(spoolDir, '.unplanned-restart.json');
  const HEARTBEAT_RECENT_MS = 60_000;
  const HEARTBEAT_DEAD_MS = 5 * 60_000;
  let _severity = 'critical';
  if (_isPlannedBoot) {
    _severity = 'info';
  } else if (!_priorShutdown && _priorStatus && Number.isFinite(_priorStatus.ts)) {
    const _statusAge = Date.now() - _priorStatus.ts;
    if (_statusAge <= HEARTBEAT_RECENT_MS) _severity = 'warn';
    else if (_statusAge < HEARTBEAT_DEAD_MS) _severity = 'warn';
    else _severity = 'critical';
  }
  if (!_isFirstBoot) {
    const incidentPayload = {
      ts: Date.now(),
      version: _bootVersion,
      severity: _severity,
      planned: _isPlannedBoot,
      ...restartContext,
      log_tail_path: path.join(spoolDir, '.watcher.log'),
      gm_log_dir: GM_LOG_ROOT,
      instruction: _isPlannedBoot
        ? `Planned restart: prior watcher exited with reason="${_priorShutdown.reason}". No action required.`
        : (_severity === 'warn'
          ? 'Prior watcher disappeared with a recent heartbeat -- likely a clean shutdown that did not write .shutdown-reason.json. Inspect .watcher.log if recurrent.'
          : 'Prior watcher died without a planned shutdown and without a recent heartbeat. This is treated as a critical failure. Inspect .watcher.log and gm-log/<day>/plugkit.jsonl events supervisor.watcher-exited-unexpectedly + supervisor.heartbeat-stale around the prior_status.ts timestamp to diagnose root cause.'),
    };
    logEvent('plugkit', _isPlannedBoot ? 'watcher.planned-restart' : 'watcher.unplanned-restart', incidentPayload);
    try {
      let history = [];
      try { history = JSON.parse(fs.readFileSync(UNPLANNED_RESTART_MARKER, 'utf-8')).history || []; } catch (_) {}
      history.push(incidentPayload);
      if (history.length > 20) history = history.slice(-20);
      fs.writeFileSync(UNPLANNED_RESTART_MARKER, JSON.stringify({
        latest: incidentPayload,
        count: history.length,
        history,
      }, null, 2));
    } catch (_) {}
    if (_isPlannedBoot) {
      console.log(`[plugkit-wasm] planned restart: prior reason="${_priorShutdown.reason}" boot_reason=${_bootReason}`);
    } else {
      console.error(`[plugkit-wasm] UNPLANNED RESTART detected -- prior watcher died without writing .shutdown-reason.json. prior_status_age_ms=${restartContext.prior_status_age_ms} boot_reason=${_bootReason}`);
    }
  }
  try { fs.unlinkSync(SHUTDOWN_REASON_PATH); } catch (_) {}
  logEvent('plugkit', 'watcher.boot', { version: _bootVersion, in_dir: inDir, out_dir: outDir, spool_dir: spoolDir, ...restartContext });

  const PRE_SUPERVISED_MARKER = path.join(spoolDir, '.pre-supervised-watcher.json');
  if (_supervisorPid == null && _bootReason === 'direct-no-supervisor') {
    try {
      fs.writeFileSync(PRE_SUPERVISED_MARKER, JSON.stringify({
        ts: Date.now(),
        reason: 'running-watcher-has-no-supervisor',
        watcher_pid: process.pid,
        watcher_version: _bootVersion,
        boot_reason: _bootReason,
        severity: 'warn',
        instruction: 'A running watcher was started directly without supervisor.js. Unplanned-restart recovery and idle-teardown coordination are dormant. To migrate: stop the current watcher and let the next bootstrap (bun x gm-plugkit@latest spool) re-spawn it under supervisor.js.',
      }, null, 2));
      logEvent('plugkit', 'watcher.unsupervised-marker-written', { spool_dir: spoolDir, watcher_pid: process.pid });
    } catch (_) {}
  } else {
    try { fs.unlinkSync(PRE_SUPERVISED_MARKER); } catch (_) {}
  }

  const PROCESSED_MAX = 10000;
  const processed = new Map();
  function markProcessed(key) {
    processed.set(key, Date.now());
    if (processed.size > PROCESSED_MAX) {
      const oldest = processed.keys().next().value;
      processed.delete(oldest);
    }
  }
  function isProcessed(key) { return processed.has(key); }
  function unmarkProcessed(key) { processed.delete(key); }

  const dispatch = instance.exports.dispatch_verb;
  if (!dispatch) throw new Error('dispatch_verb not exported');

  const processFile = async (filePath) => {
    const key = path.relative(inDir, filePath);
    if (isProcessed(key)) return;
    markProcessed(key);

    if (__wasmAbortFlag.aborted) {
      try {
        const taskBase = path.basename(filePath, path.extname(filePath));
        const relPath = path.relative(inDir, filePath);
        const dir = path.dirname(relPath);
        const verb = dir === '.' ? taskBase : dir;
        const outName = dir === '.' ? `${taskBase}.json` : `${verb}-${taskBase}.json`;
        fs.writeFileSync(path.join(outDir, outName), JSON.stringify({
          ok: false,
          error: `wasm aborted earlier (exit_code=${__wasmAbortFlag.code}); watcher will respawn`,
          wasm_aborted: true,
        }));
        try { fs.unlinkSync(filePath); } catch (_) {}
      } catch (_) {}
      unmarkProcessed(key);
      emitShutdownReason('wasm-abort-graceful', new Error(`wasm proc_exit(${__wasmAbortFlag.code}) earlier; clean watcher restart`));
      try { console.error('[plugkit-wasm] exiting after wasm abort to allow supervisor respawn'); } catch (_) {}
      setTimeout(() => process.exit(2), 100).unref();
      return;
    }

    try {
      const rawBuf = fs.readFileSync(filePath);
      let content;
      let _detectedEncoding = 'utf-8';
      if (rawBuf.length >= 2 && rawBuf[0] === 0xFF && rawBuf[1] === 0xFE) {
        content = rawBuf.slice(2).toString('utf16le');
        _detectedEncoding = 'utf-16le-bom';
      } else if (rawBuf.length >= 2 && rawBuf[0] === 0xFE && rawBuf[1] === 0xFF) {
        const swapped = Buffer.alloc(rawBuf.length - 2);
        for (let i = 2; i + 1 < rawBuf.length; i += 2) {
          swapped[i - 2] = rawBuf[i + 1];
          swapped[i - 1] = rawBuf[i];
        }
        content = swapped.toString('utf16le');
        _detectedEncoding = 'utf-16be-bom';
      } else if (rawBuf.length >= 3 && rawBuf[0] === 0xEF && rawBuf[1] === 0xBB && rawBuf[2] === 0xBF) {
        content = rawBuf.slice(3).toString('utf8');
        _detectedEncoding = 'utf-8-bom';
      } else {
        content = rawBuf.toString('utf8');
      }
      if (_detectedEncoding !== 'utf-8') {
        try { logEvent('plugkit', 'spool.body-encoding-recoded', { task: path.basename(filePath, path.extname(filePath)), encoding: _detectedEncoding, bytes: rawBuf.length }); } catch (_) {}
      }
      const relPath = path.relative(inDir, filePath);
      const dir = path.dirname(relPath);
      const verb = dir === '.' ? path.basename(filePath, path.extname(filePath)) : dir;
      if (/[\\/]/.test(verb) || verb.split(/[\\/]/).some(seg => seg.startsWith('.'))) {
        try { logEvent('plugkit', 'spool.skip-nested-verb', { rel: relPath, derived_verb: verb }); } catch (_) {}
        unmarkProcessed(key);
        return;
      }
      let body = content.trim() || '{}';
      const taskBase = path.basename(filePath, path.extname(filePath));

      if (verb === 'recall' || verb === 'memorize' || verb === 'codesearch' || verb === 'memorize-fire') {
        body = applyDisciplineSigil(body);
      }

      const verbBytes = new TextEncoder().encode(verb);
      const bodyBytes = new TextEncoder().encode(body);

      const t0 = Date.now();
      console.log(`[dispatch] -> verb=${verb} task=${taskBase} body=${bodyBytes.length}b`);
      logEvent('plugkit', 'dispatch.start', { verb, task: taskBase, body_bytes: bodyBytes.length, cwd: process.cwd() });

      if (verb === 'codesearch') {
        try { _writeStatusBusy(360000); } catch (_) {}
      } else if (verb === 'git_finalize' || verb === 'git_push' || verb === 'git_fetch') {
        try { _writeStatusBusy(180000); } catch (_) {}
      }

      let autoRecallPayload = null;
      if (verb === 'instruction') {
        const sessForRecall = readCurrentSess();
        if (isInstructionTurnStart(sessForRecall)) {
          autoRecallPayload = tryAutoRecallForTurnEntry(instance, sessForRecall, process.cwd(), promptFromInstructionBody(body));
          try {
            const _spoolDir = path.join(process.cwd(), '.gm', 'exec-spool');
            for (const _f of ['.turn-browser-edits.json', '.turn-browser-witnessed']) {
              const _p = path.join(_spoolDir, _f);
              if (fs.existsSync(_p)) fs.unlinkSync(_p);
            }
          } catch (_) {}
        }
      }

      const verbPtr = instance.exports.plugkit_alloc(verbBytes.length);
      const bodyPtr = instance.exports.plugkit_alloc(bodyBytes.length);
      new Uint8Array(instance.exports.memory.buffer, verbPtr, verbBytes.length).set(verbBytes);
      new Uint8Array(instance.exports.memory.buffer, bodyPtr, bodyBytes.length).set(bodyBytes);

      writeVerbActive(verb, taskBase);
      const result = dispatch(verbPtr, verbBytes.length, bodyPtr, bodyBytes.length);
      clearVerbActive();

      const ptr = Number(result & 0xffffffffn);
      const len = Number(result >> 32n);
      const resultBytes = new Uint8Array(instance.exports.memory.buffer, ptr, len);
      let resultStr = new TextDecoder().decode(resultBytes);

      if (autoRecallPayload) {
        resultStr = mergeAutoRecallIntoInstructionResponse(resultStr, autoRecallPayload);
        try {
          const parsed = JSON.parse(resultStr);
          if (parsed && typeof parsed === 'object') {
            injectUpdateWarning(parsed);
            resultStr = JSON.stringify(parsed);
          }
        } catch (_) {}
      } else if (verb === 'instruction' || verb === 'transition' || verb === 'phase-status') {
        try {
          const parsed = JSON.parse(resultStr);
          if (parsed && typeof parsed === 'object') {
            capInstructionPacks(parsed);
            injectUpdateWarning(parsed);
            resultStr = JSON.stringify(parsed);
          }
        } catch (_) {}
      }

      const outName = dir === '.' ? `${taskBase}.json` : `${verb}-${taskBase}.json`;
      fs.writeFileSync(path.join(outDir, outName), resultStr);
      const dur_ms = Date.now() - t0;
      console.log(`[dispatch] <- verb=${verb} task=${taskBase} ms=${dur_ms} out=${resultStr.length}b`);
      logEvent('plugkit', 'dispatch.end', { verb, task: taskBase, dur_ms, out_bytes: resultStr.length });
      emitOrchestratorEvents(verb, taskBase, resultStr);

      if (verb === 'browser') {
        try {
          const cwd_ = process.cwd();
          const editsFile = path.join(cwd_, '.gm', 'exec-spool', '.turn-browser-edits.json');
          const witnessFile = path.join(cwd_, '.gm', 'exec-spool', '.turn-browser-witnessed');
          fs.mkdirSync(path.dirname(witnessFile), { recursive: true });
          let edits = [];
          try { edits = JSON.parse(fs.readFileSync(editsFile, 'utf8')); if (!Array.isArray(edits)) edits = []; } catch (_) {}
          const witnessed_hashes = {};
          for (const e of edits) {
            if (!e || !e.file) continue;
            try {
              const abs = path.isAbsolute(e.file) ? e.file : path.join(cwd_, e.file);
              const buf = fs.readFileSync(abs);
              witnessed_hashes[e.file] = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
            } catch (_) { witnessed_hashes[e.file] = ''; }
          }
          fs.writeFileSync(witnessFile, JSON.stringify({ ts: Date.now(), task: taskBase, dur_ms, witnessed_hashes }));
          logEvent('plugkit', 'browser.witness-marked', { task: taskBase, files: Object.keys(witnessed_hashes) });
        } catch (_) {}
      }

      try { instance.exports.plugkit_free(verbPtr, verbBytes.length); } catch (_) {}
      try { instance.exports.plugkit_free(bodyPtr, bodyBytes.length); } catch (_) {}
      try { instance.exports.plugkit_free(ptr, len); } catch (_) {}

      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
      unmarkProcessed(key);
    } catch (e) {
      try { clearVerbActive(); } catch (_) {}
      console.error(`[plugkit-wasm] error processing ${key}: ${e.message}`);
      const taskBase = path.basename(filePath, path.extname(filePath));
      const relPath = path.relative(inDir, filePath);
      const dir = path.dirname(relPath);
      const verb = dir === '.' ? taskBase : dir;
      const outName = dir === '.' ? `${taskBase}.json` : `${verb}-${taskBase}.json`;
      try {
        fs.writeFileSync(path.join(outDir, outName), JSON.stringify({ ok: false, error: e.message }));
      } catch (_) {}
      try { fs.unlinkSync(filePath); } catch (_) {}
      unmarkProcessed(key);
      logEvent('plugkit', 'dispatch.error', { verb, task: taskBase, error: String(e && e.message || e) });
    }
  };

  function walkDir(dir, depth = 0) {
    const files = [];
    try {
      for (const entry of fs.readdirSync(dir)) {
        if (/\.tmp\.\d+(\.|$)/.test(entry)) continue;
        if (entry.startsWith('.')) continue;
        const fullPath = path.join(dir, entry);
        let stat;
        try { stat = fs.statSync(fullPath); } catch (_) { continue; }
        if (stat.isFile()) {
          files.push(fullPath);
        } else if (stat.isDirectory() && depth < 2) {
          files.push(...walkDir(fullPath, depth + 1));
        }
      }
    } catch (e) {
      console.error(`[plugkit-wasm] error walking ${dir}: ${e.message}`);
    }
    return files;
  }

  const STATUS_PATH = path.join(spoolDir, '.status.json');
  function writeStatus(busyMs) {
    try {
      const fileV = readFileVersionOnly() || null;
      const instV = _instanceVersionAtBoot || null;
      const version = instV || fileV;
      const drifted = !!(fileV && instV && fileV !== instV);
      const now = Date.now();
      const rec = {
        pid: process.pid,
        ts: now,
        version,
        instance_version: instV,
        file_version: fileV,
        version_drifted: drifted,
        boot_reason: _bootReason,
        supervisor_pid: _supervisorPid,
        wrapper_sha: _ownWrapperSha12 || null,
        idle_limit_ms: IDLE_LIMIT_MS,
      };
      if (busyMs && busyMs > 0) { rec.busy_until = now + busyMs; _lastBusyUntil = rec.busy_until; }
      fs.writeFileSync(STATUS_PATH, JSON.stringify(rec));
    } catch (_) {}
  }
  _writeStatusBusy = (ms) => { try { writeStatus(ms); } catch (_) {} };
  setInterval(() => writeStatus(), 5000);
  setInterval(() => { try { scanStalledTurns(); } catch (_) {} }, 30000);
  writeStatus();

  const TURN_SUMMARY_PATH = path.join(spoolDir, '.turn-summary.json');
  function writeTurnSummary() {
    try {
      const cwd = process.cwd();
      const gmDir = path.join(cwd, '.gm');
      let phase = null, lastSkill = null, prdPending = 0, browserSessions = 0;
      let lastInstructionTs = null, lastInstructionAgeMs = null;
      try {
        const ts = JSON.parse(fs.readFileSync(path.join(gmDir, 'turn-state.json'), 'utf-8'));
        phase = ts.phase || null;
        lastSkill = ts.last_skill || null;
      } catch (_) {}
      try {
        const prdRaw = fs.readFileSync(path.join(gmDir, 'prd.yml'), 'utf-8');
        const openRe = /\n\s*status:\s*(pending|in_progress|unknown)\b/g;
        const matches = prdRaw.match(openRe);
        prdPending = matches ? matches.length : 0;
      } catch (_) {}
      try {
        const tsRaw = fs.readFileSync(path.join(gmDir, 'last-instruction-ts'), 'utf-8');
        const n = parseInt(tsRaw.trim(), 10);
        if (Number.isFinite(n) && n > 0) {
          lastInstructionTs = n;
          lastInstructionAgeMs = Date.now() - n;
        }
      } catch (_) {}
      try {
        const ports = readJsonFile(browserPortsFile(cwd), {});
        for (const entry of Object.values(ports)) {
          if (entry && Number.isFinite(entry.pid) && isProcessAliveSync(entry.pid)) browserSessions++;
        }
      } catch (_) {}
      const fileV = readFileVersionOnly() || null;
      const instV = _instanceVersionAtBoot || null;
      let updateAvailable = null;
      try {
        const upd = JSON.parse(fs.readFileSync(path.join(spoolDir, '.update-available.json'), 'utf-8'));
        if (upd && upd.installed && upd.latest && upd.installed !== upd.latest) {
          updateAvailable = { installed: upd.installed, latest: upd.latest };
        }
      } catch (_) {}
      let deviations30m = 0;
      try {
        const day = new Date().toISOString().slice(0, 10);
        const cutoff = Date.now() - 30 * 60 * 1000;
        for (const sub of ['hook', 'plugkit']) {
          const p = path.join(GM_LOG_ROOT, day, `${sub}.jsonl`);
          if (!fs.existsSync(p)) continue;
          const raw = fs.readFileSync(p, 'utf-8');
          let idx = 0;
          while (true) {
            const nl = raw.indexOf('\n', idx);
            const line = nl === -1 ? raw.slice(idx) : raw.slice(idx, nl);
            if (line.includes('"event":"deviation.')) {
              const tsm = line.match(/"ts":"([^"]+)"/);
              if (tsm) {
                const t = Date.parse(tsm[1]);
                if (Number.isFinite(t) && t >= cutoff) deviations30m++;
              }
            }
            if (nl === -1) break;
            idx = nl + 1;
          }
        }
      } catch (_) {}
      fs.writeFileSync(TURN_SUMMARY_PATH, JSON.stringify({
        ts: Date.now(),
        watcher_pid: process.pid,
        watcher_version: instV || fileV,
        watcher_uptime_ms: Math.round(process.uptime() * 1000),
        phase,
        last_skill: lastSkill,
        prd_pending: prdPending,
        last_instruction_ts: lastInstructionTs,
        last_instruction_age_ms: lastInstructionAgeMs,
        long_gap_threshold_ms: 300000,
        browser_sessions_alive: browserSessions,
        update_available: updateAvailable,
        deviations_30m: deviations30m,
      }));
    } catch (_) {}
  }
  setInterval(writeTurnSummary, 5000);
  writeTurnSummary();

  const UPDATE_AVAILABLE_PATH = path.join(spoolDir, '.update-available.json');
  const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
  const UPDATE_CHECK_SHARED_CACHE = path.join(GM_TOOLS_ROOT, '.update-check-cache.json');
  const UPDATE_CHECK_CACHE_TTL_MS = 4 * 60 * 1000;
  let _lastKnownDrift = null;
  function readSharedUpdateCache() {
    try {
      const content = fs.readFileSync(UPDATE_CHECK_SHARED_CACHE, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed && parsed.ts && (Date.now() - parsed.ts) < UPDATE_CHECK_CACHE_TTL_MS) {
        return parsed;
      }
    } catch (_) {}
    return null;
  }
  function writeSharedUpdateCache(latest, status) {
    try {
      fs.mkdirSync(path.dirname(UPDATE_CHECK_SHARED_CACHE), { recursive: true });
      const tmp = UPDATE_CHECK_SHARED_CACHE + '.tmp.' + process.pid;
      fs.writeFileSync(tmp, JSON.stringify({ ts: Date.now(), latest, status, by_pid: process.pid }));
      fs.renameSync(tmp, UPDATE_CHECK_SHARED_CACHE);
    } catch (_) {}
  }
  const UPDATE_CHECK_ERROR_MARKER = path.join(GM_TOOLS_ROOT, '.update-check-error.json');
  let _lastKnownUpdateError = null;
  function readSharedUpdateErrorKey() {
    try {
      const raw = fs.readFileSync(UPDATE_CHECK_ERROR_MARKER, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.key === 'string' && Date.now() - (parsed.ts || 0) < 60 * 60 * 1000) {
        return parsed.key;
      }
    } catch (_) {}
    return null;
  }
  function writeSharedUpdateErrorKey(key) {
    try {
      const tmp = UPDATE_CHECK_ERROR_MARKER + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ ts: Date.now(), key, by_pid: process.pid }));
      fs.renameSync(tmp, UPDATE_CHECK_ERROR_MARKER);
    } catch (_) {}
  }
  function clearSharedUpdateErrorKey() {
    try { fs.unlinkSync(UPDATE_CHECK_ERROR_MARKER); } catch (_) {}
  }
  function normalizeUpdateErrorCategory(fields) {
    if (typeof fields.status === 'number') {
      if (fields.status === -1) return 'network';
      if (fields.status === -2) return 'network';
      if (fields.status < 0) return 'network';
      if (fields.status !== 200 && fields.status > 0) return `http-${fields.status}`;
    }
    const err = String(fields.error || '').toLowerCase();
    if (!err) return 'unknown';
    if (/timeout|timed out|etimedout/.test(err)) return 'network';
    if (/socket hang up|econnreset|econnrefused|enotfound|eai_again|enetunreach|ehostunreach|getaddrinfo/.test(err)) return 'network';
    if (/json|parse|unexpected/.test(err)) return 'parse';
    return 'other';
  }
  function logUpdateCheckError(fields) {
    const key = normalizeUpdateErrorCategory(fields);
    if (_lastKnownUpdateError === key) return;
    const shared = readSharedUpdateErrorKey();
    if (shared === key) {
      _lastKnownUpdateError = key;
      return;
    }
    _lastKnownUpdateError = key;
    writeSharedUpdateErrorKey(key);
    logEvent('plugkit', 'update.check.error', { ...fields, category: key });
  }
  function clearUpdateCheckError(installed) {
    const shared = readSharedUpdateErrorKey();
    if (_lastKnownUpdateError !== null || shared !== null) {
      const was = _lastKnownUpdateError || shared;
      logEvent('plugkit', 'update.check.recovered', { installed, was });
      _lastKnownUpdateError = null;
      clearSharedUpdateErrorKey();
    }
  }
  function applyUpdateCheckResult(installed, latest, statusCode) {
    if (statusCode !== 200) {
      logUpdateCheckError({ installed, status: statusCode });
      return;
    }
    if (!latest) return;
    clearUpdateCheckError(installed);
    if (latest === installed) {
      try { fs.unlinkSync(UPDATE_AVAILABLE_PATH); } catch (_) {}
      if (_lastKnownDrift) {
        logEvent('plugkit', 'update.cleared', { installed, was: _lastKnownDrift });
        _lastKnownDrift = null;
      }
      return;
    }
    const isDrift = latest !== installed;
    if (isDrift && _lastKnownDrift !== latest) {
      try {
        fs.writeFileSync(UPDATE_AVAILABLE_PATH, JSON.stringify({
          installed, latest, ts: Date.now(),
          update_url: `https://github.com/AnEntrypoint/plugkit-bin/releases/tag/v${latest}`,
        }));
      } catch (_) {}
      logEvent('plugkit', 'update.available', { installed, latest });
      _lastKnownDrift = latest;
    }
  }
  function checkUpdateViaNpm(installed) {
    const req = https.get({
      host: 'registry.npmjs.org',
      path: '/plugkit-wasm/latest',
      headers: { 'user-agent': 'plugkit-watcher', 'accept': 'application/json' },
      timeout: 5000,
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const meta = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          const latest = meta && meta.version;
          if (!latest) return;
          writeSharedUpdateCache(latest, 200);
          applyUpdateCheckResult(installed, latest, 200);
        } catch (_) {}
      });
    });
    req.on('timeout', () => { try { req.destroy(); } catch (_) {} });
    req.on('error', () => {});
  }

  function checkForUpdate() {
    const installed = resolveVersion(instance);
    const cached = readSharedUpdateCache();
    if (cached) {
      applyUpdateCheckResult(installed, cached.latest, cached.status || 200);
      return;
    }
    checkUpdateViaNpm(installed);
  }
  setTimeout(checkForUpdate, 10_000);
  setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);

  function periodicSkillMdRefresh() {
    try {
      const skillCandidates = [
        path.join(wrapperDir, 'SKILL.md'),
        path.join(wrapperDir, '..', 'gm-skill', 'skills', 'gm-skill', 'SKILL.md'),
        path.join(wrapperDir, '..', '..', 'gm-skill', 'skills', 'gm-skill', 'SKILL.md'),
        path.join(wrapperDir, '..', 'skills', 'gm-skill', 'SKILL.md'),
      ];
      const bundledPath = skillCandidates.find(p => { try { return fs.existsSync(p); } catch (_) { return false; } });
      if (!bundledPath) return;
      const bundled = fs.readFileSync(bundledPath, 'utf-8');
      const bundledHash = crypto.createHash('sha256').update(bundled).digest('hex');
      const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
      const targets = [
        path.join(home, '.agents', 'skills', 'gm-skill', 'SKILL.md'),
        path.join(home, '.claude', 'skills', 'gm-skill', 'SKILL.md'),
      ];
      const refreshed = [];
      for (const target of targets) {
        try {
          let needsWrite = true;
          if (fs.existsSync(target)) {
            const existingHash = crypto.createHash('sha256').update(fs.readFileSync(target, 'utf-8')).digest('hex');
            if (existingHash === bundledHash) needsWrite = false;
          }
          if (needsWrite) {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            const tmp = target + '.tmp';
            fs.writeFileSync(tmp, bundled);
            fs.renameSync(tmp, target);
            refreshed.push(target);
          }
        } catch (_) {}
      }
      if (refreshed.length > 0) {
        try { logEvent('plugkit', 'skill-md.refreshed-periodic', { hash: bundledHash.slice(0, 12), targets: refreshed.length, source: bundledPath }); } catch (_) {}
      }
    } catch (_) {}
  }
  setTimeout(periodicSkillMdRefresh, 12_000);
  setInterval(periodicSkillMdRefresh, UPDATE_CHECK_INTERVAL_MS);

  const pollInterval = setInterval(async () => {
    const existing = walkDir(inDir);
    if (existing.length > 0) markActivity('poll');
    for (const fullPath of existing) {
      await processFile(fullPath);
    }
  }, 5000);

  let _sweepErrLogged = false;
  setInterval(() => {
    try {
      if (!fs.existsSync(outDir)) {
        try {
          fs.mkdirSync(outDir, { recursive: true });
          fs.mkdirSync(inDir, { recursive: true });
          console.log(`[retention] recreated missing spool dirs: ${outDir}, ${inDir}`);
          logEvent('plugkit', 'spool.dirs-recreated', { outDir, inDir, reason: 'sweep-found-missing' });
          _sweepErrLogged = false;
          return;
        } catch (mke) {
          if (!_sweepErrLogged) {
            console.error(`[retention] cannot recreate ${outDir}: ${mke.message}`);
            logEvent('plugkit', 'spool.dirs-recreate-failed', { outDir, error: mke.message });
            _sweepErrLogged = true;
          }
          return;
        }
      }
      const cutoff = Date.now() - 3600_000;
      let swept = 0;
      for (const entry of fs.readdirSync(outDir)) {
        try {
          const fp = path.join(outDir, entry);
          const s = fs.statSync(fp);
          if (!s.isFile()) continue;
          if (s.mtimeMs < cutoff) { fs.unlinkSync(fp); swept++; }
        } catch (e) { console.error(`[retention] failed to sweep ${entry}: ${e.message}`); }
      }
      if (swept > 0) {
        console.log(`[retention] swept ${swept} out/ files older than 1h`);
        logEvent('plugkit', 'sweep.retention', { swept });
      }
      _sweepErrLogged = false;
    } catch (e) {
      if (!_sweepErrLogged) {
        console.error(`[retention] sweep error: ${e.message}`);
        logEvent('plugkit', 'sweep.retention.error', { error: String(e.message || e) });
        _sweepErrLogged = true;
      }
    }
  }, 60_000);

  setInterval(() => {
    try {
      const cutoff = Date.now() - 600_000;
      let stale = 0;
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (/\.tmp\.\d+(\.|$)/.test(entry.name)) continue;
          const fp = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(fp);
          else if (entry.isFile()) {
            let s;
            try { s = fs.statSync(fp); } catch (_) { continue; }
            if (s.mtimeMs < cutoff) {
              const rel = path.relative(inDir, fp);
              const verbDir = path.dirname(rel);
              const base = path.basename(fp, path.extname(fp));
              const outName = verbDir === '.' ? `${base}.json` : `${verbDir}-${base}.json`;
              try {
                fs.writeFileSync(path.join(outDir, outName), JSON.stringify({ ok: false, error: 'stale input -- never dispatched or watcher crash mid-flight' }));
              } catch (e) { console.error(`[stale-sweep] failed to write error for ${rel}: ${e.message}`); }
              try { fs.unlinkSync(fp); stale++; } catch (e) { console.error(`[stale-sweep] failed to unlink ${rel}: ${e.message}`); }
              console.error(`[stale-sweep] auto-failed ${rel} (age >${600}s)`);
            }
          }
        }
      };
      walk(inDir);
      if (stale > 0) {
        console.log(`[stale-sweep] failed ${stale} orphaned inputs`);
        logEvent('plugkit', 'sweep.stale', { stale });
      }
    } catch (e) {
      console.error(`[stale-sweep] sweep error: ${e.message}`);
      logEvent('plugkit', 'sweep.stale.error', { error: String(e.message || e) });
    }
  }, 300_000);

  const existing = walkDir(inDir);
  for (const fullPath of existing) {
    await processFile(fullPath);
  }

  let debounce = {};
  watch(inDir, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    if (/\.tmp\.\d+(\.|$)/.test(filename)) return;
    if (filename.split(/[\\/]/).some(seg => seg.startsWith('.'))) return;
    const fullPath = path.join(inDir, filename);
    markActivity('watch');

    clearTimeout(debounce[fullPath]);
    debounce[fullPath] = setTimeout(async () => {
      try {
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
          await processFile(fullPath);
        }
      } catch (_) {}
      delete debounce[fullPath];
    }, 50);
  });

  console.log('[plugkit-wasm] spool watcher running');
  await new Promise(() => {});
}

async function selfHealFromGithubReleases() {
  return new Promise((resolve, reject) => {
    const fetchJson = (url) => new Promise((res, rej) => {
      const req = https.get(url, { timeout: 5000, headers: { 'user-agent': 'plugkit-wasm-wrapper', 'accept': 'application/json' } }, (r) => {
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
          r.resume(); fetchJson(r.headers.location).then(res, rej); return;
        }
        if (r.statusCode !== 200) { r.resume(); rej(new Error(`HTTP ${r.statusCode} ${url}`)); return; }
        const chunks = []; r.on('data', c => chunks.push(c));
        r.on('end', () => { try { res(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); } catch (e) { rej(e); } });
        r.on('error', rej);
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', rej);
    });
    const fetchBuf = (url) => new Promise((res, rej) => {
      const req = https.get(url, { timeout: 30000, headers: { 'user-agent': 'plugkit-wasm-wrapper' } }, (r) => {
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
          r.resume(); fetchBuf(r.headers.location).then(res, rej); return;
        }
        if (r.statusCode !== 200) { r.resume(); rej(new Error(`HTTP ${r.statusCode} ${url}`)); return; }
        const chunks = []; r.on('data', c => chunks.push(c));
        r.on('end', () => res(Buffer.concat(chunks)));
        r.on('error', rej);
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', rej);
    });
    (async () => {
      try {
        const meta = await fetchJson('https://registry.npmjs.org/plugkit-wasm/latest');
        const version = meta && meta.version;
        if (!version) throw new Error('no version from npm plugkit-wasm');
        const base = `https://github.com/AnEntrypoint/plugkit-bin/releases/download/v${version}`;
        const [wasm, sha] = await Promise.all([
          fetchBuf(`${base}/plugkit.wasm`),
          fetchBuf(`${base}/plugkit.wasm.sha256`).then(b => b.toString('utf-8').trim().split(/\s+/)[0]).catch(() => ''),
        ]);
        if (sha) {
          const got = crypto.createHash('sha256').update(wasm).digest('hex');
          if (got !== sha) throw new Error(`sha mismatch: got ${got}, expected ${sha}`);
        }
        const toolsDir = GM_TOOLS_ROOT;
        fs.mkdirSync(toolsDir, { recursive: true });
        const wasmTarget = path.join(toolsDir, 'plugkit.wasm');
        const wasmTmp = `${wasmTarget}.partial-${process.pid}`;
        fs.writeFileSync(wasmTmp, wasm);
        try { fs.renameSync(wasmTmp, wasmTarget); }
        catch (renameErr) {
          if (renameErr.code === 'EEXIST' || renameErr.code === 'EPERM') {
            try { fs.unlinkSync(wasmTarget); } catch (_) {}
            fs.renameSync(wasmTmp, wasmTarget);
          } else {
            try { fs.unlinkSync(wasmTmp); } catch (_) {}
            throw renameErr;
          }
        }
        fs.writeFileSync(path.join(toolsDir, 'plugkit.version'), version);
        const wrapperSrc = __filename;
        const wrapperDst = path.join(toolsDir, 'plugkit-wasm-wrapper.js');
        if (path.resolve(wrapperSrc) !== path.resolve(wrapperDst) && fs.existsSync(wrapperSrc)) {
          try { fs.copyFileSync(wrapperSrc, wrapperDst); } catch (_) {}
        }
        resolve({ ok: true, version, sha });
      } catch (e) { reject(e); }
    })();
  });
}

async function selfHeal(reason) {
  console.error(`[plugkit-wasm] self-heal: ${reason}`);
  try {
    const r = await selfHealFromGithubReleases();
    console.error(`[plugkit-wasm] self-heal: installed v${r.version} from GH Releases`);
    return true;
  } catch (e) {
    console.error(`[plugkit-wasm] self-heal GH fetch failed: ${e.message}`);
  }
  console.error('[plugkit-wasm] self-heal: run `bun x gm-plugkit@latest spool` to recover manually');
  return false;
}

async function tryInstantiate(wasmPath) {
  const wasmBuffer = fs.readFileSync(wasmPath);
  const wasmModule = new WebAssembly.Module(wasmBuffer);
  const instanceRef = { value: null };
  const hostFunctions = makeHostFunctions(instanceRef);
  const importObject = {
    env: hostFunctions,
    wasi_snapshot_preview1: createWasiShim(instanceRef),
  };
  const instance = new WebAssembly.Instance(wasmModule, importObject);
  instanceRef.value = instance;
  return { instance, instanceRef };
}

let _sharedPlugkit = null;
export async function createPlugkit(opts = {}) {
  if (_sharedPlugkit && !opts.fresh) return _sharedPlugkit;
  const wasmPath = opts.wasmPath || path.join(GM_TOOLS_ROOT, 'plugkit.wasm');
  if (!fs.existsSync(wasmPath)) throw new Error(`plugkit wasm not installed at ${wasmPath} -- run: bun x gm-plugkit@latest spool`);
  let instance;
  try {
    ({ instance } = await tryInstantiate(wasmPath));
  } catch (e) {
    const healed = await selfHeal(`${e && e.name || 'instantiate'}: ${e && e.message}`);
    if (!healed) throw e;
    ({ instance } = await tryInstantiate(wasmPath));
  }
  const api = {
    dispatch(verb, body) {
      const raw = dispatchVerbToWasmInternal(instance, verb, typeof body === 'string' ? body : JSON.stringify(body || {}));
      if (raw == null) return null;
      try { return JSON.parse(raw); } catch (_) { return raw; }
    },
    version() { return resolveVersion(instance); },
    _instance: instance,
  };
  if (!opts.fresh) _sharedPlugkit = api;
  return api;
}

const _isCliEntry = (() => {
  try {
    if (!process.argv[1]) return false;
    return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
  } catch (_) { return false; }
})();

if (_isCliEntry) (async () => {
  try {
    const wasmPath = path.join(GM_TOOLS_ROOT, 'plugkit.wasm');

    let instance, instanceRef;
    if (!fs.existsSync(wasmPath)) {
      const healed = await selfHeal('wasm not installed');
      if (!healed) process.exit(1);
    }
    try {
      ({ instance, instanceRef } = await tryInstantiate(wasmPath));
    } catch (e) {
      const isLink = e && (e.name === 'LinkError' || /Import/i.test(e.message || ''));
      const isCompile = e && (e.name === 'CompileError' || /WebAssembly/i.test(e.message || ''));
      if (isLink || isCompile) {
        const healed = await selfHeal(`${e.name || 'instantiate'}: ${e.message}`);
        if (!healed) {
          console.error('[plugkit-wasm] wrapper/wasm version skew -- run: bun x gm-plugkit@latest spool');
          process.exit(1);
        }
        ({ instance, instanceRef } = await tryInstantiate(wasmPath));
      } else {
        throw e;
      }
    }

    const args = process.argv.slice(2);
    if (args.includes('--version')) {
      console.log(`plugkit v${resolveVersion(instance)} (wasm)`);
      process.exit(0);
    }

    if (args[0] === 'bootstrap' || args.includes('--ensure-latest')) {
      try {
        const bootstrapPath = path.join(__dirname, 'bootstrap.js');
        if (fs.existsSync(bootstrapPath)) {
          const bootstrap = await import('file://' + bootstrapPath.replace(/\\/g, '/'));
          if (bootstrap && typeof bootstrap.ensureReady === 'function') {
            const r = await bootstrap.ensureReady({ forceLatest: true });
            console.log(JSON.stringify(r || { ok: true }));
            process.exit(0);
          }
        }
        console.error('bootstrap.js not callable');
        process.exit(1);
      } catch (e) {
        console.error('bootstrap error:', e.message);
        process.exit(1);
      }
    }

    if (args[0] === 'spool') {
      const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
      const spoolDir = path.join(projectDir, '.gm', 'exec-spool');
      await runSpoolWatcher(instance, spoolDir);
    } else if (args[0] === 'dispatch') {
      const verb = args[1] || '';
      const body = args.length >= 3 ? args[2] : '';
      const dispatch = instance.exports.dispatch_verb;
      const verbBytes = new TextEncoder().encode(verb);
      const bodyBytes = new TextEncoder().encode(body);
      const verbPtr = instance.exports.plugkit_alloc(verbBytes.length);
      const bodyPtr = instance.exports.plugkit_alloc(bodyBytes.length);
      new Uint8Array(instance.exports.memory.buffer, verbPtr, verbBytes.length).set(verbBytes);
      new Uint8Array(instance.exports.memory.buffer, bodyPtr, bodyBytes.length).set(bodyBytes);
      const result = dispatch(verbPtr, verbBytes.length, bodyPtr, bodyBytes.length);
      const ptr = Number(result & 0xffffffffn);
      const len = Number(result >> 32n);
      const out = new TextDecoder().decode(new Uint8Array(instance.exports.memory.buffer, ptr, len));
      process.stdout.write(out);
      let parsed;
      try { parsed = JSON.parse(out); } catch (_) { parsed = null; }
      const failed = parsed && parsed.ok === false;
      process.exit(failed ? 2 : 0);
    } else {
      console.log('[plugkit-wasm] args:', args.join(' '));
      process.exit(0);
    }
  } catch (e) {
    console.error('[plugkit-wasm] fatal:', e.message);
    if (process.env.DEBUG) console.error(e.stack);
    process.exit(1);
  }
})();
