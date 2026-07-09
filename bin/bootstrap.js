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

function ensureNextStepWiring(cwd) {
  const changes = [];
  const gmDir = path.join(cwd, '.gm');
  try { fs.mkdirSync(gmDir, { recursive: true }); }
  catch (e) { obsEvent('bootstrap', 'next-step.wiring.target-failed', { target: gmDir, error: e.message }); }

  const nextStepPath = path.join(gmDir, 'next-step.md');
  const nextStepBody = '# Next step\n\nDispatch the `instruction` verb to plugkit by writing `.gm/exec-spool/in/instruction/<N>.txt` (any unique N) with body `{}` (or `{"prompt":"<user request>"}` on the first dispatch of the turn). Read the response from `.gm/exec-spool/out/<N>.json` and follow the imperative in the `instruction` field.\n\nThis file is auto-rewritten by plugkit on every instruction dispatch.\n';
  try {
    if (!fs.existsSync(nextStepPath)) {
      fs.writeFileSync(nextStepPath, nextStepBody);
      changes.push('seeded .gm/next-step.md');
    }
  } catch (e) { obsEvent('bootstrap', 'next-step.wiring.target-failed', { target: nextStepPath, error: e.message }); }

  const claudeMdPath = path.join(cwd, 'CLAUDE.md');
  try {
    if (!fs.existsSync(claudeMdPath)) {
      fs.writeFileSync(claudeMdPath, '@AGENTS.md\n');
      changes.push('created CLAUDE.md');
    } else {
      const cur = fs.readFileSync(claudeMdPath, 'utf8');
      const hasLine = cur.split(/\r?\n/).some(l => l.trim() === '@AGENTS.md');
      if (!hasLine) {
        fs.writeFileSync(claudeMdPath, '@AGENTS.md\n' + cur);
        changes.push('prepended @AGENTS.md to CLAUDE.md');
      }
    }
  } catch (e) { obsEvent('bootstrap', 'next-step.wiring.target-failed', { target: claudeMdPath, error: e.message }); }

  const agentsMdPath = path.join(cwd, 'AGENTS.md');
  try {
    if (fs.existsSync(agentsMdPath)) {
      const cur = fs.readFileSync(agentsMdPath, 'utf8');
      const hasLine = cur.split(/\r?\n/).some(l => l.trim() === '@.gm/next-step.md');
      if (!hasLine) {
        const sep = cur.endsWith('\n') ? '' : '\n';
        fs.writeFileSync(agentsMdPath, cur + sep + '\n@.gm/next-step.md\n');
        changes.push('appended @.gm/next-step.md to AGENTS.md');
      }
    }
  } catch (e) { obsEvent('bootstrap', 'next-step.wiring.target-failed', { target: agentsMdPath, error: e.message }); }

  if (changes.length > 0) {
    log(`next-step wiring: ${changes.join(', ')}`);
    obsEvent('bootstrap', 'next-step.wiring.applied', { changes });
  }
}

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
    const shim = lines.find(l => /\.(cmd|bat)$/i.test(l));
    return exe || shim || cmd;
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
  const primary = path.join(home, '.gm-tools');
  const fallback = path.join(home, '.claude', 'gm-tools');
  if (fs.existsSync(primary)) return primary;
  if (fs.existsSync(fallback)) return fallback;
  return primary;
}

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
      try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000); } catch (_) {}
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
    const isCmdShim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(npxResolved);
    const rawArgs = [NPM_PACKAGE + '@' + version, '--prefix', tempDir];
    const spawnCmd = isCmdShim && /\s/.test(npxResolved) ? `"${npxResolved}"` : npxResolved;
    const spawnArgs = isCmdShim ? rawArgs.map(a => /[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a) : rawArgs;
    const result = spawnSync(
      spawnCmd,
      spawnArgs,
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: ATTEMPT_TIMEOUT_MS,
        encoding: 'utf8',
        windowsHide: true,
        ...(isCmdShim ? { shell: true } : {}),
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
    log(`extracted ${nodeModulesPath} -> ${destPath}`);
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
      if (err && (err.code === 'ENOENT' || /ENOENT/.test(String(err.message || '')))) {
        log(`npx binary unresolvable (ENOENT); skipping retries, falling back`);
        throw err;
      }
      if (err && (err.code === 'EINVAL' || /EINVAL/.test(String(err.message || '')))) {
        log(`spawn EINVAL on npx shim; skipping retries, falling back`);
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

function isLockStale(lockPath) {
  try {
    const st = fs.statSync(lockPath);
    if (Date.now() - st.mtimeMs > LOCK_STALE_MS) return true;
    const owner = parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
    if (Number.isFinite(owner) && !pidAlive(owner)) return true;
  } catch (_) { return true; }
  return false;
}

function pruneOldVersions(root, keepVersion) {
  try {
    const entries = fs.readdirSync(root);
    for (const e of entries) {
      if (!e.startsWith('v')) continue;
      if (e === `v${keepVersion}`) continue;
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
      const actualSha = sha256OfFileSync(wasmFinalPath);
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
  const verDir = path.join(root, `v${version}`);
  const wasmPath = path.join(verDir, 'plugkit.wasm');
  const okSentinel = path.join(verDir, '.wasm-ok');
  if (fs.existsSync(wasmPath) && fs.existsSync(okSentinel)) return wasmPath;
  return null;
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

function pidCommandLineForKillGuard(pid) {
  try {
    const { spawnSync } = require('child_process');
    if (process.platform === 'win32') {
      const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      return String((r && r.stdout) || '');
    }
    const r = spawnSync('ps', ['-p', String(pid), '-o', 'args='], { encoding: 'utf8', timeout: 5000 });
    return String((r && r.stdout) || '');
  } catch (_) { return ''; }
}

function pidIsPlugkitProcess(pid) {
  return /plugkit-wasm-wrapper\.js|plugkit-supervisor\.js|gm-plugkit[\\\/]supervisor\.js/i.test(pidCommandLineForKillGuard(pid));
}

function writeKillAttribution(targetSpoolDir, info) {
  try {
    fs.mkdirSync(targetSpoolDir, { recursive: true });
    fs.writeFileSync(path.join(targetSpoolDir, '.kill-attribution.json'), JSON.stringify({ killer_pid: process.pid, killer_cwd: process.cwd(), killer_script: __filename, ts: Date.now(), ...info }, null, 2));
  } catch (_) {}
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

function killSpoolWatcherInCwd(reason) {
  try {
    const pidPath = path.join(process.cwd(), '.gm', 'exec-spool', '.watcher.pid');
    if (!fs.existsSync(pidPath)) return null;
    const pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
    if (pidAlive(pid) && !pidIsPlugkitProcess(pid)) {
      obsEvent('bootstrap', 'watcher.kill-skipped-pid-reused', { pid, reason });
      try { fs.unlinkSync(pidPath); } catch (_) {}
      return null;
    }
    writeKillAttribution(path.join(process.cwd(), '.gm', 'exec-spool'), { reason, target_pid: pid, via: 'killSpoolWatcherInCwd' });
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
