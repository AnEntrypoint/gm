#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { pidAlive, sha256OfFile, sha256OfFileSync } = require('./gm-process');
const shared = require('./bootstrap-shared');
const {
  obsEvent,
  cacheRoot,
  fallbackCacheRoot,
  gmToolsDir,
  ensureDir,
  acquireLock,
  releaseLock,
  isLockStale,
  pruneOldVersions,
  healIfShaMatches,
  daemonVersionSentinel,
  readDaemonVersion,
  writeDaemonVersion,
  pidCommandLineForKillGuard,
  pidIsPlugkitProcess,
  writeKillAttribution,
  killPid,
  killSpoolWatcherInCwd,
  proactiveKillForNewInstall,
  ensureNextStepWiring: ensureNextStepWiringShared,
  resolveWindowsExe,
  resolveNpmCliJs,
} = shared;

const NPM_PACKAGE = 'plugkit-wasm';
const ATTEMPT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [5000, 15000];
const LOCK_STALE_MS = 30 * 60 * 1000;

const wrapperDir = __dirname;

function log(msg) {
  try { process.stderr.write(`[gm-plugkit] ${msg}\n`); } catch (_) {}
}

function writeBootstrapError(spec) {
  try {
    const projectDir = resolveProjectRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());
    const spoolDir = path.join(projectDir, '.gm', 'exec-spool');
    fs.mkdirSync(spoolDir, { recursive: true });
    fs.writeFileSync(path.join(spoolDir, '.bootstrap-error.json'), JSON.stringify({ ts: new Date().toISOString(), ...spec }, null, 2));
  } catch (_) {}
}

function clearBootstrapError() {
  try {
    const projectDir = resolveProjectRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());
    fs.unlinkSync(path.join(projectDir, '.gm', 'exec-spool', '.bootstrap-error.json'));
  } catch (_) {}
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function instructionsManifestPath(cwd) {
  return path.join(cwd, '.gm', '.instructions-shipped-manifest.json');
}

function readInstructionsManifest(cwd) {
  try { return JSON.parse(fs.readFileSync(instructionsManifestPath(cwd), 'utf-8')); }
  catch (e) {
    if (e && e.code !== 'ENOENT') {
      obsEvent('bootstrap', 'instructions-bundle.manifest-read-failed', { error: e.message });
    }
    return {};
  }
}

function writeInstructionsManifest(cwd, manifest) {
  try { fs.writeFileSync(instructionsManifestPath(cwd), JSON.stringify(manifest, null, 2)); }
  catch (e) { obsEvent('bootstrap', 'instructions-bundle.manifest-write-failed', { error: e.message }); }
}

function ensureInstructionsBundle(cwd) {
  const srcDir = path.join(__dirname, 'instructions');
  if (!fs.existsSync(srcDir)) return;
  const dstDir = path.join(cwd, '.gm', 'instructions');
  const manifest = readInstructionsManifest(cwd);
  let copied = 0;
  let preserved = 0;
  const walk = (rel) => {
    const from = path.join(srcDir, rel);
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const childRel = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) { walk(childRel); continue; }
      const dst = path.join(dstDir, childRel);
      try {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        const next = fs.readFileSync(path.join(srcDir, childRel));
        const nextHash = sha256Hex(next);
        let prev = null;
        try { prev = fs.readFileSync(dst); } catch (_) {}
        if (!prev) {
          fs.writeFileSync(dst, next);
          manifest[childRel] = nextHash;
          copied++;
          continue;
        }
        if (prev.equals(next)) {
          manifest[childRel] = nextHash;
          continue;
        }
        const lastShippedHash = manifest[childRel];
        const localMatchesLastShipped = lastShippedHash && sha256Hex(prev) === lastShippedHash;
        if (localMatchesLastShipped || !lastShippedHash) {
          fs.writeFileSync(dst, next);
          manifest[childRel] = nextHash;
          copied++;
        } else {
          try { fs.writeFileSync(dst + '.new', next); } catch (_) {}
          preserved++;
          obsEvent('bootstrap', 'instructions-bundle.user-edit-preserved', { target: dst });
        }
      } catch (e) { obsEvent('bootstrap', 'instructions-bundle.target-failed', { target: dst, error: e.message }); }
    }
  };
  try { walk(''); } catch (e) { obsEvent('bootstrap', 'instructions-bundle.walk-failed', { error: e.message }); }
  if (copied > 0 || preserved > 0) writeInstructionsManifest(cwd, manifest);
  if (copied > 0) {
    log(`instructions bundle provisioned: ${copied} file(s)`);
    obsEvent('bootstrap', 'instructions-bundle.provisioned', { copied });
  }
  if (preserved > 0) {
    log(`instructions bundle: ${preserved} user-edited file(s) preserved (new default staged as .md.new)`);
  }
}

