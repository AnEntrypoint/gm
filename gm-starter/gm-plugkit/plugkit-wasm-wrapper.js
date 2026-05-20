import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import https from 'https';
import { watch } from 'fs';
import { spawn as _rawSpawn, spawnSync as _rawSpawnSync } from 'child_process';
import net from 'net';
import { fileURLToPath } from 'url';

function spawnSync(cmd, args, opts) {
  return _rawSpawnSync(cmd, args, { windowsHide: true, ...(opts || {}) });
}
function spawn(cmd, args, opts) {
  return _rawSpawn(cmd, args, { windowsHide: true, ...(opts || {}) });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KV_DIR = path.join(os.homedir(), '.claude', 'gm-tools', 'kv');
fs.mkdirSync(KV_DIR, { recursive: true });

const GM_LOG_ROOT = process.env.GM_LOG_DIR || path.join(os.homedir(), '.claude', 'gm-log');
const ORCHESTRATOR_VERBS = new Set(['instruction', 'transition', 'phase-status', 'prd-add', 'prd-resolve', 'prd-list', 'mutable-add', 'mutable-resolve', 'mutable-list', 'memorize-fire', 'residual-scan', 'auto-recall']);

const TURN_IDLE_MS = 30_000;
const _turns = new Map();

const SPOOL_POLL_GATE_MARK = '__gm_spool_poll_gate__';

function spoolPollGateScript() {
  return `#!/usr/bin/env node
// ${SPOOL_POLL_GATE_MARK}
// PreToolUse hook that blocks bash polling of .gm/exec-spool.
// Plugkit is synchronous from the agent's view; the Read tool is the canonical
// way to inspect response files. This hook denies Bash commands that try to
// poll or shell-read the spool directory.

const SPOOL_POLL_PATTERNS = [
  /\\bsleep\\s+\\d+(?:\\.\\d+)?\\s*[;&]+\\s*(?:cat|ls|tail|head|find|test|grep)\\b[^|]*\\.gm[\\\\/](?:exec-spool|spool)/i,
  /\\bStart-Sleep\\b[^;|]*?[;|]\\s*(?:Get-Content|Test-Path|Get-ChildItem|cat|ls|gci|gc|tp)\\b[^|]*\\.gm[\\\\/](?:exec-spool|spool)/i,
  /\\b(?:cat|ls|tail|head|Get-Content|Test-Path|Get-ChildItem)\\b[^|]*\\.gm[\\\\/](?:exec-spool|spool)[^|]*?[;&|]+\\s*(?:sleep|Start-Sleep)\\b/i,
  /\\bwhile\\b[^;]*?(?:!|-not)\\s*(?:-(?:f|e)\\s+|Test-Path\\s+)[^;]*?\\.gm[\\\\/](?:exec-spool|spool)/i,
  /\\buntil\\b[^;]*?(?:-f|-e|Test-Path)\\s+[^;]*?\\.gm[\\\\/](?:exec-spool|spool)/i,
  /\\bfor\\s+i\\s+in\\b[^;]*?;\\s*do\\b[^;]*?(?:sleep|Start-Sleep)[^;]*?\\.gm[\\\\/](?:exec-spool|spool)/i,
  /\\b(?:cat|head|tail|less|more|type|Get-Content|gc)\\s+(?:-[A-Za-z]+\\s+)*['"]?[^'"|;&]*\\.gm[\\\\/](?:exec-spool|spool)[\\\\/]/i,
  /\\b(?:ls|dir|Get-ChildItem|gci)\\s+(?:-[A-Za-z]+\\s+)*['"]?[^'"|;&]*\\.gm[\\\\/](?:exec-spool|spool)[\\\\/]/i,
  /\\b(?:test|Test-Path|tp)\\s+(?:-[A-Za-z]+\\s+)?['"]?[^'"|;&]*\\.gm[\\\\/](?:exec-spool|spool)[\\\\/]/i,
];

const SPOOL_POLL_REASON = 'spool polling and bash-reads of .gm/exec-spool/ are forbidden — plugkit is synchronous from your view, and the Read tool is the canonical way to inspect spool files. Specific replacements:\\n\\n- Instead of \`cat .gm/exec-spool/.status.json\` → use the Read tool: \`Read .gm/exec-spool/.status.json\`\\n- Instead of \`ls .gm/exec-spool/out/\` → check the specific response file you wrote, e.g. \`Read .gm/exec-spool/out/<verb>-<N>.json\`\\n- Instead of \`cat .gm/exec-spool/.watcher.log\` → use the Read tool with offset for tailing\\n- Instead of \`sleep N; cat .gm/exec-spool/<...>\` → just Read the response file directly; if it doesn\\'t exist yet, the watcher is dead (Read .gm/exec-spool/.status.json — fresh ts means alive) or the verb is slow (Read .gm/exec-spool/.watcher.log for the dispatch trace)\\n\\nYou are the state machine. Plugkit serves the response the moment you write the request file. If you find yourself thinking "let me just check whether the file is there yet" — use Read. If you find yourself thinking "the watcher might have died" — Read .gm/exec-spool/.status.json. Bash on .gm/exec-spool/ is wrong every single time.';

function stripHeredocsAndStringLiterals(command) {
  let s = String(command);
  s = s.replace(/<<-?\\s*'([A-Z_]+)'[\\s\\S]*?\\n\\1/g, '');
  s = s.replace(/<<-?\\s*"?([A-Z_]+)"?[\\s\\S]*?\\n\\1/g, '');
  s = s.replace(/\\$\\(cat\\s+<<-?\\s*'?([A-Z_]+)'?[\\s\\S]*?\\n\\1\\s*\\)/g, '');
  s = s.replace(/-m\\s+(['"])(?:\\\\.|(?!\\1)[^\\\\])*\\1/g, '-m STR');
  s = s.replace(/--message[= ]+(['"])(?:\\\\.|(?!\\1)[^\\\\])*\\1/g, '--message STR');
  return s;
}

function isSpoolPollCommand(command) {
  if (!command) return null;
  const stripped = stripHeredocsAndStringLiterals(command);
  for (const re of SPOOL_POLL_PATTERNS) {
    if (re.test(stripped)) return re.source;
  }
  return null;
}

function isBrowserRunningFileLocal(rel) {
  if (!rel) return false;
  const norm = String(rel).replace(/\\\\/g, '/');
  if (/\\.(html?|tsx|jsx|vue|svelte)$/i.test(norm)) return true;
  if (/\\.(mjs|cjs|js|ts|css|scss|sass)$/i.test(norm) && /^(src|public|site|app|pages|components|client|web)\\//i.test(norm)) return true;
  return false;
}

function hashFileShortLocal(cwd, rel) {
  try {
    const fs = require('fs');
    const path = require('path');
    const crypto = require('crypto');
    const abs = path.isAbsolute(rel) ? rel : path.join(cwd, rel);
    const buf = fs.readFileSync(abs);
    return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
  } catch (_) { return ''; }
}

function recordBrowserEditLocal(cwd, filePath) {
  try {
    const fs = require('fs');
    const path = require('path');
    let rel = filePath;
    try { rel = path.relative(cwd, filePath); } catch (_) {}
    if (!isBrowserRunningFileLocal(rel)) return false;
    const editsFile = path.join(cwd, '.gm', 'exec-spool', '.turn-browser-edits.json');
    fs.mkdirSync(path.dirname(editsFile), { recursive: true });
    let list = [];
    try { list = JSON.parse(fs.readFileSync(editsFile, 'utf8')); if (!Array.isArray(list)) list = []; } catch (_) {}
    const relPath = rel.replace(/\\\\/g, '/');
    const hash = hashFileShortLocal(cwd, relPath);
    const idx = list.findIndex(e => e && e.file === relPath);
    const entry = { file: relPath, ts: Date.now(), hash };
    if (idx === -1) list.push(entry); else list[idx] = entry;
    fs.writeFileSync(editsFile, JSON.stringify(list));
    return true;
  } catch (_) { return false; }
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let event = {};
  try { event = JSON.parse(raw || '{}'); } catch (_) { event = {}; }
  const tool = event.tool_name || event.tool || '';
  const input = event.tool_input || event.input || {};
  const cwd = event.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') {
    const fp = input.file_path || input.filePath || input.path || '';
    if (fp) {
      try { recordBrowserEditLocal(cwd, fp); } catch (_) {}
    }
    process.stdout.write(JSON.stringify({ continue: true }));
    process.exit(0);
  }

  if (tool !== 'Bash') {
    process.stdout.write(JSON.stringify({ continue: true }));
    process.exit(0);
  }
  const command = input.command || input.cmd || '';
  const pattern = isSpoolPollCommand(command);
  if (!pattern) {
    process.stdout.write(JSON.stringify({ continue: true }));
    process.exit(0);
  }
  try {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.join(process.env.GM_LOG_DIR || path.join(os.homedir(), '.claude', 'gm-log'), day);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'hook.jsonl'), JSON.stringify({
      ts: new Date().toISOString(),
      sub: 'hook',
      event: 'deviation.spool-poll',
      pid: process.pid,
      sess: event.session_id || process.env.CLAUDE_SESSION_ID || process.env.GM_SESSION_ID || '',
      cwd: process.cwd(),
      operation: 'bash',
      pattern,
      command_excerpt: String(command).slice(0, 200),
      via: 'pre-tool-use-hook',
    }) + '\\n');
  } catch (_) {}
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: SPOOL_POLL_REASON,
  }));
  process.exit(2);
});
`;
}

function ensureSpoolPollGate(cwd) {
  try {
    const gmHooks = path.join(cwd, '.gm', 'hooks');
    fs.mkdirSync(gmHooks, { recursive: true });
    const gateScript = path.join(gmHooks, 'spool-poll-gate.js');
    const want = spoolPollGateScript();
    let need = true;
    let oldSha = '';
    let existed = false;
    try {
      const existing = fs.readFileSync(gateScript, 'utf8');
      existed = true;
      if (existing === want) need = false;
      else {
        try {
          const _crypto = require('crypto');
          oldSha = _crypto.createHash('sha256').update(existing).digest('hex').slice(0, 12);
        } catch (_) {}
      }
    } catch (_) {}
    if (need) {
      fs.writeFileSync(gateScript, want);
      try {
        const _crypto = require('crypto');
        const newSha = _crypto.createHash('sha256').update(want).digest('hex').slice(0, 12);
        try {
          logEvent('bootstrap', existed ? 'gate.refreshed' : 'gate.installed', {
            cwd,
            path: gateScript,
            old_sha: oldSha || null,
            new_sha: newSha,
            bytes: Buffer.byteLength(want, 'utf8'),
          });
        } catch (_) {}
      } catch (_) {}
    }

    const claudeDir = path.join(cwd, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const settingsPath = path.join(claudeDir, 'settings.json');
    let settings = {};
    try {
      const rawSettings = fs.readFileSync(settingsPath, 'utf8');
      settings = JSON.parse(rawSettings || '{}');
    } catch (_) { settings = {}; }
    if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {};
    if (!Array.isArray(settings.hooks.PreToolUse)) settings.hooks.PreToolUse = [];
    const wantCommand = `node "\${CLAUDE_PROJECT_DIR}/.gm/hooks/spool-poll-gate.js"`;
    for (const matcher of ['Bash', 'Write', 'Edit', 'MultiEdit']) {
      let entry = settings.hooks.PreToolUse.find(e => e && e.matcher === matcher);
      if (!entry) {
        entry = { matcher, hooks: [] };
        settings.hooks.PreToolUse.push(entry);
      }
      if (!Array.isArray(entry.hooks)) entry.hooks = [];
      const already = entry.hooks.some(h => h && typeof h.command === 'string' && h.command.includes('spool-poll-gate.js'));
      if (!already) {
        entry.hooks.push({ type: 'command', command: wantCommand });
      }
    }
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  } catch (_) {}
}

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
  try {
    new Uint8Array(instance.exports.memory.buffer, verbPtr, verbBytes.length).set(verbBytes);
    new Uint8Array(instance.exports.memory.buffer, bodyPtr, bodyBytes.length).set(bodyBytes);
    const result = dispatch(verbPtr, verbBytes.length, bodyPtr, bodyBytes.length);
    const ptr = Number(result & 0xffffffffn);
    const len = Number(result >> 32n);
    const out = new TextDecoder().decode(new Uint8Array(instance.exports.memory.buffer, ptr, len));
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

function tryAutoRecallForTurnEntry(instance, sess, cwd) {
  try {
    const prompt = readUserPromptForRecall(cwd);
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

function turnTick(sess, verb, taskBase, phase) {
  const key = sess || '(no-session)';
  const now = Date.now();
  let t = _turns.get(key);
  if (verb === 'instruction') {
    if (t && (now - t.lastTs) > TURN_IDLE_MS) {
      logEvent('plugkit', 'turn.end', {
        sess, turn_idx: t.idx, dur_ms: t.lastTs - t.startTs,
        dispatches: t.dispatches, verbs: Object.fromEntries(t.verbs),
        phases_walked: [...t.phases], deviations: t.deviations,
        ended_in_phase: t.lastPhase || null,
      });
      t = null;
    }
    if (!t) {
      const idx = ((_turns.get(key + ':lastIdx') || 0) + 1);
      _turns.set(key + ':lastIdx', idx);
      t = { idx, startTs: now, lastTs: now, dispatches: 0, verbs: new Map(), phases: new Set(), deviations: 0, lastPhase: phase };
      _turns.set(key, t);
      logEvent('plugkit', 'turn.start', { sess, turn_idx: idx, phase: phase || null });
    }
  }
  if (!t) return;
  t.lastTs = now;
  t.dispatches++;
  t.verbs.set(verb, (t.verbs.get(verb) || 0) + 1);
  if (phase) { t.phases.add(phase); t.lastPhase = phase; }
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
  __sessCache.value = found || process.env.CLAUDE_SESSION_ID || process.env.GM_SESSION_ID || '';
  return __sessCache.value;
}

function logEvent(sub, event, fields) {
  if (process.env.GM_LOG_DISABLE) return;
  try {
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.join(GM_LOG_ROOT, day);
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      sub,
      event,
      pid: process.pid,
      sess: readCurrentSess(),
      ...fields,
    });
    fs.appendFileSync(path.join(dir, `${sub}.jsonl`), line + '\n');
  } catch (_) {}
}

function emitOrchestratorEvents(verb, taskBase, resultStr) {
  if (!ORCHESTRATOR_VERBS.has(verb)) return;
  let parsed;
  try { parsed = JSON.parse(resultStr); } catch (_) { return; }
  if (!parsed || parsed.ok !== true) {
    let errData = null;
    if (parsed && typeof parsed.stdout === 'string' && parsed.stdout.length > 0) {
      try { errData = JSON.parse(parsed.stdout); } catch (_) {}
    }
    if (verb === 'prd-resolve' && errData && errData.deviation_kind === 'prd-resolve-unknown-id') {
      logEvent('hook', 'deviation.prd-resolve-unknown-id', { task: taskBase, prd_id: errData.prd_id, reason: errData.error });
    }
    logEvent('plugkit', 'orchestrator.error', { verb, task: taskBase, error: parsed && parsed.error ? String(parsed.error) : 'unknown' });
    return;
  }
  const data = parsed.data || {};
  const sess = readCurrentSess();
  turnTick(sess, verb, taskBase, data.phase);
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

function migrateLegacyBrowserState(cwd) {
  const dst1 = browserPortsFile(cwd);
  const dst2 = browserSessionsFile(cwd);
  try {
    if (!fs.existsSync(dst1) && fs.existsSync(LEGACY_BROWSER_PORTS_FILE)) {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_BROWSER_PORTS_FILE, 'utf-8'));
      if (legacy && typeof legacy === 'object') fs.writeFileSync(dst1, JSON.stringify(legacy, null, 2));
    }
  } catch (_) {}
  try {
    if (!fs.existsSync(dst2) && fs.existsSync(LEGACY_BROWSER_SESSIONS_FILE)) {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_BROWSER_SESSIONS_FILE, 'utf-8'));
      if (legacy && typeof legacy === 'object') fs.writeFileSync(dst2, JSON.stringify(legacy, null, 2));
    }
  } catch (_) {}
}

