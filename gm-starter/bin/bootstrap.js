#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

const RELEASE_REPO = 'AnEntrypoint/plugkit-bin';
const ATTEMPT_TIMEOUT_MS = 60 * 1000;
const STALL_TIMEOUT_MS = 20 * 1000;
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [2000, 5000, 15000, 30000];
const LOCK_STALE_MS = 5 * 60 * 1000;

function log(msg) {
  try { process.stderr.write(`[plugkit-bootstrap] ${msg}\n`); } catch (_) {}
}

function platformKey() {
  const p = os.platform();
  const a = os.arch();
  if (p === 'win32') return a === 'arm64' ? 'win32-arm64' : 'win32-x64';
  if (p === 'darwin') return a === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  return (a === 'arm64' || a === 'aarch64') ? 'linux-arm64' : 'linux-x64';
}

function binaryName() {
  const key = platformKey();
  return key.startsWith('win32') ? `plugkit-${key}.exe` : `plugkit-${key}`;
}

function cacheRoot() {
  const home = os.homedir();
  if (process.env.PLUGKIT_CACHE_DIR) return process.env.PLUGKIT_CACHE_DIR;
  if (os.platform() === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return path.join(base, 'plugkit', 'bin');
  }
  if (os.platform() === 'darwin') return path.join(home, 'Library', 'Caches', 'plugkit', 'bin');
  const xdg = process.env.XDG_CACHE_HOME || path.join(home, '.cache');
  return path.join(xdg, 'plugkit', 'bin');
}

function fallbackCacheRoot() {
  return path.join(os.tmpdir(), 'plugkit-cache', 'bin');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readVersionFile(wrapperDir) {
  const p = path.join(wrapperDir, 'plugkit.version');
  if (!fs.existsSync(p)) throw new Error(`plugkit.version not found at ${p}`);
  return fs.readFileSync(p, 'utf8').trim();
}

function readShaManifest(wrapperDir) {
  const p = path.join(wrapperDir, 'plugkit.sha256');
  if (!fs.existsSync(p)) return null;
  const out = {};
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([0-9a-f]{64})\s+(\S+)\s*$/i);
    if (m) out[m[2]] = m[1].toLowerCase();
  }
  return out;
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function acquireLock(lockPath) {
  const start = Date.now();
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let stale = false;
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) stale = true;
        const owner = parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
        if (Number.isFinite(owner) && owner !== process.pid && !pidAlive(owner)) stale = true;
      } catch (_) { stale = true; }
      if (stale) {
        try { fs.unlinkSync(lockPath); } catch (_) {}
        continue;
      }
      if (Date.now() - start > ATTEMPT_TIMEOUT_MS) throw new Error(`lock wait timeout: ${lockPath}`);
      const waitMs = 2000;
      const deadline = Date.now() + waitMs;
      while (Date.now() < deadline) {}
    }
  }
}

function releaseLock(lockPath) {
  try { fs.unlinkSync(lockPath); } catch (_) {}
}

function sha256OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(filePath);
    s.on('data', c => h.update(c));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

function fetchToFile(url, destPath, expectedTotal) {
  return new Promise((resolve, reject) => {
    let existing = 0;
    try { existing = fs.statSync(destPath).size; } catch (_) {}
    const headers = { 'User-Agent': 'plugkit-bootstrap', 'Accept': '*/*' };
    if (existing > 0) headers['Range'] = `bytes=${existing}-`;

    const u = new URL(url);
    const req = https.request({
      method: 'GET',
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers,
      timeout: ATTEMPT_TIMEOUT_MS,
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        res.resume();
        return resolve(fetchToFile(res.headers.location, destPath, expectedTotal));
      }
      if (res.statusCode === 416) {
        res.resume();
        try { fs.unlinkSync(destPath); } catch (_) {}
        return reject(new Error('range-not-satisfiable: cleared partial, retry'));
      }
      if (!(res.statusCode === 200 || res.statusCode === 206)) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const append = res.statusCode === 206 && existing > 0;
      const out = fs.createWriteStream(destPath, { flags: append ? 'a' : 'w' });
      let bytes = append ? existing : 0;
      let lastLog = Date.now();
      let lastByte = Date.now();
      const stallTimer = setInterval(() => {
        if (Date.now() - lastByte > STALL_TIMEOUT_MS) {
          clearInterval(stallTimer);
          req.destroy(new Error(`stalled: no bytes for ${STALL_TIMEOUT_MS}ms`));
        }
      }, 2000);
      res.on('data', c => {
        bytes += c.length;
        lastByte = Date.now();
        if (Date.now() - lastLog > 5000) {
          const pct = expectedTotal ? ` ${Math.floor(bytes / expectedTotal * 100)}%` : '';
          log(`downloading: ${(bytes / 1048576).toFixed(1)} MiB${pct}`);
          lastLog = Date.now();
        }
      });
      res.pipe(out);
      out.on('finish', () => { clearInterval(stallTimer); out.close(() => resolve(bytes)); });
      out.on('error', err => { clearInterval(stallTimer); reject(err); });
      res.on('error', err => { clearInterval(stallTimer); reject(err); });
      res.on('end', () => clearInterval(stallTimer));
    });
    req.on('timeout', () => { req.destroy(new Error(`timeout after ${ATTEMPT_TIMEOUT_MS}ms`)); });
    req.on('error', reject);
    req.end();
  });
}

