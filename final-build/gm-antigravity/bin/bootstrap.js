#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

const RELEASE_REPO = 'AnEntrypoint/plugkit-bin';
const ATTEMPT_TIMEOUT_MS = 5 * 60 * 1000;
const STALL_TIMEOUT_MS = 15 * 1000;
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [2000, 5000, 15000, 30000];
// Worst case: a slow link downloading 140MB at 1MB/s = ~140s. Allow 30 minutes
// before another bootstrap process treats this lock as abandoned. Below this,
// concurrent bootstrap calls would wipe an in-progress download mid-stream
// (see the v0.1.294 incident where a race between two wrappers blew away the
// .partial during a 10-minute fetch).
const LOCK_STALE_MS = 30 * 60 * 1000;

function log(msg) {
  try { process.stderr.write(`[plugkit-bootstrap] ${msg}\n`); } catch (_) {}
}

function probeBinaryVersion(binPath) {
  try {
    const { spawnSync } = require('child_process');
    const r = spawnSync(binPath, ['--version'], { timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    if (r.error) return null;
    const text = `${r.stdout || ''} ${r.stderr || ''}`.trim();
    const m = text.match(/(\d+\.\d+\.\d+)/);
    return m ? m[1] : null;
  } catch (_) { return null; }
}

function writeBootstrapError(spec) {
  try {
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const spoolDir = path.join(projectDir, '.gm', 'exec-spool');
    fs.mkdirSync(spoolDir, { recursive: true });
    const out = path.join(spoolDir, '.bootstrap-error.json');
    fs.writeFileSync(out, JSON.stringify({ ts: new Date().toISOString(), ...spec }, null, 2));
  } catch (_) {}
}

function clearBootstrapError() {
  try {
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const out = path.join(projectDir, '.gm', 'exec-spool', '.bootstrap-error.json');
    fs.unlinkSync(out);
  } catch (_) {}
}

function obsEvent(subsystem, event, fields) {
  if (process.env.GM_LOG_DISABLE) return;
  try {
    const root = process.env.GM_LOG_DIR
      || path.join(os.homedir(), '.claude', 'gm-log');
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.join(root, day);
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      sub: subsystem,
      event,
      pid: process.pid,
      sess: process.env.CLAUDE_SESSION_ID || process.env.GM_SESSION_ID || '',
      ...fields,
    });
    fs.appendFileSync(path.join(dir, `${subsystem}.jsonl`), line + '\n');
  } catch (_) {}
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

function rtkBinaryName() {
  const key = platformKey();
  return key.startsWith('win32') ? `rtk-${key}.exe` : `rtk-${key}`;
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

function gmToolsDir() {
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  return path.join(home, '.claude', 'gm-tools');
}

// Copy the freshly-resolved plugkit binary + its version+sha manifests to
// ~/.claude/gm-tools so hooks.json can invoke plugkit directly without going
// through node. Self-update inside the Rust binary keeps gm-tools fresh from
// here on. Skipped silently on any error — the next session-start hook will
// retry via ensure_tools_current.
function killHoldersOfPath(targetPath) {
  if (process.platform !== 'win32') return 0;
  try {
    const { spawnSync } = require('child_process');
    const norm = path.resolve(targetPath).replace(/\//g, '\\');
    const r = spawnSync('wmic', ['process', 'where', `ExecutablePath='${norm.replace(/\\/g, '\\\\')}'`, 'get', 'ProcessId', '/format:value'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    if (r.status !== 0 || !r.stdout) return 0;
    const pids = [];
    for (const line of r.stdout.split(/\r?\n/)) {
      const m = line.match(/ProcessId=(\d+)/);
      if (m) {
        const pid = parseInt(m[1], 10);
        if (Number.isFinite(pid) && pid !== process.pid) pids.push(pid);
      }
    }
    for (const pid of pids) {
      try { spawnSync('taskkill', ['/F', '/PID', String(pid)], { windowsHide: true, timeout: 3000 }); } catch (_) {}
    }
    return pids.length;
  } catch (_) { return 0; }
}

function cleanOrphanNewFiles(dst, exeName) {
  try {
    for (const name of fs.readdirSync(dst)) {
      if (name === exeName + '.new') continue;
      if (/^plugkit(\.\d+\.\d+\.\d+)?\.new$/i.test(name)) {
        try { fs.unlinkSync(path.join(dst, name)); } catch (_) {}
      }
    }
  } catch (_) {}
}

function renameWithRetry(src, dst, attempts) {
  for (let i = 0; i < attempts; i++) {
    try { fs.renameSync(src, dst); return true; }
    catch (err) {
      if (err.code !== 'EEXIST' && err.code !== 'EPERM' && err.code !== 'EBUSY' && err.code !== 'EACCES') throw err;
      if (i === Math.floor(attempts / 2)) killHoldersOfPath(dst);
      try { const { spawnSync } = require('child_process'); spawnSync(process.execPath, ['-e', 'setTimeout(()=>{}, 200)'], { timeout: 400, killSignal: 'SIGKILL', stdio: 'ignore', windowsHide: true }); } catch (_) {}
    }
  }
  return false;
}

function copyToGmTools(finalPath, wrapperDir, version) {
  const dst = gmToolsDir();
  fs.mkdirSync(dst, { recursive: true });
  const exeName = process.platform === 'win32' ? 'plugkit.exe' : 'plugkit';
  const target = path.join(dst, exeName);
  const targetTmp = target + '.new';
  cleanOrphanNewFiles(dst, exeName);
  if (fs.existsSync(target)) {
    let needsRefresh = true;
    try {
      const cur = sha256OfFileSync(target);
      const src = sha256OfFileSync(finalPath);
      if (cur === src) needsRefresh = false;
    } catch (_) {}
    if (!needsRefresh) {
      try { fs.writeFileSync(path.join(dst, 'plugkit.version'), version); } catch (_) {}
      return;
    }
    try { killHoldersOfPath(target); } catch (_) {}
  }
  fs.copyFileSync(finalPath, targetTmp);
  if (!renameWithRetry(targetTmp, target, 8)) {
    try { killHoldersOfPath(target); } catch (_) {}
    try { fs.unlinkSync(target); } catch (_) {}
    try { fs.renameSync(targetTmp, target); }
    catch (_) {
      try { fs.unlinkSync(targetTmp); } catch (_) {}
      obsEvent('bootstrap', 'gmtools.rename.failed', { target });
      writeBootstrapError({
        expected_version: version,
        cached_version: null,
        error_phase: 'gmtools-rename',
        error_message: `cannot replace ${target} after kill+unlink retry; orphan removed`,
      });
      throw new Error(`gm-tools update blocked: cannot replace ${target} (held open by running plugkit and kill-retry exhausted)`);
    }
  }
  try {
    for (const name of fs.readdirSync(dst)) {
      if (/^plugkit(\.\d+\.\d+\.\d+)?\.new$/i.test(name)) {
        try { fs.unlinkSync(path.join(dst, name)); } catch (_) {}
      }
    }
  } catch (_) {}
  if (process.platform !== 'win32') {
    try { fs.chmodSync(target, 0o755); } catch (_) {}
  }
  fs.writeFileSync(path.join(dst, 'plugkit.version'), version);
  try {
    const srcSha = path.join(wrapperDir, 'plugkit.sha256');
    if (fs.existsSync(srcSha)) fs.copyFileSync(srcSha, path.join(dst, 'plugkit.sha256'));
  } catch (_) {}
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readVersionFile(wrapperDir) {
  const p = path.join(wrapperDir, 'plugkit.version');
  if (!fs.existsSync(p)) throw new Error(`plugkit.version not found at ${p}`);
  return fs.readFileSync(p, 'utf8').trim();
}

function readRtkVersion(wrapperDir) {
  const p = path.join(wrapperDir, 'rtk.version');
  if (!fs.existsSync(p)) return null;
  const v = fs.readFileSync(p, 'utf8').trim();
  return v || null;
}

function sha256OfFileSync(filePath) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      h.update(buf.subarray(0, n));
    }
  } finally { try { fs.closeSync(fd); } catch (_) {} }
  return h.digest('hex');
}

function healIfShaMatches(binPath, expectedSha, sentinelPath, partialPath, kind) {
  if (!fs.existsSync(binPath)) return false;
  if (partialPath) { try { if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath); } catch (_) {} }
  if (!expectedSha) return false;
  let got;
  try { got = sha256OfFileSync(binPath); }
  catch (_) { return false; }
  if (got !== expectedSha) {
    try { fs.unlinkSync(binPath); } catch (_) {}
    return false;
  }
  try { fs.writeFileSync(sentinelPath, new Date().toISOString()); } catch (_) { return false; }
  obsEvent('bootstrap', 'cache.heal', { path: binPath, kind });
  return true;
}

function readShaManifest(wrapperDir, manifestName) {
  const p = path.join(wrapperDir, manifestName || 'plugkit.sha256');
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
      try { const { spawnSync } = require('child_process'); spawnSync(process.execPath, ['-e', 'setTimeout(()=>{}, 2000)'], { timeout: 2500, killSignal: 'SIGKILL', stdio: 'ignore', windowsHide: true }); } catch (_) {}
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
      // Ensure parent dir exists — a concurrent prune may have removed it
      // between lock-acquire and now. Recreating is cheap and avoids a
      // confusing ENOENT later.
      try { ensureDir(path.dirname(destPath)); } catch (_) {}
      const out = fs.createWriteStream(destPath, { flags: append ? 'a' : 'w' });
      let bytes = append ? existing : 0;
      let lastStderr = Date.now();
      let lastByte = Date.now();
      const fetchStart = Date.now();
      const safeUrl = (() => { try { const p = new URL(url); return p.hostname + p.pathname; } catch(_) { return url.split('?')[0]; } })();
      obsEvent('bootstrap', 'fetch.start', { url: safeUrl, resume_from: existing, status: res.statusCode });
      const stallTimer = setInterval(() => {
        if (Date.now() - lastByte > STALL_TIMEOUT_MS) {
          clearInterval(stallTimer);
          req.destroy(new Error(`stalled: no bytes for ${STALL_TIMEOUT_MS}ms`));
        }
      }, 2000);
      res.on('data', c => {
        bytes += c.length;
        lastByte = Date.now();
        if (Date.now() - lastStderr > 5000) {
          const pct = expectedTotal ? ` ${Math.floor(bytes / expectedTotal * 100)}%` : '';
          try { process.stderr.write(`[plugkit-bootstrap] downloading: ${(bytes / 1048576).toFixed(1)} MiB${pct}\n`); } catch (_) {}
          lastStderr = Date.now();
        }
      });
      res.pipe(out);
      out.on('finish', () => {
        clearInterval(stallTimer);
        obsEvent('bootstrap', 'fetch.end', { url: safeUrl, bytes, dur_ms: Date.now() - fetchStart, ok: true });
        out.close(() => resolve(bytes));
      });
      out.on('error', err => { clearInterval(stallTimer); obsEvent('bootstrap', 'fetch.end', { url: safeUrl, bytes, dur_ms: Date.now() - fetchStart, ok: false, err: String(err.message || err) }); reject(err); });
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
      obsEvent('bootstrap', 'fetch.attempt_failed', { url, attempt, max: MAX_ATTEMPTS, err: String(err.message || err) });
      if (attempt < MAX_ATTEMPTS) {
        const wait = BACKOFF_MS[attempt - 1] || 120000;
        log(`backing off ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

function isLockStale(lockPath) {
  try {
    const st = fs.statSync(lockPath);
    if (Date.now() - st.mtimeMs > LOCK_STALE_MS) return true;
    const owner = parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
    if (Number.isFinite(owner) && !pidAlive(owner)) return true;
  } catch (_) { return true; }
  return false;
}

function pruneOldVersions(root, keepVersion, keepRtkVersion) {
  try {
    const entries = fs.readdirSync(root);
    for (const e of entries) {
      const isPlugkit = e.startsWith('v') && !e.startsWith('rtk-');
      const isRtk = e.startsWith('rtk-v');
      if (!isPlugkit && !isRtk) continue;
      if (isPlugkit && e === `v${keepVersion}`) continue;
      if (isRtk && keepRtkVersion && e === `rtk-v${keepRtkVersion}`) continue;
      const dir = path.join(root, e);
      const lock = path.join(dir, '.lock');
      if (fs.existsSync(lock) && !isLockStale(lock)) continue;
      if (fs.existsSync(lock)) { try { fs.unlinkSync(lock); } catch (_) {} }
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 1, retryDelay: 50 });
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
  const partialPath = `${finalPath}.partial`;

  if (fs.existsSync(finalPath) && fs.existsSync(okSentinel)) {
    if (expectedSha) {
      const actualSha = sha256OfFileSync(finalPath);
      if (actualSha === expectedSha) {
        obsEvent('bootstrap', 'decision.hit', { reason: 'sha-match', version, path: finalPath });
        copyToGmTools(finalPath, wrapperDir, version);
        clearBootstrapError();
        return finalPath;
      }
      log(`decision: fetch reason: cache-hit-sha-mismatch (dir=v${version} expected ${expectedSha.slice(0,12)}… got ${(actualSha||'').slice(0,12)}…)`);
      writeBootstrapError({
        expected_version: version,
        cached_version: null,
        error_phase: 'cache-hit-sha-mismatch',
        error_message: `cached binary at ${finalPath} sha=${actualSha} but manifest expects ${expectedSha}`,
      });
      try { fs.unlinkSync(finalPath); } catch (_) {}
      try { fs.unlinkSync(okSentinel); } catch (_) {}
    } else {
      obsEvent('bootstrap', 'decision.hit', { reason: 'sentinel+no-sha-manifest', path: finalPath });
      copyToGmTools(finalPath, wrapperDir, version);
      clearBootstrapError();
      return finalPath;
    }
  }

  if (healIfShaMatches(finalPath, expectedSha, okSentinel, partialPath, 'plugkit')) {
    obsEvent('bootstrap', 'decision.heal', { reason: 'sha-match', path: finalPath });
    spawnDetachedRtkFetch(wrapperDir);
    copyToGmTools(finalPath, wrapperDir, version);
    clearBootstrapError();
    return finalPath;
  }

  const lockPath = path.join(verDir, '.lock');
  acquireLock(lockPath);
  try {
    if (fs.existsSync(finalPath) && fs.existsSync(okSentinel)) {
      obsEvent('bootstrap', 'decision.hit', { reason: 'lock-race-resolved', path: finalPath });
      copyToGmTools(finalPath, wrapperDir, version);
      clearBootstrapError();
      return finalPath;
    }
    if (healIfShaMatches(finalPath, expectedSha, okSentinel, partialPath, 'plugkit')) {
      obsEvent('bootstrap', 'decision.heal', { reason: 'sha-match-under-lock', path: finalPath });
      spawnDetachedRtkFetch(wrapperDir);
      copyToGmTools(finalPath, wrapperDir, version);
      clearBootstrapError();
      return finalPath;
    }

    if (fs.existsSync(partialPath)) {
      try {
        const st = fs.statSync(partialPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(partialPath);
          log(`cleared stale partial: ${partialPath}`);
        }
      } catch (_) {}
    }
    const url = `https://github.com/${RELEASE_REPO}/releases/download/v${version}/${binName}`;
    try {
      await downloadWithRetry(url, partialPath);
    } catch (fetchErr) {
      writeBootstrapError({
        expected_version: version,
        cached_version: null,
        error_phase: 'download',
        error_message: fetchErr && fetchErr.message ? fetchErr.message : String(fetchErr),
      });
      throw fetchErr;
    }

    if (expectedSha) {
      const got = await sha256OfFile(partialPath);
      if (got !== expectedSha) {
        try { fs.unlinkSync(partialPath); } catch (_) {}
        writeBootstrapError({
          expected_version: version,
          cached_version: null,
          error_phase: 'sha256-mismatch',
          error_message: `sha256 mismatch for ${binName}: expected ${expectedSha}, got ${got}`,
        });
        throw new Error(`sha256 mismatch for ${binName}: expected ${expectedSha}, got ${got}`);
      }
      log('sha256 verified');
    } else {
      log('no sha256 manifest — skipping verify');
    }

    try { fs.renameSync(partialPath, finalPath); }
    catch (err) {
      if (err.code === 'EEXIST' || err.code === 'EPERM') {
        try { fs.unlinkSync(finalPath); } catch (_) {}
        fs.renameSync(partialPath, finalPath);
      } else throw err;
    }

    if (os.platform() !== 'win32') {
      try { fs.chmodSync(finalPath, 0o755); } catch (_) {}
    }

    fs.writeFileSync(okSentinel, new Date().toISOString());
    log(`decision: fetch reason: install-complete (${finalPath})`);
    obsEvent('bootstrap', 'install.done', { path: finalPath, version, kind: 'plugkit' });
    proactiveKillForNewInstall(version, finalPath);
    pruneOldVersions(root, version, readRtkVersion(wrapperDir));
    spawnDetachedRtkFetch(wrapperDir);
    copyToGmTools(finalPath, wrapperDir, version);
    clearBootstrapError();
    return finalPath;
  } finally {
    releaseLock(lockPath);
  }
}

function spawnDetachedRtkFetch(wrapperDir) {
  try {
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, [__filename, '--rtk-only', '--wrapper-dir', wrapperDir], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    obsEvent('bootstrap', 'rtk.detached.spawned', { pid: child.pid, wrapperDir });
  } catch (err) {
    log(`rtk detach spawn failed: ${err.message}`);
  }
}

function rtkCacheDir(root, wrapperDir, plugkitVerDir) {
  const rtkVer = readRtkVersion(wrapperDir);
  if (!rtkVer) return plugkitVerDir;
  const dir = path.join(root, `rtk-v${rtkVer}`);
  ensureDir(dir);
  return dir;
}

async function bootstrapRtk(plugkitVerDir, plugkitVersion, wrapperDir, silent, root) {
  const rtkName = rtkBinaryName();
  const cacheDir = rtkCacheDir(root || cacheRoot(), wrapperDir, plugkitVerDir);
  const rtkPath = path.join(cacheDir, rtkName);
  const rtkOk = path.join(cacheDir, '.rtk-ok');
  if (fs.existsSync(rtkPath) && fs.existsSync(rtkOk)) {
    if (!silent) log(`rtk cache hit: ${rtkPath}`);
    return rtkPath;
  }
  const rtkSha = readShaManifest(wrapperDir, 'rtk.sha256');
  const expected = rtkSha ? rtkSha[rtkName] : null;
  const tmp = `${rtkPath}.partial`;
  if (healIfShaMatches(rtkPath, expected, rtkOk, tmp, 'rtk')) {
    if (!silent) log(`rtk cache heal (sha match): ${rtkPath}`);
    return rtkPath;
  }
  const url = `https://github.com/${RELEASE_REPO}/releases/download/v${plugkitVersion}/${rtkName}`;
  await downloadWithRetry(url, tmp);
  if (expected) {
    const got = await sha256OfFile(tmp);
    if (got !== expected) {
      try { fs.unlinkSync(tmp); } catch (_) {}
      throw new Error(`rtk sha256 mismatch: expected ${expected}, got ${got}`);
    }
  }
  try { fs.renameSync(tmp, rtkPath); }
  catch (err) {
    if (err.code === 'EEXIST' || err.code === 'EPERM') {
      try { fs.unlinkSync(rtkPath); } catch (_) {}
      fs.renameSync(tmp, rtkPath);
    } else throw err;
  }
  if (os.platform() !== 'win32') { try { fs.chmodSync(rtkPath, 0o755); } catch (_) {} }
  fs.writeFileSync(rtkOk, new Date().toISOString());
  log(`installed ${rtkPath}`);
  obsEvent('bootstrap', 'install.done', { path: rtkPath, plugkit_version: plugkitVersion, rtk_version: readRtkVersion(wrapperDir) || plugkitVersion, kind: 'rtk' });
  return rtkPath;
}

function resolveCachedRtk(opts) {
  opts = opts || {};
  const wrapperDir = opts.wrapperDir || __dirname;
  const version = opts.version || readVersionFile(wrapperDir);
  const root = (() => {
    try { const r = cacheRoot(); ensureDir(r); return r; }
    catch (_) { const r = fallbackCacheRoot(); ensureDir(r); return r; }
  })();
  const plugkitVerDir = path.join(root, `v${version}`);
  const cacheDir = rtkCacheDir(root, wrapperDir, plugkitVerDir);
  const rtkPath = path.join(cacheDir, rtkBinaryName());
  const rtkOk = path.join(cacheDir, '.rtk-ok');
  if (fs.existsSync(rtkPath) && fs.existsSync(rtkOk)) return rtkPath;
  return null;
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

// ---------------------------------------------------------------------------
// Daemon kill on version change.
//
// The plugin tarball pins `plugkit.version`. When that pin advances and we
// install a newer cached binary, any long-running daemon (the runner) holds
// stale code and serves stale RPCs until killed. We track which version the
// daemon was last started under via `.daemon-version`; on every wrapper
// invocation, if the wrapper-pinned version differs, we kill the daemon so
// the next exec spawns it fresh under the new binary.
// ---------------------------------------------------------------------------

function daemonVersionSentinel() {
  const root = (() => {
    try { const r = cacheRoot(); ensureDir(r); return r; }
    catch (_) { const r = fallbackCacheRoot(); ensureDir(r); return r; }
  })();
  return path.join(root, '.daemon-version');
}

function readDaemonVersion() {
  try { return fs.readFileSync(daemonVersionSentinel(), 'utf8').trim(); }
  catch (_) { return null; }
}

function writeDaemonVersion(v) {
  try { fs.writeFileSync(daemonVersionSentinel(), String(v)); } catch (_) {}
}

function killPid(pid) {
  if (!Number.isFinite(pid) || pid === process.pid || !pidAlive(pid)) return false;
  try { process.kill(pid, 'SIGTERM'); }
  catch (_) { try { process.kill(pid); } catch (_) {} }
  if (os.platform() === 'win32' && pidAlive(pid)) {
    try {
      const { spawnSync } = require('child_process');
      spawnSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true, timeout: 3000, killSignal: 'SIGKILL' });
    } catch (_) {}
  }
  return true;
}

function killRunningDaemons(reason) {
  const tmp = os.tmpdir();
  const killedPids = [];
  for (const pidFile of ['glootie-runner.pid', 'plugkit-runner.pid']) {
    const pidPath = path.join(tmp, pidFile);
    if (!fs.existsSync(pidPath)) continue;
    try {
      const pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
      if (killPid(pid)) {
        killedPids.push(pid);
        obsEvent('bootstrap', 'daemon.killed', { pid, pidFile, reason });
      }
      try { fs.unlinkSync(pidPath); } catch (_) {}
    } catch (_) {}
  }
  return killedPids;
}

function listRunningPlugkitImagePaths() {
  const out = [];
  try {
    const { spawnSync } = require('child_process');
    if (os.platform() === 'win32') {
      let parsed = null;
      try {
        const p = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', "Get-Process plugkit* -ErrorAction SilentlyContinue | Select-Object Id,Path | ConvertTo-Json -Compress"], { windowsHide: true, encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'] });
        const text = ((p && p.stdout) || '').trim();
        if (text) {
          const j = JSON.parse(text);
          parsed = Array.isArray(j) ? j : [j];
        }
      } catch (_) {}
      if (parsed) {
        for (const item of parsed) {
          if (!item) continue;
          const pid = parseInt(item.Id, 10);
          if (!Number.isFinite(pid)) continue;
          out.push({ pid, path: (item.Path || '').trim() });
        }
      } else {
        const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq plugkit*', '/FO', 'CSV', '/NH'], { windowsHide: true, encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'] });
        const text = (r && r.stdout) || '';
        const seen = new Set();
        for (const line of text.split(/\r?\n/)) {
          const m = line.match(/^"([^"]+)","(\d+)"/);
          if (!m) continue;
          const pid = parseInt(m[2], 10);
          if (!Number.isFinite(pid) || seen.has(pid)) continue;
          seen.add(pid);
          out.push({ pid, path: '' });
        }
      }
    } else if (os.platform() === 'linux') {
      let entries = [];
      try { entries = fs.readdirSync('/proc'); } catch (_) {}
      for (const e of entries) {
        if (!/^\d+$/.test(e)) continue;
        const pid = parseInt(e, 10);
        let comm = '';
        try { comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim(); } catch (_) { continue; }
        if (!/^plugkit/i.test(comm)) continue;
        let imagePath = '';
        try { imagePath = fs.readlinkSync(`/proc/${pid}/exe`); } catch (_) {}
        out.push({ pid, path: imagePath });
      }
    } else {
      const r = spawnSync('ps', ['-axo', 'pid=,comm='], { encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'] });
      const text = (r && r.stdout) || '';
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*(\d+)\s+(.+?)\s*$/);
        if (!m) continue;
        if (!/plugkit/i.test(m[2])) continue;
        const pid = parseInt(m[1], 10);
        let imagePath = '';
        try {
          const p = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 3000, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'] });
          imagePath = ((p && p.stdout) || '').trim().split(/\s+/)[0] || '';
        } catch (_) {}
        out.push({ pid, path: imagePath });
      }
    }
  } catch (_) {}
  return out;
}

