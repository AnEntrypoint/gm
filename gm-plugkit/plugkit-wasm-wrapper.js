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
import _gmLog from './gm-log.js';
const _sharedLogEvent = _gmLog.logEvent;
const _sharedGmLogRoot = _gmLog.GM_LOG_ROOT;
import _gmProcess from './gm-process.js';
const _sharedPidCommandLine = _gmProcess.pidCommandLineForKillGuard;

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

const GM_LOG_ROOT = _sharedGmLogRoot;
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

function pidCommandLineForKillGuard(pid) {
  return _sharedPidCommandLine(pid);
}

function pidIsPlugkitProcess(pid) {
  return /plugkit-wasm-wrapper\.js|plugkit-supervisor\.js|gm-plugkit[\\\/]supervisor\.js/i.test(pidCommandLineForKillGuard(pid));
}

function pidIsManagedChromium(pid) {
  const cmd = pidCommandLineForKillGuard(pid).toLowerCase().replace(/\\/g, '/');
  return cmd.includes('browser-profile') && cmd.includes('--remote-debugging-port');
}

function writeKillAttribution(targetSpoolDir, info) {
  try {
    fs.mkdirSync(targetSpoolDir, { recursive: true });
    fs.writeFileSync(path.join(targetSpoolDir, '.kill-attribution.json'), JSON.stringify({ killer_pid: process.pid, killer_cwd: process.cwd(), killer_script: 'plugkit-wasm-wrapper', ts: Date.now(), ...info }, null, 2));
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
  try { killAllTasks('crash:uncaughtException'); } catch (_) {}
  emitShutdownReason('uncaughtException', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  try { console.error('[plugkit-wasm] unhandled rejection:', reason && reason.stack || reason); } catch (_) {}
  try { killAllTasks('crash:unhandledRejection'); } catch (_) {}
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
  let verbPtr = 0, bodyPtr = 0;
  try { verbPtr = writeWasmInput(instance, verbBytes, `dispatch_verb(${verb}).verb`); }
  catch (e) { throw new Error(`wasm-alloc-failed for dispatch_verb(${verb}): ${e.message}`); }
  try { bodyPtr = writeWasmInput(instance, bodyBytes, `dispatch_verb(${verb}).body`); }
  catch (e) { try { if (verbPtr) instance.exports.plugkit_free(verbPtr, verbBytes.length); } catch (_) {}
    throw new Error(`wasm-alloc-failed for dispatch_verb(${verb}): ${e.message}`); }
  try {
    const result = dispatch(verbPtr, verbBytes.length, bodyPtr, bodyBytes.length);
    return decodeWasmResult(instance, result, `dispatch_verb(${verb})`);   // normalized i64 + fresh buffer
  } finally {
    try { if (verbPtr) instance.exports.plugkit_free(verbPtr, verbBytes.length); } catch (_) {}
    try { if (bodyPtr) instance.exports.plugkit_free(bodyPtr, bodyBytes.length); } catch (_) {}
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
    upd = JSON.parse(fs.readFileSync(path.join(spoolDirForSentinel(), '.update-available.json'), 'utf-8'));
  } catch (_) { return; }
  if (!upd || !upd.installed || !upd.latest || upd.installed === upd.latest) return;
  const target = (parsed.data && typeof parsed.data === 'object') ? parsed.data : parsed;
  target.update_available = { installed: upd.installed, latest: upd.latest, update_url: upd.update_url || null };
  target.update_warning = `STALE RUNTIME: running plugkit ${upd.installed} but ${upd.latest} is published. FIRST ACTION THIS TURN, before any other work: dispatch bun x gm-plugkit@latest spool (idempotent, safe even if already serving) to force the update through now. Add --kill-stale-watchers only if it stays stuck across several turns after forcing. Set PLUGKIT_NO_AUTO_UPDATE=1 to pin. This warning repeats until the running version catches up.`;
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
  _sharedLogEvent(sub, event, fields, { sess: readCurrentSess() });
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

const __browserRootCache = new Map();
const BROWSER_ROOT_CACHE_TTL_MS = 60_000;
function browserRootDir(cwd) {
  const start = path.resolve(cwd || process.cwd());
  const cached = __browserRootCache.get(start);
  if (cached && Date.now() - cached.ts < BROWSER_ROOT_CACHE_TTL_MS) return cached.root;
  let root = start;
  try {
    const r = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: start, encoding: 'utf-8', windowsHide: true, timeout: 1500 });
    if (r.status === 0 && r.stdout && r.stdout.trim()) {
      let commonDir = r.stdout.trim();
      if (!path.isAbsolute(commonDir)) commonDir = path.resolve(start, commonDir);
      if (/(^|[\\/])\.git$/.test(commonDir)) root = path.dirname(commonDir);
    }
  } catch (_) {}
  root = path.resolve(root);
  __browserRootCache.set(start, { root, ts: Date.now() });
  return root;
}

function browserStateDir(cwd) {
  const dir = path.join(browserRootDir(cwd), '.gm', 'browser-state');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return dir;
}
function browserStateDirLegacyCoLocated(cwd) {
  return path.join(browserRootDir(cwd), '.gm', 'exec-spool');
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

function atomicWriteRaw(filePath, data) {
  const tmp = filePath + '.tmp.' + process.pid + '.' + Date.now() + '.' + Math.random().toString(36).slice(2, 8);
  fs.writeFileSync(tmp, data);
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw err;
  }
}

function atomicWriteJson(filePath, obj) {
  atomicWriteRaw(filePath, JSON.stringify(obj, null, 2));
}

function migrateLegacyBrowserState(cwd) {
  const dst1 = browserPortsFile(cwd);
  const dst2 = browserSessionsFile(cwd);
  const coLocated = browserStateDirLegacyCoLocated(cwd);
  const coLocatedPorts = path.join(coLocated, 'browser-ports.json');
  const coLocatedSessions = path.join(coLocated, 'browser-sessions.json');
  try {
    if (!fs.existsSync(dst1) && fs.existsSync(coLocatedPorts)) {
      const legacy = JSON.parse(fs.readFileSync(coLocatedPorts, 'utf-8'));
      if (legacy && typeof legacy === 'object') atomicWriteJson(dst1, legacy);
    } else if (!fs.existsSync(dst1) && fs.existsSync(LEGACY_BROWSER_PORTS_FILE)) {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_BROWSER_PORTS_FILE, 'utf-8'));
      if (legacy && typeof legacy === 'object') atomicWriteJson(dst1, legacy);
    }
  } catch (_) {}
  try {
    if (!fs.existsSync(dst2) && fs.existsSync(coLocatedSessions)) {
      const legacy = JSON.parse(fs.readFileSync(coLocatedSessions, 'utf-8'));
      if (legacy && typeof legacy === 'object') atomicWriteJson(dst2, legacy);
    } else if (!fs.existsSync(dst2) && fs.existsSync(LEGACY_BROWSER_SESSIONS_FILE)) {
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

const AGGREGATE_CPU_PROFILE_SRC = `function aggregateCpuProfile(profile, topN, isBrowserCtx) {
  const N = topN || 20;
  if (!profile || !Array.isArray(profile.nodes) || !Array.isArray(profile.samples)) {
    return { timeframe: null, culprits: [] };
  }
  const byId = new Map();
  for (const node of profile.nodes) byId.set(node.id, node);
  const deltas = Array.isArray(profile.timeDeltas) ? profile.timeDeltas : [];
  const acc = new Map();
  let total = 0;
  const sampleCount = profile.samples.length;
  for (let i = 0; i < profile.samples.length; i++) {
    const node = byId.get(profile.samples[i]);
    const dt = deltas[i] || 0;
    total += dt;
    if (!node) continue;
    const cf = node.callFrame || {};
    let url = cf.url || '';
    if (!url) url = cf.functionName ? '(native)' : '(program)';
    const line = (typeof cf.lineNumber === 'number' && cf.lineNumber >= 0) ? cf.lineNumber + 1 : 0;
    const loc = url + ':' + line;
    let e = acc.get(loc);
    if (!e) { e = { location: loc, function: cf.functionName || '(anonymous)', self_us: 0, hits: 0 }; acc.set(loc, e); }
    e.self_us += dt;
    e.hits += 1;
  }
  const culprits = Array.from(acc.values())
    .sort((a, b) => b.self_us - a.self_us)
    .slice(0, N)
    .map(c => ({ location: c.location, function: c.function, self_us: c.self_us, self_pct: total ? Math.round((c.self_us / total) * 1000) / 10 : 0, hits: c.hits }));
  // gpu_hint: when the TOP culprit is the unattributed '(program)'/'(native)' bucket at a dominant
  // share of total self-time, the CPU sampler is telling you it is BLIND here -- that time is real
  // wall-clock cost the JS/V8 sampler cannot see into (GPU driver submission, shader execution,
  // compositor/raster work), not "nothing is happening". Proactively naming the follow-up (the
  // browser verb's own 'trace\\n<script>' CDP-tracing prefix, which returns real gpu_us/viz_us/cc_us
  // wall-clock GPU-process activity) saves a full extra dispatch+re-read round trip every time a
  // caller has to rediscover this on their own -- a real, repeated cost hit debugging a live FPS
  // regression where the top culprit was '(program)' at 84% self-time with nothing further to go on
  // until a SEPARATE trace-mode dispatch was manually reasoned into existence.
  const topC = culprits[0];
  const gpu_hint = (topC && (topC.location === '(native):0' || topC.location === '(program):0') && topC.self_pct >= 40)
    ? (isBrowserCtx
        ? \`Top culprit is the unattributed \${topC.function === '(program)' ? '(program)' : '(native)'} bucket at \${topC.self_pct}% self-time -- the CPU sampler cannot see GPU-side work (driver submission, shader execution, compositor/raster). Re-run this dispatch with the 'trace\\n<script>' prefix instead of 'profile' to get real gpu_us/viz_us/cc_us wall-clock GPU-process activity via CDP Tracing.\`
        : \`Top culprit is the unattributed \${topC.function === '(program)' ? '(program)' : '(native)'} bucket at \${topC.self_pct}% self-time -- the CPU sampler cannot see into native/C++ addon calls, syscalls, or (on the node exec_js surface) any work happening off the main JS thread. No GPU-tracing follow-up applies here (that is browser-only); consider opts.mem:true or narrowing the profiled span if this bucket needs further attribution.\`)
    : null;
  return {
    timeframe: {
      start_us: typeof profile.startTime === 'number' ? profile.startTime : 0,
      end_us: typeof profile.endTime === 'number' ? profile.endTime : 0,
      total_us: total,
      sample_count: sampleCount,
    },
    culprits,
    gpu_hint,
  };
}`;

let execProfileSeq = 0;
function sweepStaleProfileTmp() {
  try {
    const dir = os.tmpdir();
    const cutoff = Date.now() - 3600000;
    for (const name of fs.readdirSync(dir)) {
      if (!/^gm-prof-\d+-\d+\.js$/.test(name)) continue;
      const fp = path.join(dir, name);
      try { if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp); } catch (_) {}
    }
  } catch (_) {}
}
try { sweepStaleProfileTmp(); } catch (_) {}
let _aggregateCpuProfileFn = null;
function aggregateCpuProfile(profile, topN, isBrowserCtx) {
  if (!_aggregateCpuProfileFn) {
    _aggregateCpuProfileFn = new Function(AGGREGATE_CPU_PROFILE_SRC + '\nreturn aggregateCpuProfile;')();
  }
  return _aggregateCpuProfileFn(profile, topN, isBrowserCtx);
}

const BROWSER_RUNNER_BIN = process.env.GM_BROWSER_RUNNER_BIN || 'playwriter';

function findCachedBunRunnerBin() {
  try {
    const cacheDir = path.join(os.homedir(), '.bun', 'install', 'cache');
    const entries = fs.readdirSync(cacheDir).filter(n => n.startsWith(`${BROWSER_RUNNER_BIN}@`));
    for (const name of entries) {
      const binJs = path.join(cacheDir, name, 'bin.js');
      if (fs.existsSync(binJs)) return binJs;
    }
  } catch (_) {}
  return null;
}

// Cache dir entries are named `<pkg>@<version>[@@@N]` (the `@@@N` suffix is bun's own
// disambiguator for multiple cache slots of the same resolved version, not part of the semver).
// Picks the highest semver-looking version present so a stale older cache entry left over from
// a prior gm-plugkit run doesn't win over a newer one that's also cached.
function findCachedBunRunnerVersion() {
  try {
    const cacheDir = path.join(os.homedir(), '.bun', 'install', 'cache');
    const entries = fs.readdirSync(cacheDir).filter(n => n.startsWith(`${BROWSER_RUNNER_BIN}@`));
    const versions = entries
      .map(n => n.slice(BROWSER_RUNNER_BIN.length + 1).split('@@@')[0])
      .filter(v => /^\d+\.\d+\.\d+/.test(v));
    if (!versions.length) return null;
    versions.sort((a, b) => {
      const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
      for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pb[i] - pa[i]; }
      return 0;
    });
    return versions[0];
  } catch (_) {
    return null;
  }
}

