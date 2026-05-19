#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const NPM_PACKAGE = '@anentrypoint/plugkit-wasm';
const ATTEMPT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [5000, 15000];
const LOCK_STALE_MS = 30 * 60 * 1000;

const wrapperDir = __dirname;

function log(msg) {
  try { process.stderr.write(`[gm-plugkit] ${msg}\n`); } catch (_) {}
}

function obsEvent(subsystem, event, fields) {
  if (process.env.GM_LOG_DISABLE) return;
  try {
    const root = process.env.GM_LOG_DIR || path.join(os.homedir(), '.claude', 'gm-log');
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.join(root, day);
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(), sub: subsystem, event,
      pid: process.pid, sess: process.env.CLAUDE_SESSION_ID || process.env.GM_SESSION_ID || '',
      ...fields,
    });
    fs.appendFileSync(path.join(dir, `${subsystem}.jsonl`), line + '\n');
  } catch (_) {}
}

function writeBootstrapError(spec) {
  try {
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const spoolDir = path.join(projectDir, '.gm', 'exec-spool');
    fs.mkdirSync(spoolDir, { recursive: true });
    fs.writeFileSync(path.join(spoolDir, '.bootstrap-error.json'), JSON.stringify({ ts: new Date().toISOString(), ...spec }, null, 2));
  } catch (_) {}
}

function clearBootstrapError() {
  try {
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    fs.unlinkSync(path.join(projectDir, '.gm', 'exec-spool', '.bootstrap-error.json'));
  } catch (_) {}
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

function readVersionFile() {
  const p = path.join(wrapperDir, 'plugkit.version');
  if (!fs.existsSync(p)) throw new Error(`plugkit.version not found at ${p}`);
  return fs.readFileSync(p, 'utf8').trim();
}

function readShaManifest() {
  const p = path.join(wrapperDir, 'plugkit.sha256');
  if (!fs.existsSync(p)) return null;
  const out = {};
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([0-9a-f]{64})\s+(\S+)\s*$/i);
    if (m) out[m[2]] = m[1].toLowerCase();
  }
  return out;
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

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
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
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
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

function resolveNpxJsCli() {
  if (process.platform !== 'win32') return null;
  const candidates = [];
  if (process.env.npm_config_prefix) {
    candidates.push(path.join(process.env.npm_config_prefix, 'node_modules', 'npm', 'bin', 'npx-cli.js'));
  }
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  candidates.push(path.join(programFiles, 'nodejs', 'node_modules', 'npm', 'bin', 'npx-cli.js'));
  candidates.push(path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js'));
  const appdata = process.env.APPDATA;
  if (appdata) candidates.push(path.join(appdata, 'npm', 'node_modules', 'npm', 'bin', 'npx-cli.js'));
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch (_) {}
  }
  return null;
}

async function extractNpmPackageWasm(destPath, version) {
  const tempDir = path.join(path.dirname(destPath), '.npm-extract-' + Date.now());
  try {
    ensureDir(tempDir);
    const startMs = Date.now();
    log(`extracting npm package ${NPM_PACKAGE}@${version} to ${tempDir}`);
    obsEvent('bootstrap', 'npm.extract.start', { package: NPM_PACKAGE, version });

    let cmd, args;
    if (process.platform === 'win32') {
      const npxCli = resolveNpxJsCli();
      if (npxCli) {
        cmd = process.execPath;
        args = [npxCli, NPM_PACKAGE + '@' + version, '--prefix', tempDir];
      } else {
        cmd = 'npx.cmd';
        args = [NPM_PACKAGE + '@' + version, '--prefix', tempDir];
      }
    } else {
      cmd = 'npx';
      args = [NPM_PACKAGE + '@' + version, '--prefix', tempDir];
    }

    const result = spawnSync(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: ATTEMPT_TIMEOUT_MS,
      encoding: 'utf8',
      windowsHide: true,
      shell: process.platform === 'win32' && cmd === 'npx.cmd',
    });

    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`npx extraction failed: ${result.stderr || result.stdout || 'unknown error'}`);
    }

    const nodeModulesPath = path.join(tempDir, 'node_modules', NPM_PACKAGE, 'plugkit.wasm');
    if (!fs.existsSync(nodeModulesPath)) {
      throw new Error(`plugkit.wasm not found in extracted npm package at ${nodeModulesPath}`);
    }

    fs.copyFileSync(nodeModulesPath, destPath);
    log(`extracted ${nodeModulesPath} → ${destPath}`);
    obsEvent('bootstrap', 'npm.extract.end', { dur_ms: Date.now() - startMs, ok: true });
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 1, retryDelay: 50 }); } catch (_) {}
  }
}