function killSpoolWatcherInCwd(reason) {
  try {
    const pidPath = path.join(process.cwd(), '.gm', 'exec-spool', '.watcher.pid');
    if (!fs.existsSync(pidPath)) return null;
    const pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
    if (killPid(pid)) {
      obsEvent('bootstrap', 'watcher.killed', { pid, reason });
      try { fs.unlinkSync(pidPath); } catch (_) {}
      return pid;
    }
    try { fs.unlinkSync(pidPath); } catch (_) {}
  } catch (_) {}
  return null;
}

function proactiveKillForNewInstall(installedVersion, finalPath) {
  try {
    const reason = `install:v${installedVersion}`;
    const target = finalPath ? path.resolve(finalPath).toLowerCase() : null;
    const cacheRootNorm = (() => {
      try { return path.resolve(cacheRoot()).toLowerCase(); } catch (_) { return null; }
    })();
    const procs = listRunningPlugkitImagePaths();
    for (const { pid, path: imagePath } of procs) {
      if (!Number.isFinite(pid) || pid === process.pid) continue;
      if (!imagePath) continue;
      const norm = path.resolve(imagePath).toLowerCase();
      if (target && norm === target) continue;
      if (!cacheRootNorm || !norm.startsWith(cacheRootNorm + path.sep.toLowerCase())) continue;
      if (killPid(pid)) {
        try { process.stderr.write(`[bootstrap] killed stale daemon pid=${pid} path=${imagePath} (current install: v${installedVersion})\n`); } catch (_) {}
        obsEvent('bootstrap', 'daemon.killed', { pid, oldPath: imagePath, installedVersion, mechanism: 'process-path' });
      }
    }
    killRunningDaemons(reason);
    killSpoolWatcherInCwd(reason);
    writeDaemonVersion(installedVersion);
  } catch (_) {}
}