function readJsonFile(fp, fallback) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch (_) { return fallback; }
}
function writeJsonFile(fp, value) {
  try { fs.writeFileSync(fp, JSON.stringify(value, null, 2)); } catch (_) {}
}

function findChrome() {
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    for (const c of candidates) { if (c && fs.existsSync(c)) return c; }
    return null;
  }
  if (process.platform === 'darwin') {
    const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (fs.existsSync(mac)) return mac;
    return null;
  }
  for (const bin of ['google-chrome', 'chromium', 'chromium-browser']) {
    const r = spawnSync('which', [bin], { encoding: 'utf-8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return null;
}

function findPlaywriter() {
  const npmR = spawnSync('npm', ['root', '-g'], { encoding: 'utf-8', shell: true });
  if (npmR.status === 0 && npmR.stdout.trim()) {
    const root = npmR.stdout.trim().split(/\r?\n/).pop();
    const binJs = path.join(root, 'playwriter', 'bin.js');
    if (fs.existsSync(binJs)) return { cmd: process.execPath, baseArgs: [binJs], shell: false };
  }
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(whichCmd, ['playwriter'], { encoding: 'utf-8', shell: true });
  if (r.status === 0 && r.stdout.trim()) {
    const candidates = r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const cmd = candidates.find(c => c.toLowerCase().endsWith('.cmd')) || candidates.find(c => !c.toLowerCase().endsWith('.ps1')) || candidates[0];
    if (cmd) return { cmd, baseArgs: [], shell: process.platform === 'win32' };
  }
  const bunR = spawnSync(whichCmd, ['bun'], { encoding: 'utf-8', shell: true });
  if (bunR.status === 0 && bunR.stdout.trim()) {
    return { cmd: 'bun', baseArgs: ['x', 'playwriter@latest'], shell: true };
  }
  const npxR = spawnSync(whichCmd, ['npx'], { encoding: 'utf-8', shell: true });
  if (npxR.status === 0 && npxR.stdout.trim()) {
    return { cmd: 'npx', baseArgs: ['-y', 'playwriter'], shell: true };
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

function isProfileLocked(profileDir) {
  const lock = path.join(profileDir, 'SingletonLock');
  return fs.existsSync(lock);
}

function acquireProfileDir(cwd) {
  const gmDir = path.join(cwd, '.gm');
  try { fs.mkdirSync(gmDir, { recursive: true }); } catch (_) {}
  const primary = path.join(gmDir, 'browser-profile');
  ensureGitignored(cwd, '.gm/browser-profile/');
  ensureGitignored(cwd, '.gm/browser-profile-*/');
  try { fs.mkdirSync(primary, { recursive: true }); } catch (_) {}
  if (!isProfileLocked(primary)) return primary;
  const fallback = path.join(gmDir, `browser-profile-${process.pid}`);
  try { fs.mkdirSync(fallback, { recursive: true }); } catch (_) {}
  return fallback;
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
  spawnSync(process.execPath, ['-e', `setTimeout(()=>{}, ${ms})`], { timeout: ms + 2000 });
}

function runPlaywriter(pw, args, timeoutMs) {
  return spawnSync(pw.cmd, [...pw.baseArgs, ...args], {
    encoding: 'utf-8',
    timeout: timeoutMs,
    shell: pw.shell,
    env: process.env,
  });
}

function scrubBrowserRunnerText(s) {
  if (!s || typeof s !== 'string') return s;
  let t = s;
  t = t.replace(/playwriter/gi, 'managed browser session');
  t = t.replace(/Click the[^.\n]*?extension[^.\n]*?icon[^.\n]*?\.?/gi, '');
  t = t.replace(/(connected\s+)?browser\s+extension(\s+is)?\s+not\s+connected\b[^.\n]*\.?/gi, '');
  t = t.replace(/no\s+connected\s+browsers?\b[^.\n]*\.?/gi, '');
  t = t.replace(/Install via:[^\n]*managed browser session[^\n]*/gi, '');
  return t;
}

function getOrCreateBrowserSession(cwd, claudeSessionId, pw) {
  migrateLegacyBrowserState(cwd);
  const portsFile = browserPortsFile(cwd);
  const sessionsFile = browserSessionsFile(cwd);
  const ports = readJsonFile(portsFile, {});
  const sessions = readJsonFile(sessionsFile, {});
  const existing = ports[claudeSessionId];
  if (existing && existing.port && isPortAliveSync(existing.port)) {
    const pwIds = sessions[claudeSessionId] || [];
    if (pwIds.length > 0) return pwIds[0];
  }
  const chrome = findChrome();
  if (!chrome) throw new Error('Chrome not found. Please install Google Chrome.');
  const profileDir = acquireProfileDir(cwd);
  const port = findFreePortSync();
  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
  ];
  const child = spawn(chrome, chromeArgs, { detached: true, stdio: 'ignore' });
  const chromePid = child.pid;
  child.unref();
  const deadline = Date.now() + 10000;
  let alive = false;
  while (Date.now() < deadline) {
    if (isPortAliveSync(port)) { alive = true; break; }
    sleepSync(300);
  }
  if (!alive) throw new Error(`Chrome failed to open debug port ${port}`);
  const newR = runPlaywriter(pw, ['session', 'new', `--direct=localhost:${port}`], 30000);
  if (newR.status !== 0) throw new Error(`managed browser session start failed: ${scrubBrowserRunnerText(newR.stderr || newR.stdout || 'unknown')}`);
  const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
  const out = stripAnsi(newR.stdout || '').trim();
  let pwSessionId = null;
  const created = out.match(/Session\s+(\S+)\s+created/i);
  if (created) pwSessionId = created[1];
  if (!pwSessionId) {
    const hex = out.match(/\b([a-f0-9-]{8,})\b/i);
    if (hex) pwSessionId = hex[1];
  }
  if (!pwSessionId) {
    try { const j = JSON.parse(out); pwSessionId = j.id || j.session_id || j.session; } catch (_) {}
  }
  if (!pwSessionId) throw new Error(`could not parse managed browser session id from: ${scrubBrowserRunnerText(out)}`);
  ports[claudeSessionId] = { port, profileDir, pid: chromePid };
  sessions[claudeSessionId] = [pwSessionId];
  writeJsonFile(portsFile, ports);
  writeJsonFile(sessionsFile, sessions);
  return pwSessionId;
}

const ACPTOAPI_URL = process.env.ACPTOAPI_URL || 'http://127.0.0.1:4800';
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

function createWasiShim(instanceRef) {
  const getMemory = () => instanceRef.value.exports.memory.buffer;
  const shim = {
    proc_exit: (code) => process.exit(code),
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
          if (len > 0) {
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
  };
  return new Proxy(shim, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args) => {
        console.error(`[plugkit-wasm] unimplemented WASI call: ${String(prop)} args=${args.length}`);
        return 52;
      };
    }
  });
}

function readWasmBytes(instance, ptr, len) {
  if (ptr === 0 || len === 0) return new Uint8Array(0);
  return new Uint8Array(instance.exports.memory.buffer, ptr, len).slice();
}

function readWasmStr(instance, ptr, len) {
  if (ptr === 0 || len === 0) return '';
  const bytes = new Uint8Array(instance.exports.memory.buffer, ptr, len);
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

function kvFilePath(ns, key) {
  const dir = projectKvDir(ns);
  fs.mkdirSync(dir, { recursive: true });
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
        fs.writeFileSync(kvFilePath(ns, key), val);
        return 1;
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

    host_vec_search: (qPtr, qLen, k) => {
      try {
        const raw = readWasmStr(instanceRef.value, qPtr, qLen);
        if (!raw) return writeWasmJson(instanceRef.value, []);
        let parsedQ;
        try { parsedQ = JSON.parse(raw); } catch (_) { parsedQ = { query: raw }; }
        const q = parsedQ.query || raw;
        const namespace = parsedQ.namespace || 'default';
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
        const vecDirs = kvNamespaceDirs(`${namespace}-vec`);
        const dataDirs = kvNamespaceDirs(namespace);
        if (vecDirs.length === 0 || dataDirs.length === 0) {
          return writeWasmJson(instanceRef.value, []);
        }
        const scored = [];
        const seen = new Set();
        for (const vecDir of vecDirs) {
          for (const f of fs.readdirSync(vecDir)) {
            if (!f.endsWith('.json')) continue;
            const key = f.replace(/\.json$/, '');
            if (seen.has(key)) continue;
            seen.add(key);
            let emb;
            try { emb = JSON.parse(fs.readFileSync(path.join(vecDir, f), 'utf-8')); }
            catch (_) { continue; }
            const vector = Array.isArray(emb?.data?.[0]?.embedding) ? emb.data[0].embedding
                         : Array.isArray(emb?.embedding) ? emb.embedding
                         : Array.isArray(emb) ? emb : null;
            if (!vector) continue;
            const score = cosineSim(queryEmbedding, vector);
            let text = '';
            for (const dataDir of dataDirs) {
              const valuePath = path.join(dataDir, `${key}.json`);
              if (fs.existsSync(valuePath)) { text = fs.readFileSync(valuePath, 'utf-8'); break; }
            }
            scored.push({ key, text, score });
          }
        }
        scored.sort((a, b) => b.score - a.score);
        return writeWasmJson(instanceRef.value, scored.slice(0, k_));
      } catch (e) {
        console.error('[plugkit-wasm] host_vec_search error:', e.message);
        return writeWasmJson(instanceRef.value, []);
      }
    },

    host_vec_embed: (textPtr, textLen) => {
      try {
        const text = readWasmStr(instanceRef.value, textPtr, textLen);
        if (!text) return 0n;
        const body = JSON.stringify({ model: EMBED_MODEL_DEFAULT, input: text });
        const result = spawnSync(process.execPath, ['-e', `
          fetch('${ACPTOAPI_URL}/v1/embeddings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(body)} })
            .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
            .then(t => process.stdout.write(t))
            .catch(e => { process.stderr.write('embed-error: ' + e.message); process.exit(2); });
        `], { encoding: 'utf-8', timeout: 30000 });
        if (result.status !== 0 || !result.stdout) {
          console.error('[plugkit-wasm] host_vec_embed FAILED:', result.stderr || 'no response');
          return 0n;
        }
        return writeWasmStr(instanceRef.value, result.stdout);
      } catch (e) {
        console.error('[plugkit-wasm] host_vec_embed exception:', e.message);
        return 0n;
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
            paper_ref: '§20',
            received: rawTimeout === undefined ? null : rawTimeout,
          });
        }
        if (rawTimeout < MIN_TIMEOUT_MS) {
          return writeWasmJson(instanceRef.value, {
            ok: false,
            error: 'timeoutMs below floor',
            min: MIN_TIMEOUT_MS,
            received: rawTimeout,
            paper_ref: '§20',
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
        return 0;
      } catch (e) {
        return 0;
      }
    },

    host_now_ms: () => BigInt(Date.now()),

    host_browser_exec: (bodyPtr, bodyLen, cwdPtr, cwdLen, sidPtr, sidLen) => {
      try {
        const body = readWasmStr(instanceRef.value, bodyPtr, bodyLen);
        const cwd = readWasmStr(instanceRef.value, cwdPtr, cwdLen) || process.cwd();
        const sessionId = readWasmStr(instanceRef.value, sidPtr, sidLen) || 'default';
        const pw = findPlaywriter();
        if (!pw) return writeWasmJson(instanceRef.value, { ok: false, error: 'managed browser session runner not available' });
        if (body.startsWith('session ')) {
          const parts = body.slice(8).trim().split(/\s+/);
          const ports = readJsonFile(browserPortsFile(cwd), {});
          const existing = ports[sessionId];
          const directArgs = (existing && existing.port && isPortAliveSync(existing.port))
            ? [`--direct=localhost:${existing.port}`]
            : [];
          const r = runPlaywriter(pw, ['session', ...parts, ...directArgs], 30000);
          return writeWasmJson(instanceRef.value, {
            ok: r.status === 0,
            stdout: scrubBrowserRunnerText(r.stdout || ''),
            stderr: scrubBrowserRunnerText(r.stderr || ''),
            exit_code: r.status === null ? -1 : r.status,
          });
        }
        const pwSessionId = getOrCreateBrowserSession(cwd, sessionId, pw);
        const r = runPlaywriter(pw, ['-s', pwSessionId, '--timeout', '14000', '-e', body], 60000);
        return writeWasmJson(instanceRef.value, {
          ok: r.status === 0,
          stdout: scrubBrowserRunnerText(r.stdout || ''),
          stderr: scrubBrowserRunnerText(r.stderr || ''),
          exit_code: r.status === null ? -1 : r.status,
          session_id: pwSessionId,
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
  };
}

function resolveVersion(instance) {
  try {
    return fs.readFileSync(path.join(os.homedir(), '.claude', 'gm-tools', 'plugkit.version'), 'utf8').trim();
  } catch (_) {}
  try {
    const fn = instance && instance.exports && instance.exports.plugkit_version;
    if (typeof fn === 'function') {
      const result = fn();
      const ptr = Number(result & 0xffffffffn);
      const len = Number(result >> 32n);
      const bytes = new Uint8Array(instance.exports.memory.buffer, ptr, len);
      return new TextDecoder().decode(bytes).trim();
    }
  } catch (_) {}
  return 'unknown';
}

function readFileVersionOnly() {
  try { return fs.readFileSync(path.join(os.homedir(), '.claude', 'gm-tools', 'plugkit.version'), 'utf8').trim(); } catch (_) { return null; }
}

function readInstanceVersion(instance) {
  try {
    const fn = instance && instance.exports && instance.exports.plugkit_version;
    if (typeof fn !== 'function') return null;
    const result = fn();
    const ptr = Number(result & 0xffffffffn);
    const len = Number(result >> 32n);
    const bytes = new Uint8Array(instance.exports.memory.buffer, ptr, len);
    return new TextDecoder().decode(bytes).trim();
  } catch (_) { return null; }
}

async function runSpoolWatcher(instance, spoolDir) {
  const inDir = path.join(spoolDir, 'in');
  const outDir = path.join(spoolDir, 'out');
  fs.mkdirSync(inDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  try { ensureSpoolPollGate(process.env.CLAUDE_PROJECT_DIR || process.cwd()); } catch (_) {}

  const LOCK_PATH = path.join(spoolDir, '.watcher.lock');
  let _ownWrapperSha12 = '';
  try {
    const _crypto = require('crypto');
    const _wp = path.join(os.homedir(), '.claude', 'gm-tools', 'plugkit-wasm-wrapper.js');
    _ownWrapperSha12 = _crypto.createHash('sha256').update(fs.readFileSync(_wp)).digest('hex').slice(0, 12);
  } catch (_) {}
  function lockBody() { return `${process.pid}|${Date.now()}|${_ownWrapperSha12}`; }
  function acquireLock() {
    try {
      if (fs.existsSync(LOCK_PATH)) {
        const content = fs.readFileSync(LOCK_PATH, 'utf-8').trim();
        const parts = content.split('|');
        const pidStr = parts[0];
        const tsStr = parts[1];
        const holderSha = parts[2] || '';
        const lockTs = parseInt(tsStr, 10);
        const age = Date.now() - lockTs;
        if (age < 15000) {
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
          } else {
            const msg = JSON.stringify({ ok: false, reason: 'another-watcher-active', pid: pidStr, age_ms: age });
            console.error(`[plugkit-wasm] ${msg}; refusing to start`);
            try { fs.writeFileSync(path.join(spoolDir, '.lock-rejection.json'), msg); } catch (_) {}
            try { logEvent('plugkit', 'watcher.lock-rejected', { holder_pid: pidStr, lock_age_ms: age }); } catch (_) {}
            process.exit(75);
          }
        } else {
          console.error(`[plugkit-wasm] stale lock (age=${age}ms); taking over`);
        }
      }
      fs.writeFileSync(LOCK_PATH, lockBody());
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

  const PEER_REGISTRY_PATH = path.join(os.homedir(), '.claude', 'gm-tools', 'peer-registry.json');
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
  const ACPTOAPI_STATUS_PATH = path.join(process.cwd(), '.gm', 'acptoapi-status.json');
  let lastActivityMs = Date.now();
  function markActivity(source) {
    lastActivityMs = Date.now();
  }

  function killPidQuiet(pid) {
    if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) return false;
    try { process.kill(pid, 'SIGTERM'); } catch (_) {}
    if (process.platform === 'win32') {
      try { spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore', timeout: 3000 }); } catch (_) {}
    }
    return true;
  }

  function teardownAll(reason) {
    try {
      logEvent('plugkit', 'watcher.teardown', { reason, idle_ms: Date.now() - lastActivityMs });
      console.log(`[plugkit-wasm] teardown reason=${reason}`);
    } catch (_) {}

    try { killAllTasks(`teardown:${reason}`); } catch (_) {}

    try {
      if (fs.existsSync(ACPTOAPI_STATUS_PATH)) {
        const status = JSON.parse(fs.readFileSync(ACPTOAPI_STATUS_PATH, 'utf-8'));
        if (status && Number.isFinite(status.pid)) killPidQuiet(status.pid);
        try { fs.unlinkSync(ACPTOAPI_STATUS_PATH); } catch (_) {}
      }
    } catch (_) {}

    try {
      const portsFile = browserPortsFile(process.cwd());
      const sessionsFile = browserSessionsFile(process.cwd());
      const ports = readJsonFile(portsFile, {});
      for (const [sid, entry] of Object.entries(ports)) {
        if (entry && Number.isFinite(entry.pid)) killPidQuiet(entry.pid);
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
    } catch (_) {}

    try { fs.unlinkSync(STATUS_PATH_FOR_TEARDOWN); } catch (_) {}
    try { releaseLock(); } catch (_) {}
    process.exit(0);
  }

  setInterval(() => {
    try { reapTimedOutTasks(); } catch (_) {}
  }, 5000);

  const _instanceVersionAtBoot = readInstanceVersion(instance);
  setInterval(() => {
    try {
      const fileV = readFileVersionOnly();
      const instV = _instanceVersionAtBoot;
      if (!fileV || !instV || fileV === instV) return;
      logEvent('plugkit', 'version.drift', {
        instance_version: instV,
        file_version: fileV,
        action: 'exit-for-respawn',
      });
      console.error(`[plugkit-wasm] version drift detected: instance=${instV} file=${fileV} → exiting so supervisor reloads fresh wasm`);
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
      process.exit(0);
    } catch (e) {
      console.error(`[version-drift-check] error: ${e.message}`);
    }
  }, 60_000);

  const _wrapperPathInstalled = path.join(os.homedir(), '.claude', 'gm-tools', 'plugkit-wasm-wrapper.js');
  let _wrapperShaAtBoot = '';
  try {
    const _crypto = require('crypto');
    _wrapperShaAtBoot = _crypto.createHash('sha256').update(fs.readFileSync(_wrapperPathInstalled)).digest('hex');
  } catch (_) {}
  setInterval(() => {
    try {
      if (!_wrapperShaAtBoot) return;
      const _crypto = require('crypto');
      const cur = _crypto.createHash('sha256').update(fs.readFileSync(_wrapperPathInstalled)).digest('hex');
      if (cur === _wrapperShaAtBoot) return;
      logEvent('plugkit', 'wrapper.drift', {
        boot_sha: _wrapperShaAtBoot.slice(0, 12),
        file_sha: cur.slice(0, 12),
        action: 'exit-for-respawn',
      });
      console.error(`[plugkit-wasm] wrapper.js drift detected → exiting so supervisor reloads fresh wrapper`);
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
      process.exit(0);
    } catch (e) {
      console.error(`[wrapper-drift-check] error: ${e.message}`);
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
          if (entry && Number.isFinite(entry.port) && isPortAliveSync(entry.port)) { browserAlive = true; break; }
        }
        if (browserAlive) { markActivity('browser-port-alive'); return; }
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

  process.on('SIGINT', () => { releaseLock(); process.exit(0); });
  process.on('SIGTERM', () => { releaseLock(); process.exit(0); });
  process.on('exit', releaseLock);

  try {
    const wrapperDst = path.join(os.homedir(), '.claude', 'gm-tools', 'plugkit-wasm-wrapper.js');
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
  const _PLANNED_REASONS = new Set(['idle', 'sigterm', 'version-change', 'wrapper-change', 'peer-stale-takeover', 'version-drift', 'external-planned']);
  const _isPlannedBoot = _priorShutdown && _PLANNED_REASONS.has(_priorShutdown.reason);
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
          ? 'Prior watcher disappeared with a recent heartbeat — likely a clean shutdown that did not write .shutdown-reason.json. Inspect .watcher.log if recurrent.'
          : 'Prior watcher died without a planned shutdown and without a recent heartbeat. This is treated as a critical failure. Inspect .watcher.log and gm-log/<day>/plugkit.jsonl events supervisor.watcher-exited-unexpectedly + supervisor.heartbeat-stale around the prior_status.ts timestamp to diagnose root cause.'),
    };
    logEvent('plugkit', 'watcher.unplanned-restart', incidentPayload);
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
    console.error(`[plugkit-wasm] UNPLANNED RESTART detected — prior watcher died without writing .shutdown-reason.json. prior_status_age_ms=${restartContext.prior_status_age_ms} boot_reason=${_bootReason}`);
  }
  try { fs.unlinkSync(SHUTDOWN_REASON_PATH); } catch (_) {}
  logEvent('plugkit', 'watcher.boot', { version: _bootVersion, in_dir: inDir, out_dir: outDir, spool_dir: spoolDir, ...restartContext });

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

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const relPath = path.relative(inDir, filePath);
      const dir = path.dirname(relPath);
      const verb = dir === '.' ? path.basename(filePath, path.extname(filePath)) : dir;
      let body = content.trim() || '{}';
      const taskBase = path.basename(filePath, path.extname(filePath));

      if (verb === 'recall' || verb === 'memorize' || verb === 'codesearch' || verb === 'memorize-fire') {
        body = applyDisciplineSigil(body);
      }

      const verbBytes = new TextEncoder().encode(verb);
      const bodyBytes = new TextEncoder().encode(body);

      const t0 = Date.now();
      console.log(`[dispatch] → verb=${verb} task=${taskBase} body=${bodyBytes.length}b`);
      logEvent('plugkit', 'dispatch.start', { verb, task: taskBase, body_bytes: bodyBytes.length, cwd: process.cwd() });

      let autoRecallPayload = null;
      if (verb === 'instruction') {
        const sessForRecall = readCurrentSess();
        if (isInstructionTurnStart(sessForRecall)) {
          autoRecallPayload = tryAutoRecallForTurnEntry(instance, sessForRecall, process.cwd());
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

      const result = dispatch(verbPtr, verbBytes.length, bodyPtr, bodyBytes.length);

      const ptr = Number(result & 0xffffffffn);
      const len = Number(result >> 32n);
      const resultBytes = new Uint8Array(instance.exports.memory.buffer, ptr, len);
      let resultStr = new TextDecoder().decode(resultBytes);

      if (autoRecallPayload) {
        resultStr = mergeAutoRecallIntoInstructionResponse(resultStr, autoRecallPayload);
      }

      const outName = dir === '.' ? `${taskBase}.json` : `${verb}-${taskBase}.json`;
      fs.writeFileSync(path.join(outDir, outName), resultStr);
      const dur_ms = Date.now() - t0;
      console.log(`[dispatch] ← verb=${verb} task=${taskBase} ms=${dur_ms} out=${resultStr.length}b`);
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

  function walkDir(dir) {
    const files = [];
    try {
      for (const entry of fs.readdirSync(dir)) {
        if (/\.tmp\.\d+(\.|$)/.test(entry)) continue;
        const fullPath = path.join(dir, entry);
        let stat;
        try { stat = fs.statSync(fullPath); } catch (_) { continue; }
        if (stat.isFile()) {
          files.push(fullPath);
        } else if (stat.isDirectory()) {
          files.push(...walkDir(fullPath));
        }
      }
    } catch (e) {
      console.error(`[plugkit-wasm] error walking ${dir}: ${e.message}`);
    }
    return files;
  }

  const STATUS_PATH = path.join(spoolDir, '.status.json');
  function writeStatus() {
    try {
      fs.writeFileSync(STATUS_PATH, JSON.stringify({
        pid: process.pid,
        ts: Date.now(),
        version: resolveVersion(instance),
        wrapper_sha: _ownWrapperSha12 || null,
        idle_limit_ms: IDLE_LIMIT_MS,
      }));
    } catch (_) {}
  }
  setInterval(writeStatus, 5000);
  writeStatus();

  const UPDATE_AVAILABLE_PATH = path.join(spoolDir, '.update-available.json');
  const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
  let _lastKnownDrift = null;
  function checkForUpdate() {
    const installed = resolveVersion(instance);
    const req = https.get({
      host: 'api.github.com',
      path: '/repos/AnEntrypoint/plugkit-bin/releases/latest',
      headers: { 'user-agent': 'plugkit-watcher', 'accept': 'application/json' },
      timeout: 5000,
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        logEvent('plugkit', 'update.check.error', { installed, status: res.statusCode });
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const rel = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          const tag = rel && rel.tag_name;
          if (!tag) return;
          const latest = tag.replace(/^v/, '');
          if (latest === installed) {
            try { fs.unlinkSync(UPDATE_AVAILABLE_PATH); } catch (_) {}
            if (_lastKnownDrift) {
              logEvent('plugkit', 'update.cleared', { installed, was: _lastKnownDrift });
              _lastKnownDrift = null;
            }
            return;
          }
          const update_url = `https://github.com/AnEntrypoint/plugkit-bin/releases/tag/v${latest}`;
          fs.writeFileSync(UPDATE_AVAILABLE_PATH, JSON.stringify({
            installed,
            latest,
            checked_at_ms: Date.now(),
            instruction: 'plugkit is out of date. To update, close the running watcher and re-bootstrap with the @latest flag, e.g. node ~/.claude/gm-tools/plugkit-wasm-wrapper.js spool & after running bootstrap with {latest: true}.',
            update_url,
          }, null, 2));
          console.log(`[update] available: installed=${installed} latest=${latest} → wrote ${UPDATE_AVAILABLE_PATH}`);
          if (_lastKnownDrift !== latest) {
            logEvent('plugkit', 'update.available', { installed, latest, update_url });
            _lastKnownDrift = latest;
          }
        } catch (e) {
          logEvent('plugkit', 'update.check.error', { error: String(e && e.message || e) });
        }
      });
    });
    req.on('timeout', () => { req.destroy(); logEvent('plugkit', 'update.check.error', { error: 'timeout' }); });
    req.on('error', (e) => logEvent('plugkit', 'update.check.error', { error: String(e && e.message || e) }));
  }
  setTimeout(checkForUpdate, 10_000);
  setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);

  const pollInterval = setInterval(async () => {
    const existing = walkDir(inDir);
    if (existing.length > 0) markActivity('poll');
    for (const fullPath of existing) {
      await processFile(fullPath);
    }
  }, 5000);

  setInterval(() => {
    try {
      const cutoff = Date.now() - 3600_000;
      let swept = 0;
      for (const entry of fs.readdirSync(outDir)) {
        try {
          const fp = path.join(outDir, entry);
          const s = fs.statSync(fp);
          if (s.mtimeMs < cutoff) { fs.unlinkSync(fp); swept++; }
        } catch (e) { console.error(`[retention] failed to sweep ${entry}: ${e.message}`); }
      }
      if (swept > 0) {
        console.log(`[retention] swept ${swept} out/ files older than 1h`);
        logEvent('plugkit', 'sweep.retention', { swept });
      }
    } catch (e) {
      console.error(`[retention] sweep error: ${e.message}`);
      logEvent('plugkit', 'sweep.retention.error', { error: String(e.message || e) });
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
                fs.writeFileSync(path.join(outDir, outName), JSON.stringify({ ok: false, error: 'stale input — never dispatched or watcher crash mid-flight' }));
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
        const rel = await fetchJson('https://api.github.com/repos/AnEntrypoint/plugkit-bin/releases/latest');
        const tag = rel.tag_name;
        if (!tag) throw new Error('no tag_name from GH Releases');
        const version = tag.replace(/^v/, '');
        const base = `https://github.com/AnEntrypoint/plugkit-bin/releases/download/${tag}`;
        const [wasm, sha] = await Promise.all([
          fetchBuf(`${base}/plugkit.wasm`),
          fetchBuf(`${base}/plugkit.wasm.sha256`).then(b => b.toString('utf-8').trim().split(/\s+/)[0]).catch(() => ''),
        ]);
        if (sha) {
          const got = crypto.createHash('sha256').update(wasm).digest('hex');
          if (got !== sha) throw new Error(`sha mismatch: got ${got}, expected ${sha}`);
        }
        const toolsDir = path.join(os.homedir(), '.claude', 'gm-tools');
        fs.mkdirSync(toolsDir, { recursive: true });
        fs.writeFileSync(path.join(toolsDir, 'plugkit.wasm'), wasm);
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

(async () => {
  try {
    const wasmPath = path.join(os.homedir(), '.claude', 'gm-tools', 'plugkit.wasm');

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
          console.error('[plugkit-wasm] wrapper/wasm version skew — run: bun x gm-plugkit@latest spool');
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
      ensureSpoolPollGate(projectDir);
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
