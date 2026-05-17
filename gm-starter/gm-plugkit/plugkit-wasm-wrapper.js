import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { watch } from 'fs';
import { spawn, spawnSync } from 'child_process';
import net from 'net';

const KV_DIR = path.join(os.homedir(), '.claude', 'gm-tools', 'kv');
fs.mkdirSync(KV_DIR, { recursive: true });

const TMP_DIR = os.tmpdir();
const BROWSER_PORTS_FILE = path.join(TMP_DIR, 'plugkit-browser-ports.json');
const BROWSER_SESSIONS_FILE = path.join(TMP_DIR, 'plugkit-browser-sessions.json');

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
  const primary = path.join(cwd, '.plugkit-browser-profile');
  ensureGitignored(cwd, '.plugkit-browser-profile/');
  ensureGitignored(cwd, '.plugkit-browser-profile-*/');
  try { fs.mkdirSync(primary, { recursive: true }); } catch (_) {}
  if (!isProfileLocked(primary)) return primary;
  const fallback = path.join(cwd, `.plugkit-browser-profile-${process.pid}`);
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
  const ports = readJsonFile(BROWSER_PORTS_FILE, {});
  const sessions = readJsonFile(BROWSER_SESSIONS_FILE, {});
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
  ports[claudeSessionId] = { port, profileDir };
  sessions[claudeSessionId] = [pwSessionId];
  writeJsonFile(BROWSER_PORTS_FILE, ports);
  writeJsonFile(BROWSER_SESSIONS_FILE, sessions);
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
  process.on('SIGINT', () => { releaseLock(); process.exit(0); });
  process.on('SIGTERM', () => { releaseLock(); process.exit(0); });
  process.on('exit', releaseLock);

  console.log(`[plugkit-wasm] plugkit v${resolveVersion(instance)} (wasm)`);
  console.log(`[plugkit-wasm] watching ${inDir}`);

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

      const verbBytes = new TextEncoder().encode(verb);
      const bodyBytes = new TextEncoder().encode(body);

      const verbPtr = instance.exports.plugkit_alloc(verbBytes.length);
      const bodyPtr = instance.exports.plugkit_alloc(bodyBytes.length);
      new Uint8Array(instance.exports.memory.buffer, verbPtr, verbBytes.length).set(verbBytes);
      new Uint8Array(instance.exports.memory.buffer, bodyPtr, bodyBytes.length).set(bodyBytes);

      const result = dispatch(verbPtr, verbBytes.length, bodyPtr, bodyBytes.length);

      const ptr = Number(result & 0xffffffffn);
      const len = Number(result >> 32n);
      const resultBytes = new Uint8Array(instance.exports.memory.buffer, ptr, len);
      const resultStr = new TextDecoder().decode(resultBytes);

      const taskBase = path.basename(filePath, path.extname(filePath));
      const outName = dir === '.' ? `${taskBase}.json` : `${verb}-${taskBase}.json`;
      fs.writeFileSync(path.join(outDir, outName), resultStr);

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

  const pollInterval = setInterval(async () => {
    const existing = walkDir(inDir);
    for (const fullPath of existing) {
      await processFile(fullPath);
    }
  }, 5000);

  setInterval(() => {
    try {
      const cutoff = Date.now() - 3600_000;
      for (const entry of fs.readdirSync(outDir)) {
        try {
          const fp = path.join(outDir, entry);
          const s = fs.statSync(fp);
          if (s.mtimeMs < cutoff) fs.unlinkSync(fp);
        } catch (_) {}
      }
    } catch (_) {}
  }, 60_000);

  setInterval(() => {
    try {
      const cutoff = Date.now() - 600_000;
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
              } catch (_) {}
              try { fs.unlinkSync(fp); } catch (_) {}
            }
          }
        }
      };
      walk(inDir);
    } catch (_) {}
  }, 300_000);

  const existing = walkDir(inDir);
  for (const fullPath of existing) {
    await processFile(fullPath);
  }

  let debounce = {};
  watch(inDir, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    const fullPath = path.join(inDir, filename);

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

(async () => {
  try {
    const wasmPath = path.join(os.homedir(), '.claude', 'gm-tools', 'plugkit.wasm');
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

    const args = process.argv.slice(2);
    if (args.includes('--version')) {
      console.log(`plugkit v${resolveVersion(instance)} (wasm)`);
      process.exit(0);
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