async function downloadWithRetry(url, destPath) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      log(`fetch attempt ${attempt}/${MAX_ATTEMPTS}: ${url}`);
      await fetchToFile(url, destPath);
      return;
    } catch (err) {
      lastErr = err;
      log(`attempt ${attempt} failed: ${err.message}`);
      if (attempt < MAX_ATTEMPTS) {
        const wait = BACKOFF_MS[attempt - 1] || 120000;
        log(`backing off ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

function pruneOldVersions(root, keepVersion) {
  try {
    const entries = fs.readdirSync(root);
    for (const e of entries) {
      if (!e.startsWith('v')) continue;
      if (e === `v${keepVersion}`) continue;
      const dir = path.join(root, e);
      const lock = path.join(dir, '.lock');
      if (fs.existsSync(lock)) continue;
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        log(`pruned ${dir}`);
      } catch (err) { log(`prune skip ${dir}: ${err.message}`); }
    }
  } catch (_) {}
}

async function bootstrap(opts) {
  opts = opts || {};
  const wrapperDir = opts.wrapperDir || __dirname;
  const version = opts.version || readVersionFile(wrapperDir);
  const shaManifest = readShaManifest(wrapperDir);
  const binName = binaryName();
  const expectedSha = shaManifest ? shaManifest[binName] : null;

  let root = cacheRoot();
  try { ensureDir(root); }
  catch (_) { root = fallbackCacheRoot(); ensureDir(root); }

  const verDir = path.join(root, `v${version}`);
  ensureDir(verDir);

  const finalPath = path.join(verDir, binName);
  const okSentinel = path.join(verDir, '.ok');

  if (fs.existsSync(finalPath) && fs.existsSync(okSentinel)) {
    if (!opts.silent) log(`cache hit: ${finalPath}`);
    pruneOldVersions(root, version);
    return finalPath;
  }

  const lockPath = path.join(verDir, '.lock');
  acquireLock(lockPath);
  try {
    if (fs.existsSync(finalPath) && fs.existsSync(okSentinel)) {
      pruneOldVersions(root, version);
      return finalPath;
    }

    const tmpPath = `${finalPath}.partial`;
    const url = `https://github.com/${RELEASE_REPO}/releases/download/v${version}/${binName}`;
    await downloadWithRetry(url, tmpPath);

    if (expectedSha) {
      const got = await sha256OfFile(tmpPath);
      if (got !== expectedSha) {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        throw new Error(`sha256 mismatch for ${binName}: expected ${expectedSha}, got ${got}`);
      }
      log('sha256 verified');
    } else {
      log('no sha256 manifest — skipping verify');
    }

    try { fs.renameSync(tmpPath, finalPath); }
    catch (err) {
      if (err.code === 'EEXIST' || err.code === 'EPERM') {
        try { fs.unlinkSync(finalPath); } catch (_) {}
        fs.renameSync(tmpPath, finalPath);
      } else throw err;
    }

    if (os.platform() !== 'win32') {
      try { fs.chmodSync(finalPath, 0o755); } catch (_) {}
    }

    fs.writeFileSync(okSentinel, new Date().toISOString());
    log(`installed ${finalPath}`);
    pruneOldVersions(root, version);
    return finalPath;
  } finally {
    releaseLock(lockPath);
  }
}

function resolveCachedBinary(opts) {
  opts = opts || {};
  const wrapperDir = opts.wrapperDir || __dirname;
  const version = opts.version || readVersionFile(wrapperDir);
  const root = (() => {
    try { const r = cacheRoot(); ensureDir(r); return r; }
    catch (_) { const r = fallbackCacheRoot(); ensureDir(r); return r; }
  })();
  const verDir = path.join(root, `v${version}`);
  const finalPath = path.join(verDir, binaryName());
  const okSentinel = path.join(verDir, '.ok');
  if (fs.existsSync(finalPath) && fs.existsSync(okSentinel)) return finalPath;
  return null;
}

module.exports = { bootstrap, resolveCachedBinary, platformKey, binaryName, cacheRoot };

if (require.main === module) {
  bootstrap({ silent: false })
    .then(p => { process.stdout.write(p + '\n'); process.exit(0); })
    .catch(err => { log(`FATAL: ${err.message}`); process.exit(1); });
}
