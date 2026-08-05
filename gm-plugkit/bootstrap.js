#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { sha256OfFile, sha256OfFileSync } = require('./gm-process');
const shared = require('./bootstrap-shared');
const core = require('./bootstrap-wasm-core');
const {
  obsEvent,
  cacheRoot,
  fallbackCacheRoot,
  gmToolsDir,
  ensureDir,
  acquireLock,
  releaseLock,
  pruneOldVersions,
  healIfShaMatches,
  daemonVersionSentinel,
  readDaemonVersion,
  writeDaemonVersion,
  killSpoolWatcherInCwd,
  proactiveKillForNewInstall,
  ensureNextStepWiring: ensureNextStepWiringShared,
} = shared;
const {
  resolveProjectRoot,
  writeBootstrapError,
  clearBootstrapError,
  resolveInstalledWasmPath,
} = core;

const LOCK_STALE_MS = 30 * 60 * 1000;

const wrapperDir = __dirname;

const log = core.makeLogger('gm-plugkit');

function copyWasmToGmTools(wasmPath, version) {
  core.copyWasmToGmTools(wasmPath, version);
  try {
    const ownPkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
    if (ownPkg && ownPkg.version) {
      fs.writeFileSync(path.join(gmToolsDir(), 'gm-plugkit.version'), ownPkg.version);
    }
  } catch (_) {}
}

function extractNpmPackageWithRetry(destPath, version) {
  return core.extractNpmPackageWithRetry(destPath, version, { log });
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

function readVersionFile() {
  return core.readVersionFile(wrapperDir);
}

function readShaManifest() {
  return core.readShaManifest(wrapperDir);
}

async function fetchRemoteSha(version, artifactName) {
  const base = `https://github.com/AnEntrypoint/plugkit-bin/releases/download/v${version}`;
  try {
    const shaBuf = await httpGetBuffer(`${base}/${artifactName}.sha256`, 10000);
    return shaBuf.toString('utf-8').trim().split(/\s+/)[0].toLowerCase();
  } catch (e) {
    log(`remote sha fetch failed for ${artifactName}@${version}: ${e.message}`);
    return null;
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

function httpHeadOk(url, timeoutMs) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'HEAD', timeout: timeoutMs || 3000, headers: { 'user-agent': 'gm-plugkit-bootstrap' } }, (res) => {
      res.resume();
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpHeadOk(res.headers.location, timeoutMs).then(resolve, reject);
        return;
      }
      if (res.statusCode === 200) resolve();
      else reject(new Error(`HTTP ${res.statusCode} ${url}`));
    });
    req.on('timeout', () => { try { req.destroy(new Error(`idle-timeout ${timeoutMs || 3000}ms ${url}`)); } catch (_) {} });
    req.on('error', reject);
    req.end();
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