function ensureNextStepWiring(cwd) {
  const changes = ensureNextStepWiringShared(cwd);

  try {
    const pkgPath = path.join(cwd, 'package.json');
    let hasFilesAllowlist = false;
    try {
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        hasFilesAllowlist = Array.isArray(pkg.files) && pkg.files.length > 0;
      }
    } catch (_) {}
    if (!hasFilesAllowlist) {
      const npmIgnorePath = path.join(cwd, '.npmignore');
      const begin = '# >>> gm managed';
      const end = '# <<< gm managed';
      const block = `${begin}\n.gm/\n${end}\n`;
      let content = '';
      if (fs.existsSync(npmIgnorePath)) content = fs.readFileSync(npmIgnorePath, 'utf8');
      if (!content.includes(begin)) {
        const sep = content && !content.endsWith('\n') ? '\n' : '';
        fs.writeFileSync(npmIgnorePath, content + sep + (content ? '\n' : '') + block);
        changes.push(fs.existsSync(npmIgnorePath) && content ? 'added gm managed block to .npmignore' : 'created .npmignore excluding .gm/');
      }
    }
  } catch (e) { obsEvent('bootstrap', 'next-step.wiring.target-failed', { target: '.npmignore', error: e.message }); }

  if (changes.length > 0) {
    log(`next-step wiring: ${changes.join(', ')}`);
    obsEvent('bootstrap', 'next-step.wiring.applied', { changes });
  }
}

function hasNativeEmbedRunner() {
  const dir = gmToolsDir();
  const names = process.platform === 'win32'
    ? ['agentplug-runner.exe']
    : ['agentplug-runner'];
  return names.some(n => { try { return fs.existsSync(path.join(dir, n)); } catch (_) { return false; } });
}

function resolveProjectRoot(start) {
  const resolved = path.resolve(start);
  try {
    const r = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: resolved, encoding: 'utf-8', windowsHide: true, timeout: 1500 });
    if (r.status === 0 && r.stdout && r.stdout.trim()) {
      let commonDir = r.stdout.trim();
      if (!path.isAbsolute(commonDir)) commonDir = path.resolve(resolved, commonDir);
      if (/(^|[\\/])\.git$/.test(commonDir)) return path.dirname(commonDir);
    }
  } catch (_) {}
  return resolved;
}

function readVersionFile() {
  const p = path.join(wrapperDir, 'plugkit.version');
  if (!fs.existsSync(p)) throw new Error(`plugkit.version not found at ${p}`);
  return fs.readFileSync(p, 'utf8').trim();
}

function readShaManifest() {
  const p = path.join(wrapperDir, 'plugkit.sha256');
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const out = {};
      for (const [name, sha] of Object.entries(parsed)) {
        if (typeof sha === 'string') out[name] = sha.toLowerCase();
      }
      return out;
    }
  } catch (_) {}
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([0-9a-f]{64})\s+(\S+)\s*$/i);
    if (m) out[m[2]] = m[1].toLowerCase();
  }
  return out;
}

