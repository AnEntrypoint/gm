#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { logEvent: _sharedLogEvent } = require('./gm-log');
const { pidCommandLineForKillGuard: _sharedPidCommandLine } = require('./gm-process');

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

const NPM_PACKAGE = 'plugkit-wasm';
const ATTEMPT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [5000, 15000];
const LOCK_STALE_MS = 30 * 60 * 1000;

const wrapperDir = __dirname;

function log(msg) {
  try { process.stderr.write(`[gm-plugkit] ${msg}\n`); } catch (_) {}
}

function obsEvent(subsystem, event, fields) {
  _sharedLogEvent(subsystem, event, fields, { cwd: false });
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

// User/agent edits to .gm/instructions/*.md are the whole point of vendoring
// them per-project -- a bare content-diff overwrite treats "user diverged
// from the shipped default" identically to "file is just stale", silently
// clobbering local edits on every routine bootstrap/auto-update. The
// manifest records the sha256 of what THIS install last shipped for each
// key; a local file matching that hash is safe to refresh (it's untouched),
// but a local file that differs from BOTH the manifest AND the new default
// is a real user edit -- write the new default beside it as .md.new instead
// of overwriting, so the edit survives and the update is still visible.
function instructionsManifestPath(cwd) {
  return path.join(cwd, '.gm', '.instructions-shipped-manifest.json');
}

function readInstructionsManifest(cwd) {
  try { return JSON.parse(fs.readFileSync(instructionsManifestPath(cwd), 'utf-8')); }
  catch (_) { return {}; }
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
          continue; // already current, nothing to do
        }
        const lastShippedHash = manifest[childRel];
        const localMatchesLastShipped = lastShippedHash && sha256Hex(prev) === lastShippedHash;
        if (localMatchesLastShipped || !lastShippedHash) {
          // Untouched since we last wrote it (or first time we've ever
          // recorded a hash for this key -- pre-manifest install, treat as
          // ours) -- safe to refresh with the new default.
          fs.writeFileSync(dst, next);
          manifest[childRel] = nextHash;
          copied++;
        } else {
          // Local content diverges from what we shipped: a real user/agent
          // edit. Never overwrite it -- stage the new default beside it so
          // the update is visible without destroying the edit.
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

// Slim-artifact eligibility: plugkit-core's embed.rs probes host_vec_embed
// before ever loading its wasm-embedded safetensors fallback (see
// rs-plugkit/crates/plugkit-core/src/embed.rs::init_ctx) -- a slim build
// (feature=slim, no embedded weights at all) is only safe to fetch on a host
// that actually answers host_vec_embed for real. plugkit-wasm-wrapper.js
// wires that answer through gm-runner's native candle path
// (hostEmbedViaGmRunner) or agentplug-runner's shared daemon, both gated on
// one of these two binaries existing under ~/.gm-tools -- mirrors that same
// on-disk presence check here so bootstrap-time artifact selection and
// runtime embed-delegation eligibility never disagree. Absence of both means
// no host_vec_embed answer will ever come, so fetching fat (which carries its
// own wasm-side embedding fallback) is the only safe choice.
function hasNativeEmbedRunner() {
  const dir = gmToolsDir();
  const names = process.platform === 'win32'
    ? ['gm-runner.exe', 'agentplug-runner.exe']
    : ['gm-runner', 'agentplug-runner'];
  return names.some(n => { try { return fs.existsSync(path.join(dir, n)); } catch (_) { return false; } });
}

// Root a project-dir resolution at the git COMMON dir, not the raw cwd/
// CLAUDE_PROJECT_DIR -- a worktree (e.g. Workflow's isolation:'worktree'
// agents, each `git worktree add`-ing a fresh physical directory) shares the
// SAME underlying repo as its main checkout but has its own separate
// directory tree. Every cwd-derived project-dir computation in this file and
// in supervisor.js/cli.js must funnel through this so a worktree-spawned
// process resolves to the SAME .gm/exec-spool/ as its main-repo sibling --
// otherwise the single-instance supervisor lock can never see a sibling
// worktree's already-running watcher, and every worktree cold-boots its own
// independent watcher (each loading the full embed model + running its own
// cold reindex of what is, conceptually, the same project). Live-measured
// this session under real concurrent multi-agent load: this was the actual
// root cause of a user-flagged "memory grows to ~2GB then clears" churn
// pattern -- N worktrees of one repo each independently paying full
// cold-embed cost instead of sharing one already-warm watcher, and the
// resulting CPU contention pushed genuinely-busy processes past their
// heartbeat deadline into a restart cycle that produces the sawtooth memory
// pattern. Mirrors the existing browserRootDir() resolution already used for
// browser-session state in plugkit-wasm-wrapper.js (same fix, same reason,
// applied one layer up at the process-boot-dedup level).
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

    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'plugkit-extract', version: '0.0.0', private: true }));

    const cmd = resolveWindowsExe('npm');
    const args = ['install', '--no-audit', '--no-fund', '--no-save', NPM_PACKAGE + '@' + version];
    const isCmdShim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd);

    const spawnCmd = isCmdShim ? `"${cmd}"` : cmd;
    const spawnArgs = isCmdShim ? args.map(a => /[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a) : args;

    const result = spawnSync(spawnCmd, spawnArgs, {
      cwd: tempDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: ATTEMPT_TIMEOUT_MS,
      encoding: 'utf8',
      windowsHide: true,
      ...(isCmdShim ? { shell: true } : {}),
      ...(process.platform === 'win32' ? { creationFlags: 0x08000000 } : {}),
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

// artifactName selects the REMOTE release asset ('plugkit.wasm' fat or
// 'plugkit-slim.wasm' slim) -- the local destPath filename is unaffected,
// same convention gm-runner's own download.rs::bootstrap_plugkit_wasm uses
// (fixed local name, artifact-selected remote source). A slim fetch that 404s
// (older release predating the slim publish step, or the asset genuinely
// missing) falls back to fetching fat rather than failing the whole
// bootstrap -- a host capable of running the slim build is also always a
// valid fat-build host (fat is a strict superset of slim's capability), so
// this fallback never produces incorrect behavior, only a larger download.
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

function pidCommandLineForKillGuard(pid) {
  return _sharedPidCommandLine(pid);
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
    try { spawnSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true, timeout: 3000, killSignal: 'SIGKILL' }); } catch (_) {}
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

function proactiveKillForNewInstall(installedVersion) {
  try {
    const reason = `install:v${installedVersion}`;
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
  if (recorded) killSpoolWatcherInCwd(`version_change:${recorded}->${currentVersion}`);
  writeDaemonVersion(currentVersion);
}


async function bootstrap(opts) {
  opts = opts || {};
  const version = readVersionFile();
  const shaManifest = readShaManifest();
  // Artifact selection: slim (no wasm-embedded safetensors, ~130MB smaller)
  // only when this host has a native host_vec_embed answerer on disk
  // (gm-runner or agentplug-runner under ~/.gm-tools -- see
  // hasNativeEmbedRunner) -- everyone else fetches fat, unchanged from
  // before this selection logic existed. remoteArtifact is the release-asset
  // name; the LOCAL cache filename stays 'plugkit.wasm' either way (matching
  // gm-runner's own download.rs convention) so nothing downstream that reads
  // the local wasm path needs to know which variant landed. The cache
  // sub-directory is kept distinct per-kind (v<version> vs v<version>-slim)
  // so a fat and slim download of the same version never collide under the
  // same sha/sentinel check.
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
      // The plugkit-wasm npm package only ever ships the fat artifact (see
      // release.yml's npm-publish step, which cp's release-assets/plugkit.wasm
      // -- never plugkit-slim.wasm -- into the package). Skip the npm-extract
      // attempt entirely for a slim fetch and go straight to GitHub Releases,
      // which is where slim is actually published.
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
    // pruneOldVersions keeps only the dir literally named v<keepVersion> --
    // verDir uses a '-slim' suffix for the slim cache slot (see useSlim
    // above), so the keep-token passed here must match that same suffix or
    // pruneOldVersions deletes the directory just populated by THIS run
    // before copyWasmToGmTools below can read from it (live-witnessed this
    // session: a real end-to-end bootstrap() run on a native-runner host hit
    // exactly this -- 'pruned .../v0.1.906-slim' followed by an ENOENT on the
    // immediately-following copy, because 'v0.1.906' != 'v0.1.906-slim').
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

function runningFromGmSourceRepo() {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    if (!fs.existsSync(pkgPath)) return false;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg && pkg.name === 'gm-skill';
  } catch (_) { return false; }
}

function ensureWrapperFresh() {
  try {
    const wrapperSrc = path.join(__dirname, 'plugkit-wasm-wrapper.js');
    const wrapperDst = path.join(gmToolsDir(), 'plugkit-wasm-wrapper.js');
    if (!fs.existsSync(wrapperSrc)) return false;
    if (runningFromGmSourceRepo() && process.env.GM_PLUGKIT_ALLOW_DEV_WRAPPER_OVERWRITE !== '1') {
      log(`refusing to overwrite the shared ~/.gm-tools wrapper from the gm source repo (${wrapperSrc}) -- this machine-wide install is shared by every project's watcher; set GM_PLUGKIT_ALLOW_DEV_WRAPPER_OVERWRITE=1 to opt in, or use 'bun x gm-plugkit@latest' which fetches an isolated npm copy instead`);
      return false;
    }
    let same = false;
    if (fs.existsSync(wrapperDst)) {
      try {
        const a = sha256OfFileSync(wrapperSrc);
        const b = sha256OfFileSync(wrapperDst);
        if (a === b) same = true;
      } catch (_) {}
    }
    if (same) return false;
    // Many independent per-project watchers share this one gmToolsDir() install --
    // concurrent CLI invocations from different projects can race this copy, so
    // it's lock-guarded (atomic O_EXCL) + tmp-write-then-rename, never a direct
    // in-place copyFileSync another reader could observe half-written.
    fs.mkdirSync(gmToolsDir(), { recursive: true });
    const lockPath = wrapperDst + '.lock';
    acquireLock(lockPath);
    try {
      let stillSame = false;
      if (fs.existsSync(wrapperDst)) {
        try {
          const a = sha256OfFileSync(wrapperSrc);
          const b = sha256OfFileSync(wrapperDst);
          if (a === b) stillSame = true;
        } catch (_) {}
      }
      if (stillSame) return false;
      const tmpDst = wrapperDst + '.tmp.' + process.pid;
      fs.copyFileSync(wrapperSrc, tmpDst);
      fs.renameSync(tmpDst, wrapperDst);
      return true;
    } finally {
      releaseLock(lockPath);
    }
  } catch (_) { return false; }
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
  found.set('gm', path.join(__dirname, 'SKILL.md'));
  try {
    for (const f of fs.readdirSync(__dirname)) {
      const m = f.match(/^SKILL-(.+)\.md$/);
      if (m) found.set(m[1], path.join(__dirname, f));
    }
  } catch (_) {}
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
    } catch (_) {}
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
  } catch (_) {}
  return null;
}

async function resolveLatestGmPlugkitNpmVersion(timeoutMs) {
  try {
    const buf = await httpGetBuffer('https://registry.npmjs.org/gm-plugkit/latest', timeoutMs || 3000);
    const meta = JSON.parse(buf.toString('utf-8'));
    if (meta && typeof meta.version === 'string') return meta.version;
  } catch (_) {}
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
    } catch (_) {}
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
    const wrapperUpdated = ensureWrapperFresh();
    const versionMarkerUpdated = ensureGmPlugkitVersionFresh();
    ensureSkillMdFresh();
    return { ok: true, wasmPath, binaryPath: wasmPath, status: (wrapperUpdated || versionMarkerUpdated) ? 'wrapper-refreshed' : 'already-ready', version: installed };
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
      ensureWrapperFresh();
      ensureSkillMdFresh();
      return { ok: true, wasmPath: cachedPath, binaryPath: cachedPath, status: 'bootstrap-failed-served-cached', version: installed };
    }
    throw bootErr;
  }

  if (versionDrift) {
    try { killSpoolWatcherInCwd(`version_drift:${installed}->${targetVersion}`); } catch (_) {}
  }

  ensureWrapperFresh();
  ensureSkillMdFresh();
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