function killStaleDaemonIfVersionChanged() {
  let currentVersion;
  try { currentVersion = readVersionFile(); }
  catch (e) {
    obsEvent('bootstrap', 'kill-stale-daemon.version-read-failed', { error: e.message });
    return;
  }
  const cached = resolveInstalledWasmPath();
  if (cached && fs.existsSync(cached)) {
    proactiveKillForNewInstall(currentVersion);
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
  const useSlim = hasNativeEmbedRunner();
  const remoteArtifact = useSlim ? 'plugkit-slim.wasm' : 'plugkit.wasm';
  const wasmName = 'plugkit.wasm';

  let expectedSha = await fetchRemoteSha(version, remoteArtifact);
  if (!expectedSha) {
    const shaManifest = readShaManifest();
    const localManifestVersion = (() => { try { return readVersionFile(); } catch (_) { return null; } })();
    if (shaManifest && localManifestVersion === version) {
      expectedSha = shaManifest[remoteArtifact] || (useSlim ? null : shaManifest[wasmName]) || null;
      if (expectedSha) log(`remote sha unreachable, falling back to committed manifest for matching version ${version}`);
    }
  }

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

function getWasmPath() {
  return resolveInstalledWasmPath();
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

const SKILL_MD_REMOTE_REPO = 'AnEntrypoint/gm';
const SKILL_MD_REMOTE_BRANCH = 'main';

function discoverBundledSkillsAndSourcesLocal() {
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

// Walks a (decompressed) POSIX tar stream's fixed 512-byte headers, yielding
// each entry's name. `git archive --remote` was tried first and does NOT
// work against GitHub (its git server returns HTTP 422 for upload-archive,
// a documented GitHub limitation) -- codeload.github.com's tarball endpoint
// is the real plain-HTTPS, non-api.github.com path that actually serves
// repo content.
function* tarEntryNames(buf) {
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every(b => b === 0)) break;
    const name = header.subarray(0, 100).toString('utf-8').replace(/\0.*$/s, '');
    const sizeOctal = header.subarray(124, 136).toString('utf-8').replace(/\0.*$/s, '').trim();
    const size = parseInt(sizeOctal, 8) || 0;
    if (name) yield name;
    offset += 512 + Math.ceil(size / 512) * 512;
  }
}

async function discoverRemoteSkillNamesViaCodeload(timeoutMs) {
  const url = `https://codeload.github.com/${SKILL_MD_REMOTE_REPO}/tar.gz/refs/heads/${SKILL_MD_REMOTE_BRANCH}`;
  const gz = await httpGetBuffer(url, timeoutMs || 15000);
  const tar = require('zlib').gunzipSync(gz);
  const names = new Set();
  for (const name of tarEntryNames(tar)) {
    const m = /^[^/]+\/skills\/([^/]+)\/$/.exec(name);
    if (m) names.add(m[1]);
  }
  if (names.size === 0) throw new Error('codeload tarball listing produced zero skill directories');
  return Array.from(names);
}

// The GitHub Contents API this normally uses already fails soft (caller
// falls back to bundled local skills), but a fully API-scope-restricted
// environment (a corporate proxy or org policy blocking api.github.com
// specifically) loses fresh remote skill discovery entirely even though
// the same repo is reachable over codeload.github.com's plain-HTTPS
// tarball endpoint -- a different host, no API token or REST surface.
async function discoverRemoteSkillNames(timeoutMs) {
  const url = `https://api.github.com/repos/${SKILL_MD_REMOTE_REPO}/contents/skills?ref=${SKILL_MD_REMOTE_BRANCH}`;
  try {
    const buf = await httpGetBuffer(url, timeoutMs || 5000);
    const entries = JSON.parse(buf.toString('utf-8'));
    if (!Array.isArray(entries)) throw new Error('unexpected github contents API response shape');
    return entries.filter(e => e && e.type === 'dir' && e.name).map(e => e.name);
  } catch (apiErr) {
    try {
      return await discoverRemoteSkillNamesViaCodeload(timeoutMs);
    } catch (fallbackErr) {
      obsEvent('bootstrap', 'discover-remote-skill-names.codeload-fallback-failed', { error: fallbackErr.message });
      throw apiErr;
    }
  }
}

async function fetchRemoteSkillMd(skillName, timeoutMs) {
  const url = `https://raw.githubusercontent.com/${SKILL_MD_REMOTE_REPO}/${SKILL_MD_REMOTE_BRANCH}/skills/${skillName}/SKILL.md`;
  const buf = await httpGetBuffer(url, timeoutMs || 8000);
  return buf.toString('utf-8');
}

async function resolveSkillMdSource(skillName, localPath) {
  if (localPath && fs.existsSync(localPath)) {
    return { content: fs.readFileSync(localPath, 'utf-8'), origin: localPath };
  }
  const content = await fetchRemoteSkillMd(skillName, 8000);
  return { content, origin: `https://raw.githubusercontent.com/${SKILL_MD_REMOTE_REPO}/${SKILL_MD_REMOTE_BRANCH}/skills/${skillName}/SKILL.md` };
}

async function ensureSkillMdFresh() {
  const home = process.env.HOME || process.env.USERPROFILE || require('os').homedir();
  const crypto = require('crypto');
  const _norm = s => s.replace(/\r\n/g, '\n');
  const allRefreshed = [];
  const sources = {};
  const failures = [];

  const localFound = discoverBundledSkillsAndSourcesLocal();
  let skillNames = Array.from(localFound.keys());
  let remoteNamesFetched = false;
  try {
    const remoteNames = await discoverRemoteSkillNames(5000);
    remoteNamesFetched = true;
    for (const n of remoteNames) if (!skillNames.includes(n)) skillNames.push(n);
  } catch (e) {
    obsEvent('bootstrap', 'skill-md.refresh.remote-name-discovery-failed', { error: e.message });
  }

  if (skillNames.length === 0) {
    const msg = `SKILL.md refresh found zero bundled skills: local dev-tree lookup empty AND remote discovery ${remoteNamesFetched ? 'returned zero dirs' : 'failed'} against ${SKILL_MD_REMOTE_REPO}@${SKILL_MD_REMOTE_BRANCH}`;
    log(`ERROR: ${msg}`);
    try { obsEvent('bootstrap', 'skill-md.refresh.zero-skills-discovered', { dir: __dirname, remote_repo: SKILL_MD_REMOTE_REPO, remote_branch: SKILL_MD_REMOTE_BRANCH, remote_names_fetched: remoteNamesFetched }); } catch (_) {}
    return { refreshed: [], sources: {}, failures: [{ skillName: null, error: msg }] };
  }

  for (const skillName of skillNames) {
    try {
      const localPath = localFound.get(skillName) || null;
      let resolved;
      try {
        resolved = await resolveSkillMdSource(skillName, localPath);
      } catch (e) {
        try { obsEvent('bootstrap', 'skill-md.refresh.bundled-not-found', { skillName, searched: [localPath, `https://raw.githubusercontent.com/${SKILL_MD_REMOTE_REPO}/${SKILL_MD_REMOTE_BRANCH}/skills/${skillName}/SKILL.md`], error: e.message }); } catch (_) {}
        failures.push({ skillName, error: e.message });
        continue;
      }
      const bundled = resolved.content;
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
      sources[skillName] = resolved.origin;
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
      failures.push({ skillName, error: e.message });
    }
  }
  if (allRefreshed.length > 0) {
    log(`SKILL.md refreshed: ${allRefreshed.length} target(s)`);
    try { obsEvent('bootstrap', 'skill-md.refreshed', { targets: allRefreshed, sources }); } catch (_) {}
  }
  return { refreshed: allRefreshed, sources, failures };
}

function installedVersionAtTools() {
  try {
    const p = path.join(gmToolsDir(), 'plugkit.version');
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, 'utf-8').trim();
  } catch (_) { return null; }
}

function compareDottedSemverAscending(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

// Fallback when the Releases-list API is unreachable: git ls-remote can
// see every tag over plain git protocol without touching api.github.com,
// but cannot see release ASSETS -- so a tag it finds is verified against
// a HEAD probe on the raw release-download URL for plugkit.wasm before
// being trusted, matching the API path's own hasPlugkitWasm check.
async function resolveLatestRemoteVersionViaGit(timeoutMs) {
  const { execFileSync } = require('child_process');
  const out = execFileSync('git', ['ls-remote', '--tags', '--refs', 'https://github.com/AnEntrypoint/plugkit-bin.git'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const tags = out.split('\n')
    .map(line => line.match(/refs\/tags\/v(\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?)$/))
    .filter(Boolean)
    .map(m => m[1]);
  tags.sort(compareDottedSemverAscending);
  for (let i = tags.length - 1; i >= 0; i--) {
    const version = tags[i];
    try {
      await httpHeadOk(`https://github.com/AnEntrypoint/plugkit-bin/releases/download/v${version}/plugkit.wasm`, timeoutMs || 3000);
      return version;
    } catch (_) { /* asset missing for this tag, try the next-newest */ }
  }
  return null;
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
    try {
      const viaGit = await resolveLatestRemoteVersionViaGit(timeoutMs);
      if (viaGit) return viaGit;
    } catch (gitErr) {
      obsEvent('bootstrap', 'resolve-latest-remote-version.git-fallback-failed', { error: gitErr.message });
    }
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
    await ensureSkillMdFresh();
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
      await ensureSkillMdFresh();
      return { ok: true, wasmPath: cachedPath, binaryPath: cachedPath, status: 'bootstrap-failed-served-cached', version: installed };
    }
    throw bootErr;
  }

  if (versionDrift) {
    try { killSpoolWatcherInCwd(`version_drift:${installed}->${targetVersion}`); } catch (_) {}
  }

  await ensureSkillMdFresh();
  return { ok: true, wasmPath, binaryPath: wasmPath, status: 'bootstrapped', version: targetVersion || installed };
}

function getBinaryPath() {
  return getWasmPath();
}

function agentplugRunnerAssetName() {
  const plat = process.platform;
  const arch = process.arch;
  if (plat === 'win32') {
    if (arch === 'x64') return 'agentplug-runner-windows-x64.exe';
    if (arch === 'arm64') return 'agentplug-runner-windows-arm64.exe';
    return null;
  }
  if (plat === 'darwin') {
    if (arch === 'x64') return 'agentplug-runner-macos-x64';
    if (arch === 'arm64') return 'agentplug-runner-macos-arm64';
    return null;
  }
  if (plat === 'linux') {
    if (arch === 'x64') return 'agentplug-runner-linux-x64';
    if (arch === 'arm64') return 'agentplug-runner-linux-arm64';
    return null;
  }
  return null;
}

function compareDottedSemverAscending(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function latestAgentplugRunnerTagViaGitLsRemote() {
  const { execFileSync } = require('child_process');
  const out = execFileSync('git', ['ls-remote', '--tags', '--refs', 'https://github.com/AnEntrypoint/agentplug-bin.git'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const tags = out.split('\n')
    .map(line => line.match(/refs\/tags\/(.+)$/))
    .filter(Boolean)
    .map(m => m[1]);
  if (tags.length === 0) return null;
  tags.sort(compareDottedSemverAscending);
  return tags[tags.length - 1];
}

// The sole loader has to exist before startSpoolDaemon can do anything --
// a project that never ran `gm-skill install` (or whose install predates
// agentplug-runner) hit a hard "not installed" failure here even though
// the sha256-verified download this needs is the same one bin/install.js
// already performs. Attempting it inline means a bare `spool` boot recovers
// on its own instead of requiring a separate manual install step first.
async function ensureAgentplugRunnerInstalled(destPath) {
  const assetName = agentplugRunnerAssetName();
  if (!assetName) return false;
  const destDir = gmToolsDir();
  try {
    let tag;
    try {
      const releaseInfo = JSON.parse((await httpGetBuffer('https://api.github.com/repos/AnEntrypoint/agentplug-bin/releases/latest', 15000)).toString('utf8'));
      tag = releaseInfo && releaseInfo.tag_name;
    } catch (apiErr) {
      try {
        tag = latestAgentplugRunnerTagViaGitLsRemote();
      } catch (_) {
        return false;
      }
    }
    if (!tag) return false;
    const base = `https://github.com/AnEntrypoint/agentplug-bin/releases/download/${tag}`;
    const [binBuf, shaBuf] = await Promise.all([
      httpGetBuffer(`${base}/${assetName}`, 60000),
      httpGetBuffer(`${base}/${assetName}.sha256`, 15000),
    ]);
    const expectedSha = shaBuf.toString('utf8').trim().split(/\s+/)[0];
    const actualSha = sha256Hex(binBuf);
    if (!expectedSha || actualSha.toLowerCase() !== expectedSha.toLowerCase()) return false;
    fs.mkdirSync(destDir, { recursive: true });
    const tmp = destPath + '.tmp' + process.pid;
    fs.writeFileSync(tmp, binBuf);
    if (process.platform !== 'win32') { try { fs.chmodSync(tmp, 0o755); } catch (_) {} }
    fs.renameSync(tmp, destPath);
    fs.writeFileSync(path.join(destDir, 'agentplug-runner.version'), tag);
    return true;
  } catch (_) {
    return false;
  }
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
        needsRunnerInstall: true,
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
  ensureAgentplugRunnerInstalled,
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
