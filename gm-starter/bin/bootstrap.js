#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const NPM_PACKAGE = 'plugkit-wasm';
const ATTEMPT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [5000, 15000];
const LOCK_STALE_MS = 30 * 60 * 1000;

function log(msg) {
  try { process.stderr.write(`[plugkit-bootstrap] ${msg}\n`); } catch (_) {}
}

// Resolve a bare command name to its actual .exe on Windows. cmd.exe + .cmd
// shim chains re-enter conhost (visible window flash) even with
// windowsHide:true on the parent. Spawning the real .exe directly lets
// CREATE_NO_WINDOW propagate. Falls back to .cmd or the original name when
// no .exe is found. See [[windows-spawn-cmd-shim-flash]].
function resolveWindowsExe(cmd) {
  if (process.platform !== 'win32') return cmd;
  try {
    const r = spawnSync('where', [cmd], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      timeout: 800,
    });
    if (r.status !== 0) return cmd;
    const lines = (r.stdout || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const exe = lines.find(l => /\.exe$/i.test(l));
    return exe || lines[0] || cmd;
  } catch {
    return cmd;
  }
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

function copyWasmToGmTools(wasmPath, wrapperDir, version) {
  const dst = gmToolsDir();
  fs.mkdirSync(dst, { recursive: true });
  const target = path.join(dst, 'plugkit.wasm');
  if (fs.existsSync(target)) {
    try {
      const cur = sha256OfFileSync(target);
      const src = sha256OfFileSync(wasmPath);
      if (cur === src) {
        try { fs.writeFileSync(path.join(dst, 'plugkit.version'), version); } catch (_) {}
        return;
      }
    } catch (_) {}
  }
  fs.copyFileSync(wasmPath, target);
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

async function extractNpmPackageWasm(destPath, version) {
  const tempDir = path.join(path.dirname(destPath), '.npm-extract-' + Date.now());
  try {
    ensureDir(tempDir);
    const startMs = Date.now();
    log(`extracting npm package ${NPM_PACKAGE}@${version} to ${tempDir}`);
    obsEvent('bootstrap', 'npm.extract.start', { package: NPM_PACKAGE, version });

    const npxResolved = resolveWindowsExe('npx');
    const result = spawnSync(
      npxResolved,
      [NPM_PACKAGE + '@' + version, '--prefix', tempDir],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: ATTEMPT_TIMEOUT_MS,
        encoding: 'utf8',
        windowsHide: true,
        // CREATE_NO_WINDOW — inherited by all .cmd shims npm/npx spawn
        // during package extraction, so no conhost flash during install.
        ...(process.platform === 'win32' ? { creationFlags: 0x08000000 } : {}),
      }
    );

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
  const wasmName = 'plugkit.wasm';
  const wasmExpectedSha = shaManifest ? shaManifest[wasmName] : null;

  let root = cacheRoot();
  try { ensureDir(root); }
  catch (_) { root = fallbackCacheRoot(); ensureDir(root); }

  const verDir = path.join(root, `v${version}`);
  ensureDir(verDir);

  const wasmFinalPath = path.join(verDir, wasmName);
  const wasmOkSentinel = path.join(verDir, '.wasm-ok');
  const wasmPartialPath = `${wasmFinalPath}.partial`;

  if (fs.existsSync(wasmFinalPath) && fs.existsSync(wasmOkSentinel)) {
    if (wasmExpectedSha) {
      const actualSha = sha256OfFileSync(wasmFinalPath);
      if (actualSha === wasmExpectedSha) {
        obsEvent('bootstrap', 'decision.hit', { reason: 'sha-match', version, path: wasmFinalPath });
        copyWasmToGmTools(wasmFinalPath, wrapperDir, version);
        clearBootstrapError();
        return wasmFinalPath;
      }
      log(`decision: fetch reason: cache-hit-sha-mismatch (dir=v${version} expected ${wasmExpectedSha.slice(0,12)}… got ${(actualSha||'').slice(0,12)}…)`);
      writeBootstrapError({
        expected_version: version,
        cached_version: null,
        error_phase: 'cache-hit-sha-mismatch',
        error_message: `cached wasm at ${wasmFinalPath} sha=${actualSha} but manifest expects ${wasmExpectedSha}`,
      });
      try { fs.unlinkSync(wasmFinalPath); } catch (_) {}
      try { fs.unlinkSync(wasmOkSentinel); } catch (_) {}
    } else {
      obsEvent('bootstrap', 'decision.hit', { reason: 'sentinel+no-sha-manifest', path: wasmFinalPath });
      copyWasmToGmTools(wasmFinalPath, wrapperDir, version);
      clearBootstrapError();
      return wasmFinalPath;
    }
  }

  if (healIfShaMatches(wasmFinalPath, wasmExpectedSha, wasmOkSentinel, wasmPartialPath, 'wasm')) {
    obsEvent('bootstrap', 'decision.heal', { reason: 'sha-match', path: wasmFinalPath });
    spawnDetachedRtkFetch(wrapperDir);
    copyWasmToGmTools(wasmFinalPath, wrapperDir, version);
    clearBootstrapError();
    return wasmFinalPath;
  }

  const lockPath = path.join(verDir, '.lock');
  acquireLock(lockPath);
  try {
    if (fs.existsSync(wasmFinalPath) && fs.existsSync(wasmOkSentinel)) {
      obsEvent('bootstrap', 'decision.hit', { reason: 'lock-race-resolved', path: wasmFinalPath });
      copyWasmToGmTools(wasmFinalPath, wrapperDir, version);
      clearBootstrapError();
      return wasmFinalPath;
    }
    if (healIfShaMatches(wasmFinalPath, wasmExpectedSha, wasmOkSentinel, wasmPartialPath, 'wasm')) {
      obsEvent('bootstrap', 'decision.heal', { reason: 'sha-match-under-lock', path: wasmFinalPath });
      spawnDetachedRtkFetch(wrapperDir);
      copyWasmToGmTools(wasmFinalPath, wrapperDir, version);
      clearBootstrapError();
      return wasmFinalPath;
    }

    if (fs.existsSync(wasmPartialPath)) {
      try {
        const st = fs.statSync(wasmPartialPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(wasmPartialPath);
          log(`cleared stale partial: ${wasmPartialPath}`);
        }
      } catch (_) {}
    }
    try {
      await extractNpmPackageWithRetry(wasmPartialPath, version);
    } catch (extractErr) {
      writeBootstrapError({
        expected_version: version,
        cached_version: null,
        error_phase: 'npm-extract',
        error_message: extractErr && extractErr.message ? extractErr.message : String(extractErr),
      });
      throw extractErr;
    }

    if (wasmExpectedSha) {
      const got = await sha256OfFile(wasmPartialPath);
      if (got !== wasmExpectedSha) {
        try { fs.unlinkSync(wasmPartialPath); } catch (_) {}
        writeBootstrapError({
          expected_version: version,
          cached_version: null,
          error_phase: 'sha256-mismatch',
          error_message: `sha256 mismatch for ${wasmName}: expected ${wasmExpectedSha}, got ${got}`,
        });
        throw new Error(`sha256 mismatch for ${wasmName}: expected ${wasmExpectedSha}, got ${got}`);
      }
      log('sha256 verified');
    } else {
      log('no sha256 manifest — skipping verify');
    }

    try { fs.renameSync(wasmPartialPath, wasmFinalPath); }
    catch (err) {
      if (err.code === 'EEXIST' || err.code === 'EPERM') {
        try { fs.unlinkSync(wasmFinalPath); } catch (_) {}
        fs.renameSync(wasmPartialPath, wasmFinalPath);
      } else throw err;
    }

    fs.writeFileSync(wasmOkSentinel, new Date().toISOString());
    log(`decision: fetch reason: install-complete (${wasmFinalPath})`);
    obsEvent('bootstrap', 'install.done', { path: wasmFinalPath, version, kind: 'wasm' });
    pruneOldVersions(root, version, readRtkVersion(wrapperDir));
    spawnDetachedRtkFetch(wrapperDir);
    copyWasmToGmTools(wasmFinalPath, wrapperDir, version);

    clearBootstrapError();
    return wasmFinalPath;
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
  obsEvent('bootstrap', 'install.done', { path: rtkPath, plugkit_version: plugkitVersion, rtk_version: readRtkVersion(wrapperDir) || plugkitVersion, kind: 'rtk', dur_ms: Date.now() - startMs });
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

function getWasmPath(opts) {
  opts = opts || {};
  const wrapperDir = opts.wrapperDir || __dirname;
  const version = opts.version || readVersionFile(wrapperDir);
  const root = (() => {
    try { const r = cacheRoot(); ensureDir(r); return r; }
    catch (_) { const r = fallbackCacheRoot(); ensureDir(r); return r; }
  })();
  const verDir = path.join(root, `v${version}`);
  const wasmPath = path.join(verDir, 'plugkit.wasm');
  const okSentinel = path.join(verDir, '.wasm-ok');
  if (fs.existsSync(wasmPath) && fs.existsSync(okSentinel)) return wasmPath;
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

function proactiveKillForNewInstall(installedVersion) {
  try {
    const reason = `install:v${installedVersion}`;
    killRunningDaemons(reason);
    killSpoolWatcherInCwd(reason);
    writeDaemonVersion(installedVersion);
  } catch (_) {}
}

function killStaleDaemonIfVersionChanged(wrapperDir) {
  let currentVersion;
  try { currentVersion = readVersionFile(wrapperDir); } catch (_) { return; }
  const cached = getWasmPath({ wrapperDir, version: currentVersion });
  if (cached) {
    proactiveKillForNewInstall(currentVersion);
    return;
  }
  const recorded = readDaemonVersion();
  if (recorded === currentVersion) return;
  if (recorded) killRunningDaemons(`version_change:${recorded}->${currentVersion}`);
  writeDaemonVersion(currentVersion);
}

module.exports = { bootstrap, getWasmPath, resolveCachedRtk, rtkBinaryName, cacheRoot, obsEvent, killRunningDaemons, killStaleDaemonIfVersionChanged, killSpoolWatcherInCwd, proactiveKillForNewInstall };

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