function httpGetBuffer(url, timeoutMs) {
  const https = require('https');
  const idleTimeoutMs = timeoutMs || 30000;
  const totalDeadlineMs = (timeoutMs || 30000) * 2;
  return new Promise((resolve, reject) => {
    let bytesReceived = 0;
    let settled = false;
    const settleReject = (err) => { if (!settled) { settled = true; reject(err); } };
    const settleResolve = (v) => { if (!settled) { settled = true; resolve(v); } };
    const absTimer = setTimeout(() => {
      try { req.destroy(new Error(`abs-deadline ${totalDeadlineMs}ms ${url} after ${bytesReceived} bytes`)); } catch (_) {}
      settleReject(new Error(`abs-deadline ${totalDeadlineMs}ms ${url} after ${bytesReceived} bytes`));
    }, totalDeadlineMs);
    const req = https.get(url, { timeout: idleTimeoutMs, headers: { 'user-agent': 'gm-plugkit-bootstrap' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        clearTimeout(absTimer);
        httpGetBuffer(res.headers.location, timeoutMs).then(settleResolve, settleReject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        clearTimeout(absTimer);
        settleReject(new Error(`HTTP ${res.statusCode} ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', c => { chunks.push(c); bytesReceived += c.length; });
      res.on('end', () => { clearTimeout(absTimer); settleResolve(Buffer.concat(chunks)); });
      res.on('error', (e) => { clearTimeout(absTimer); settleReject(e); });
    });
    req.on('timeout', () => { try { req.destroy(new Error(`idle-timeout ${idleTimeoutMs}ms ${url}`)); } catch (_) {} settleReject(new Error(`idle-timeout ${idleTimeoutMs}ms ${url}`)); });
    req.on('error', (e) => { clearTimeout(absTimer); settleReject(e); });
  });
}

async function downloadFromGithubReleases(destPath, version) {
  const base = `https://github.com/AnEntrypoint/plugkit-bin/releases/download/v${version}`;
  log(`gh-releases download: ${base}/plugkit.wasm`);
  const buf = await httpGetBuffer(`${base}/plugkit.wasm`, 60000);
  if (!buf || buf.length < 1024) throw new Error(`gh-releases download too small: ${buf ? buf.length : 0} bytes`);
  let remoteSha = '';
  try {
    const shaBuf = await httpGetBuffer(`${base}/plugkit.wasm.sha256`, 10000);
    remoteSha = shaBuf.toString('utf-8').trim().split(/\s+/)[0];
  } catch (e) { log(`gh-releases sha fetch failed: ${e.message}`); }
  if (remoteSha) {
    const got = require('crypto').createHash('sha256').update(buf).digest('hex');
    if (got !== remoteSha) throw new Error(`gh-releases sha mismatch: got ${got}, expected ${remoteSha}`);
    log(`gh-releases sha verified ${got.slice(0, 16)}...`);
  }
  fs.writeFileSync(destPath, buf);
  log(`gh-releases wrote ${buf.length} bytes to ${destPath}`);
}

async function extractNpmPackageWithRetry(destPath, version) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      log(`npm extract attempt ${attempt}/${MAX_ATTEMPTS}: ${NPM_PACKAGE}@${version}`);
      await extractNpmPackageWasm(destPath, version);
      return;
    } catch (err) {
      lastErr = err;
      log(`attempt ${attempt} failed: ${err.message}`);
      obsEvent('bootstrap', 'npm.extract.attempt_failed', { package: NPM_PACKAGE, attempt, max: MAX_ATTEMPTS, err: String(err.message || err) });
      if (attempt < MAX_ATTEMPTS) {
        const wait = BACKOFF_MS[attempt - 1] || 120000;
        log(`backing off ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}


function platformKey() {
  const p = os.platform();
  const a = os.arch();
  if (p === 'win32') return a === 'arm64' ? 'win32-arm64' : 'win32-x64';
  if (p === 'darwin') return a === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  return (a === 'arm64' || a === 'aarch64') ? 'linux-arm64' : 'linux-x64';
}

function rtkBinaryName() {
  const key = platformKey();
  return key.startsWith('win32') ? `rtk-${key}.exe` : `rtk-${key}`;
}

function readRtkVersion() {
  const p = path.join(wrapperDir, 'rtk.version');
  if (!fs.existsSync(p)) return null;
  const v = fs.readFileSync(p, 'utf8').trim();
  return v || null;
}

function rtkCacheDir(root, plugkitVerDir) {
  const rtkVer = readRtkVersion();
  if (!rtkVer) return plugkitVerDir;
  const dir = path.join(root, `rtk-v${rtkVer}`);
  ensureDir(dir);
  return dir;
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
    try { spawnSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true, timeout: 3000, killSignal: 'SIGKILL' }); } catch (_) {}
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

function proactiveKillForNewInstall(installedVersion) {
  try {
    const reason = `install:v${installedVersion}`;
    killRunningDaemons(reason);
    killSpoolWatcherInCwd(reason);
    writeDaemonVersion(installedVersion);
  } catch (_) {}
}

function killStaleDaemonIfVersionChanged() {
  let currentVersion;
  try { currentVersion = readVersionFile(); } catch (_) { return; }
  const cached = resolveCachedBinary({ version: currentVersion });
  if (cached) {
    proactiveKillForNewInstall(currentVersion, cached);
    return;
  }
  const recorded = readDaemonVersion();
  if (recorded === currentVersion) return;
  if (recorded) killRunningDaemons(`version_change:${recorded}->${currentVersion}`);
  writeDaemonVersion(currentVersion);
}


function resolveCachedRtk() {
  const version = readVersionFile();
  const root = (() => {
    try { const r = cacheRoot(); ensureDir(r); return r; }
    catch (_) { const r = fallbackCacheRoot(); ensureDir(r); return r; }
  })();
  const plugkitVerDir = path.join(root, `v${version}`);
  const cacheDir = rtkCacheDir(root, plugkitVerDir);
  const rtkPath = path.join(cacheDir, rtkBinaryName());
  const rtkOk = path.join(cacheDir, '.rtk-ok');
  if (fs.existsSync(rtkPath) && fs.existsSync(rtkOk)) return rtkPath;
  return null;
}

async function bootstrapRtk(plugkitVerDir, plugkitVersion, silent, root) {
  const rtkName = rtkBinaryName();
  const cacheDir = rtkCacheDir(root || cacheRoot(), plugkitVerDir);
  const rtkPath = path.join(cacheDir, rtkName);
  const rtkOk = path.join(cacheDir, '.rtk-ok');
  if (fs.existsSync(rtkPath) && fs.existsSync(rtkOk)) {
    if (!silent) log(`rtk cache hit: ${rtkPath}`);
    return rtkPath;
  }
  const rtkSha = readShaManifest();
  // rtk.sha256 may be in a separate file
  const rtkShaPath = path.join(wrapperDir, 'rtk.sha256');
  let expected = null;
  if (fs.existsSync(rtkShaPath)) {
    expected = fs.readFileSync(rtkShaPath, 'utf8').trim();
  }
  const tmp = `${rtkPath}.partial`;
  if (healIfShaMatches(rtkPath, expected, rtkOk, tmp, 'rtk')) {
    if (!silent) log(`rtk cache heal (sha match): ${rtkPath}`);
    return rtkPath;
  }
  const RTKS_RELEASE_REPO = 'AnEntrypoint/plugkit-bin';
  const url = `https://github.com/${RTKS_RELEASE_REPO}/releases/download/v${plugkitVersion}/${rtkName}`;
  const startMs = Date.now();
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      log(`rtk download attempt ${attempt}/${MAX_ATTEMPTS}: ${url}`);
      const result = spawnSync(
        'curl',
        ['-fSL', '--max-time', String(Math.floor(ATTEMPT_TIMEOUT_MS / 1000)), '-o', tmp, url],
        { stdio: 'pipe', timeout: ATTEMPT_TIMEOUT_MS + 5000, windowsHide: true }
      );
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`curl failed with status ${result.status}`);
      break;
    } catch (err) {
      lastErr = err;
      log(`rtk attempt ${attempt} failed: ${err.message}`);
      obsEvent('bootstrap', 'rtk.download.attempt_failed', { attempt, max: MAX_ATTEMPTS, err: String(err.message || err) });
      if (attempt < MAX_ATTEMPTS) {
        const wait = BACKOFF_MS[attempt - 1] || 120000;
        log(`backing off ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  if (lastErr) throw lastErr;
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
  obsEvent('bootstrap', 'install.done', { path: rtkPath, plugkit_version: plugkitVersion, rtk_version: readRtkVersion() || plugkitVersion, kind: 'rtk', dur_ms: Date.now() - startMs });
  return rtkPath;
}

function spawnDetachedRtkFetch() {
  try {
    const child = spawn(process.execPath, [__filename, '--rtk-only'], {
      detached: true, stdio: 'ignore', windowsHide: true,
    });
    child.unref();
    obsEvent('bootstrap', 'rtk.detached.spawned', { pid: child.pid });
  } catch (err) {
    log(`rtk detach spawn failed: ${err.message}`);
  }
}

async function bootstrap(opts) {
  opts = opts || {};
  const version = readVersionFile();
  const shaManifest = readShaManifest();
  const wasmName = 'plugkit.wasm';
  const expectedSha = shaManifest ? shaManifest[wasmName] : null;

  let root = cacheRoot();
  try { ensureDir(root); }
  catch (_) { root = fallbackCacheRoot(); ensureDir(root); }

  const verDir = path.join(root, `v${version}`);
  ensureDir(verDir);

  const finalPath = path.join(verDir, wasmName);
  const okSentinel = path.join(verDir, '.ok');
  const partialPath = `${finalPath}.partial`;

  if (fs.existsSync(finalPath) && fs.existsSync(okSentinel)) {
    if (expectedSha) {
      const actualSha = sha256OfFileSync(finalPath);
      if (actualSha === expectedSha) {
        obsEvent('bootstrap', 'decision.hit', { reason: 'sha-match', version, path: finalPath });
        copyWasmToGmTools(finalPath, version);
        clearBootstrapError();
        return finalPath;
      }
      log(`decision: fetch reason: cache-hit-sha-mismatch (dir=v${version} expected ${expectedSha.slice(0,12)}... got ${(actualSha||'').slice(0,12)}...)`);
      writeBootstrapError({
        expected_version: version, cached_version: null,
        error_phase: 'cache-hit-sha-mismatch',
        error_message: `cached wasm at ${finalPath} sha=${actualSha} but manifest expects ${expectedSha}`,
      });
      try { fs.unlinkSync(finalPath); } catch (_) {}
      try { fs.unlinkSync(okSentinel); } catch (_) {}
    } else {
      obsEvent('bootstrap', 'decision.hit', { reason: 'sentinel+no-sha-manifest', path: finalPath });
      copyWasmToGmTools(finalPath, version);
      clearBootstrapError();
      return finalPath;
    }
  }

  if (healIfShaMatches(finalPath, expectedSha, okSentinel, partialPath, 'plugkit-wasm')) {
    obsEvent('bootstrap', 'decision.heal', { reason: 'sha-match', path: finalPath });
    spawnDetachedRtkFetch();
    copyWasmToGmTools(finalPath, version);
    clearBootstrapError();
    return finalPath;
  }

  const lockPath = path.join(verDir, '.lock');
  acquireLock(lockPath);
  try {
    if (fs.existsSync(finalPath) && fs.existsSync(okSentinel)) {
      obsEvent('bootstrap', 'decision.hit', { reason: 'lock-race-resolved', path: finalPath });
      copyWasmToGmTools(finalPath, version);
      clearBootstrapError();
      return finalPath;
    }
    if (healIfShaMatches(finalPath, expectedSha, okSentinel, partialPath, 'plugkit-wasm')) {
      obsEvent('bootstrap', 'decision.heal', { reason: 'sha-match-under-lock', path: finalPath });
      spawnDetachedRtkFetch();
      copyWasmToGmTools(finalPath, version);
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
    try {
      await extractNpmPackageWithRetry(partialPath, version);
    } catch (extractErr) {
      log(`npm-extract failed (${extractErr.message || extractErr}); falling back to GitHub Releases`);
      try {
        await downloadFromGithubReleases(partialPath, version);
      } catch (ghErr) {
        writeBootstrapError({
          expected_version: version, cached_version: null,
          error_phase: 'npm-extract+gh-fallback',
          error_message: `npm: ${extractErr.message}; gh: ${ghErr.message}`,
        });
        throw ghErr;
      }
    }

    if (expectedSha) {
      const got = await sha256OfFile(partialPath);
      if (got !== expectedSha) {
        try { fs.unlinkSync(partialPath); } catch (_) {}
        writeBootstrapError({
          expected_version: version, cached_version: null,
          error_phase: 'sha256-mismatch',
          error_message: `sha256 mismatch for ${wasmName}: expected ${expectedSha}, got ${got}`,
        });
        throw new Error(`sha256 mismatch for ${wasmName}: expected ${expectedSha}, got ${got}`);
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

    fs.writeFileSync(okSentinel, new Date().toISOString());
    log(`decision: fetch reason: install-complete (${finalPath})`);
    obsEvent('bootstrap', 'install.done', { path: finalPath, version, kind: 'plugkit-wasm' });
    proactiveKillForNewInstall(version);
    pruneOldVersions(root, version, readRtkVersion());
    spawnDetachedRtkFetch();
    copyWasmToGmTools(finalPath, version);
    clearBootstrapError();
    return finalPath;
  } finally {
    releaseLock(lockPath);
  }
}

function copyWasmToGmTools(wasmPath, version) {
  const dst = gmToolsDir();
  fs.mkdirSync(dst, { recursive: true });
  const target = path.join(dst, 'plugkit.wasm');
  const wrapperSrc = path.join(__dirname, 'plugkit-wasm-wrapper.js');
  const wrapperDst = path.join(dst, 'plugkit-wasm-wrapper.js');

  let wasmFresh = false;
  if (fs.existsSync(target)) {
    try {
      const cur = sha256OfFileSync(target);
      const src = sha256OfFileSync(wasmPath);
      if (cur === src) wasmFresh = true;
    } catch (_) {}
  }
  if (!wasmFresh) fs.copyFileSync(wasmPath, target);
  fs.writeFileSync(path.join(dst, 'plugkit.version'), version);

  if (fs.existsSync(wrapperSrc)) {
    let wrapperFresh = false;
    if (fs.existsSync(wrapperDst)) {
      try {
        const cur = sha256OfFileSync(wrapperDst);
        const src = sha256OfFileSync(wrapperSrc);
        if (cur === src) wrapperFresh = true;
      } catch (_) {}
    }
    if (!wrapperFresh) fs.copyFileSync(wrapperSrc, wrapperDst);
  }
}

function getWasmPath() {
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  return path.join(home, '.claude', 'gm-tools', 'plugkit.wasm');
}

function isReady() {
  const wasm = getWasmPath();
  return fs.existsSync(wasm);
}

function ensureWrapperFresh() {
  try {
    const wrapperSrc = path.join(__dirname, 'plugkit-wasm-wrapper.js');
    const wrapperDst = path.join(gmToolsDir(), 'plugkit-wasm-wrapper.js');
    if (!fs.existsSync(wrapperSrc)) return false;
    let same = false;
    if (fs.existsSync(wrapperDst)) {
      try {
        const a = sha256OfFileSync(wrapperSrc);
        const b = sha256OfFileSync(wrapperDst);
        if (a === b) same = true;
      } catch (_) {}
    }
    if (!same) {
      fs.mkdirSync(gmToolsDir(), { recursive: true });
      fs.copyFileSync(wrapperSrc, wrapperDst);
      return true;
    }
    return false;
  } catch (_) { return false; }
}

function installedVersionAtTools() {
  try {
    const p = path.join(gmToolsDir(), 'plugkit.version');
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, 'utf-8').trim();
  } catch (_) { return null; }
}

async function resolveLatestRemoteVersion(timeoutMs) {
  try {
    const buf = await httpGetBuffer('https://api.github.com/repos/AnEntrypoint/plugkit-bin/releases?per_page=50', timeoutMs || 3000);
    const releases = JSON.parse(buf.toString('utf-8'));
    if (!Array.isArray(releases)) return null;
    for (const rel of releases) {
      const tag = rel && rel.tag_name;
      if (!tag) continue;
      const m = /^v(\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?)$/.exec(tag);
      if (!m) continue;
      const hasPlugkitWasm = Array.isArray(rel.assets) && rel.assets.some(a => a && a.name === 'plugkit.wasm');
      if (hasPlugkitWasm) return m[1];
    }
  } catch (_) {}
  return null;
}

async function ensureReady(opts) {
  opts = opts || {};
  const offline = opts.offline === true;
  let pinnedVersion = null;
  try { pinnedVersion = readVersionFile(); } catch (_) {}
  let targetVersion = pinnedVersion;
  if (!offline) {
    const latest = await resolveLatestRemoteVersion(3000);
    if (latest) targetVersion = latest;
  }
  if (!targetVersion) targetVersion = pinnedVersion;

  const installed = installedVersionAtTools();
  const versionDrift = targetVersion && installed && installed !== targetVersion;

  if (isReady() && !versionDrift) {
    const wasmPath = getWasmPath();
    const wrapperUpdated = ensureWrapperFresh();
    return { ok: true, wasmPath, binaryPath: wasmPath, status: wrapperUpdated ? 'wrapper-refreshed' : 'already-ready', version: installed };
  }
  if (versionDrift) {
    try { killRunningDaemons(`version_drift:${installed}->${targetVersion}`); } catch (_) {}
  }

  if (targetVersion && targetVersion !== pinnedVersion) {
    try {
      const verFilePath = path.join(wrapperDir, 'plugkit.version');
      fs.writeFileSync(verFilePath, targetVersion + '\n');
      log(`overrode bundled plugkit.version: ${pinnedVersion} -> ${targetVersion} (remote latest)`);
    } catch (e) { log(`could not override plugkit.version: ${e.message}`); }
  }

  const wasmPath = await bootstrap();
  ensureWrapperFresh();
  return { ok: true, wasmPath, binaryPath: wasmPath, status: 'bootstrapped', version: targetVersion || installed };
}

function getBinaryPath() {
  return getWasmPath();
}

function probeUnsupervisedWatcher(spoolDir) {
  try {
    const statusPath = path.join(spoolDir, '.status.json');
    const supervisorPath = path.join(spoolDir, '.supervisor.json');
    const markerPath = path.join(spoolDir, '.pre-supervised-watcher.json');
    if (!fs.existsSync(statusPath)) {
      try { fs.unlinkSync(markerPath); } catch (_) {}
      return;
    }
    const status = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
    const age = Date.now() - (status && status.ts || 0);
    if (age > 30_000) {
      try { fs.unlinkSync(markerPath); } catch (_) {}
      return;
    }
    if (fs.existsSync(supervisorPath)) {
      try { fs.unlinkSync(markerPath); } catch (_) {}
      return;
    }
    const marker = {
      ts: Date.now(),
      reason: 'running-watcher-has-no-supervisor',
      watcher_pid: status.pid,
      watcher_version: status.version,
      severity: 'warn',
      instruction: 'A running watcher was started under an older bootstrap that did not spawn a supervisor. Unplanned-restart recovery and idle-teardown coordination are dormant. To migrate, stop the current watcher (taskkill /F /T /PID <watcher_pid> on Windows or kill <watcher_pid> on POSIX) and let the next bootstrap re-spawn it under supervisor.js.',
    };
    fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2));
  } catch (_) {}
}

function startSpoolDaemon() {
  try {
    const wrapper = path.join(gmToolsDir(), 'plugkit-wasm-wrapper.js');
    if (!fs.existsSync(wrapper)) {
      return { ok: false, error: `wrapper not at ${wrapper} — ensureReady() must run first` };
    }
    const runtime = process.platform === 'win32' ? 'bun.exe' : 'bun';
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const spoolDir = path.join(projectDir, '.gm', 'exec-spool');
    fs.mkdirSync(spoolDir, { recursive: true });
    probeUnsupervisedWatcher(spoolDir);
    const logPath = path.join(spoolDir, '.watcher.log');
    try {
      const stat = fs.statSync(logPath);
      if (stat.size > 10 * 1024 * 1024) {
        try { fs.unlinkSync(path.join(spoolDir, '.watcher.log.1')); } catch (_) {}
        fs.renameSync(logPath, path.join(spoolDir, '.watcher.log.1'));
      }
    } catch (_) {}

    const supervisor = path.join(__dirname, 'supervisor.js');
    if (process.env.PLUGKIT_SKIP_SUPERVISOR === '1' || !fs.existsSync(supervisor)) {
      let cmd = runtime;
      let args = [wrapper, 'spool'];
      try {
        require('child_process').execFileSync(runtime, ['--version'], { stdio: 'ignore' });
      } catch (_) {
        cmd = process.execPath;
        args = [wrapper, 'spool'];
      }
      const logFd = fs.openSync(logPath, 'a');
      try { fs.writeSync(logFd, `\n--- daemon spawn ${new Date().toISOString()} parent=${process.pid} (no supervisor) ---\n`); } catch (_) {}
      const child = require('child_process').spawn(cmd, args, {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        windowsHide: true,
        env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, PLUGKIT_BOOT_REASON: 'direct-no-supervisor' },
      });
      try { fs.closeSync(logFd); } catch (_) {}
      const pid = child.pid;
      child.unref();
      return { ok: true, pid, wrapper, runtime: cmd, logPath, supervised: false };
    }

    const logFd = fs.openSync(logPath, 'a');
    try { fs.writeSync(logFd, `\n--- supervisor spawn ${new Date().toISOString()} parent=${process.pid} ---\n`); } catch (_) {}
    const child = require('child_process').spawn(process.execPath, [supervisor], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, PLUGKIT_RUNTIME: runtime },
    });
    try { fs.closeSync(logFd); } catch (_) {}
    const pid = child.pid;
    child.unref();
    return { ok: true, pid, wrapper, supervisor, runtime, logPath, supervised: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  bootstrap,
  ensureReady,
  getWasmPath,
  getBinaryPath,
  startSpoolDaemon,
  isReady,
  rtkBinaryName,
  cacheRoot,
  obsEvent,
  killRunningDaemons,
  killStaleDaemonIfVersionChanged,
  killSpoolWatcherInCwd,
  proactiveKillForNewInstall,
  resolveCachedRtk,
  bootstrapRtk,
  readDaemonVersion,
  writeDaemonVersion,
  daemonVersionSentinel,
};

if (require.main === module) {
  (async () => {
    try {
      const args = process.argv.slice(2);
      if (args.includes('--rtk-only')) {
        const version = readVersionFile();
        let root = cacheRoot();
        try { ensureDir(root); }
        catch (_) { root = fallbackCacheRoot(); ensureDir(root); }
        const verDir = path.join(root, `v${version}`);
        ensureDir(verDir);
        await bootstrapRtk(verDir, version, true, root);
        process.exit(0);
      } else if (args.includes('--status')) {
        console.log(JSON.stringify({
          ready: isReady(),
          wasmPath: getWasmPath(),
          daemonVersion: readDaemonVersion(),
          cachedRtk: resolveCachedRtk(),
        }));
        process.exit(0);
      } else {
        const result = await ensureReady();
        console.log(JSON.stringify({ bootstrap: result }));
        process.exit(result.ok ? 0 : 1);
      }
    } catch (err) {
      obsEvent('bootstrap', 'fatal', { err: String(err.message || err) });
      try {
        const pinned = (() => { try { return readVersionFile(); } catch (_) { return null; } })();
        writeBootstrapError({
          expected_version: pinned, cached_version: null,
          error_phase: 'fatal', error_message: String(err && err.message || err),
        });
      } catch (_) {}
      console.error('gm-plugkit bootstrap failed:', err.message);
      process.exit(1);
    }
  })();
}