function resolveNodeRuntime() {
  const candidates = [];
  if (process.env.PLUGKIT_RUNTIME) candidates.push(process.env.PLUGKIT_RUNTIME);
  candidates.push('bun');
  try {
    const which = process.platform === 'win32' ? 'where' : 'which';
    const out = require('child_process').spawnSync(which, ['bun'], { encoding: 'utf8', windowsHide: true });
    if (out && out.stdout) {
      const first = out.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
      if (first) candidates.push(first);
    }
  } catch (_) {}
  for (const c of candidates) {
    try { const r = require('child_process').spawnSync(c, ['--version'], { stdio: 'ignore', windowsHide: true }); if (r && r.status === 0) return c; } catch (_) {}
  }
  const isNodeExe = (p) => /(^|[\\/])node(\.exe)?$/i.test(String(p || ''));
  const nodeCandidates = [];
  if (isNodeExe(process.env.GM_NODE_PATH)) nodeCandidates.push(process.env.GM_NODE_PATH);
  if (isNodeExe(process.execPath)) nodeCandidates.push(process.execPath);
  try {
    const which = process.platform === 'win32' ? 'where' : 'which';
    const out = require('child_process').spawnSync(which, ['node'], { encoding: 'utf8', windowsHide: true });
    if (out && out.stdout) {
      const first = out.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
      if (first) nodeCandidates.push(first);
    }
  } catch (_) {}
  for (const c of nodeCandidates) {
    try { const r = require('child_process').spawnSync(c, ['--version'], { stdio: 'ignore', windowsHide: true }); if (r && r.status === 0) return c; } catch (_) {}
  }
  return process.execPath;
}

function startSpoolDaemon() {
  try {
    const wrapper = path.join(gmToolsDir(), 'plugkit-wasm-wrapper.js');
    if (!fs.existsSync(wrapper)) {
      return { ok: false, error: `wrapper not at ${wrapper} -- ensureReady() must run first` };
    }
    const runtime = resolveNodeRuntime();
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
      const cmd = runtime;
      const args = [wrapper, 'spool'];
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
    const child = require('child_process').spawn(runtime, [supervisor], {
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
  ensureWrapperFresh,
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