async function extractNpmPackageWasm(destPath, version) {
  const tempDir = path.join(path.dirname(destPath), '.npm-extract-' + Date.now());
  try {
    ensureDir(tempDir);
    const startMs = Date.now();
    log(`extracting npm package ${NPM_PACKAGE}@${version} to ${tempDir}`);
    obsEvent('bootstrap', 'npm.extract.start', { package: NPM_PACKAGE, version });

    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'plugkit-extract', version: '0.0.0', private: true }));

    const cmd = resolveWindowsExe('npm');
    const installArgs = ['install', '--no-audit', '--no-fund', '--no-save', NPM_PACKAGE + '@' + version];
    const isCmdShim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd);
    const npmCliJs = isCmdShim ? resolveNpmCliJs(cmd) : null;

    const spawnCmd = npmCliJs ? process.execPath : (isCmdShim ? `"${cmd}"` : cmd);
    const rawArgs = npmCliJs ? [npmCliJs, ...installArgs] : installArgs;
    const spawnArgs = (isCmdShim && !npmCliJs) ? rawArgs.map(a => /[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a) : rawArgs;

    const result = spawnSync(spawnCmd, spawnArgs, {
      cwd: tempDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: ATTEMPT_TIMEOUT_MS,
      encoding: 'utf8',
      windowsHide: true,
      ...((isCmdShim && !npmCliJs) ? { shell: true } : {}),
    });

    if (result.error) throw result.error;
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || '').trim().split(/\r?\n/).slice(-5).join(' | ');
      const sig = result.signal ? ` signal=${result.signal}` : '';
      throw new Error(`npm install failed status=${result.status}${sig}: ${detail || 'no stderr/stdout captured'}`);
    }

    const nodeModulesPath = path.join(tempDir, 'node_modules', NPM_PACKAGE, 'plugkit.wasm');
    if (!fs.existsSync(nodeModulesPath)) {
      throw new Error(`plugkit.wasm not found in extracted npm package at ${nodeModulesPath}`);
    }

    fs.copyFileSync(nodeModulesPath, destPath);
    log(`extracted ${nodeModulesPath} -> ${destPath}`);
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
    let absTimer = null;
    const armAbsTimer = () => {
      if (absTimer) clearTimeout(absTimer);
      absTimer = setTimeout(() => {
        try { req.destroy(new Error(`abs-deadline ${totalDeadlineMs}ms-since-progress ${url} after ${bytesReceived} bytes`)); } catch (_) {}
        settleReject(new Error(`abs-deadline ${totalDeadlineMs}ms-since-progress ${url} after ${bytesReceived} bytes`));
      }, totalDeadlineMs);
    };
    armAbsTimer();
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
      res.on('data', c => { chunks.push(c); bytesReceived += c.length; armAbsTimer(); });
      res.on('end', () => { clearTimeout(absTimer); settleResolve(Buffer.concat(chunks)); });
      res.on('error', (e) => { clearTimeout(absTimer); settleReject(e); });
    });
    req.on('timeout', () => { try { req.destroy(new Error(`idle-timeout ${idleTimeoutMs}ms ${url}`)); } catch (_) {} settleReject(new Error(`idle-timeout ${idleTimeoutMs}ms ${url}`)); });
    req.on('error', (e) => { clearTimeout(absTimer); settleReject(e); });
  });
}