// playwriter's CLI `--timeout` option is parsed as a raw string (its own arg parser does not
// coerce it despite the zod schema declaring z.number()), and that string is forwarded verbatim
// into `vm.runInContext(..., { timeout })`, which throws
// `TypeError: The "options.timeout" property must be of type number` -- every managed browser
// session then fails, and each spawn's relay/Chromium never gets torn down (an "orphan-chrome
// pileup"). Idempotently patch it in whatever playwriter dist copy we're about to invoke.
const _patchedPlaywriterDistDirs = new Set();
function patchPlaywriterTimeoutBug(binJs) {
  try {
    const pkgDir = path.dirname(binJs);
    if (_patchedPlaywriterDistDirs.has(pkgDir)) return;
    _patchedPlaywriterDistDirs.add(pkgDir);
    // executor.js/cli.js live under <pkg-dir>/dist/ in the real published package layout, not
    // directly alongside bin.js -- the prior version of this function joined path.dirname(binJs)
    // straight onto 'executor.js'/'cli.js', which never matched any real file (fs.existsSync was
    // always false), so the timeout-coercion patch silently never applied and every managed
    // browser session with an explicit timeout= prefix threw
    // `TypeError [ERR_INVALID_ARG_TYPE]: The "options.timeout" property must be of type number`.
    // Check both the dist/ subfolder (the real layout) and the flat pkg-dir (defensive fallback
    // for a differently-laid-out future version) so this keeps working either way.
    const candidateDirs = [path.join(pkgDir, 'dist'), pkgDir];
    for (const distDir of candidateDirs) {
      const executorPath = path.join(distDir, 'executor.js');
      if (fs.existsSync(executorPath)) {
        const src = fs.readFileSync(executorPath, 'utf-8');
        if (/async execute\(code, timeout = 10000\) \{(?!\s*timeout = Number)/.test(src)) {
          const patched = src.replace(
            /(async execute\(code, timeout = 10000\) \{)/,
            '$1\n        timeout = Number(timeout) || 10000;'
          );
          fs.writeFileSync(executorPath, patched);
        }
      }
      const cliPath = path.join(distDir, 'cli.js');
      if (fs.existsSync(cliPath)) {
        const src = fs.readFileSync(cliPath, 'utf-8');
        if (src.includes('timeout: options.timeout || 10000') && !src.includes('timeout: Number(options.timeout)')) {
          const patched = src.replace(
            'timeout: options.timeout || 10000',
            'timeout: Number(options.timeout) || 10000'
          );
          fs.writeFileSync(cliPath, patched);
        }
      }
    }
  } catch (_) {}
}

function patchAllCachedPlaywriterCopies() {
  try {
    const cacheDir = path.join(os.homedir(), '.bun', 'install', 'cache');
    const entries = fs.readdirSync(cacheDir).filter(n => n.startsWith(`${BROWSER_RUNNER_BIN}@`));
    for (const name of entries) {
      const binJs = path.join(cacheDir, name, 'bin.js');
      if (fs.existsSync(binJs)) patchPlaywriterTimeoutBug(binJs);
    }
  } catch (_) {}
}

function findBrowserRunner() {
  // bun's global-install node_modules root has real dependency resolution (npm-style
  // node_modules tree), so a bin.js found there is safe to invoke directly.
  const bunGlobalRoots = [
    path.join(os.homedir(), '.bun', 'install', 'global', 'node_modules', BROWSER_RUNNER_BIN, 'bin.js'),
  ];
  for (const binJs of bunGlobalRoots) {
    if (fs.existsSync(binJs)) { patchPlaywriterTimeoutBug(binJs); return { cmd: process.execPath, baseArgs: [binJs], shell: false }; }
  }
  // `~/.bun/install/cache/<pkg>@version` is bun's *content-addressed package cache*, not an
  // installed tree -- it has no node_modules of its own, so invoking its bin.js directly with
  // plain node/bun fails to resolve the package's own dependencies (e.g. "Cannot find package
  // 'hono'"). Only `bun x` (or an npm-global install) sets up real dependency resolution, so
  // prefer that over the cached bin.js. `bun x` still ultimately runs the same content-addressed
  // cache copy (symlinked node_modules alongside it), so patch every cached copy proactively --
  // there is no separate resolved-tree location to target for the `bun x` path specifically.
  patchAllCachedPlaywriterCopies();
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  const bunR = spawnSync(whichCmd, ['bun'], { encoding: 'utf-8', shell: true });
  if (bunR.status === 0 && bunR.stdout.trim()) {
    // `bun x <pkg>@latest` re-resolves the `@latest` tag against the npm registry on every
    // single invocation, even when a resolved copy already sits in bun's own content-addressed
    // cache (~/.bun/install/cache/<pkg>@<version>) from a prior run -- a redundant network
    // round-trip per browser-verb dispatch. Observed on Windows to occasionally never return
    // (hangs past "Resolved, downloaded and extracted" with no further output or error), which
    // wedges every subsequent browser dispatch behind a 30s+ spawnSync timeout for no benefit,
    // since the pinned exact version was already available locally. Prefer `bun x <pkg>@<exact
    // cached version>` when a cached copy exists -- this still goes through `bun x`'s real
    // dependency-tree resolution (the reason `bun x` is preferred over the raw cached bin.js
    // above), it just skips the registry round-trip for the tag lookup itself.
    const cachedVersion = findCachedBunRunnerVersion();
    const pkgSpec = cachedVersion ? `${BROWSER_RUNNER_BIN}@${cachedVersion}` : `${BROWSER_RUNNER_BIN}@latest`;
    // bun is a real native binary (resolved to its actual path via `where`/`which` just above), so
    // it can be spawned directly without an intermediate shell. shell:true here was forcing every
    // browser-verb -e script argument through cmd.exe's argv parsing on Windows, which treats an
    // unescaped `&` (extremely common in real target URLs, e.g. `?singleplayer&world=...` query
    // strings) as a command separator EVEN INSIDE A QUOTED ARGUMENT -- silently truncating the
    // script/URL mid-string, corrupting the executed code (observed live: "await page.goto(\"http:
    // //host/path?a" with everything from the `&` onward missing, then a bogus second "command"
    // from the leftover text failing with "'world' is not recognized..."). Passing the resolved
    // absolute exe path with shell:false hands the args array to the OS process-create call
    // directly, with zero shell metacharacter interpretation -- verified safe for arbitrary argv
    // content (long strings containing `&`, quotes, newlines) via direct spawnSync reproduction.
    const bunPath = bunR.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0];
    return { cmd: bunPath || 'bun', baseArgs: ['x', pkgSpec], shell: false };
  }
  const cachedBin = findCachedBunRunnerBin();
  if (cachedBin) return { cmd: process.execPath, baseArgs: [cachedBin], shell: false };
  const r = spawnSync(whichCmd, [BROWSER_RUNNER_BIN], { encoding: 'utf-8', shell: true });
  if (r.status === 0 && r.stdout.trim()) {
    const candidates = r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const cmd = candidates.find(c => c.toLowerCase().endsWith('.cmd')) || candidates.find(c => !c.toLowerCase().endsWith('.ps1')) || candidates[0];
    // A resolved .exe candidate is a real binary and can run shell:false (same reasoning as the bun
    // case above). Only a genuine .cmd/.bat wrapper needs shell:true on Windows -- cmd.exe is the
    // only thing that can directly execute a .cmd file -- so scope the shell path to that case.
    if (cmd) return { cmd, baseArgs: [], shell: process.platform === 'win32' && cmd.toLowerCase().endsWith('.cmd') };
  }
  const npxR = spawnSync(whichCmd, ['npx'], { encoding: 'utf-8', shell: true });
  if (npxR.status === 0 && npxR.stdout.trim()) {
    // npx resolves to npx.cmd on Windows, which genuinely requires shell:true to execute (see
    // above). Non-Windows npx is a real executable/shebang script and needs no shell.
    return { cmd: 'npx', baseArgs: ['-y', BROWSER_RUNNER_BIN], shell: process.platform === 'win32' };
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
  return 'default';
}

function sessionProfileDir(cwd, claudeSessionId) {
  return path.join(browserRootDir(cwd), '.gm', `browser-profile-${sessionProfileSlug(claudeSessionId)}`);
}

function acquireProfileDir(cwd, claudeSessionId) {
  const root = browserRootDir(cwd);
  const gmDir = path.join(root, '.gm');
  try { fs.mkdirSync(gmDir, { recursive: true }); } catch (_) {}
  ensureGitignored(root, '.gm/browser-profile/');
  ensureGitignored(root, '.gm/browser-profile-*/');
  const primary = sessionProfileDir(cwd, claudeSessionId);
  try { fs.mkdirSync(primary, { recursive: true }); } catch (_) {}
  if (!isProfileLocked(primary)) return primary;
  const fallback = path.join(gmDir, `browser-profile-${sessionProfileSlug(claudeSessionId)}-${process.pid}`);
  try { fs.mkdirSync(fallback, { recursive: true }); } catch (_) {}
  return fallback;
}

function cleanDeadProfileFragments(cwd) {
  try {
    const gmDir = path.join(browserRootDir(cwd), '.gm');
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
      if (name === 'browser-profile-default') continue;
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

const __openedSessionIds = new Set();
const __idleClosedSessions = new Set();
const __inflightDispatch = new Map();
const __launchingPids = new Map();
const INFLIGHT_MAX_MS = 130000;
const LAUNCH_GRACE_MS = 30000;
function markInflight(sessionId, pid) {
  __inflightDispatch.set(sessionId, { pid: pid || null, ts: Date.now() });
}
function clearInflight(sessionId) {
  __inflightDispatch.delete(sessionId);
}
function inflightPids() {
  const now = Date.now();
  const pids = new Set();
  const sids = new Set();
  for (const [sid, v] of __inflightDispatch) {
    if (now - v.ts > INFLIGHT_MAX_MS) { __inflightDispatch.delete(sid); continue; }
    sids.add(sid);
    if (Number.isFinite(v.pid)) pids.add(v.pid);
  }
  return { pids, sids };
}
function markLaunching(pid) { if (Number.isFinite(pid)) __launchingPids.set(pid, Date.now()); }
function clearLaunching(pid) { __launchingPids.delete(pid); }
function launchingPidsFresh() {
  const now = Date.now();
  const pids = new Set();
  for (const [pid, ts] of __launchingPids) {
    if (now - ts > LAUNCH_GRACE_MS) { __launchingPids.delete(pid); continue; }
    pids.add(pid);
  }
  return pids;
}
function enumerateManagedChromiums(profileRootMarker) {
  const marker = String(profileRootMarker || '').toLowerCase().replace(/\\/g, '/');
  const out = [];
  try {
    if (process.platform === 'win32') {
      const ps = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*--remote-debugging-port*' -and $_.CommandLine -like '*browser-profile*' -and $_.CommandLine -notlike '*--type=*' } | ForEach-Object { $_.ProcessId.ToString() + '|' + $_.CommandLine }`;
      const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf-8', windowsHide: true, timeout: 10000 });
      if (r.status === 0 && r.stdout) {
        for (const line of r.stdout.split(/\r?\n/).filter(Boolean)) {
          const bar = line.indexOf('|');
          if (bar < 0) continue;
          const pid = parseInt(line.slice(0, bar), 10);
          const cmd = line.slice(bar + 1);
          if (/--type=/.test(cmd)) continue;
          if (Number.isFinite(pid) && cmd.toLowerCase().replace(/\\/g, '/').includes(marker)) out.push({ pid, cmd });
        }
      }
    } else {
      const r = spawnSync('ps', ['-eo', 'pid,command'], { encoding: 'utf-8', timeout: 10000 });
      if (r.status === 0 && r.stdout) {
        for (const line of r.stdout.split('\n').slice(1)) {
          if (!/--remote-debugging-port/.test(line) || !/browser-profile/.test(line)) continue;
          if (/--type=/.test(line)) continue;
          const m = line.match(/^\s*(\d+)\s+(.+)$/);
          if (!m) continue;
          const pid = parseInt(m[1], 10);
          if (Number.isFinite(pid) && m[2].toLowerCase().replace(/\\/g, '/').includes(marker)) out.push({ pid, cmd: m[2] });
        }
      }
    }
  } catch (_) {}
  return out;
}
function reapOrphanChromiums(cwd, reason) {
  try {
    const root = browserRootDir(cwd);
    const marker = path.join(root, '.gm', 'browser-profile').toLowerCase().replace(/\\/g, '/');
    const procs = enumerateManagedChromiums(marker);
    if (procs.length === 0) return { reaped: 0 };
    const ports = readJsonFile(browserPortsFile(cwd), {});
    const livePids = new Set();
    for (const ent of Object.values(ports)) {
      if (ent && Number.isFinite(ent.pid) && isProcessAliveSync(ent.pid)) livePids.add(ent.pid);
    }
    const { pids: protectedInflight } = inflightPids();
    const launching = launchingPidsFresh();
    let reaped = 0;
    for (const { pid } of procs) {
      if (livePids.has(pid) || protectedInflight.has(pid) || launching.has(pid)) continue;
      try { killPidQuiet(pid); reaped++; logEvent('plugkit', 'browser.os-orphan-reaped', { pid, reason: reason || 'sweep' }); } catch (_) {}
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

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ms | 0));
}

function playwriterHomeFor(cwd, claudeSessionId) {
  if (process.env.PLAYWRITER_HOME) return process.env.PLAYWRITER_HOME;
  if (!cwd) return path.join(GM_TOOLS_ROOT, `pw-sock-${sessionProfileSlug(claudeSessionId)}`);
  try { ensureGitignored(cwd, '.gm/pw-sock-*/'); } catch (_) {}
  return path.join(cwd, '.gm', `pw-sock-${sessionProfileSlug(claudeSessionId)}`);
}

// cmd.exe (the shell Node's spawnSync{shell:true} uses on Windows for a .cmd/.bat target) treats
// &|<>^ as command-line metacharacters EVEN INSIDE a double-quoted argument -- double-quoting alone
// (the prior logic here) stops whitespace-splitting but does not stop cmd.exe from splitting
// `foo&bar` into two separate commands. Real script/URL arguments passed through the browser verb
// routinely contain `&` (e.g. `?a=1&b=2` query strings), which was being silently truncated
// mid-argument on any shell:true path. Escaping each metacharacter with a caret (^) inside the
// quoted string is the standard cmd.exe-safe encoding; this is the remaining defense for the
// npx.cmd/.cmd-wrapper fallback paths that genuinely require shell:true (the bun path above no
// longer needs this at all, since it now spawns the resolved .exe directly with shell:false).
function cmdExeQuote(s) {
  const str = String(s);
  const escaped = str.replace(/"/g, '\\"').replace(/[&|<>^]/g, '^$&');
  return `"${escaped}"`;
}

function runBrowserRunner(pw, args, timeoutMs, cwd, claudeSessionId) {
  const allArgs = [...pw.baseArgs, ...args];
  const useShell = !!pw.shell;
  const spawnCmd = useShell && /\s/.test(pw.cmd) ? `"${pw.cmd}"` : pw.cmd;
  const spawnArgs = useShell
    ? (process.platform === 'win32'
        ? allArgs.map(a => cmdExeQuote(a))
        : allArgs.map(a => /[\s"]/.test(String(a)) ? `"${String(a).replace(/"/g, '\\"')}"` : a))
    : allArgs;
  const env = { ...process.env };
  const sockDir = playwriterHomeFor(cwd, claudeSessionId);
  try { fs.mkdirSync(sockDir, { recursive: true }); } catch (_) {}
  env.PLAYWRITER_HOME = sockDir;
  _writeStatusBusy((timeoutMs || 120000) + 5000);
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

function fetchJsonSyncRetry(url, timeoutMs, attempts) {
  const n = attempts || 3;
  for (let i = 0; i < n; i++) {
    const r = fetchJsonSync(url, timeoutMs);
    if (r) return r;
    if (i < n - 1) sleepSyncMs(150);
  }
  return null;
}

function closeExtraBlankTabs(port, keepWsEndpoint) {
  try {
    const targets = fetchJsonSync(`http://127.0.0.1:${port}/json/list`, 1500);
    if (!Array.isArray(targets)) return { closed: 0 };
    const pages = targets.filter(t => t && t.type === 'page');
    const blank = pages.filter(t => t.url === 'about:blank' || t.url === '');
    const nonBlankCount = pages.length - blank.length;
    const keepCount = nonBlankCount > 0 ? 0 : 1;
    const toClose = blank.slice(0, Math.max(0, blank.length - keepCount));
    let closed = 0;
    for (const t of toClose) {
      if (t.webSocketDebuggerUrl === keepWsEndpoint) continue;
      const r = spawnSync(process.execPath, ['-e', `
        const http = require('http');
        const req = http.get(${JSON.stringify(`http://127.0.0.1:${port}/json/close/${t.id}`)}, res => { res.resume(); res.on('end', () => process.exit(0)); });
        req.on('error', () => process.exit(1));
        req.setTimeout(1500, () => { req.destroy(); process.exit(1); });
      `], { timeout: 3000, windowsHide: true });
      if (r.status === 0) closed++;
    }
    return { closed };
  } catch (_) {
    return { closed: 0 };
  }
}

function chromeLogHasSandboxDenied(chromeLogPath) {
  try {
    return /Sandbox cannot access executable/.test(fs.readFileSync(chromeLogPath, 'utf-8'));
  } catch (_) {
    return false;
  }
}

function spawnChromiumOnce(browserBin, profileDir, port, headless, noSandbox, cwd) {
  const args = [
    '--user-data-dir=' + profileDir,
    '--remote-debugging-port=' + port,
    '--remote-debugging-address=127.0.0.1',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-default-apps',
    '--disable-gpu-process-crash-limit',
  ];
  if (noSandbox) {
    args.push('--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage');
  }
  if (headless) {
    args.push('--headless=new');
  } else {
    args.push(resolveBrowserStartUrl(cwd));
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
  child.unref();
  return { pid: child.pid, chromeLogPath };
}

const BROWSER_AUTODETECT_PORTS = [3000, 5173, 8080, 4200, 5000, 8000];

function probeLocalHttpPort(port, timeoutMs) {
  const r = spawnSync(process.execPath, ['-e', `
    const http = require('http');
    const req = http.request({ host: '127.0.0.1', port: ${port}, path: '/', method: 'HEAD', timeout: ${timeoutMs || 400} }, (res) => {
      res.resume();
      process.exit(0);
    });
    req.on('error', () => process.exit(1));
    req.on('timeout', () => { req.destroy(); process.exit(1); });
    req.end();
  `], { timeout: (timeoutMs || 400) + 300, windowsHide: true });
  return r.status === 0;
}

function autodetectLocalDevServerUrl() {
  for (const port of BROWSER_AUTODETECT_PORTS) {
    if (probeLocalHttpPort(port, 400)) return `http://127.0.0.1:${port}/`;
  }
  return null;
}

function resolveBrowserStartUrl(cwd) {
  if (process.env.GM_BROWSER_START_URL) return process.env.GM_BROWSER_START_URL;
  try {
    const root = cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const cfgPath = path.join(root, '.gm', 'browser-target-url');
    const url = fs.readFileSync(cfgPath, 'utf-8').trim();
    if (url) return url;
  } catch (_) {}
  const detected = autodetectLocalDevServerUrl();
  if (detected) {
    try { logEvent('plugkit', 'browser.start-url-autodetected', { url: detected }); } catch (_) {}
    return detected;
  }
  try { logEvent('plugkit', 'browser.start-url-fallback-blank', { reason: 'no GM_BROWSER_START_URL, no .gm/browser-target-url, no local dev server detected on common ports' }); } catch (_) {}
  return 'about:blank';
}

function waitForCdpReady(port, deadlineMs) {
  const start = Date.now();
  const deadline = start + deadlineMs;
  while (Date.now() < deadline) {
    const info = fetchJsonSync(`http://127.0.0.1:${port}/json/version`, 1500);
    if (info && info.webSocketDebuggerUrl) return { wsEndpoint: info.webSocketDebuggerUrl, ms: Date.now() - start };
    sleepSync(500);
  }
  return null;
}

function startManagedBrowser(pw, profileDir, cwd) {
  const rawHeadlessEnv = process.env.GM_BROWSER_HEADLESS;
  const headless = rawHeadlessEnv === '1';
  const unexpectedHeadlessEnv = rawHeadlessEnv !== undefined && rawHeadlessEnv !== '1';
  logEvent('plugkit', 'browser.headless-mode-resolved', {
    headless,
    source: headless ? 'GM_BROWSER_HEADLESS=1' : 'default-headful',
    raw_env_value: rawHeadlessEnv === undefined ? null : rawHeadlessEnv,
    unexpected_env_value: unexpectedHeadlessEnv,
  });
  if (unexpectedHeadlessEnv) {
    logEvent('plugkit', 'browser.headless-env-unexpected-value', { raw_env_value: rawHeadlessEnv });
  }
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
  try { reapOrphanChromiums(cwd, 'pre-spawn'); } catch (_) {}
  const port = findFreePortSync();
  const noSandboxEnv = process.env.GM_BROWSER_NO_SANDBOX;
  let noSandbox = noSandboxEnv === '0' ? false : (noSandboxEnv === '1' || process.platform === 'win32');
  let { pid, chromeLogPath } = spawnChromiumOnce(browserBin, profileDir, port, headless, noSandbox, cwd);
  logEvent('plugkit', 'browser.chromium-launched', { pid, port, profileDir, headless, noSandbox, binary: browserBin, chromeLogPath });
  let ready = waitForCdpReady(port, 30000);
  if (!ready) {
    logEvent('plugkit', 'browser.launch-failed', { reason: 'cdp-not-ready', pid, port });
    throw new Error(`chromium launched (pid=${pid}) but CDP at 127.0.0.1:${port} did not become ready within 30s`);
  }
  if (!noSandbox && chromeLogHasSandboxDenied(chromeLogPath)) {
    logEvent('plugkit', 'browser.sandbox-fallback-engaged', { pid, port, profileDir, reason: 'sandbox-access-denied-detected-in-chrome-launch-log' });
    try { process.kill(pid, 'SIGTERM'); } catch (_) {}
    sleepSyncMs(500);
    try { killPidQuiet(pid); } catch (_) {}
    purgeProfileLockFiles(profileDir);
    noSandbox = true;
    const port2 = findFreePortSync();
    ({ pid, chromeLogPath } = spawnChromiumOnce(browserBin, profileDir, port2, headless, noSandbox, cwd));
    logEvent('plugkit', 'browser.chromium-launched', { pid, port: port2, profileDir, headless, noSandbox, binary: browserBin, chromeLogPath, retry: true });
    ready = waitForCdpReady(port2, 30000);
    if (!ready) {
      logEvent('plugkit', 'browser.launch-failed', { reason: 'cdp-not-ready-after-sandbox-fallback', pid, port: port2 });
      throw new Error(`chromium sandbox-fallback relaunch (pid=${pid}) but CDP at 127.0.0.1:${port2} did not become ready within 30s`);
    }
    logEvent('plugkit', 'browser.cdp-ready', { pid, port: port2, ms: ready.ms, wsEndpoint: ready.wsEndpoint, noSandbox: true });
    return { pid, port: port2, wsEndpoint: ready.wsEndpoint };
  }
  logEvent('plugkit', 'browser.cdp-ready', { pid, port, ms: ready.ms, wsEndpoint: ready.wsEndpoint });
  return { pid, port, wsEndpoint: ready.wsEndpoint };
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

const __browserClosingPids = new Set();

function gracefulCloseBrowser(entry, reason) {
  if (!entry) return;
  const { pid, port, profileDir } = entry;
  if (Number.isFinite(pid) && pid > 0 && __browserClosingPids.has(pid)) {
    try { logEvent('plugkit', 'browser.close-skipped-already-closing', { pid, reason: reason || 'close' }); } catch (_) {}
    return;
  }
  if (Number.isFinite(pid) && pid > 0) __browserClosingPids.add(pid);
  try {
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
      if (isProcessAliveSync(pid) && !pidIsManagedChromium(pid)) {
        try { logEvent('plugkit', 'browser.kill-skipped-pid-reused', { pid, reason: reason || 'close' }); } catch (_) {}
      } else {
        const deadline = Date.now() + 1500;
        try { process.kill(pid, 'SIGTERM'); } catch (_) {}
        while (Date.now() < deadline && isProcessAliveSync(pid)) sleepSyncMs(Math.min(150, deadline - Date.now()));
        if (isProcessAliveSync(pid)) killPidQuiet(pid);
      }
    }
    purgeProfileLockFiles(profileDir);
    try { logEvent('plugkit', 'browser.closed', { reason: reason || 'closed', pid, port, profileDir }); } catch (_) {}
  } finally {
    if (Number.isFinite(pid) && pid > 0) __browserClosingPids.delete(pid);
  }
}

function checkSessionNavigatedAway(port, claudeSessionId) {
  try {
    const list = fetchJsonSync(`http://127.0.0.1:${port}/json/list`, 1000);
    if (!Array.isArray(list)) return;
    const pages = list.filter(t => t && t.type === 'page');
    const stray = pages.filter(t => /^(chrome:\/\/new-tab-page|about:blank|chrome:\/\/newtab)/i.test(String(t.url || '')));
    if (pages.length > 0 && stray.length === pages.length) {
      logEvent('plugkit', 'browser.session-navigated-away', { sid: claudeSessionId, port, urls: pages.map(p => p.url) });
    }
  } catch (_) {}
}

function resolveExistingBrowserEntry(cwd, claudeSessionId, pw, portsFile, sessionsFile, ports, sessions) {
  const existing = ports[claudeSessionId];
  if (!(existing && existing.pid && existing.wsEndpoint)) return null;
  const wantProfile = sessionProfileDir(cwd, claudeSessionId);
  const pidOk = isProcessAliveSync(existing.pid);
  const profileOk = !existing.profileDir || existing.profileDir === wantProfile || existing.profileDir.startsWith(wantProfile);
  const cdpOk = pidOk && !!fetchJsonSyncRetry(`http://127.0.0.1:${existing.port}/json/version`, 1000, 3);
  if (pidOk && profileOk && cdpOk) {
    const pwIds = sessions[claudeSessionId] || [];
    if (pwIds.length > 0 && existing.pwSessionId) {
      checkSessionNavigatedAway(existing.port, claudeSessionId);
      return existing.pwSessionId;
    }
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
        logEvent('plugkit', 'browser.attached', { pwSessionId: sid, reused: true, pid: existing.pid, same_chromium: true });
        return sid;
      }
    }
    return null;
  }
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
    if (pidIsManagedChromium(existing.pid)) {
      try { killPidQuiet(existing.pid); } catch (_) {}
    } else {
      try { logEvent('plugkit', 'browser.kill-skipped-pid-reused', { pid: existing.pid, reason: 'collision' }); } catch (_) {}
    }
  }
  purgeProfileLockFiles(existing.profileDir);
  delete ports[claudeSessionId];
  delete sessions[claudeSessionId];
  try { writeJsonFile(portsFile, ports); } catch (_) {}
  try { writeJsonFile(sessionsFile, sessions); } catch (_) {}
  return null;
}

function getOrCreateBrowserSession(cwd, claudeSessionId, pw) {
  migrateLegacyBrowserState(cwd);
  const portsFile = browserPortsFile(cwd);
  const sessionsFile = browserSessionsFile(cwd);
  const spawnLock = path.join(browserStateDir(cwd), `.browser-spawn-${sessionProfileSlug(claudeSessionId)}.lock`);
  let lockFd = null;
  const spawnDeadline = Date.now() + 35000;
  for (;;) {
    try { lockFd = fs.openSync(spawnLock, 'wx'); break; }
    catch (e) {
      if (e.code !== 'EEXIST') break;
      let stale = false;
      try {
        const owner = parseInt(String(fs.readFileSync(spawnLock, 'utf-8')).split('|')[0], 10);
        const ageOk = (Date.now() - fs.statSync(spawnLock).mtimeMs) < 40000;
        if (!ageOk || !(Number.isFinite(owner) && isProcessAliveSync(owner))) stale = true;
      } catch (_) { stale = true; }
      if (stale) { try { fs.unlinkSync(spawnLock); } catch (_) {} continue; }
      const winner = readJsonFile(portsFile, {})[claudeSessionId];
      if (winner && winner.pid && winner.wsEndpoint && isProcessAliveSync(winner.pid)
          && fetchJsonSync(`http://127.0.0.1:${winner.port}/json/version`, 1000)) {
        const a = runBrowserRunner(pw, ['session', 'new', '--direct', winner.wsEndpoint], 30000, cwd, claudeSessionId);
        const sid = a && a.status === 0 ? parseSessionId(a.stdout || '') : null;
        if (sid) {
          checkSessionNavigatedAway(winner.port, claudeSessionId);
          logEvent('plugkit', 'browser.attached', { pwSessionId: sid, reused: true, via: 'spawn-lock-wait', pid: winner.pid, same_chromium: true });
          return sid;
        }
      }
      if (Date.now() > spawnDeadline) break;
      sleepSyncMs(300);
    }
  }
  try { if (lockFd !== null) { fs.writeSync(lockFd, `${process.pid}|${Date.now()}`); fs.closeSync(lockFd); } } catch (_) {}
  const releaseSpawnLock = () => { try { const o = parseInt(String(fs.readFileSync(spawnLock, 'utf-8')).split('|')[0], 10); if (o === process.pid) fs.unlinkSync(spawnLock); } catch (_) {} };
  try {
  const portsLocked = readJsonFile(portsFile, {});
  const sessionsLocked = readJsonFile(sessionsFile, {});
  const reused = resolveExistingBrowserEntry(cwd, claudeSessionId, pw, portsFile, sessionsFile, portsLocked, sessionsLocked);
  if (reused) { logEvent('plugkit', 'browser.attached', { pwSessionId: reused, reused: true, via: 'spawn-lock-recheck' }); return reused; }
  cleanDeadProfileFragments(cwd);
  reapOrphanBrowserSessions(pw, cwd, claudeSessionId, 'pre-spawn');
  const profileDir = acquireProfileDir(cwd, claudeSessionId);
  const aliveCdpForProfile = (() => {
    for (const key of Object.keys(portsLocked)) {
      const ent = portsLocked[key];
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
  let browserPid, port, wsEndpoint, freshLaunch;
  if (aliveCdpForProfile) {
    ({ pid: browserPid, port, wsEndpoint } = aliveCdpForProfile);
    freshLaunch = false;
    logEvent('plugkit', 'browser.reused-existing-chromium', { pid: browserPid, port, profileDir });
  } else {
    logEvent('plugkit', 'browser.start', { profileDir });
    ({ pid: browserPid, port, wsEndpoint } = startManagedBrowser(pw, profileDir, cwd));
    freshLaunch = true;
  }
  markLaunching(browserPid);
  const r = runBrowserRunner(pw, ['session', 'new', '--direct', wsEndpoint], 30000, cwd, claudeSessionId);
  if (!r || r.status !== 0) {
    const errTxt = scrubBrowserRunnerText((r && (r.stderr || r.stdout)) || 'unknown');
    logEvent('plugkit', 'browser.launch-failed', { reason: 'session-attach-failed', pid: browserPid, port, error: errTxt });
    throw new Error(`playwriter session new --direct failed: ${errTxt}`);
  }
  if (freshLaunch) {
    const { closed } = closeExtraBlankTabs(port, wsEndpoint);
    if (closed > 0) logEvent('plugkit', 'browser.extra-blank-tabs-closed', { pid: browserPid, port, closed });
  }
  const pwSessionId = parseSessionId(r.stdout || '');
  if (!pwSessionId) {
    logEvent('plugkit', 'browser.launch-failed', { reason: 'session-id-unparseable', stdout: r.stdout });
    throw new Error(`could not parse managed browser session id from: ${scrubBrowserRunnerText(r.stdout || '')}`);
  }
  portsLocked[claudeSessionId] = { profileDir, pid: browserPid, port, wsEndpoint, pwSessionId, lastUse: Date.now() };
  sessionsLocked[claudeSessionId] = [pwSessionId];
  writeJsonFile(portsFile, portsLocked);
  writeJsonFile(sessionsFile, sessionsLocked);
  clearLaunching(browserPid);
  if (!__openedSessionIds.has(claudeSessionId) && __openedSessionIds.size >= 1) {
    logEvent('hook', 'deviation.browser-multi-session', { sid: claudeSessionId, already_open: Array.from(__openedSessionIds), reason: 'a 2nd distinct browser sessionId launched its own chromium this run -- reuse one session per run and close it when done' });
  }
  __openedSessionIds.add(claudeSessionId);
  logEvent('plugkit', 'browser.attached', { pwSessionId, pid: browserPid, port });
  return pwSessionId;
  } finally { releaseSpawnLock(); }
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
const WASI_PROJECT_SLUG = crypto.createHash('sha256').update(String(process.env.CLAUDE_PROJECT_DIR || process.cwd()).toLowerCase().replace(/\\/g, '/')).digest('hex').slice(0, 16);
const WASI_FILESYSTEM_ROOT = path.join(GM_TOOLS_ROOT, 'wasi-fs', WASI_PROJECT_SLUG);
const wasiOpenFiles = new Map();
let wasiNextFd = 100;

function wasiResolvePath(relPath) {
  const rel = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const resolved = path.resolve(WASI_FILESYSTEM_ROOT, rel);
  const rootResolved = path.resolve(WASI_FILESYSTEM_ROOT) + path.sep;
  if (resolved !== path.resolve(WASI_FILESYSTEM_ROOT) && !resolved.startsWith(rootResolved)) {
    throw new Error(`wasi-path-traversal-refused: ${relPath} escapes ${WASI_FILESYSTEM_ROOT}`);
  }
  return resolved;
}

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
        const iovsBase = iovs_ptr >>> 0;   // >>>0: high-bit iovs pointer is negative in JS -> getUint32 would throw
        for (let i = 0; i < iovs_len; i++) {
          const base = iovsBase + i * 8;
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
        crypto.randomFillSync(new Uint8Array(getMemory(), buf_ptr >>> 0, buf_len >>> 0));   // >>>0: high-bit ptr is negative in JS
        return 0;
      } catch (e) {
        return 28;
      }
    },
    clock_time_get: (clock_id, precision, time_ptr) => {
      try {
        const ns = BigInt(Date.now()) * 1000000n;
        new DataView(getMemory()).setBigUint64(time_ptr >>> 0, ns, true);   // >>>0: high-bit ptr is negative in JS
        return 0;
      } catch (e) {
        return 28;
      }
    },
    environ_get: () => 0,
    environ_sizes_get: () => 0,
    fd_prestat_get: (fd, buf_ptr) => {
      if (fd !== 3) return 8;
      try {
        const dv = new DataView(getMemory());
        dv.setUint8(buf_ptr, 0);
        dv.setUint32(buf_ptr + 4, 1, true);
        return 0;
      } catch (e) { return 8; }
    },
    fd_prestat_dir_name: (fd, path_ptr, path_len) => {
      if (fd !== 3) return 8;
      try {
        const buf = getMemory();
        new Uint8Array(buf, path_ptr >>> 0, Math.min(path_len, 1)).set([0x2e]);
        return 0;
      } catch (e) { return 8; }
    },
    fd_close: (fd) => {
      const entry = wasiOpenFiles.get(fd);
      if (!entry) return 0;
      try { fs.closeSync(entry.nodeFd); } catch (_) {}
      wasiOpenFiles.delete(fd);
      return 0;
    },
    fd_fdstat_get: (fd, stat_ptr) => {
      try {
        const dv = new DataView(getMemory());
        const entry = wasiOpenFiles.get(fd);
        dv.setUint8(stat_ptr, entry ? 4 : 0);
        dv.setUint8(stat_ptr + 1, 0);
        dv.setBigUint64(stat_ptr + 8, 0xffffffffffffffffn, true);
        dv.setBigUint64(stat_ptr + 16, 0xffffffffffffffffn, true);
        return 0;
      } catch (e) { return 8; }
    },
    fd_fdstat_set_flags: () => 0,
    fd_filestat_get: (fd, buf_ptr) => {
      const entry = wasiOpenFiles.get(fd);
      if (!entry) { if (process.env.PLUGKIT_DEBUG) console.error(`[plugkit-wasm] fd_filestat_get FAILED: no entry for fd=${fd}`); return 8; }
      try {
        const st = fs.fstatSync(entry.nodeFd);
        const dv = new DataView(getMemory());
        dv.setBigUint64(buf_ptr, 0n, true);
        dv.setBigUint64(buf_ptr + 8, 0n, true);
        dv.setUint8(buf_ptr + 16, 4);
        dv.setBigUint64(buf_ptr + 24, 1n, true);
        dv.setBigUint64(buf_ptr + 32, BigInt(st.size), true);
        dv.setBigUint64(buf_ptr + 40, BigInt(Math.floor(st.atimeMs * 1e6)), true);
        dv.setBigUint64(buf_ptr + 48, BigInt(Math.floor(st.mtimeMs * 1e6)), true);
        dv.setBigUint64(buf_ptr + 56, BigInt(Math.floor(st.ctimeMs * 1e6)), true);
        return 0;
      } catch (e) { if (process.env.PLUGKIT_DEBUG) console.error(`[plugkit-wasm] fd_filestat_get FAILED: ${e && e.message}`); return 8; }
    },
    fd_seek: (fd, offset64, whence, newoffset_ptr) => {
      const entry = wasiOpenFiles.get(fd);
      if (!entry) { try { new DataView(getMemory()).setBigUint64(newoffset_ptr, 0n, true); } catch (_) {} return 8; }
      try {
        const offset = BigInt.asIntN(64, BigInt(offset64));
        let base;
        if (whence === 0) base = 0n;
        else if (whence === 1) base = BigInt(entry.pos);
        else base = BigInt(fs.fstatSync(entry.nodeFd).size);
        const next = base + offset;
        entry.pos = Number(next < 0n ? 0n : next);
        new DataView(getMemory()).setBigUint64(newoffset_ptr, BigInt(entry.pos), true);
        return 0;
      } catch (e) { if (process.env.PLUGKIT_DEBUG) console.error(`[plugkit-wasm] fd_seek FAILED: ${e && e.message}`); return 8; }
    },
    fd_read: (fd, iovs_ptr, iovs_len, nread_ptr) => {
      const entry = wasiOpenFiles.get(fd);
      if (!entry) { try { new DataView(getMemory()).setUint32(nread_ptr, 0, true); } catch (_) {} return 8; }
      try {
        const buf = getMemory();
        const dv = new DataView(buf);
        let total = 0;
        const iovsBase = iovs_ptr >>> 0;
        for (let i = 0; i < iovs_len; i++) {
          const base = iovsBase + i * 8;
          const ptr = dv.getUint32(base, true) >>> 0;
          const len = dv.getUint32(base + 4, true) >>> 0;
          if (len === 0) continue;
          const dest = Buffer.from(buf, ptr, len);
          const n = fs.readSync(entry.nodeFd, dest, 0, len, entry.pos);
          entry.pos += n;
          total += n;
          if (n < len) break;
        }
        dv.setUint32(nread_ptr, total, true);
        return 0;
      } catch (e) { return 8; }
    },
    fd_pread: (fd, iovs_ptr, iovs_len, offset64, nread_ptr) => {
      const entry = wasiOpenFiles.get(fd);
      if (!entry) { try { new DataView(getMemory()).setUint32(nread_ptr, 0, true); } catch (_) {} return 8; }
      try {
        const offset = Number(BigInt.asUintN(64, BigInt(offset64)));
        const buf = getMemory();
        const dv = new DataView(buf);
        let total = 0;
        const iovsBase = iovs_ptr >>> 0;
        let pos = offset;
        for (let i = 0; i < iovs_len; i++) {
          const base = iovsBase + i * 8;
          const ptr = dv.getUint32(base, true) >>> 0;
          const len = dv.getUint32(base + 4, true) >>> 0;
          if (len === 0) continue;
          const dest = Buffer.from(buf, ptr, len);
          const n = fs.readSync(entry.nodeFd, dest, 0, len, pos);
          pos += n;
          total += n;
          if (n < len) break;
        }
        dv.setUint32(nread_ptr, total, true);
        return 0;
      } catch (e) { if (process.env.PLUGKIT_DEBUG) console.error(`[plugkit-wasm] fd_pread FAILED: ${e && e.message}`); return 8; }
    },
    fd_pwrite: (fd, iovs_ptr, iovs_len, offset64, nwritten_ptr) => {
      const entry = wasiOpenFiles.get(fd);
      if (!entry) { try { new DataView(getMemory()).setUint32(nwritten_ptr, 0, true); } catch (_) {} return 8; }
      try {
        const offset = Number(BigInt.asUintN(64, BigInt(offset64)));
        const buf = getMemory();
        const dv = new DataView(buf);
        let total = 0;
        const iovsBase = iovs_ptr >>> 0;
        let pos = offset;
        for (let i = 0; i < iovs_len; i++) {
          const base = iovsBase + i * 8;
          const ptr = dv.getUint32(base, true) >>> 0;
          const len = dv.getUint32(base + 4, true) >>> 0;
          if (len === 0) continue;
          const src = Buffer.from(buf, ptr, len);
          const n = fs.writeSync(entry.nodeFd, src, 0, len, pos);
          pos += n;
          total += n;
        }
        dv.setUint32(nwritten_ptr, total, true);
        return 0;
      } catch (e) { if (process.env.PLUGKIT_DEBUG) console.error(`[plugkit-wasm] fd_pwrite FAILED: ${e && e.message}`); return 8; }
    },
    fd_sync: (fd) => {
      const entry = wasiOpenFiles.get(fd);
      if (!entry) return 8;
      try { fs.fsyncSync(entry.nodeFd); return 0; } catch (e) { if (process.env.PLUGKIT_DEBUG) console.error(`[plugkit-wasm] fd_sync FAILED: ${e && e.message}`); return 8; }
    },
    fd_datasync: (fd) => {
      const entry = wasiOpenFiles.get(fd);
      if (!entry) return 8;
      try { fs.fdatasyncSync(entry.nodeFd); return 0; } catch (e) { return 8; }
    },
    fd_filestat_set_size: (fd, size64) => {
      const entry = wasiOpenFiles.get(fd);
      if (!entry) return 8;
      try {
        const size = Number(BigInt.asUintN(64, BigInt(size64)));
        fs.ftruncateSync(entry.nodeFd, size);
        return 0;
      } catch (e) { if (process.env.PLUGKIT_DEBUG) console.error(`[plugkit-wasm] fd_filestat_set_size FAILED: ${e && e.message}`); return 8; }
    },
    path_create_directory: (_dirfd, path_ptr, path_len) => {
      try {
        const buf = getMemory();
        const relPath = new TextDecoder('utf-8').decode(new Uint8Array(buf, path_ptr >>> 0, path_len >>> 0));
        const absPath = wasiResolvePath(relPath);
        fs.mkdirSync(absPath, { recursive: true });
        return 0;
      } catch (e) {
        if (process.env.PLUGKIT_DEBUG) console.error(`[plugkit-wasm] path_create_directory FAILED: ${e && e.message}`);
        return e && e.code === 'EEXIST' ? 0 : 8;
      }
    },
    path_unlink_file: (_dirfd, path_ptr, path_len) => {
      try {
        const buf = getMemory();
        const relPath = new TextDecoder('utf-8').decode(new Uint8Array(buf, path_ptr >>> 0, path_len >>> 0));
        const absPath = wasiResolvePath(relPath);
        fs.unlinkSync(absPath);
        return 0;
      } catch (e) {
        return e && e.code === 'ENOENT' ? 44 : 8;
      }
    },
    path_remove_directory: (_dirfd, path_ptr, path_len) => {
      try {
        const buf = getMemory();
        const relPath = new TextDecoder('utf-8').decode(new Uint8Array(buf, path_ptr >>> 0, path_len >>> 0));
        const absPath = wasiResolvePath(relPath);
        fs.rmdirSync(absPath);
        return 0;
      } catch (e) {
        if (e && e.code === 'ENOENT') return 44;
        if (e && e.code === 'ENOTEMPTY') return 55;
        return 8;
      }
    },
    path_filestat_set_times: (_dirfd, _flags, path_ptr, path_len, atim64, mtim64, fst_flags) => {
      try {
        const buf = getMemory();
        const relPath = new TextDecoder('utf-8').decode(new Uint8Array(buf, path_ptr >>> 0, path_len >>> 0));
        const absPath = wasiResolvePath(relPath);
        const FILESTAT_SET_ATIM = 0x1, FILESTAT_SET_ATIM_NOW = 0x2, FILESTAT_SET_MTIM = 0x4, FILESTAT_SET_MTIM_NOW = 0x8;
        const st = fs.statSync(absPath);
        const nowMs = Date.now();
        let atimeMs = st.atimeMs;
        let mtimeMs = st.mtimeMs;
        if (fst_flags & FILESTAT_SET_ATIM_NOW) atimeMs = nowMs;
        else if (fst_flags & FILESTAT_SET_ATIM) atimeMs = Number(BigInt.asUintN(64, BigInt(atim64))) / 1e6;
        if (fst_flags & FILESTAT_SET_MTIM_NOW) mtimeMs = nowMs;
        else if (fst_flags & FILESTAT_SET_MTIM) mtimeMs = Number(BigInt.asUintN(64, BigInt(mtim64))) / 1e6;
        fs.utimesSync(absPath, atimeMs / 1000, mtimeMs / 1000);
        return 0;
      } catch (e) {
        if (process.env.PLUGKIT_DEBUG) console.error(`[plugkit-wasm] path_filestat_set_times FAILED: ${e && e.message}`);
        return e && e.code === 'ENOENT' ? 44 : 8;
      }
    },
    path_open: (_dirfd, _dirflags, path_ptr, path_len, oflags, _rights_base, _rights_inherit, fdflags, opened_fd_ptr) => {
      try {
        const buf = getMemory();
        const relPath = new TextDecoder('utf-8').decode(new Uint8Array(buf, path_ptr >>> 0, path_len >>> 0));
        const absPath = wasiResolvePath(relPath);
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        const OFLAGS_CREAT = 1, OFLAGS_EXCL = 2, OFLAGS_TRUNC = 8;
        let nodeFlags = 'r+';
        const creat = (oflags & OFLAGS_CREAT) !== 0;
        const excl = (oflags & OFLAGS_EXCL) !== 0;
        const trunc = (oflags & OFLAGS_TRUNC) !== 0;
        if (excl && creat) nodeFlags = 'wx+';
        else if (trunc) nodeFlags = 'w+';
        else if (creat) nodeFlags = fs.existsSync(absPath) ? 'r+' : 'w+';
        else nodeFlags = 'r+';
        if (process.env.PLUGKIT_DEBUG) console.error(`[plugkit-wasm] path_open: rel=${relPath} abs=${absPath} oflags=${oflags} nodeFlags=${nodeFlags}`);
        const nodeFd = fs.openSync(absPath, nodeFlags);
        const wasiFd = wasiNextFd++;
        wasiOpenFiles.set(wasiFd, { nodeFd, pos: 0, path: absPath });
        new DataView(buf).setUint32(opened_fd_ptr, wasiFd, true);
        return 0;
      } catch (e) {
        if (process.env.PLUGKIT_DEBUG) console.error(`[plugkit-wasm] path_open FAILED: ${e && e.message}`);
        return e && /ENOENT/.test(e.code || '') ? 44 : 8;
      }
    },
    path_filestat_get: (_dirfd, _flags, path_ptr, path_len, buf_ptr) => {
      try {
        const buf = getMemory();
        const relPath = new TextDecoder('utf-8').decode(new Uint8Array(buf, path_ptr >>> 0, path_len >>> 0));
        const absPath = wasiResolvePath(relPath);
        const st = fs.statSync(absPath);
        const dv = new DataView(buf);
        dv.setBigUint64(buf_ptr, 0n, true);
        dv.setBigUint64(buf_ptr + 8, 0n, true);
        dv.setUint8(buf_ptr + 16, st.isDirectory() ? 3 : 4);
        dv.setBigUint64(buf_ptr + 24, 1n, true);
        dv.setBigUint64(buf_ptr + 32, BigInt(st.size), true);
        dv.setBigUint64(buf_ptr + 40, BigInt(Math.floor(st.atimeMs * 1e6)), true);
        dv.setBigUint64(buf_ptr + 48, BigInt(Math.floor(st.mtimeMs * 1e6)), true);
        dv.setBigUint64(buf_ptr + 56, BigInt(Math.floor(st.ctimeMs * 1e6)), true);
        return 0;
      } catch (e) {
        return e && /ENOENT/.test(e.code || '') ? 44 : 8;
      }
    },
    poll_oneoff: () => 0,
    sched_yield: () => 0,
  };
  if (process.env.PLUGKIT_DEBUG_WASI) {
    for (const k of Object.keys(shim)) {
      const orig = shim[k];
      shim[k] = (...args) => {
        const r = orig(...args);
        try { console.error(`[plugkit-wasm] wasi.${k}(${args.map(a => typeof a === 'bigint' ? a.toString() : a).join(',')}) -> ${r}`); } catch (_) {}
        return r;
      };
    }
  }
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

function decodeWasmResult(instance, result, where) {
  const u = BigInt.asUintN(64, BigInt(result));
  const ptr = Number(u & 0xffffffffn);
  const len = Number(u >> 32n);
  if (ptr === 0 || len === 0) return '';
  const buffer = instance.exports.memory.buffer;
  guardWasmRange(buffer, ptr, len, where);
  const out = new TextDecoder().decode(new Uint8Array(buffer, ptr, len));
  try { instance.exports.plugkit_free(ptr, len); } catch (_) {}
  return out;
}

function writeWasmInput(instance, bytes, where) {
  if (bytes.length === 0) return 0;
  const ptr = instance.exports.plugkit_alloc(bytes.length) >>> 0;
  if (ptr === 0) throw new Error(`wasm-alloc-failed at ${where}: plugkit_alloc returned 0 (wasm OOM)`);
  guardWasmRange(instance.exports.memory.buffer, ptr, bytes.length, `${where}:writeWasmInput`);
  new Uint8Array(instance.exports.memory.buffer, ptr, bytes.length).set(bytes);
  return ptr;
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
  const ptr = instance.exports.plugkit_alloc(bytes.length) >>> 0;
  if (ptr === 0) return 0n;
  guardWasmRange(instance.exports.memory.buffer, ptr, bytes.length, 'writeWasmBytes');
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

let _jsRuntimeCmd = null;
function resolveJsRuntimeCmd() {
  if (_jsRuntimeCmd) return _jsRuntimeCmd;
  if (!/(^|[\\/])node(\.exe)?$/i.test(String(process.execPath || ''))) {
    _jsRuntimeCmd = process.execPath;
    return _jsRuntimeCmd;
  }
  try {
    const which = process.platform === 'win32' ? 'where' : 'which';
    const out = spawnSync(which, ['bun'], { encoding: 'utf-8', windowsHide: true });
    const first = (out && out.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first) { _jsRuntimeCmd = first; return _jsRuntimeCmd; }
  } catch (_) {}
  _jsRuntimeCmd = process.execPath;
  return _jsRuntimeCmd;
}

function langToCmd(lang, code) {
  if (lang === 'nodejs' || lang === 'js' || lang === 'javascript' || lang === 'node') return { cmd: resolveJsRuntimeCmd(), args: ['-e', code], stdinCode: null };
  if (lang === 'python' || lang === 'py') return { cmd: 'python', args: ['-c', code], stdinCode: null };
  if (lang === 'bash' || lang === 'sh' || lang === 'shell' || lang === 'zsh') return { cmd: 'bash', args: ['-c', code], stdinCode: null };
  if (lang === 'powershell' || lang === 'ps1') return { cmd: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command', code], stdinCode: null };
  if (lang === 'deno') return { cmd: 'deno', args: ['eval', code], stdinCode: null };
  return null;
}

const TASK_MAX_TIMEOUT_MS = 10 * 60 * 1000;

function spawnTask({ cwd, lang, code, timeoutMs }) {
  const id = nextTaskId(cwd);
  const built = langToCmd(lang, code);
  if (!built) return { ok: false, error: `unsupported lang: ${lang}` };
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > TASK_MAX_TIMEOUT_MS) {
    timeoutMs = TASK_MAX_TIMEOUT_MS;
  }
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

function pidAliveLocal(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

function sweepOrphanedTaskMetaOnBoot(cwd) {
  let swept = 0;
  try {
    const dir = tasksDir(cwd);
    const now = Date.now();
    for (const name of fs.readdirSync(dir)) {
      if (!/^t\d+\.json$/.test(name)) continue;
      const metaPath = path.join(dir, name);
      let meta = null;
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch (_) { continue; }
      if (!meta || meta.status !== 'running') continue;
      const stale = !pidAliveLocal(meta.pid) || (meta.deadline_ms && now > meta.deadline_ms);
      if (!stale) continue;
      if (pidAliveLocal(meta.pid)) {
        try {
          if (process.platform === 'win32') {
            spawnSync('taskkill', ['/F', '/T', '/PID', String(meta.pid)], { stdio: 'ignore', windowsHide: true, timeout: 3000 });
          } else {
            try { process.kill(-meta.pid, 'SIGKILL'); } catch (_) { try { process.kill(meta.pid, 'SIGKILL'); } catch (_) {} }
          }
        } catch (_) {}
      }
      meta.status = 'reaped-on-boot';
      meta.ended_ms = now;
      try { fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2)); } catch (_) {}
      swept += 1;
    }
  } catch (_) {}
  if (swept > 0) logEvent('plugkit', 'task.bootSweepReaped', { cwd: cwd || process.cwd(), count: swept });
  return swept;
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

let _gmRunnerEmbedBinPath;
function resolveGmRunnerEmbedBin() {
  if (_gmRunnerEmbedBinPath !== undefined) return _gmRunnerEmbedBinPath;
  const exe = path.join(GM_TOOLS_ROOT, process.platform === 'win32' ? 'gm-runner.exe' : 'gm-runner');
  _gmRunnerEmbedBinPath = fs.existsSync(exe) ? exe : null;
  return _gmRunnerEmbedBinPath;
}

// Slim-build support: plugkit-core's embed.rs probes host_vec_embed BEFORE
// ever loading the 133MB wasm-embedded safetensors fallback (see
// rs-plugkit/crates/plugkit-core/src/embed.rs::init_ctx) -- if this function
// returns a real embedding, the wasm-side model never loads at all. Wired
// here to gm-runner's OWN native candle path (crates/gm-runner/src/embed.rs)
// via its `embed-text` one-shot subcommand (stdin=text,
// stdout={"embedding":[...]}), a synchronous spawnSync call so the wasm-side
// caller (a synchronous extern "C" import) can block on it correctly. Used
// ONLY when a real ~/.gm-tools/gm-runner(.exe) binary is present on this
// host; if absent, returns null immediately and the caller (host_vec_embed
// below) falls through to -1, which makes plugkit-core's own probe fail and
// fall back to loading the wasm-embedded fat-build safetensors model exactly
// as before -- embedding capability is never silently lost on a host with no
// gm-runner installed, by design (this is the real fallback the
// slim-wasm-default-flip PRD row required be live before any default-feature
// flip).
function hostEmbedViaGmRunner(text) {
  const bin = resolveGmRunnerEmbedBin();
  if (!bin) return null;
  try {
    const r = spawnSync(bin, ['embed-text'], {
      input: text,
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (r.error || r.status !== 0) return null;
    const parsed = JSON.parse(r.stdout || '{}');
    if (!Array.isArray(parsed.embedding)) return null;
    return parsed.embedding;
  } catch (_) {
    return null;
  }
}

globalThis.__hostEmbedSync = function __hostEmbedSync(textPtr, textLen, outPtr, outLen, instance) {
  try {
    const text = readWasmStr(instance, textPtr, textLen);
    if (!text) return -1;
    const values = hostEmbedViaGmRunner(text);
    if (!values || values.length === 0) return -1;
    const dim = Math.min(values.length, outLen >>> 0);
    const bytes = new Uint8Array(dim * 4);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < dim; i++) view.setFloat32(i * 4, values[i], true);
    const buffer = instance.exports.memory.buffer;
    guardWasmRange(buffer, outPtr, dim * 4, '__hostEmbedSync:write');
    new Uint8Array(buffer, outPtr, dim * 4).set(bytes);
    return dim;
  } catch (_) {
    return -1;
  }
};

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

    host_fs_remove: (pathPtr, pathLen) => {
      try {
        const filePath = readWasmStr(instanceRef.value, pathPtr, pathLen);
        if (!filePath) return 0;
        const st = fs.statSync(filePath);
        if (st.isDirectory()) return 0;
        fs.unlinkSync(filePath);
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
        atomicWriteRaw(kvFilePath(ns, key, true), val);
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
        const isJsLang = lang === 'nodejs' || lang === 'js' || lang === undefined;
        const wantProfile = opts.profile === true && isJsLang;
        const profileSkipped = opts.profile === true && !isJsLang
          ? { reason: `profile requested but lang=${lang} is not js/nodejs; CPU profiling only supported on the node surface`, lang }
          : null;
        const profileTopN = Number.isFinite(opts.profileTopN) && opts.profileTopN > 0 ? Math.floor(opts.profileTopN) : 20;
        let profileUserFile = null;
        let cmd, args;
        if (lang === 'nodejs' || lang === 'js') {
          if (wantProfile) {
            profileUserFile = path.join(os.tmpdir(), `gm-prof-${process.pid}-${execProfileSeq++}.js`);
            fs.writeFileSync(profileUserFile, `module.exports = (async () => {\n${code}\n});`, 'utf-8');
            const runnerCode = `${AGGREGATE_CPU_PROFILE_SRC}\n`
              + `const __inspector = require('inspector');\n`
              + `const { performance: __perf } = require('perf_hooks');\n`
              + `const __session = new __inspector.Session();\n`
              + `__session.connect();\n`
              + `const __post = (m, p) => new Promise((res, rej) => __session.post(m, p || {}, (e, r) => e ? rej(e) : res(r)));\n`
              + `(async () => {\n`
              + `  let __profile = null, __profileError = null, __userResult = null, __userError = null, __wallMs = 0;\n`
              + `  const __memBefore = process.memoryUsage();\n`
              + `  try {\n`
              + `    await __post('Profiler.enable');\n`
              + `    await __post('Profiler.setSamplingInterval', { interval: ${Number.isFinite(opts.sampleIntervalUs) && opts.sampleIntervalUs > 0 ? Math.floor(opts.sampleIntervalUs) : 100} });\n`
              + `    await __post('Profiler.start');\n`
              + `    const __w0 = __perf.now();\n`
              + `    try { __userResult = await require(${JSON.stringify(profileUserFile)})(); } catch (ue) { __userError = String(ue && ue.stack || ue); }\n`
              + `    __wallMs = Math.round((__perf.now() - __w0) * 1000) / 1000;\n`
              + `    const __r = await __post('Profiler.stop');\n`
              + `    __profile = __r && __r.profile || null;\n`
              + `  } catch (pe) { __profileError = String(pe && pe.message || pe); }\n`
              + `  const __memAfter = process.memoryUsage();\n`
              + `  const __agg = __profile ? aggregateCpuProfile(__profile, ${profileTopN}, false) : { timeframe: null, culprits: [] };\n`
              + `  const __userFile = ${JSON.stringify('file:///' + profileUserFile.replace(/\\/g, '/'))};\n`
              + `  const __cpuTotalUs = __agg.timeframe ? __agg.timeframe.total_us : 0;\n`
              + `  const __cpuUserUs = (__agg.culprits || []).filter(c => c.location && c.location.indexOf(__userFile) === 0).reduce((a, c) => a + c.self_us, 0);\n`
              + `  const __wallUs = Math.round(__wallMs * 1000);\n`
              + `  const __mem = { rss_mb: Math.round(__memAfter.rss/10485.76)/100, heapUsed_mb: Math.round(__memAfter.heapUsed/10485.76)/100, heapUsed_delta_mb: Math.round((__memAfter.heapUsed-__memBefore.heapUsed)/10485.76)/100, external_mb: Math.round(__memAfter.external/10485.76)/100 };\n`
              + `  const __wallVsCpu = { wall_us: __wallUs, cpu_user_self_us: __cpuUserUs, cpu_total_sampled_us: __cpuTotalUs, offcpu_us: Math.max(0, __wallUs - __cpuUserUs), note: 'offcpu_us = inner wall minus on-CPU user-code JS self time = IO/async/GPU/idle the CPU sampler is blind to; cpu_total_sampled_us includes node-init/inspector overhead' };\n`
              + `  process.stdout.write('__GM_PROFILE__' + JSON.stringify({ result: __userResult, user_error: __userError, profile: __agg, profile_error: __profileError, mem: __mem, wall_vs_cpu: __wallVsCpu }));\n`
              + `  __session.disconnect();\n`
              + `})();\n`;
            cmd = process.execPath; args = ['-e', runnerCode];
          } else if (opts.mem === true) {
            const memRunner = `const { performance: __perf } = require('perf_hooks');\n`
              + `(async () => {\n`
              + `  const __mb = process.memoryUsage(); const __w0 = __perf.now();\n`
              + `  let __r = null, __err = null;\n`
              + `  try { __r = await (async () => {\n${code}\n})(); } catch (e) { __err = { name: e && e.name || 'Error', message: String(e && e.message || e), stack: String(e && e.stack || '') }; }\n`
              + `  const __wallMs = Math.round((__perf.now() - __w0) * 1000) / 1000; const __ma = process.memoryUsage();\n`
              + `  const __mem = { rss_mb: Math.round(__ma.rss/10485.76)/100, heapUsed_mb: Math.round(__ma.heapUsed/10485.76)/100, heapUsed_delta_mb: Math.round((__ma.heapUsed-__mb.heapUsed)/10485.76)/100, external_mb: Math.round(__ma.external/10485.76)/100 };\n`
              + `  process.stdout.write('__GM_META__' + JSON.stringify({ result: __r === undefined ? null : __r, error: __err, mem: __mem, wall_ms: __wallMs }));\n`
              + `  if (__err) process.exitCode = 1;\n`
              + `})();\n`;
            cmd = process.execPath; args = ['-e', memRunner];
          } else {
            // Wrap in an async IIFE so top-level `return` (and top-level
            // `await`) work -- `node/bun -e "return 2+2;"` is a SyntaxError
            // at top level, but the gm exec_js contract lets code `return` a
            // result. This mirrors the mem/profile paths and the browser verb.
            // The returned value is emitted via a __GM_RESULT__ sentinel so the
            // user's own stdout stays clean; a throw still prints its stack to
            // stderr and exits 1, preserving the documented error channel.
            const defRunner = `(async () => {\n`
              + `  try {\n`
              + `    const __r = await (async () => {\n${code}\n})();\n`
              + `    try { console.log('__GM_RESULT__' + JSON.stringify(__r === undefined ? null : __r)); }\n`
              + `    catch (__se) { console.log('__GM_RESULT__' + JSON.stringify({ __unserializable: String(__se && __se.message || __se) })); }\n`
              + `  } catch (__e) {\n`
              + `    console.error(String(__e && __e.stack || __e));\n`
              + `    process.exitCode = 1;\n`
              + `  }\n`
              + `})();\n`;
            cmd = process.execPath; args = ['-e', defRunner];
          }
        }
        else if (lang === 'python') { cmd = 'python'; args = ['-c', code]; }
        else if (lang === 'bash') { cmd = 'bash'; args = ['-c', code]; }
        else if (lang === 'deno') { cmd = 'deno'; args = ['eval', code]; }
        else { return writeWasmJson(instanceRef.value, { ok: false, error: `unsupported lang: ${lang}` }); }
        const __execT0 = Date.now();
        let result;
        try {
          result = spawnSync(cmd, args, { encoding: 'utf-8', timeout: timeoutMs, cwd, env: process.env });
        } finally {
          if (profileUserFile) { try { fs.unlinkSync(profileUserFile); } catch (_) {} }
        }
        // Shared across all result branches: a genuine timeout kills the child
        // near the deadline. A SIGTERM far under timeoutMs is a spurious /
        // host-injected kill (e.g. the stale-watcher SIGTERM-at-28ms), not a
        // timeout -- do not mislabel it as timed_out.
        const __execDurMs = Date.now() - __execT0;
        const __execTimedOut = result.signal === 'SIGTERM' && __execDurMs >= Math.floor(timeoutMs * 0.9);
        // spawnSync sets result.error (and leaves status/signal null) when the
        // child could NOT be started or was reaped abnormally (spawn race
        // during watcher boot, ETIMEDOUT, EBADF, ENOENT for a missing runtime).
        // Surface it so a status:-1 is diagnosable instead of a silent empty
        // failure -- the caller sees WHY, not just exit_code:-1.
        const __spawnError = result.error
          ? { code: result.error.code || null, errno: result.error.errno || null, syscall: result.error.syscall || null, message: String(result.error.message || result.error) }
          : null;
        if (wantProfile) {
          const raw = result.stdout || '';
          const idx = raw.indexOf('__GM_PROFILE__');
          let parsed = null;
          if (idx >= 0) { try { parsed = JSON.parse(raw.slice(idx + '__GM_PROFILE__'.length)); } catch (_) {} }
          return writeWasmJson(instanceRef.value, {
            ok: result.status === 0 && parsed !== null && !parsed.user_error,
            stdout: idx >= 0 ? raw.slice(0, idx) : raw,
            stderr: result.stderr || '',
            exit_code: result.status === null ? -1 : result.status,
            timed_out: __execTimedOut,
            duration_ms: __execDurMs,
            result: parsed ? parsed.result : null,
            profile: parsed ? parsed.profile : { timeframe: null, culprits: [] },
            profile_error: parsed ? parsed.profile_error : 'profile sentinel not found in stdout',
            user_error: parsed ? parsed.user_error : null,
            mem: parsed ? parsed.mem : null,
            wall_vs_cpu: parsed ? parsed.wall_vs_cpu : null,
            ...(__spawnError ? { spawn_error: __spawnError } : {}),
          });
        }
        if (opts.mem === true && isJsLang) {
          const raw = result.stdout || '';
          const idx = raw.indexOf('__GM_META__');
          let meta = null;
          if (idx >= 0) { try { meta = JSON.parse(raw.slice(idx + '__GM_META__'.length)); } catch (_) {} }
          return writeWasmJson(instanceRef.value, {
            ok: result.status === 0 && !!meta && !meta.error,
            stdout: idx >= 0 ? raw.slice(0, idx) : raw,
            stderr: result.stderr || '',
            exit_code: result.status === null ? -1 : result.status,
            timed_out: __execTimedOut,
            duration_ms: __execDurMs,
            result: meta ? meta.result : null,
            mem: meta ? meta.mem : null,
            wall_ms: meta ? meta.wall_ms : null,
            ...(meta && meta.error ? { error: meta.error } : {}),
            ...(__spawnError ? { spawn_error: __spawnError } : {}),
          });
        }
        let __defStdout = result.stdout || '';
        let __defResult = null;
        let __defHasResult = false;
        if (isJsLang) {
          const __ri = __defStdout.lastIndexOf('__GM_RESULT__');
          if (__ri >= 0) {
            const __tail = __defStdout.slice(__ri + '__GM_RESULT__'.length);
            const __nl = __tail.indexOf('\n');
            const __jsonStr = __nl >= 0 ? __tail.slice(0, __nl) : __tail;
            try { __defResult = JSON.parse(__jsonStr); __defHasResult = true; } catch (_) {}
            // Strip the __GM_RESULT__ sentinel line (console.log emits it on its
            // own line after the user's output) so the caller's stdout is clean.
            let __clean = __defStdout.slice(0, __ri) + (__nl >= 0 ? __tail.slice(__nl + 1) : '');
            if (__clean.endsWith('\n')) __clean = __clean.slice(0, -1);
            __defStdout = __clean;
          }
        }
        return writeWasmJson(instanceRef.value, {
          ok: result.status === 0,
          stdout: __defStdout,
          stderr: result.stderr || '',
          exit_code: result.status === null ? -1 : result.status,
          timed_out: __execTimedOut,
          duration_ms: __execDurMs,
          ...(__defHasResult ? { result: __defResult } : {}),
          ...(__spawnError ? { spawn_error: __spawnError } : {}),
          ...(profileSkipped ? { profile_skipped: profileSkipped } : {}),
        });
      } catch (e) {
        return writeWasmJson(instanceRef.value, { ok: false, error: e.message });
      }
    },

    host_log: (level, msgPtr, msgLen) => {
      try {
        try { _writeStatusBusy(120000); } catch (_) {}
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
        crypto.randomFillSync(new Uint8Array(buf, ptr >>> 0, len >>> 0));   // >>>0: high-bit ptr is negative in JS
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
            stdout: `Session ${pwSessionId} attached to locally-profiled chromium at ${sessionProfileDir(cwd, sessionId)}`,
            stderr: '',
            exit_code: 0,
            session_id: pwSessionId,
            hint: 'Reuse this same session for every browser dispatch this run (the spool sessionId selects it); a different sessionId opens its OWN chromium. Close it with `session close` when done -- the idle/orphan reaper is only a backstop.',
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

        const wasIdleClosed = __idleClosedSessions.has(sessionId);
        const pwSessionId = getOrCreateBrowserSession(cwd, sessionId, pw);
        const curPid = (() => { try { const e = readJsonFile(browserPortsFile(cwd), {})[sessionId]; return e && e.pid; } catch (_) { return null; } })();
        const wasRelaunched = wasIdleClosed;
        __idleClosedSessions.delete(sessionId);
        stampBrowserLastUse(cwd, sessionId);
        markInflight(sessionId, curPid);
        {
          const bodyForShapeCheck = trimmed.replace(/^(?:timeout=\d+\s*\n|url=\S+[ \t]*\n)*/, '').trim();
          if (/^\{/.test(bodyForShapeCheck)) {
            return writeWasmJson(instanceRef.value, {
              ok: false,
              stdout: '',
              stderr: 'browser verb body is a JSON object, not a supported body shape. The browser verb takes plain-text prefixed bodies only: "session new", "session close", "timeout=<ms>\\n<expr>", "url=<target>\\n<expr>", a bare URL, "screenshot[=name]\\n<expr>", "dom=<selector>\\n<expr>", or "capture|profile|trace ...\\n<expr>" -- never a {"command":...} JSON payload. Use "session new" to open a session, then "url=<target>\\n<js-expression>" to navigate and evaluate in one dispatch.',
              exit_code: 1,
            });
          }
        }
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
        let startUrl = null;
        const urlMatch = evalBody.match(/^url=(\S+)[ \t]*\n([\s\S]*)$/);
        if (urlMatch) {
          startUrl = urlMatch[1];
          evalBody = urlMatch[2];
        } else {
          const bare = evalBody.trim();
          if (/^https?:\/\/\S+$/.test(bare)) {
            startUrl = bare;
            evalBody = 'return {url: page.url(), title: await page.title()};';
          }
        }
        let screenshotPath = null;
        const shotMatch = evalBody.match(/^screenshot(?:=(\S+))?[ \t]*\n([\s\S]*)$/);
        if (shotMatch) {
          const witnessDir = path.join(browserRootDir(cwd), '.gm', 'witness');
          try { fs.mkdirSync(witnessDir, { recursive: true }); } catch (_) {}
          const reqName = shotMatch[1] ? path.basename(shotMatch[1]).replace(/[^A-Za-z0-9._-]/g, '_') : '';
          const fname = (reqName && /\.png$/i.test(reqName)) ? reqName : `shot-${process.pid}-${execProfileSeq++}.png`;
          screenshotPath = path.join(witnessDir, fname);
          evalBody = shotMatch[2];
        }
        let domSelector = null;
        const domMatch = evalBody.match(/^dom=(.+?)[ \t]*\n([\s\S]*)$/);
        if (domMatch) {
          domSelector = domMatch[1];
          evalBody = domMatch[2] && domMatch[2].trim() ? domMatch[2] : 'return null;';
        }
        const navTimeout = Math.min(timeoutMs, 120000);
        const gotoPrefix = startUrl
          ? `await page.goto(${JSON.stringify(startUrl)},{waitUntil:'load',timeout:${navTimeout}});\n`
          : '';
        const modeMatch = evalBody.match(/^(capture|profile|trace)((?:[ \t]+(?:interval|topN)=\d+)*)[ \t]*\n([\s\S]*)$/);
        const modeOpts = modeMatch ? modeMatch[2] : '';
        const __intervalM = modeOpts.match(/interval=(\d+)/);
        const __topNM = modeOpts.match(/topN=(\d+)/);
        const sampleIntervalUs = __intervalM && parseInt(__intervalM[1], 10) > 0 ? parseInt(__intervalM[1], 10) : 100;
        const profileTopNBrowser = __topNM && parseInt(__topNM[1], 10) > 0 ? parseInt(__topNM[1], 10) : 20;
        // Real, pre-existing bug fixed here: this block previously called `page.evaluateOnNewDocument`,
        // which is a PUPPETEER method name -- playwriter's `page` object is a real Playwright Page,
        // whose equivalent is `page.addInitScript`. evaluateOnNewDocument does not exist on a
        // Playwright page, so both calls threw `TypeError: page.evaluateOnNewDocument is not a
        // function` on every single dispatch, silently swallowed by the enclosing try/catch -- meaning
        // window.__gmErrors (window.onerror/onunhandledrejection capture) was NEVER actually installed,
        // for as long as this code has existed, independent of the new GL-instrumentation block added
        // alongside it (which inherited the same wrong method name by copying the existing pattern).
        // Verified live: window.HTMLCanvasElement.prototype.getContext.toString() did not contain the
        // patch marker before this fix, confirming the pre-navigation init script never ran.
        const debugSetup = `const __logs=[],__errs=[],__net=[];\n`
          + `try{page.on('console',m=>{try{__logs.push({type:m.type(),text:m.text()});}catch(_){}});`
          + `page.on('pageerror',e=>{try{__errs.push({type:'pageerror',msg:String(e&&e.message||e)});}catch(_){}});`
          + `page.on('error',e=>{try{__errs.push({type:'uncaught',msg:String(e&&e.message||e),stack:String(e&&e.stack||'')});}catch(_){}});`
          + `page.on('requestfinished',r=>{try{const t=r.timing();let __st=0,__sz=0;try{__st=(r.response()&&r.response().status())||0;}catch(_){}__net.push({url:String(r.url()).slice(0,120),method:r.method(),status:__st,dur_ms:Math.round(t.responseEnd),ttfb_ms:Math.round(t.responseStart)});}catch(_){}});`
          + `page.on('requestfailed',r=>{try{const err=r.failure();__errs.push({type:'fetch',msg:String(err&&err.errorText||'request failed'),url:String(r.url()).slice(0,120)});}catch(_){}});`
          + `await page.addInitScript(()=>{window.__gmErrors=[];window.onerror=(msg,src,line,col,err)=>{try{window.__gmErrors.push({type:'error',msg:String(msg),src:String(src).slice(0,80),line,col,stack:String(err&&err.stack||'')});}catch(_){};return false;};window.onunhandledrejection=(e)=>{try{window.__gmErrors.push({type:'unhandledRejection',msg:String(e.reason&&e.reason.message||e.reason),stack:String(e.reason&&e.reason.stack||'')});}catch(_){}};});`
          // Auto-instrument every canvas's WebGL/WebGL2 context: patch getContext once (idempotent,
          // pre-navigation via page.addInitScript so it is in place before the page's own first
          // getContext call) to wrap every draw call (drawArrays/drawElements and their -Instanced
          // variants) with a post-call gl.getError() drain. This is exactly the manual
          // gl.*=function(){...gl.getError()...} monkeypatch pattern used ad hoc to root-cause GPU
          // rendering bugs (stale VAO/buffer bindings, sampler-unit collisions, etc) -- making it a
          // standing, zero-setup capability means every browser-verb dispatch against a WebGL page
          // gets GL error visibility for free, without hand-rolling the instrumentation each time.
          // window.__gmGlErrors accumulates {fn,mode,count,offset,type,error,errorName,ctxLabel} for
          // up to 40 distinct GL errors per page load (capped to bound memory on a runaway-error page);
          // window.__gmGlDrawCalls is a running total per draw-fn name for volume context.
          // DESIGN NOTES (2026-07-17, fixing two real gaps hit live debugging a session-reported FPS
          // regression): (1) the original cap was "first 40 occurrences, ever, per page load, then
          // silently stop recording" -- on a bug that fires every frame, the array fills in <1s and
          // every subsequent browser dispatch for the rest of a long debugging session reads the exact
          // same stale 9-or-so entries, making it look like the error stopped recurring or is capped/
          // dead when it is actually still firing every frame. Fixed to a per-SIGNATURE (fn+error+mode+
          // count+instanceCount) dedup table with an occurrence COUNTER and lastSeenDrawCallIndex, so a
          // recurring error updates its own entry's count/lastSeen instead of being dropped once 40 raw
          // occurrences have ever been logged -- growth is now bounded by DISTINCT error shapes (a
          // realistic page has a handful, not thousands), not raw occurrence volume, and a caller can
          // tell "still happening, N times so far, most recently at draw #X" instead of a dead list.
          // (2) no error entry carried a JS stack trace, forcing the exact same
          // gl.drawX=function(){...new Error().stack...} monkeypatch to be hand-rolled from scratch in
          // every debugging session that needed to know WHICH call site triggered a given GL error --
          // captured here once, for free, on first occurrence of each distinct signature (capturing on
          // EVERY occurrence would be wasteful once a hot per-frame error has fired thousands of times;
          // the call site for a given signature does not change across occurrences in practice).
          + `await page.addInitScript(()=>{`
          +   `window.__gmGlErrors=[];window.__gmGlDrawCalls={};window.__gmGlErrorTotalCount=0;`
          +   `const __glErrName=(gl,code)=>{for(const k of ['NO_ERROR','INVALID_ENUM','INVALID_VALUE','INVALID_OPERATION','INVALID_FRAMEBUFFER_OPERATION','OUT_OF_MEMORY','CONTEXT_LOST_WEBGL']){try{if(gl[k]===code)return k;}catch(_){}}return 'UNKNOWN_'+code;};`
          +   `const __wrapDraw=(gl,ctxLabel)=>{`
          +     `['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'].forEach(fn=>{`
          +       `if(typeof gl[fn]!=='function'||gl[fn].__gmWrapped)return;`
          +       `const __orig=gl[fn].bind(gl);`
          +       `const __wrapped=function(...args){`
          +         `const __res=__orig(...args);`
          +         `window.__gmGlDrawCalls[fn]=(window.__gmGlDrawCalls[fn]||0)+1;`
          +         `const __err=gl.getError();`
          +         `window.__gmGlLastDrainedError={fn,error:__err,errorName:__glErrName(gl,__err),drawCallIndex:window.__gmGlDrawCalls[fn]};` // last-drained-code accessor: a user script's OWN post-draw gl.getError() call always reads NO_ERROR (this wrapper already drained the single-slot GL error queue first) -- read this instead of calling gl.getError() again in user code.
          +         `if(__err!==gl.NO_ERROR){`
          +           `window.__gmGlErrorTotalCount++;`
          +           `let __bufSize=-1;try{__bufSize=gl.getBufferParameter(gl.ELEMENT_ARRAY_BUFFER,gl.BUFFER_SIZE);}catch(_){}`
          +           `const __sig=fn+'|'+__err+'|'+args[0]+'|'+args[1]+'|'+(fn.indexOf('Instanced')>=0?args[args.length-1]:'');`
          +           `let __rec=window.__gmGlErrors.find(e=>e.__sig===__sig);`
          +           `if(__rec){__rec.occurrenceCount++;__rec.lastDrawCallIndex=window.__gmGlDrawCalls[fn];}`
          +           `else if(window.__gmGlErrors.length<40){`
          +             `let __stack='';try{__stack=new Error().stack.split('\\n').slice(1,9).join(' | ');}catch(_){}`
          +             `window.__gmGlErrors.push({__sig,fn,ctxLabel,mode:args[0],count:args[1],offset:fn.indexOf('Elements')>=0?args[3]:undefined,type:fn.indexOf('Elements')>=0?args[2]:undefined,instanceCount:fn.indexOf('Instanced')>=0?args[args.length-1]:undefined,error:__err,errorName:__glErrName(gl,__err),elementArrayBufferSize:__bufSize,firstDrawCallIndex:window.__gmGlDrawCalls[fn],lastDrawCallIndex:window.__gmGlDrawCalls[fn],occurrenceCount:1,stack:__stack});`
          +           `}`
          +         `}`
          +         `return __res;`
          +       `};`
          +       `__wrapped.__gmWrapped=true;gl[fn]=__wrapped;`
          +     `});`
          +   `};`
          +   `const __origGetContext=HTMLCanvasElement.prototype.getContext;`
          +   `HTMLCanvasElement.prototype.getContext=function(type,...rest){`
          +     `const ctx=__origGetContext.call(this,type,...rest);`
          +     `if(ctx&&(type==='webgl'||type==='webgl2'||type==='experimental-webgl')&&typeof ctx.getError==='function'){try{__wrapDraw(ctx,type);}catch(_){}}`
          +     `return ctx;`
          +   `};`
          + `});`
          + `}catch(_){}\n`;
        const perfRead = `let __perf=null;try{__perf=await page.evaluate(async()=>{const n=performance.getEntriesByType('navigation')[0];const paints={};for(const p of performance.getEntriesByType('paint')){paints[p.name]=Math.round(p.startTime);}let lcp=0;try{const le=performance.getEntriesByType('largest-contentful-paint');if(le.length)lcp=Math.round(le[le.length-1].startTime);}catch(_){}let cls=0;try{for(const ls of performance.getEntriesByType('layout-shift')){if(!ls.hadRecentInput)cls+=ls.value;}}catch(_){}let longtasks=0;try{longtasks=performance.getEntriesByType('longtask').length;}catch(_){}let heapU=0,heapT=0;try{if(performance.memory){heapU=Math.round(performance.memory.usedJSHeapSize/10485.76)/100;heapT=Math.round(performance.memory.totalJSHeapSize/10485.76)/100;}}catch(_){}const fps=await new Promise(res=>{let f=0;const s=performance.now();function tick(){f++;if(performance.now()-s>=500)return res(Math.round(f/((performance.now()-s)/1000)));requestAnimationFrame(tick);}requestAnimationFrame(tick);});return{load_ms:n?Math.round(n.loadEventEnd||0):0,dcl_ms:n?Math.round(n.domContentLoadedEventEnd||0):0,resources:performance.getEntriesByType('resource').length,now:Math.round(performance.now()),first_paint_ms:paints['first-paint']||0,first_contentful_paint_ms:paints['first-contentful-paint']||0,largest_contentful_paint_ms:lcp,cumulative_layout_shift:Math.round(cls*1000)/1000,longtasks,fps,heap_used_mb:heapU,heap_total_mb:heapT};});}catch(_){}\n`;
        const blankProbe = startUrl ? '' : `try{const __u=page.url();if(__u==='about:blank'||__u===''){console.error('__GM_BLANK__');}}catch(_){}\n`;
        const netFmt = `__net.slice().sort((a,b)=>(b.dur_ms||0)-(a.dur_ms||0)).slice(0,30)`;
        const consoleFmt = `(__logs.length>50?[...__logs.slice(0,50),{type:'meta',text:'... '+(__logs.length-50)+' more console entries dropped'}]:__logs)`;
        // playwriter's own executor.js truncates the DISPLAYED stdout text at a fixed 10000 chars
        // ("[Truncated to 10000 characters...]"), which silently ate the __GM_RESULT__ sentinel line
        // (always appended LAST, after any real console.log volume from the page/debug capture) on
        // any dispatch whose combined console output exceeded that cap -- the exact common case once
        // debug capture became always-on. Writing the result to a dedicated file from inside the
        // executed script, then reading that file directly (bypassing playwriter's own stdout
        // formatting entirely), makes result delivery immune to output volume.
        const resultFile = path.join(os.tmpdir(), `gm-browser-result-${process.pid}-${execProfileSeq++}.json`);
        const emitResult = `try{require('fs').writeFileSync(${JSON.stringify(resultFile)},JSON.stringify(__RET===undefined?null:__RET));}catch(__se){try{require('fs').writeFileSync(${JSON.stringify(resultFile)},JSON.stringify({__unserializable:String(__se&&__se.message||__se)}));}catch(__se2){}}\n`;
        if (modeMatch && modeMatch[1] === 'profile') {
          const userScript = modeMatch[3];
          const intervalUs = sampleIntervalUs;
          evalBody = debugSetup
            + `let __profile=null,__profileError=null;\n`
            + `let __cdp=null;\n`
            + `try{__cdp=await page.context().newCDPSession(page);await __cdp.send('Profiler.enable');await __cdp.send('Profiler.setSamplingInterval',{interval:${intervalUs}});await __cdp.send('Profiler.start');}catch(e){__profileError=String(e&&e.message||e);__cdp=null;}\n`
            + `const __wallT0=Date.now();\n`
            + `const __result = await (async () => {\n${blankProbe}${gotoPrefix}try{${userScript}}catch(e){__errs.push({type:'exec',msg:String(e&&e.message||e),stack:String(e&&e.stack||'')});throw e;}\n})();\n`
            + `const __wallUs=(Date.now()-__wallT0)*1000;\n`
            + `if(__cdp){try{const __r=await __cdp.send('Profiler.stop');__profile=__r&&__r.profile||null;}catch(e){__profileError=String(e&&e.message||e);}}\n`
            + `const __wmErrors=await page.evaluate(()=>window.__gmErrors||[]);\n`
            + `const __glErrors=await page.evaluate(()=>window.__gmGlErrors||[]).catch(()=>[]);\n`
            + `const __glDrawCalls=await page.evaluate(()=>window.__gmGlDrawCalls||{}).catch(()=>({}));\n`
            + `const __glErrorTotalCount=await page.evaluate(()=>window.__gmGlErrorTotalCount||0).catch(()=>0);\n`
            + perfRead
            + AGGREGATE_CPU_PROFILE_SRC + `\n`
            + `const __agg = __profile ? aggregateCpuProfile(__profile, ${profileTopNBrowser}, true) : {timeframe:null,culprits:[]};\n`
            + `const __cpuUs=__agg.timeframe?__agg.timeframe.total_us:0;\n`
            + `const __wallVsCpu={wall_us:__wallUs,cpu_self_us:__cpuUs,offcpu_us:Math.max(0,__wallUs-__cpuUs),note:'offcpu_us = wall minus on-CPU JS self time = GPU/compositor/raster/IO/idle the CPU sampler is blind to; use trace mode to attribute GPU activity'};\n`
            + `const __allErrors=[...__errs,...__wmErrors];\n`
            + `const __RET={result:__result,profile:__agg,profile_error:__profileError,wall_vs_cpu:__wallVsCpu,debug:{console:${consoleFmt},pageErrors:__allErrors,network:${netFmt},performance:__perf,gl:{errors:__glErrors,drawCalls:__glDrawCalls,errorTotalCount:__glErrorTotalCount}}};\n`
            + emitResult + `return __RET;`;
        } else if (modeMatch && modeMatch[1] === 'trace') {
          const userScript = modeMatch[3];
          evalBody = debugSetup
            + `let __traceEvents=[],__traceError=null,__cdp=null,__traceComplete=false;\n`
            + `const __traceCats=['gpu','disabled-by-default-gpu.service','viz','cc','blink','devtools.timeline','toplevel','rail'];\n`
            + `try{__cdp=await page.context().newCDPSession(page);__cdp.on('Tracing.dataCollected',p=>{if(p&&p.value)__traceEvents.push(...p.value);});await __cdp.send('Tracing.start',{traceConfig:{includedCategories:__traceCats},transferMode:'ReportEvents',bufferUsageReportingInterval:0});}catch(e){__traceError='start:'+String(e&&e.message||e);__cdp=null;}\n`
            + `const __wallT0=Date.now();\n`
            + `const __result = await (async () => {\n${blankProbe}${gotoPrefix}try{${userScript}}catch(e){__errs.push({type:'exec',msg:String(e&&e.message||e),stack:String(e&&e.stack||'')});throw e;}\n})();\n`
            + `const __wallUs=(Date.now()-__wallT0)*1000;\n`
            + `if(__cdp){const __done=new Promise(res=>{__cdp.once('Tracing.tracingComplete',()=>res(true));setTimeout(()=>res(false),Math.min(${Math.min(navTimeout, 10000)},10000));});try{await __cdp.send('Tracing.end');}catch(e){__traceError=(__traceError||'')+' end:'+String(e&&e.message||e);}__traceComplete=await __done;}\n`
            + `const __wmErrors=await page.evaluate(()=>window.__gmErrors||[]);\n`
            + `const __glErrors=await page.evaluate(()=>window.__gmGlErrors||[]).catch(()=>[]);\n`
            + `const __glDrawCalls=await page.evaluate(()=>window.__gmGlDrawCalls||{}).catch(()=>({}));\n`
            + `const __glErrorTotalCount=await page.evaluate(()=>window.__gmGlErrorTotalCount||0).catch(()=>0);\n`
            + perfRead
            + `const __byCat={};let __minTs=Infinity,__maxTs=-Infinity;for(const ev of __traceEvents){if(typeof ev.ts==='number'){__minTs=Math.min(__minTs,ev.ts);if(typeof ev.dur==='number')__maxTs=Math.max(__maxTs,ev.ts+ev.dur);}if(typeof ev.dur==='number'&&ev.dur>0){const c=ev.cat||'?';__byCat[c]=(__byCat[c]||0)+ev.dur;}}\n`
            + `const __sum=(re)=>Object.entries(__byCat).filter(([k])=>re.test(k)).reduce((a,[,v])=>a+v,0);\n`
            + `const __gpuUs=__sum(/gpu|graphics\\.pipeline/),__vizUs=__sum(/viz/),__ccUs=__sum(/\\bcc\\b/),__rasterUs=__sum(/raster/);\n`
            + `const __topCats=Object.entries(__byCat).sort((a,b)=>b[1]-a[1]).slice(0,15).map(([cat,us])=>({cat,wall_us:us}));\n`
            + `const __spanUs=(isFinite(__minTs)&&__maxTs>0)?(__maxTs-__minTs):0;\n`
            + `const __allErrors=[...__errs,...__wmErrors];\n`
            + `const __RET={result:__result,trace:{wall_us:__wallUs,trace_span_us:__spanUs,event_count:__traceEvents.length,complete:__traceComplete,gpu_us:__gpuUs,viz_us:__vizUs,cc_us:__ccUs,raster_us:__rasterUs,offcpu_note:'gpu_us/viz_us/cc_us are wall-clock GPU-process activity (compositor/raster/draw) captured via CDP Tracing -- the CPU sampler cannot see these',by_category:__topCats},trace_error:__traceError,debug:{console:${consoleFmt},pageErrors:__allErrors,network:${netFmt},performance:__perf,gl:{errors:__glErrors,drawCalls:__glDrawCalls,errorTotalCount:__glErrorTotalCount}}};\n`
            + emitResult + `return __RET;`;
        } else if (modeMatch && modeMatch[1] === 'capture') {
          const userScript = modeMatch[3];
          evalBody = debugSetup
            + `const __result = await (async () => {\n${blankProbe}${gotoPrefix}try{${userScript}}catch(e){__errs.push({type:'exec',msg:String(e&&e.message||e),stack:String(e&&e.stack||'')});throw e;}\n})();\n`
            + `const __wmErrors=await page.evaluate(()=>window.__gmErrors||[]);\n`
            + `const __glErrors=await page.evaluate(()=>window.__gmGlErrors||[]).catch(()=>[]);\n`
            + `const __glDrawCalls=await page.evaluate(()=>window.__gmGlDrawCalls||{}).catch(()=>({}));\n`
            + `const __glErrorTotalCount=await page.evaluate(()=>window.__gmGlErrorTotalCount||0).catch(()=>0);\n`
            + perfRead
            + `const __allErrors=[...__errs,...__wmErrors];\n`
            + `const __RET={result:__result,debug:{console:${consoleFmt},pageErrors:__allErrors,network:${netFmt},performance:__perf,gl:{errors:__glErrors,drawCalls:__glDrawCalls,errorTotalCount:__glErrorTotalCount}}};\n`
            + emitResult + `return __RET;`;
        } else if (screenshotPath) {
          // Every path below (screenshot, DOM query, plain URL/eval, bare eval) now attaches the SAME
          // debugSetup + debug:{console,pageErrors,network,performance} envelope that `capture` already
          // had -- console.log/pageerror/uncaught-exception/failed-request/perf data was previously
          // silently dropped on every dispatch that didn't explicitly type the `capture` prefix, which
          // meant the single most common case (navigate + do something + screenshot/return a value) had
          // zero visibility into what the page actually logged or errored on. Debugging a live page
          // should never require remembering to opt in to seeing its own console/errors.
          evalBody = debugSetup
            + `const __result = await (async () => {\n${blankProbe}${gotoPrefix}try{${evalBody}}catch(e){__errs.push({type:'exec',msg:String(e&&e.message||e),stack:String(e&&e.stack||'')});throw e;}\n})();\n`
            + `let __shotErr=null;try{await page.screenshot({path:${JSON.stringify(screenshotPath)},fullPage:false});}catch(e){__shotErr=String(e&&e.message||e);}\n`
            + `const __wmErrors=await page.evaluate(()=>window.__gmErrors||[]);\n`
            + `const __glErrors=await page.evaluate(()=>window.__gmGlErrors||[]).catch(()=>[]);\n`
            + `const __glDrawCalls=await page.evaluate(()=>window.__gmGlDrawCalls||{}).catch(()=>({}));\n`
            + `const __glErrorTotalCount=await page.evaluate(()=>window.__gmGlErrorTotalCount||0).catch(()=>0);\n`
            + perfRead
            + `const __allErrors=[...__errs,...__wmErrors];\n`
            + `const __RET={result:__result,screenshot_path:${JSON.stringify(screenshotPath)},screenshot_error:__shotErr,debug:{console:${consoleFmt},pageErrors:__allErrors,network:${netFmt},performance:__perf,gl:{errors:__glErrors,drawCalls:__glDrawCalls,errorTotalCount:__glErrorTotalCount}}};\n`
            + emitResult + `return __RET;`;
        } else if (domSelector) {
          evalBody = debugSetup
            + `${blankProbe}${gotoPrefix}let __RET;try{__RET=await page.evaluate((sel)=>{const out=[];const els=document.querySelectorAll(sel);for(let i=0;i<Math.min(els.length,20);i++){const e=els[i];const r=e.getBoundingClientRect();const attrs={};for(const a of e.attributes)attrs[a.name]=String(a.value).slice(0,120);out.push({tag:e.tagName.toLowerCase(),text:(e.textContent||'').trim().slice(0,200),attrs,visible:!!(r.width&&r.height),rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}});}return{selector:sel,match_count:els.length,elements:out};},${JSON.stringify(domSelector)});}catch(e){__RET={selector:${JSON.stringify(domSelector)},error:String(e&&e.message||e),match_count:0,elements:[]};}\n`
            + `const __wmErrors=await page.evaluate(()=>window.__gmErrors||[]);\n`
            + `const __glErrors=await page.evaluate(()=>window.__gmGlErrors||[]).catch(()=>[]);\n`
            + `const __glDrawCalls=await page.evaluate(()=>window.__gmGlDrawCalls||{}).catch(()=>({}));\n`
            + `const __glErrorTotalCount=await page.evaluate(()=>window.__gmGlErrorTotalCount||0).catch(()=>0);\n`
            + perfRead
            + `const __allErrors=[...__errs,...__wmErrors];\n`
            + `__RET={...__RET,debug:{console:${consoleFmt},pageErrors:__allErrors,network:${netFmt},performance:__perf,gl:{errors:__glErrors,drawCalls:__glDrawCalls,errorTotalCount:__glErrorTotalCount}}};\n`
            + emitResult + `return __RET;`;
        } else {
          // startUrl and/or blankProbe and/or bare-eval all collapse into this single branch now --
          // same debug-envelope treatment as every other path above.
          evalBody = debugSetup
            + `${blankProbe}${gotoPrefix}const __result = await (async () => {try{${evalBody}}catch(e){__errs.push({type:'exec',msg:String(e&&e.message||e),stack:String(e&&e.stack||'')});throw e;}})();\n`
            + `const __wmErrors=await page.evaluate(()=>window.__gmErrors||[]);\n`
            + `const __glErrors=await page.evaluate(()=>window.__gmGlErrors||[]).catch(()=>[]);\n`
            + `const __glDrawCalls=await page.evaluate(()=>window.__gmGlDrawCalls||{}).catch(()=>({}));\n`
            + `const __glErrorTotalCount=await page.evaluate(()=>window.__gmGlErrorTotalCount||0).catch(()=>0);\n`
            + perfRead
            + `const __allErrors=[...__errs,...__wmErrors];\n`
            + `const __RET={result:__result,debug:{console:${consoleFmt},pageErrors:__allErrors,network:${netFmt},performance:__perf,gl:{errors:__glErrors,drawCalls:__glDrawCalls,errorTotalCount:__glErrorTotalCount}}};\n`
            + emitResult + `return __RET;`;
        }
        const outerTimeoutMs = Math.min(timeoutMs + 6000, 126000);
        let r;
        // Route the script through a temp file (-f) instead of inlining it on the command line (-e).
        // Bun on Windows has known fixed-size-buffer index-out-of-bounds panics ("index out of bounds:
        // index N, len 2048/4095/4096...", a real oven-sh/bun bug class, not user-code-triggerable
        // from a JS bug) that fire on sufficiently long argv/command-line content -- the debug/GL
        // instrumentation prelude alone is >2KB, so ANY non-trivial user script pushed the combined
        // argv over that threshold and crashed the whole `bun x` invocation outright (visible as
        // `panic(main thread): index out of bounds` with a Bun crash-report link, not a script error).
        // A temp .js file has no such length limit -- this sidesteps the Bun bug class entirely rather
        // than working around it script-by-script.
        const scriptFile = path.join(os.tmpdir(), `gm-browser-eval-${process.pid}-${execProfileSeq++}.js`);
        try {
          fs.writeFileSync(scriptFile, evalBody, 'utf-8');
          r = runBrowserRunner(pw, ['-s', pwSessionId, '--timeout', String(timeoutMs), '-f', scriptFile], outerTimeoutMs, cwd, sessionId);
        } finally {
          try { fs.unlinkSync(scriptFile); } catch (_) {}
          clearInflight(sessionId);
          stampBrowserLastUse(cwd, sessionId);
        }
        const ok = r.status === 0;
        if (!ok && r.status === null) {
          logEvent('plugkit', 'browser.runner-timeout', { session_id: pwSessionId, timeout_ms: timeoutMs, body_bytes: evalBody.length });
        }
        const rawStderr = r.stderr || '';
        const landedOnBlank = !startUrl && rawStderr.includes('__GM_BLANK__');
        // Read the real result from resultFile (written by emitResult inside the executed script) --
        // NOT parsed out of playwriter's own stdout, which truncates its displayed text at a fixed
        // 10000 chars regardless of how much real data the script actually produced. This is the
        // authoritative result channel; stdout below is kept only for genuine console.log visibility,
        // no longer load-bearing for the actual return value.
        let parsedResult;
        let resultParsed = false;
        try {
          const resultFileContent = fs.readFileSync(resultFile, 'utf-8');
          parsedResult = JSON.parse(resultFileContent);
          resultParsed = true;
        } catch (_) {
          // Script threw before reaching emitResult, or the runner itself failed/timed out before the
          // page-side code ever ran -- resultParsed stays false, envelope.result is simply absent,
          // exactly matching the pre-fix behavior for a script that never printed __GM_RESULT__.
        } finally {
          try { fs.unlinkSync(resultFile); } catch (_) {}
        }
        const rawStdout = r.stdout || '';
        const envelope = {
          ok,
          stdout: scrubBrowserRunnerText(rawStdout),
          stderr: scrubBrowserRunnerText(rawStderr.replace(/^__GM_BLANK__\r?\n?/gm, '')),
          exit_code: r.status === null ? -1 : r.status,
          session_id: pwSessionId,
          timeout_ms_used: timeoutMs,
        };
        if (resultParsed) envelope.result = parsedResult;
        if (wasRelaunched) {
          envelope.session_relaunched = true;
          envelope.relaunch_note = 'This session was closed (idle/orphan reaper) and re-launched fresh -- any window.* globals or in-page state from earlier dispatches are gone. Re-establish them before relying on them.';
        }
        envelope.navigation_requested = !!startUrl;
        if (__openedSessionIds.size > 1) {
          envelope.multi_session_warning = `${__openedSessionIds.size} distinct browser sessions opened this run, each its own chromium -- reuse ONE sessionId per run and 'session close' it when done to avoid leaking browsers.`;
        }
        if (landedOnBlank) {
          envelope.landed_on_blank = true;
          envelope.hint = "page is about:blank: this dispatch did not navigate, so the expression evaluated against an empty page. Prefix the body with 'url=<target>' (or send a bare 'https://...' URL) to open the page you want before evaluating.";
        }
        return writeWasmJson(instanceRef.value, envelope);
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
      const u = BigInt.asUintN(64, result);   // normalize the i64 to unsigned before splitting (signed-ptr fix)
      ptr = Number(u & 0xffffffffn);
      len = Number(u >> 32n);
    } else {
      ptr = Number(result) >>> 0;   // unsigned 32-bit
      len = 0;
    }
    const buf = new Uint8Array(instance.exports.memory.buffer, ptr, 64);   // fresh buffer (post fn() grow)
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

  // A heartbeat must exist BEFORE any boot step that can block for a while (the
  // browser-runner orphan reaps below shell out to `bun x playwriter@latest`, a
  // network-bound resolution that can run long under real network degradation).
  // The full writeStatus/_writeStatusBusy pair is defined ~1000 lines later in
  // this function (it needs _bootReason/_supervisorPid/_instanceVersionAtBoot/
  // IDLE_LIMIT_MS, all assigned further down) -- calling _writeStatusBusy from
  // runBrowserRunner during these early reaps was a no-op (undefined) until that
  // point, so the supervisor's heartbeat-stale check (30s, no busy_until to
  // shield it) killed the watcher every ~10s before it ever wrote a real status,
  // an unrecoverable respawn loop. Write a minimal, dependency-free heartbeat with
  // a busy window up front (real writeStatus() overwrites it correctly once its
  // dependencies exist) so the supervisor sees genuine liveness immediately.
  try {
    fs.writeFileSync(path.join(spoolDir, '.status.json'), JSON.stringify({
      pid: process.pid,
      ts: Date.now(),
      busy_until: Date.now() + 60000,
    }));
  } catch (_) {}

  try {
    const gmDir = path.dirname(spoolDir);
    fs.writeFileSync(path.join(gmDir, 'last-instruction-ts'), String(Date.now()));
    fs.writeFileSync(path.join(gmDir, 'long-gap-retry-state'), '');
  } catch (_) {}

  try { reapOrphanBrowserSessions(findBrowserRunner(), process.cwd(), process.env.CLAUDE_SESSION_ID || 'claude-loop-iter', 'watcher-boot'); } catch (_) {}
  try { reapOrphanChromiums(process.cwd(), 'watcher-boot'); } catch (_) {}


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
            if (pidIsPlugkitProcess(holderPidNum)) {
              writeKillAttribution(spoolDir, { reason: 'peer-stale-takeover', target_pid: holderPidNum, via: 'lock-takeover', holder_sha: holderSha });
              try { process.kill(holderPidNum, 'SIGTERM'); } catch (_) {}
            } else {
              try { logEvent('plugkit', 'takeover-kill-skipped-pid-reused', { holder_pid: pidStr }); } catch (_) {}
            }
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

  function sweepStaleAtomicTmpFiles(dir, maxAgeMs) {
    try {
      const entries = fs.readdirSync(dir);
      const now = Date.now();
      for (const name of entries) {
        if (!/\.tmp(\.|$)/.test(name)) continue;
        const full = path.join(dir, name);
        try {
          const st = fs.statSync(full);
          if (now - st.mtimeMs > maxAgeMs) fs.unlinkSync(full);
        } catch (_) {}
      }
    } catch (_) {}
  }
  sweepStaleAtomicTmpFiles(GM_TOOLS_ROOT, 10 * 60 * 1000);

  const PEER_REGISTRY_PATH = path.join(GM_TOOLS_ROOT, 'peer-registry.json');
  function registerSelfAsPeer() {
    try {
      let reg = {};
      try { reg = JSON.parse(fs.readFileSync(PEER_REGISTRY_PATH, 'utf-8')); } catch (_) {}
      reg[process.cwd()] = { pid: process.pid, ts: Date.now(), sha: _ownWrapperSha12 };
      atomicWriteJson(PEER_REGISTRY_PATH, reg);
    } catch (_) {}
  }
  registerSelfAsPeer();
  setInterval(registerSelfAsPeer, 30_000);

  function sweepStalePeers() {
    if (!_ownWrapperSha12) return;
    let reg = {};
    try { reg = JSON.parse(fs.readFileSync(PEER_REGISTRY_PATH, 'utf-8')); } catch (_) { return; }
    const ownRoot = browserRootDir(process.cwd());
    for (const peerCwd of Object.keys(reg)) {
      if (peerCwd === process.cwd()) continue;
      if (browserRootDir(peerCwd) !== ownRoot) continue;
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
      if (!pidIsPlugkitProcess(peerPid)) {
        logEvent('plugkit', 'peer.kill-skipped-pid-reused', { peer_cwd: peerCwd, peer_pid: peerPid });
        continue;
      }
      writeKillAttribution(path.join(peerCwd, '.gm', 'exec-spool'), { reason: 'peer-stale-takeover', target_pid: peerPid, via: 'peer-sweep', peer_sha: peerSha, own_sha: _ownWrapperSha12 });
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
      try { __inflightDispatch.clear(); __launchingPids.clear(); reapOrphanChromiums(process.cwd(), `teardown:${reason}`); } catch (_) {}
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

  try { sweepOrphanedTaskMetaOnBoot(process.cwd()); } catch (_) {}

  setInterval(() => {
    try { reapTimedOutTasks(); } catch (_) {}
  }, 5000);

  let _selfStaleLoggedOnce = false;
  let _selfStaleProbeErrorLogged = false;
  function probeGmPlugkitSelfStale() {
    try {
      if (process.env.PLUGKIT_NO_AUTO_UPDATE === '1') return;
      const { sids: _ifSids } = (typeof inflightPids === 'function') ? inflightPids() : { sids: new Set() };
      if (_ifSids.size > 0) return;
      if ((Date.now() - lastActivityMs) < 30000) return;
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
                const bustCache = true;
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
                try { logEvent('plugkit', 'update.auto-applying', { running_version: own, latest_version: latest, cache_busted: bustCache, attempt: (respawnGuard.attempts || 0) + 1, note: 'auto-update: cache-busted self-respawn to latest' }); } catch (_) {}
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

  const BROWSER_IDLE_LIMIT_MS = parseInt(process.env.PLUGKIT_BROWSER_IDLE_LIMIT_MS, 10) || 5 * 60 * 1000;
  setInterval(() => {
    try {
      const portsFile = browserPortsFile(process.cwd());
      const sessionsFile = browserSessionsFile(process.cwd());
      const ports = readJsonFile(portsFile, {});
      const sessions = readJsonFile(sessionsFile, {});
      const now = Date.now();
      const { sids: inflightSids } = inflightPids();
      const idle = selectIdleBrowserSessions(ports, now, BROWSER_IDLE_LIMIT_MS).filter((x) => !inflightSids.has(x.sid));
      const idleSids = new Set(idle.map((x) => x.sid));
      let mutated = false;
      for (const { sid, entry, idleMs } of idle) {
        if (Number.isFinite(entry.pid) && isProcessAliveSync(entry.pid)) {
          try { gracefulCloseBrowser(entry, 'browser-idle'); } catch (_) {}
        }
        try { __idleClosedSessions.add(sid); } catch (_) {}
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
        const cdpOk = !!fetchJsonSyncRetry(`http://127.0.0.1:${entry.port}/json/version`, 1000, 3);
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
      try { reapOrphanChromiums(process.cwd(), 'idle-sweep'); } catch (_) {}
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
        const abortOutPath = path.join(outDir, outName);
        const abortTmpPath = abortOutPath + '.tmp.' + process.pid;
        fs.writeFileSync(abortTmpPath, JSON.stringify({
          ok: false,
          error: `wasm aborted earlier (exit_code=${__wasmAbortFlag.code}); watcher will respawn`,
          wasm_aborted: true,
        }));
        fs.renameSync(abortTmpPath, abortOutPath);
        try { fs.writeFileSync(abortOutPath + '.ready', ''); } catch (_) {}
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
      } else if (verb === 'instruction') {
        // instruction's auto_recall path can trigger a cold bert-embed-model
        // reload (~10-15s, paid fresh every process restart -- no cross-
        // process cache) plus memory_md_sync_partial processing a backlog of
        // .gm/memories/*.md files a few at a time. Without busy protection
        // here, the 30s heartbeat-stale supervisor check kills the watcher
        // mid-sync on any project with a nontrivial memory corpus, and the
        // respawned process pays the same cold-reload cost again before
        // making further progress -- a restart loop that never converges.
        // Same class of blocking work as the codesearch case above.
        try { _writeStatusBusy(300000); } catch (_) {}
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

      const verbPtr = writeWasmInput(instance, verbBytes, `spool-dispatch:${verb}.verb`);
      const bodyPtr = writeWasmInput(instance, bodyBytes, `spool-dispatch:${verb}.body`);

      writeVerbActive(verb, taskBase);
      const result = dispatch(verbPtr, verbBytes.length, bodyPtr, bodyBytes.length);
      clearVerbActive();

      let resultStr = decodeWasmResult(instance, result, `spool-dispatch:${verb}`);

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
      const outPath = path.join(outDir, outName);
      const outTmpPath = outPath + '.tmp.' + process.pid;
      fs.writeFileSync(outTmpPath, resultStr);
      fs.renameSync(outTmpPath, outPath);
      try { fs.writeFileSync(outPath + '.ready', ''); } catch (_) {}
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
        const errOutPath = path.join(outDir, outName);
        const errTmpPath = errOutPath + '.tmp.' + process.pid;
        fs.writeFileSync(errTmpPath, JSON.stringify({ ok: false, error: e.message }));
        fs.renameSync(errTmpPath, errOutPath);
        try { fs.writeFileSync(errOutPath + '.ready', ''); } catch (_) {}
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
        supervisor_stale_limit_ms: 30000,
        abi_version: 1,
      };
      if (busyMs && busyMs > 0) { rec.busy_until = now + busyMs; _lastBusyUntil = rec.busy_until; }
      fs.writeFileSync(STATUS_PATH, JSON.stringify(rec));
    } catch (_) {}
  }
  _writeStatusBusy = (ms) => { try { writeStatus(ms); } catch (_) {} };
  setInterval(() => writeStatus(), 5000);
  setInterval(() => { try { scanStalledTurns(); } catch (_) {} }, 30000);
  writeStatus();

  setTimeout(async () => {
    try {
      // The boot warmup's codesearch triggers a codeinsight reindex + full
      // in-wasm embed of the project when the stored digest is absent/stale.
      // That embed is a SYNCHRONOUS wasm call that blocks the event loop, so
      // the 5s heartbeat interval cannot fire while it runs. On a large repo a
      // cold embed can take several minutes; if it exceeds the busy_until
      // window the supervisor's stale-heartbeat check kills the watcher
      // mid-embed, the digest never persists, and every respawn re-embeds from
      // scratch -- an unbounded restart loop that spawns duplicate watchers.
      // The window must therefore comfortably exceed the worst-case cold embed;
      // it is a one-time cost (the digest persists after a single completion,
      // so subsequent boots' warmup is near-instant).
      // A single warmup dispatch only advances the index by one wall-budget
      // slice, so a large repo needs many passes before the digest converges
      // (deferred_files == 0). A single-shot warmup left the digest permanently
      // withheld: every later verb and every respawn re-triggered a fresh
      // partial pass, and the stale-digest boot path re-embedded from scratch
      // forever. Loop the warmup, refreshing busy_until each pass so the
      // supervisor's stale-heartbeat check never kills a converging rebuild,
      // until deferred_files reaches 0 or a bounded pass count is hit.
      const t0 = Date.now();
      let passes = 0;
      let lastDeferred = -1;
      let stagnant = 0;
      const MAX_WARMUP_PASSES = 80;
      while (passes < MAX_WARMUP_PASSES) {
        _writeStatusBusy(1200000);
        const vb = new TextEncoder().encode('codeinsight_index');
        const bb = new TextEncoder().encode(JSON.stringify({ root: '.', max_files: 500 }));
        const vp = writeWasmInput(instance, vb, 'boot-warmup:codeinsight_index.verb');
        const bp = writeWasmInput(instance, bb, 'boot-warmup:codeinsight_index.body');
        const r = dispatch(vp, vb.length, bp, bb.length);
        const decoded = decodeWasmResult(instance, r, 'boot-warmup:codeinsight_index');
        passes++;
        let deferred = null;
        try {
          const parsed = typeof decoded === 'string' ? JSON.parse(decoded) : decoded;
          const d = parsed && (parsed.data || parsed);
          if (d && typeof d.deferred_files === 'number') deferred = d.deferred_files;
          else if (parsed && typeof parsed.deferred_files === 'number') deferred = parsed.deferred_files;
        } catch (_) {}
        if (deferred === null) break;
        if (deferred === 0) break;
        if (deferred === lastDeferred) { stagnant++; if (stagnant >= 4) break; } else { stagnant = 0; }
        lastDeferred = deferred;
        await new Promise((r) => setImmediate(r));
      }
      writeStatus();
      logEvent('plugkit', 'boot.index-warmup', { ms: Date.now() - t0, passes, converged: lastDeferred === -1 || lastDeferred === 0 });
    } catch (e) {
      try { logEvent('plugkit', 'boot.index-warmup-failed', { error: String(e && e.message || e) }); } catch (_) {}
    }
  }, 3000);

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
        prd_pending_count: prdPending,
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
    let tmp = null;
    try {
      fs.mkdirSync(path.dirname(UPDATE_CHECK_SHARED_CACHE), { recursive: true });
      tmp = UPDATE_CHECK_SHARED_CACHE + '.tmp.' + process.pid;
      fs.writeFileSync(tmp, JSON.stringify({ ts: Date.now(), latest, status, by_pid: process.pid }));
      fs.renameSync(tmp, UPDATE_CHECK_SHARED_CACHE);
    } catch (_) {
      if (tmp) { try { fs.unlinkSync(tmp); } catch (_) {} }
    }
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
    const tmp = UPDATE_CHECK_ERROR_MARKER + '.tmp.' + process.pid;
    try {
      fs.writeFileSync(tmp, JSON.stringify({ ts: Date.now(), key, by_pid: process.pid }));
      fs.renameSync(tmp, UPDATE_CHECK_ERROR_MARKER);
    } catch (_) {
      try { fs.unlinkSync(tmp); } catch (_) {}
    }
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
      selfRespawnOnUpdate(installed, latest);
    }
  }
  function selfRespawnOnUpdate(installed, latest) {
    const guardPath = path.join(GM_TOOLS_ROOT, '.wasm-update-respawn-guard.json');
    let guard = {};
    try { guard = JSON.parse(fs.readFileSync(guardPath, 'utf8')); } catch (_) {}
    const sameTarget = guard.last_latest === latest;
    const attempts = sameTarget ? (guard.attempts || 0) : 0;
    if (attempts >= 3) {
      logEvent('plugkit', 'update.auto-respawn-abandoned', { installed, latest, attempts, note: 'wasm-registry version keeps drifting after 3 self-respawn attempts; agent must run bun x gm-plugkit@latest spool manually' });
      return;
    }
    try {
      fs.writeFileSync(guardPath, JSON.stringify({ attempts: attempts + 1, last_latest: latest, ts: Date.now() }));
    } catch (_) {}
    logEvent('plugkit', 'update.auto-applying', { installed, latest, attempt: attempts + 1, note: 'plugkit-wasm registry drift; self-respawning via bun x gm-plugkit@latest spool' });
    try {
      const bunPath = process.env.GM_BUN_PATH || 'bun';
      const child = _childProcess.spawn(bunPath, ['x', 'gm-plugkit@latest', 'spool'], {
        cwd: process.cwd(),
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, PLUGKIT_BOOT_REASON: 'self-respawn-from-wasm-registry-drift' },
      });
      child.unref();
    } catch (e) {
      logEvent('plugkit', 'update.auto-respawn-spawn-failed', { installed, latest, error: String(e && e.message || e) });
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
        path.join(wrapperDir, '..', 'gm-skill', 'skills', 'gm', 'SKILL.md'),
        path.join(wrapperDir, '..', '..', 'gm-skill', 'skills', 'gm', 'SKILL.md'),
        path.join(wrapperDir, '..', 'skills', 'gm', 'SKILL.md'),
      ];
      const bundledPath = skillCandidates.find(p => { try { return fs.existsSync(p); } catch (_) { return false; } });
      if (!bundledPath) return;
      const bundled = fs.readFileSync(bundledPath, 'utf-8');
      const bundledHash = crypto.createHash('sha256').update(bundled).digest('hex');
      const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
      const targets = [
        path.join(home, '.agents', 'skills', 'gm', 'SKILL.md'),
        path.join(home, '.claude', 'skills', 'gm', 'SKILL.md'),
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

function writeHealBusyStatus() {
  try {
    const spoolDir = spoolDirForSentinel();
    fs.mkdirSync(spoolDir, { recursive: true });
    fs.writeFileSync(path.join(spoolDir, '.status.json'), JSON.stringify({ pid: process.pid, ts: Date.now(), healing: true, busy_until: Date.now() + 60_000 }));
  } catch (_) {}
}

function restoreWasmFromLocalCache() {
  try {
    const root = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.cache'), 'plugkit', 'bin');
    const dirs = fs.readdirSync(root).filter(d => /^v\d+\.\d+\.\d+$/.test(d));
    dirs.sort((a, b) => {
      const pa = a.slice(1).split('.').map(Number), pb = b.slice(1).split('.').map(Number);
      return (pb[0] - pa[0]) || (pb[1] - pa[1]) || (pb[2] - pa[2]);
    });
    for (const d of dirs) {
      const wasm = path.join(root, d, 'plugkit.wasm');
      if (!fs.existsSync(wasm) || !fs.existsSync(path.join(root, d, '.ok'))) continue;
      const target = path.join(GM_TOOLS_ROOT, 'plugkit.wasm');
      const tmp = `${target}.partial-${process.pid}`;
      fs.copyFileSync(wasm, tmp);
      try { fs.renameSync(tmp, target); }
      catch (_) { try { fs.unlinkSync(target); } catch (_) {} fs.renameSync(tmp, target); }
      fs.writeFileSync(path.join(GM_TOOLS_ROOT, 'plugkit.version'), d.slice(1));
      return d.slice(1);
    }
  } catch (_) {}
  return null;
}

async function selfHeal(reason) {
  console.error(`[plugkit-wasm] self-heal: ${reason}`);
  writeHealBusyStatus();
  const healBusy = setInterval(writeHealBusyStatus, 5000);
  try {
    if (/not installed/.test(reason)) {
      const restored = restoreWasmFromLocalCache();
      if (restored) {
        console.error(`[plugkit-wasm] self-heal: restored v${restored} from local install cache`);
        return true;
      }
    }
    const r = await selfHealFromGithubReleases();
    console.error(`[plugkit-wasm] self-heal: installed v${r.version} from GH Releases`);
    return true;
  } catch (e) {
    console.error(`[plugkit-wasm] self-heal GH fetch failed: ${e.message}`);
  } finally {
    clearInterval(healBusy);
  }
  console.error('[plugkit-wasm] self-heal: run `bun x gm-plugkit@latest spool` to recover manually');
  return false;
}

async function tryInstantiate(wasmPath) {
  const wasmBuffer = fs.readFileSync(wasmPath);
  const keepBusy = setInterval(() => { try { _writeStatusBusy(60000); } catch (_) {} }, 15000);
  try { _writeStatusBusy(60000); } catch (_) {}
  try {
    const wasmModule = await WebAssembly.compile(wasmBuffer);
    try { _writeStatusBusy(60000); } catch (_) {}
    const instanceRef = { value: null };
    const hostFunctions = makeHostFunctions(instanceRef);
    const importObject = {
      env: hostFunctions,
      wasi_snapshot_preview1: createWasiShim(instanceRef),
    };
    const instance = await WebAssembly.instantiate(wasmModule, importObject);
    instanceRef.value = instance;
    return { instance, instanceRef };
  } finally {
    clearInterval(keepBusy);
  }
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
      const verbPtr = writeWasmInput(instance, verbBytes, `cli-dispatch:${verb}.verb`);
      const bodyPtr = writeWasmInput(instance, bodyBytes, `cli-dispatch:${verb}.body`);
      const result = dispatch(verbPtr, verbBytes.length, bodyPtr, bodyBytes.length);
      const out = decodeWasmResult(instance, result, `cli-dispatch:${verb}`);   // normalized i64 + fresh buffer
      try { instance.exports.plugkit_free(verbPtr, verbBytes.length); } catch (_) {}
      try { instance.exports.plugkit_free(bodyPtr, bodyBytes.length); } catch (_) {}
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