// Compare wrapper-pinned version against last-recorded daemon version. If
// they differ, kill the daemon so it respawns under the new binary.
function killStaleDaemonIfVersionChanged(wrapperDir) {
  let currentVersion;
  try { currentVersion = readVersionFile(wrapperDir); } catch (_) { return; }
  const cached = resolveCachedBinary({ wrapperDir, version: currentVersion });
  if (cached) {
    proactiveKillForNewInstall(currentVersion, cached);
    return;
  }
  const recorded = readDaemonVersion();
  if (recorded === currentVersion) return;
  if (recorded) killRunningDaemons(`version_change:${recorded}->${currentVersion}`);
  writeDaemonVersion(currentVersion);
}

module.exports = { bootstrap, resolveCachedBinary, resolveCachedRtk, platformKey, binaryName, rtkBinaryName, cacheRoot, obsEvent, killRunningDaemons, killStaleDaemonIfVersionChanged, killSpoolWatcherInCwd, proactiveKillForNewInstall };

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv.includes('--rtk-only')) {
    const wIdx = argv.indexOf('--wrapper-dir');
    const wrapperDir = wIdx >= 0 ? argv[wIdx + 1] : __dirname;
    (async () => {
      try {
        const version = readVersionFile(wrapperDir);
        let root = cacheRoot();
        try { ensureDir(root); }
        catch (_) { root = fallbackCacheRoot(); ensureDir(root); }
        const verDir = path.join(root, `v${version}`);
        ensureDir(verDir);
        await bootstrapRtk(verDir, version, wrapperDir, true, root);
        process.exit(0);
      } catch (err) {
        obsEvent('bootstrap', 'rtk.detached.failed', { err: String(err.message || err) });
        process.exit(1);
      }
    })();
  } else {
    bootstrap({ silent: false })
      .then(p => { process.stdout.write(p + '\n'); process.exit(0); })
      .catch(err => {
        log(`FATAL: ${err.message}`);
        obsEvent('bootstrap', 'fatal', { err: String(err.message || err) });
        try {
          const pinned = (() => { try { return readVersionFile(__dirname); } catch (_) { return null; } })();
          writeBootstrapError({
            expected_version: pinned,
            cached_version: null,
            error_phase: 'fatal',
            error_message: String(err && err.message || err),
          });
        } catch (_) {}
        process.exit(1);
      });
  }
}