async function downloadFromGithubReleases(destPath, version, artifactName) {
  const name = artifactName || 'plugkit.wasm';
  const base = `https://github.com/AnEntrypoint/plugkit-bin/releases/download/v${version}`;
  log(`gh-releases download: ${base}/${name}`);
  let buf;
  try {
    buf = await httpGetBuffer(`${base}/${name}`, 60000);
  } catch (e) {
    if (name !== 'plugkit.wasm') {
      log(`gh-releases slim fetch failed (${e.message}); falling back to fat plugkit.wasm`);
      return downloadFromGithubReleases(destPath, version, 'plugkit.wasm');
    }
    throw e;
  }
  if (!buf || buf.length < 1024) {
    if (name !== 'plugkit.wasm') {
      log(`gh-releases slim download too small (${buf ? buf.length : 0} bytes); falling back to fat plugkit.wasm`);
      return downloadFromGithubReleases(destPath, version, 'plugkit.wasm');
    }
    throw new Error(`gh-releases download too small: ${buf ? buf.length : 0} bytes`);
  }
  let remoteSha = '';
  try {
    const shaBuf = await httpGetBuffer(`${base}/${name}.sha256`, 10000);
    remoteSha = shaBuf.toString('utf-8').trim().split(/\s+/)[0];
  } catch (e) { log(`gh-releases sha fetch failed: ${e.message}`); }
  if (remoteSha) {
    const got = require('crypto').createHash('sha256').update(buf).digest('hex');
    if (got !== remoteSha) throw new Error(`gh-releases sha mismatch: got ${got}, expected ${remoteSha}`);
    log(`gh-releases sha verified ${got.slice(0, 16)}...`);
  }
  fs.writeFileSync(destPath, buf);
  log(`gh-releases wrote ${buf.length} bytes to ${destPath} (artifact=${name})`);
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
      if (err && (err.code === 'ENOENT' || /ENOENT/.test(String(err.message || '')))) {
        log(`npm binary unresolvable (ENOENT); skipping retries, falling back`);
        throw err;
      }
      if (err && (err.code === 'EINVAL' || /EINVAL/.test(String(err.message || '')))) {
        log(`spawn EINVAL on npm shim; skipping retries, falling back`);
        throw err;
      }
      if (attempt < MAX_ATTEMPTS) {
        const wait = BACKOFF_MS[attempt - 1] || 120000;
        log(`backing off ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

function killStaleDaemonIfVersionChanged() {
  let currentVersion;
  try { currentVersion = readVersionFile(); }
  catch (e) {
    obsEvent('bootstrap', 'kill-stale-daemon.version-read-failed', { error: e.message });
    return;
  }
  const cached = resolveCachedBinary({ version: currentVersion });
  if (cached) {
    proactiveKillForNewInstall(currentVersion, cached);
    return;
  }
  const recorded = readDaemonVersion();
  if (recorded === currentVersion) return;
  if (recorded) killSpoolWatcherInCwd(`version_change:${recorded}->${currentVersion}`);
  writeDaemonVersion(currentVersion);
}

async function bootstrap(opts) {
  opts = opts || {};
  const version = readVersionFile();
  const shaManifest = readShaManifest();
  const useSlim = hasNativeEmbedRunner();
  const remoteArtifact = useSlim ? 'plugkit-slim.wasm' : 'plugkit.wasm';
  const wasmName = 'plugkit.wasm';
  const expectedSha = shaManifest ? (shaManifest[remoteArtifact] || (useSlim ? null : shaManifest[wasmName])) : null;

  let root = cacheRoot();
  try { ensureDir(root); }
  catch (_) { root = fallbackCacheRoot(); ensureDir(root); }

  const verDir = path.join(root, useSlim ? `v${version}-slim` : `v${version}`);
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
    if (useSlim) {
      try {
        await downloadFromGithubReleases(partialPath, version, remoteArtifact);
      } catch (ghErr) {
        writeBootstrapError({
          expected_version: version, cached_version: null,
          error_phase: 'gh-releases-slim',
          error_message: `gh: ${ghErr.message}`,
        });
        throw ghErr;
      }
    } else {
      try {
        await extractNpmPackageWithRetry(partialPath, version);
      } catch (extractErr) {
        log(`npm-extract failed (${extractErr.message || extractErr}); falling back to GitHub Releases`);
        try {
          await downloadFromGithubReleases(partialPath, version, remoteArtifact);
        } catch (ghErr) {
          writeBootstrapError({
            expected_version: version, cached_version: null,
            error_phase: 'npm-extract+gh-fallback',
            error_message: `npm: ${extractErr.message}; gh: ${ghErr.message}`,
          });
          throw ghErr;
        }
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
      log('no sha256 manifest -- skipping verify');
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
    pruneOldVersions(root, useSlim ? `${version}-slim` : version);
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

  let wasmFresh = false;
  if (fs.existsSync(target)) {
    try {
      const cur = sha256OfFileSync(target);
      const src = sha256OfFileSync(wasmPath);
      if (cur === src) wasmFresh = true;
    } catch (_) {}
  }
  if (!wasmFresh) {
    const tmp = `${target}.partial-${process.pid}`;
    fs.copyFileSync(wasmPath, tmp);
    try { fs.renameSync(tmp, target); }
    catch (err) {
      if (err.code === 'EEXIST' || err.code === 'EPERM') {
        try { fs.unlinkSync(target); } catch (_) {}
        fs.renameSync(tmp, target);
      } else {
        try { fs.unlinkSync(tmp); } catch (_) {}
        throw err;
      }
    }
  }
  fs.writeFileSync(path.join(dst, 'plugkit.version'), version);

  try {
    const ownPkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
    if (ownPkg && ownPkg.version) {
      fs.writeFileSync(path.join(dst, 'gm-plugkit.version'), ownPkg.version);
    }
  } catch (_) {}

}

function getWasmPath() {
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const primary = path.join(home, '.gm-tools', 'plugkit.wasm');
  const fallback = path.join(home, '.claude', 'gm-tools', 'plugkit.wasm');
  if (fs.existsSync(primary)) return primary;
  if (fs.existsSync(fallback)) return fallback;
  return primary;
}

function isReady() {
  const wasm = getWasmPath();
  return fs.existsSync(wasm);
}

function ensureGmPlugkitVersionFresh() {
  try {
    const ownPkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
    if (!ownPkg || !ownPkg.version) return false;
    const dst = path.join(gmToolsDir(), 'gm-plugkit.version');
    let cur = null;
    try { cur = fs.readFileSync(dst, 'utf-8').trim(); } catch (_) {}
    if (cur === ownPkg.version) return false;
    fs.mkdirSync(gmToolsDir(), { recursive: true });
    fs.writeFileSync(dst, ownPkg.version);
    return true;
  } catch (_) { return false; }
}

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function readPinnedGmPlugkitVersion() {
  try {
    const p = path.join(gmToolsDir(), 'gm-plugkit.version');
    if (!fs.existsSync(p)) return null;
    const v = fs.readFileSync(p, 'utf-8').trim();
    if (!v || !SEMVER_RE.test(v)) return null;
    return v;
  } catch (_) { return null; }
}

function resolveBunRuntime() {
  const candidates = process.platform === 'win32' ? ['bun.exe', 'bun'] : ['bun'];
  for (const c of candidates) {
    try {
      const r = spawnSync('where', [c], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 800 });
      if (r.status === 0) {
        const lines = (r.stdout || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const exe = lines.find(l => /\.exe$/i.test(l)) || lines[0];
        if (exe) return exe;
      }
    } catch (_) {}
  }
  return process.platform === 'win32' ? 'bun.exe' : 'bun';
}

function spawnPinnedBoot(extraArgs) {
  const args = Array.isArray(extraArgs) ? extraArgs : [];
  const pinned = readPinnedGmPlugkitVersion();
  if (!pinned) {
    return { ok: false, reason: 'no-pin-file', fallback: '@latest' };
  }
  const runtime = resolveBunRuntime();
  const bunxArgs = ['x', `gm-plugkit@${pinned}`, ...args];
  const startedMs = Date.now();
  let result;
  try {
    result = spawnSync(runtime, bunxArgs, {
      stdio: 'inherit',
      windowsHide: true,
      shell: false,
      env: { ...process.env, GM_PLUGKIT_PINNED_REEXEC: '1' },
    });
  } catch (e) {
    return { ok: false, reason: 'spawn-failed', error: e.message, pinned_version: pinned, fallback: '@latest' };
  }
  const durationMs = Date.now() - startedMs;
  if (result.error) {
    return { ok: false, reason: 'spawn-error', error: result.error.message, pinned_version: pinned, fallback: '@latest' };
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    return { ok: false, reason: 'pinned-invocation-nonzero-exit', status: result.status, pinned_version: pinned, duration_ms: durationMs, fallback: '@latest' };
  }
  return { ok: true, pinned_version: pinned, duration_ms: durationMs, status: result.status };
}

function discoverBundledSkillsAndSources() {
  const found = new Map();
  try {
    for (const f of fs.readdirSync(__dirname)) {
      const m = f.match(/^SKILL-(.+)\.md$/);
      if (m) found.set(m[1], path.join(__dirname, f));
    }
  } catch (e) { obsEvent('bootstrap', 'discover-bundled-skills.readdir-failed', { dir: __dirname, error: e.message }); }
  const devSkillsRoots = [
    path.join(__dirname, '..', 'gm-skill', 'skills'),
    path.join(__dirname, '..', '..', 'gm-skill', 'skills'),
    path.join(__dirname, '..', 'skills'),
  ];
  for (const root of devSkillsRoots) {
    try {
      if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) continue;
      for (const e of fs.readdirSync(root, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const p = path.join(root, e.name, 'SKILL.md');
        if (fs.existsSync(p) && !found.has(e.name)) found.set(e.name, p);
      }
    } catch (e) {
      obsEvent('bootstrap', 'discover-bundled-skills.dir-read-failed', { root, error: e.message });
    }
  }
  return found;
}

function ensureSkillMdFresh() {
  const home = process.env.HOME || process.env.USERPROFILE || require('os').homedir();
  const crypto = require('crypto');
  const _norm = s => s.replace(/\r\n/g, '\n');
  const allRefreshed = [];
  const sources = {};
  const discovered = discoverBundledSkillsAndSources();
  for (const [skillName, bundledPath] of discovered) {
    try {
      if (!fs.existsSync(bundledPath)) {
        try { obsEvent('bootstrap', 'skill-md.refresh.bundled-not-found', { skillName, searched: [bundledPath] }); } catch (_) {}
        continue;
      }
      const bundled = fs.readFileSync(bundledPath, 'utf-8');
      const bundledHash = crypto.createHash('sha256').update(_norm(bundled)).digest('hex');
      const targets = [
        path.join(home, '.agents', 'skills', skillName, 'SKILL.md'),
        path.join(home, '.claude', 'skills', skillName, 'SKILL.md'),
      ];
      if (skillName === 'gm') {
        for (const legacy of [
          path.join(home, '.agents', 'skills', 'gm-skill'),
          path.join(home, '.claude', 'skills', 'gm-skill'),
        ]) {
          try { if (fs.existsSync(legacy)) fs.rmSync(legacy, { recursive: true, force: true }); } catch (_) {}
        }
      }
      sources[skillName] = bundledPath;
      for (const target of targets) {
        try {
          let needsWrite = true;
          if (fs.existsSync(target)) {
            const existing = fs.readFileSync(target, 'utf-8');
            const existingHash = crypto.createHash('sha256').update(_norm(existing)).digest('hex');
            if (existingHash === bundledHash) needsWrite = false;
          }
          if (needsWrite) {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            const tmp = target + '.tmp';
            fs.writeFileSync(tmp, bundled);
            fs.renameSync(tmp, target);
            allRefreshed.push(target);
          }
        } catch (e) {
          try { obsEvent('bootstrap', 'skill-md.refresh.target-failed', { target, error: e.message }); } catch (_) {}
        }
      }
    } catch (e) {
      try { obsEvent('bootstrap', 'skill-md.refresh.failed', { skillName, error: e.message }); } catch (_) {}
    }
  }
  if (allRefreshed.length > 0) {
    log(`SKILL.md refreshed: ${allRefreshed.length} target(s)`);
    try { obsEvent('bootstrap', 'skill-md.refreshed', { targets: allRefreshed, sources }); } catch (_) {}
  }
  return { refreshed: allRefreshed, sources };
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
  } catch (e) {
    obsEvent('bootstrap', 'resolve-latest-remote-version.failed', { error: e.message });
  }
  return null;
}

async function resolveLatestGmPlugkitNpmVersion(timeoutMs) {
  try {
    const buf = await httpGetBuffer('https://registry.npmjs.org/gm-plugkit/latest', timeoutMs || 3000);
    const meta = JSON.parse(buf.toString('utf-8'));
    if (meta && typeof meta.version === 'string') return meta.version;
  } catch (e) {
    obsEvent('bootstrap', 'resolve-latest-npm-version.failed', { error: e.message });
  }
  return null;
}

function getSelfVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
    return pkg.version || null;
  } catch (_) { return null; }
}

async function probeSelfStaleness(timeoutMs) {
  const own = getSelfVersion();
  if (!own) return { stale: false, reason: 'no-self-version' };
  const latest = await resolveLatestGmPlugkitNpmVersion(timeoutMs);
  if (!latest) return { stale: false, reason: 'no-remote-version', own };
  if (latest === own) return { stale: false, own, latest };
  return { stale: true, own, latest };
}

async function ensureReady(opts) {
  opts = opts || {};
  const offline = opts.offline === true;
  const skipSelfStaleCheck = offline || process.env.GM_PLUGKIT_SKIP_SELF_STALE_CHECK === '1';

  try { ensureNextStepWiring(process.env.CLAUDE_PROJECT_DIR || process.cwd()); } catch (_) {}
  try { ensureInstructionsBundle(process.env.CLAUDE_PROJECT_DIR || process.cwd()); } catch (_) {}

  if (!skipSelfStaleCheck) {
    try {
      const selfStale = await probeSelfStaleness(2500);
      if (selfStale && selfStale.stale) {
        const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
        const spoolDir = path.join(projectDir, '.gm', 'exec-spool');
        try { fs.mkdirSync(spoolDir, { recursive: true }); } catch (_) {}
        const marker = {
          ts: new Date().toISOString(),
          reason: 'gm-plugkit-self-stale',
          running_version: selfStale.own,
          latest_version: selfStale.latest,
          instruction: `gm-plugkit running ${selfStale.own} but npm has ${selfStale.latest}. The npx/bun cache served a stale copy. Clear the cache so the next invocation picks up the latest wrapper fixes: bun pm cache rm; or  npx clear-npx-cache; or rm -rf ~/.npm/_npx ~/AppData/Local/npm-cache/_npx`,
        };
        try { fs.writeFileSync(path.join(spoolDir, '.gm-plugkit-stale.json'), JSON.stringify(marker, null, 2)); } catch (_) {}
        log(`gm-plugkit self-stale: running ${selfStale.own}, latest npm ${selfStale.latest} -- cache served old code (marker at .gm/exec-spool/.gm-plugkit-stale.json)`);
      } else if (selfStale && selfStale.own) {
        try {
          const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
          const stalePath = path.join(projectDir, '.gm', 'exec-spool', '.gm-plugkit-stale.json');
          if (fs.existsSync(stalePath)) fs.unlinkSync(stalePath);
        } catch (_) {}
      }
    } catch (e) {
      obsEvent('bootstrap', 'self-stale-check.failed', { error: e.message });
    }
  }

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
    const versionMarkerUpdated = ensureGmPlugkitVersionFresh();
    ensureSkillMdFresh();
    return { ok: true, wasmPath, binaryPath: wasmPath, status: versionMarkerUpdated ? 'version-refreshed' : 'already-ready', version: installed };
  }
  if (targetVersion && targetVersion !== pinnedVersion) {
    try {
      const verFilePath = path.join(wrapperDir, 'plugkit.version');
      fs.writeFileSync(verFilePath, targetVersion + '\n');
      log(`overrode bundled plugkit.version: ${pinnedVersion} -> ${targetVersion} (remote latest)`);
    } catch (e) { log(`could not override plugkit.version: ${e.message}`); }
  }

  let wasmPath;
  try {
    wasmPath = await bootstrap();
  } catch (bootErr) {
    if (versionDrift && isReady()) {
      log(`bootstrap for ${targetVersion} failed (${bootErr.message || bootErr}); keeping running watcher on installed ${installed} (no kill, serve cached wasm)`);
      const cachedPath = getWasmPath();
      ensureSkillMdFresh();
      return { ok: true, wasmPath: cachedPath, binaryPath: cachedPath, status: 'bootstrap-failed-served-cached', version: installed };
    }
    throw bootErr;
  }

  if (versionDrift) {
    try { killSpoolWatcherInCwd(`version_drift:${installed}->${targetVersion}`); } catch (_) {}
  }

  ensureSkillMdFresh();
  return { ok: true, wasmPath, binaryPath: wasmPath, status: 'bootstrapped', version: targetVersion || installed };
}

function getBinaryPath() {
  return getWasmPath();
}

function startSpoolDaemon() {
  try {
    const runnerName = process.platform === 'win32' ? 'agentplug-runner.exe' : 'agentplug-runner';
    const runner = path.join(gmToolsDir(), runnerName);
    if (!fs.existsSync(runner)) {
      return {
        ok: false,
        error:
          `agentplug-runner is not installed at ${runner} and is the sole supported spool loader. ` +
          `The JS wasm-host has been retired. Install it with 'bun x gm-skill install' (or 'npx gm-skill install'), ` +
          `which downloads the sha256-verified native runner from AnEntrypoint/agentplug-bin for this platform ` +
          `(${process.platform}/${process.arch}). If no binary is published for this platform yet, there is no ` +
          `loader available -- file an issue at https://github.com/AnEntrypoint/agentplug-bin so a binary is built for it.`,
      };
    }
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const spoolDir = path.join(projectDir, '.gm', 'exec-spool');
    fs.mkdirSync(spoolDir, { recursive: true });
    const logPath = path.join(spoolDir, '.watcher.log');
    try {
      const stat = fs.statSync(logPath);
      if (stat.size > 10 * 1024 * 1024) {
        try { fs.unlinkSync(path.join(spoolDir, '.watcher.log.1')); } catch (_) {}
        fs.renameSync(logPath, path.join(spoolDir, '.watcher.log.1'));
      }
    } catch (_) {}

    const logFd = fs.openSync(logPath, 'a');
    try { fs.writeSync(logFd, `\n--- daemon spawn ${new Date().toISOString()} parent=${process.pid} (agentplug-runner) ---\n`); } catch (_) {}
    const child = require('child_process').spawn(runner, ['spool'], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, PLUGKIT_BOOT_REASON: 'agentplug-runner' },
    });
    try { fs.closeSync(logFd); } catch (_) {}
    const pid = child.pid;
    child.unref();
    return { ok: true, pid, runner, logPath, supervised: false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  bootstrap,
  ensureReady,
  ensureNextStepWiring,
  ensureInstructionsBundle,
  gmToolsDir,
  resolveProjectRoot,
  getWasmPath,
  getBinaryPath,
  startSpoolDaemon,
  isReady,
  cacheRoot,
  obsEvent,
  killStaleDaemonIfVersionChanged,
  killSpoolWatcherInCwd,
  proactiveKillForNewInstall,
  readDaemonVersion,
  writeDaemonVersion,
  daemonVersionSentinel,
  readVersionFile,
  ensureGmPlugkitVersionFresh,
  ensureSkillMdFresh,
  readPinnedGmPlugkitVersion,
  resolveBunRuntime,
  spawnPinnedBoot,
};

if (require.main === module) {
  (async () => {
    try {
      const args = process.argv.slice(2);
      if (args.includes('--status')) {
        console.log(JSON.stringify({
          ready: isReady(),
          wasmPath: getWasmPath(),
          daemonVersion: readDaemonVersion(),
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
