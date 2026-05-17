import fs from 'fs';
import path from 'path';
import os from 'os';
import { watch } from 'fs';
import { spawn, spawnSync } from 'child_process';

const KV_DIR = path.join(os.homedir(), '.claude', 'gm-tools', 'kv');
fs.mkdirSync(KV_DIR, { recursive: true });

const RS_LEARN_URL = process.env.RS_LEARN_URL || 'http://127.0.0.1:8000';
const VEC_K_DEFAULT = 10;

const browserSessions = new Map();
let nextBrowserSessionId = 1;

function createWasiShim() {
  return new Proxy({}, {
    get(target, prop) {
      if (prop === 'proc_exit') return (code) => process.exit(code);
      if (prop === 'fd_write') return () => 0;
      if (prop === 'environ_get') return () => 0;
      if (prop === 'environ_sizes_get') return () => 0;
      return () => 0;
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
        const scope = parsedQ.scope || 'all';
        const k_ = k > 0 ? k : VEC_K_DEFAULT;
        const body = JSON.stringify({ query: q, limit: k_, scope });
        const result = spawnSync(process.execPath, ['-e', `
          fetch('${RS_LEARN_URL}/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(body)} })
            .then(r => r.text().then(t => process.stdout.write(t)))
            .catch(e => process.stdout.write(JSON.stringify({ error: e.message })));
        `], { encoding: 'utf-8', timeout: 5000 });
        if (result.status !== 0 || !result.stdout) return writeWasmJson(instanceRef.value, []);
        try {
          const parsed = JSON.parse(result.stdout);
          const hits = parsed.hits || parsed.results || parsed.episodes || [];
          return writeWasmJson(instanceRef.value, hits);
        } catch (_) {
          return writeWasmJson(instanceRef.value, []);
        }
      } catch (e) {
        return writeWasmJson(instanceRef.value, []);
      }
    },

    host_vec_embed: (textPtr, textLen) => {
      try {
        const text = readWasmStr(instanceRef.value, textPtr, textLen);
        if (!text) return 0n;
        const body = JSON.stringify({ text });
        const result = spawnSync(process.execPath, ['-e', `
          fetch('${RS_LEARN_URL}/embed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(body)} })
            .then(r => r.text().then(t => process.stdout.write(t)))
            .catch(e => process.stdout.write(''));
        `], { encoding: 'utf-8', timeout: 5000 });
        if (result.status !== 0 || !result.stdout) return 0n;
        return writeWasmStr(instanceRef.value, result.stdout);
      } catch (e) {
        return 0n;
      }
    },

    host_browser_spawn: (urlPtr, urlLen) => {
      try {
        const url = readWasmStr(instanceRef.value, urlPtr, urlLen);
        const id = BigInt(nextBrowserSessionId++);
        browserSessions.set(id, { url, opened_at: Date.now() });
        return id;
      } catch (e) {
        return 0n;
      }
    },

    host_browser_eval: (sessionId, codePtr, codeLen) => {
      try {
        const code = readWasmStr(instanceRef.value, codePtr, codeLen);
        const session = browserSessions.get(BigInt(sessionId));
        if (!session) return writeWasmJson(instanceRef.value, { error: 'session not found' });
        return writeWasmJson(instanceRef.value, { ok: false, error: 'browser eval not implemented in JS host; route via spool browser verb' });
      } catch (e) {
        return writeWasmJson(instanceRef.value, { error: e.message });
      }
    },

    host_browser_close: (sessionId) => {
      try {
        return browserSessions.delete(BigInt(sessionId)) ? 1 : 0;
      } catch (e) {
        return 0;
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

  console.log(`[plugkit-wasm] plugkit v${resolveVersion(instance)} (wasm)`);
  console.log(`[plugkit-wasm] watching ${inDir}`);

  const processed = new Set();
  const dispatch = instance.exports.dispatch_verb;
  if (!dispatch) throw new Error('dispatch_verb not exported');

  const processFile = async (filePath) => {
    const key = path.relative(inDir, filePath);
    if (processed.has(key)) return;
    processed.add(key);

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
      processed.delete(key);
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
      processed.delete(key);
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

  const heartbeatPath = path.join(spoolDir, '.watcher.heartbeat');
  setInterval(() => {
    try { fs.writeFileSync(heartbeatPath, String(Date.now())); } catch (_) {}
  }, 5000);

  const pollDeadline = setInterval(async () => {
    const existing = walkDir(inDir);
    for (const fullPath of existing) {
      await processFile(fullPath);
    }
  }, 250);

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
      wasi_snapshot_preview1: createWasiShim(),
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
      const body = args[2] || '{}';
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
      process.exit(0);
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
