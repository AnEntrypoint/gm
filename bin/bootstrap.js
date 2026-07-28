#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const shared = require('../gm-plugkit/bootstrap-shared');
const core = require('../gm-plugkit/bootstrap-wasm-core');
const {
  obsEvent,
  cacheRoot,
  fallbackCacheRoot,
  ensureDir,
  acquireLock,
  releaseLock,
  healIfShaMatches,
  pruneOldVersions,
  readDaemonVersion,
  writeDaemonVersion,
  killSpoolWatcherInCwd,
  proactiveKillForNewInstall,
  ensureNextStepWiring,
} = shared;
const {
  readVersionFile,
  readShaManifest,
  resolveCacheWasmPath,
  extractNpmPackageWithRetry: extractNpmPackageWithRetryCore,
  writeBootstrapError,
  clearBootstrapError,
} = core;

const log = core.makeLogger('plugkit-bootstrap');

function copyWasmToGmTools(wasmPath, wrapperDir, version) {
  return core.copyWasmToGmTools(wasmPath, version, { wrapperDir });
}

function extractNpmPackageWithRetry(destPath, version) {
  return extractNpmPackageWithRetryCore(destPath, version, { log });
}

function discoverBundledSkills(wrapperDir) {
  const roots = [
    path.join(wrapperDir, '..', 'skills'),
    path.join(wrapperDir, '..', '..', 'skills'),
  ];
  const root = roots.find(r => { try { return fs.existsSync(r) && fs.statSync(r).isDirectory(); } catch (_) { return false; } });
  if (!root) return [];
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .filter(name => { try { return fs.existsSync(path.join(root, name, 'SKILL.md')); } catch (_) { return false; } })
      .sort();
  } catch (_) { return []; }
}

function ensureSkillMdCurrent(wrapperDir) {
  const home = os.homedir();
  const allRefreshed = [];
  for (const skillName of discoverBundledSkills(wrapperDir)) {
    try {
      const candidates = [
        path.join(wrapperDir, '..', 'skills', skillName, 'SKILL.md'),
        path.join(wrapperDir, '..', '..', 'skills', skillName, 'SKILL.md'),
      ];
      const bundledPath = candidates.find(p => { try { return fs.existsSync(p); } catch (_) { return false; } });
      if (!bundledPath) { obsEvent('bootstrap', 'skill-md.refresh.bundled-not-found', { skillName }); continue; }
      const bundled = fs.readFileSync(bundledPath, 'utf8');
      const _norm = s => s.replace(/\r\n/g, '\n');
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
      for (const target of targets) {
        try {
          let needsWrite = true;
          if (fs.existsSync(target)) {
            const existing = fs.readFileSync(target, 'utf8');
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
          obsEvent('bootstrap', 'skill-md.refresh.target-failed', { target, error: e.message });
        }
      }
    } catch (e) {
      obsEvent('bootstrap', 'skill-md.refresh.failed', { skillName, error: e.message });
    }
  }
  if (allRefreshed.length > 0) {
    log(`SKILL.md refreshed: ${allRefreshed.join(', ')}`);
    obsEvent('bootstrap', 'skill-md.refreshed', { targets: allRefreshed });
  }
  return { refreshed: allRefreshed };
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

async function bootstrap(opts) {
  opts = opts || {};
  const wrapperDir = opts.wrapperDir || __dirname;
  try { ensureSkillMdCurrent(wrapperDir); } catch (_) {}
  try { ensureNextStepWiring(process.cwd()); } catch (_) {}
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
      const actualSha = require('../gm-plugkit/gm-process').sha256OfFileSync(wasmFinalPath);
      if (actualSha === wasmExpectedSha) {
        obsEvent('bootstrap', 'decision.hit', { reason: 'sha-match', version, path: wasmFinalPath });
        copyWasmToGmTools(wasmFinalPath, wrapperDir, version);
        clearBootstrapError();
        return wasmFinalPath;
      }
      log(`decision: fetch reason: cache-hit-sha-mismatch (dir=v${version} expected ${wasmExpectedSha.slice(0,12)}... got ${(actualSha||'').slice(0,12)}...)`);
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
      copyWasmToGmTools(wasmFinalPath, wrapperDir, version);
      clearBootstrapError();
      return wasmFinalPath;
    }

    if (fs.existsSync(wasmPartialPath)) {
      try {
        const st = fs.statSync(wasmPartialPath);
        if (Date.now() - st.mtimeMs > 30 * 60 * 1000) {
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
      const got = await require('../gm-plugkit/gm-process').sha256OfFile(wasmPartialPath);
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
      log('no sha256 manifest -- skipping verify');
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
    pruneOldVersions(root, version);
    copyWasmToGmTools(wasmFinalPath, wrapperDir, version);

    clearBootstrapError();
    return wasmFinalPath;
  } finally {
    releaseLock(lockPath);
  }
}

function getWasmPath(opts) {
  opts = opts || {};
  const wrapperDir = opts.wrapperDir || __dirname;
  const version = opts.version || readVersionFile(wrapperDir);
  const root = (() => {
    try { const r = cacheRoot(); ensureDir(r); return r; }
    catch (_) { const r = fallbackCacheRoot(); ensureDir(r); return r; }
  })();
  return resolveCacheWasmPath(root, version, 'plugkit.wasm');
}

function killStaleDaemonIfVersionChanged(wrapperDir) {
  let currentVersion;
  try { currentVersion = readVersionFile(wrapperDir); }
  catch (e) {
    obsEvent('bootstrap', 'kill-stale-daemon.version-read-failed', { error: e.message });
    return;
  }
  const cached = getWasmPath({ wrapperDir, version: currentVersion });
  if (cached) {
    proactiveKillForNewInstall(currentVersion);
    return;
  }
  const recorded = readDaemonVersion();
  if (recorded === currentVersion) return;
  if (recorded) killSpoolWatcherInCwd(`version_change:${recorded}->${currentVersion}`);
  writeDaemonVersion(currentVersion);
}

module.exports = { bootstrap, getWasmPath, cacheRoot, obsEvent, killStaleDaemonIfVersionChanged, killSpoolWatcherInCwd, proactiveKillForNewInstall };

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv[0] === 'install') {
    require('./install.js');
    return;
  }
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
