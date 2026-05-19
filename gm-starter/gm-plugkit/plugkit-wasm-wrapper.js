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
      sess: process.env.CLAUDE_SESSION_ID || process.env.GM_SESSION_ID || '',
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
    logEvent('plugkit', 'orchestrator.error', { verb, task: taskBase, error: parsed && parsed.error ? String(parsed.error) : 'unknown' });
    return;
  }
  const data = parsed.data || {};
  const sess = process.env.CLAUDE_SESSION_ID || process.env.GM_SESSION_ID || '';
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
      logEvent('plugkit', 'prd.resolved', { task: taskBase, id: data.resolved });
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
      else logEvent('plugkit', 'residual.skipped', { task: taskBase, reason: data.reason });
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
  if (newR.status !== 0) throw new Error(`playwriter session new failed: ${newR.stderr || newR.stdout || 'unknown'}`);
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
  if (!pwSessionId) throw new Error(`could not parse playwriter session id from: ${out}`);
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

function kvFilePath(ns, key) {
  const safeNs = String(ns).replace(/[^A-Za-z0-9._-]/g, '_');
  const safeKey = String(key).replace(/[^A-Za-z0-9._-]/g, '_');
  const dir = path.join(KV_DIR, safeNs);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, safeKey + '.json');
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
        const fp = kvFilePath(ns, key);
        if (!fs.existsSync(fp)) return 0n;
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
        const dir = path.join(KV_DIR, String(ns).replace(/[^A-Za-z0-9._-]/g, '_'));
        if (!fs.existsSync(dir)) return writeWasmJson(instanceRef.value, []);
        const ql = q ? String(q).toLowerCase() : '';
        const results = [];
        for (const f of fs.readdirSync(dir)) {
          if (!f.endsWith('.json')) continue;
          const value = fs.readFileSync(path.join(dir, f), 'utf-8');
          if (ql && !value.toLowerCase().includes(ql) && !f.toLowerCase().includes(ql)) continue;
          results.push({ key: f.replace(/\.json$/, ''), value });
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
        const vecDir = path.join(KV_DIR, `${namespace}-vec`.replace(/[^A-Za-z0-9._-]/g, '_'));
        const dataDir = path.join(KV_DIR, namespace.replace(/[^A-Za-z0-9._-]/g, '_'));
        if (!fs.existsSync(vecDir) || !fs.existsSync(dataDir)) {
          return writeWasmJson(instanceRef.value, []);
        }
        const scored = [];
        for (const f of fs.readdirSync(vecDir)) {
          if (!f.endsWith('.json')) continue;
          let emb;
          try { emb = JSON.parse(fs.readFileSync(path.join(vecDir, f), 'utf-8')); }
          catch (_) { continue; }
          const vector = Array.isArray(emb?.data?.[0]?.embedding) ? emb.data[0].embedding
                       : Array.isArray(emb?.embedding) ? emb.embedding
                       : Array.isArray(emb) ? emb : null;
          if (!vector) continue;
          const score = cosineSim(queryEmbedding, vector);
          const key = f.replace(/\.json$/, '');
          const valuePath = path.join(dataDir, `${key}.json`);
          const text = fs.existsSync(valuePath) ? fs.readFileSync(valuePath, 'utf-8') : '';
          scored.push({ key, text, score });
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
        const timeoutMs = opts.timeoutMs || 30000;
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
        if (!pw) return writeWasmJson(instanceRef.value, { ok: false, error: 'playwriter not found. Install via: npm i -g playwriter' });
        if (body.startsWith('session ')) {
          const parts = body.slice(8).trim().split(/\s+/);
          const r = runPlaywriter(pw, ['session', ...parts], 30000);
          return writeWasmJson(instanceRef.value, {
            ok: r.status === 0,
            stdout: r.stdout || '',
            stderr: r.stderr || '',
            exit_code: r.status === null ? -1 : r.status,
          });
        }
        const pwSessionId = getOrCreateBrowserSession(cwd, sessionId, pw);
        const r = runPlaywriter(pw, ['-s', pwSessionId, '--timeout', '14000', '-e', body], 60000);
        return writeWasmJson(instanceRef.value, {
          ok: r.status === 0,
          stdout: r.stdout || '',
          stderr: r.stderr || '',
          exit_code: r.status === null ? -1 : r.status,
          session_id: pwSessionId,
        });
      } catch (e) {
        return writeWasmJson(instanceRef.value, { ok: false, error: e.message });
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

async function runSpoolWatcher(instance, spoolDir) {
  const inDir = path.join(spoolDir, 'in');
  const outDir = path.join(spoolDir, 'out');
  fs.mkdirSync(inDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  const LOCK_PATH = path.join(spoolDir, '.watcher.lock');
  function acquireLock() {
    try {
      if (fs.existsSync(LOCK_PATH)) {
        const content = fs.readFileSync(LOCK_PATH, 'utf-8').trim();
        const [pidStr, tsStr] = content.split('|');
        const lockTs = parseInt(tsStr, 10);
        const age = Date.now() - lockTs;
        if (age < 15000) {
          console.error(`[plugkit-wasm] another watcher active (pid=${pidStr}, age=${age}ms); refusing to start`);
          process.exit(1);
        }
        console.error(`[plugkit-wasm] stale lock (age=${age}ms); taking over`);
      }
      fs.writeFileSync(LOCK_PATH, `${process.pid}|${Date.now()}`);
    } catch (e) {
      console.error(`[plugkit-wasm] lock acquire failed: ${e.message}`);
      process.exit(1);
    }
  }
  function refreshLock() {
    try { fs.writeFileSync(LOCK_PATH, `${process.pid}|${Date.now()}`); } catch (_) {}
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

  const IDLE_LIMIT_MS = parseInt(process.env.PLUGKIT_IDLE_LIMIT_MS, 10) || 15 * 60 * 1000;
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
  const _isPlannedBoot = _priorShutdown && (_priorShutdown.reason === 'idle' || _priorShutdown.reason === 'sigterm' || _priorShutdown.reason === 'version-change');
  const _isFirstBoot = !_priorShutdown && !_priorStatus;
  const UNPLANNED_RESTART_MARKER = path.join(spoolDir, '.unplanned-restart.json');
  if (!_isPlannedBoot && !_isFirstBoot) {
    const incidentPayload = {
      ts: Date.now(),
      version: _bootVersion,
      severity: 'critical',
      ...restartContext,
      log_tail_path: path.join(spoolDir, '.watcher.log'),
      gm_log_dir: GM_LOG_ROOT,
      instruction: 'Prior watcher died without a planned shutdown. This is treated as a critical failure. Inspect .watcher.log and gm-log/<day>/plugkit.jsonl events supervisor.watcher-exited-unexpectedly + supervisor.heartbeat-stale around the prior_status.ts timestamp to diagnose root cause.',
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
      const body = content.trim() || '{}';
      const taskBase = path.basename(filePath, path.extname(filePath));

      const verbBytes = new TextEncoder().encode(verb);
      const bodyBytes = new TextEncoder().encode(body);

      const t0 = Date.now();
      console.log(`[dispatch] → verb=${verb} task=${taskBase} body=${bodyBytes.length}b`);
      logEvent('plugkit', 'dispatch.start', { verb, task: taskBase, body_bytes: bodyBytes.length, cwd: process.cwd() });

      const verbPtr = instance.exports.plugkit_alloc(verbBytes.length);
      const bodyPtr = instance.exports.plugkit_alloc(bodyBytes.length);
      new Uint8Array(instance.exports.memory.buffer, verbPtr, verbBytes.length).set(verbBytes);
      new Uint8Array(instance.exports.memory.buffer, bodyPtr, bodyBytes.length).set(bodyBytes);

      const result = dispatch(verbPtr, verbBytes.length, bodyPtr, bodyBytes.length);

      const ptr = Number(result & 0xffffffffn);
      const len = Number(result >> 32n);
      const resultBytes = new Uint8Array(instance.exports.memory.buffer, ptr, len);
      const resultStr = new TextDecoder().decode(resultBytes);

      const outName = dir === '.' ? `${taskBase}.json` : `${verb}-${taskBase}.json`;
      fs.writeFileSync(path.join(outDir, outName), resultStr);
      const dur_ms = Date.now() - t0;
      console.log(`[dispatch] ← verb=${verb} task=${taskBase} ms=${dur_ms} out=${resultStr.length}b`);
      logEvent('plugkit', 'dispatch.end', { verb, task: taskBase, dur_ms, out_bytes: resultStr.length });
      emitOrchestratorEvents(verb, taskBase, resultStr);

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
        const fullPath = path.join(dir, entry);
        const stat = fs.statSync(fullPath);
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
          const fp = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(fp);
          else if (entry.isFile()) {
            const s = fs.statSync(fp);
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
