'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { sha256OfFileSync } = require('./gm-process');
const {
  obsEvent,
  gmToolsDir,
  resolveWindowsExe,
  resolveNpmCliJs,
} = require('./bootstrap-shared');

const NPM_PACKAGE = 'plugkit-wasm';
const ATTEMPT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [5000, 15000];

function makeLogger(prefix) {
  return function log(msg) {
    try { process.stderr.write(`[${prefix}] ${msg}\n`); } catch (_) {}
  };
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

function readVersionFile(wrapperDir) {
  const p = path.join(wrapperDir, 'plugkit.version');
  if (!fs.existsSync(p)) throw new Error(`plugkit.version not found at ${p}`);
  return fs.readFileSync(p, 'utf8').trim();
}

function readShaManifest(wrapperDir, manifestName) {
  const p = path.join(wrapperDir, manifestName || 'plugkit.sha256');
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

function copyWasmToGmTools(wasmPath, version, opts) {
  opts = opts || {};
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

  if (opts.wrapperDir) {
    try {
      const srcSha = path.join(opts.wrapperDir, 'plugkit.sha256');
      if (fs.existsSync(srcSha)) fs.copyFileSync(srcSha, path.join(dst, 'plugkit.sha256'));
    } catch (_) {}
  }
}

function resolveCacheWasmPath(root, version, wasmName) {
  const verDir = path.join(root, `v${version}`);
  const wasmPath = path.join(verDir, wasmName || 'plugkit.wasm');
  const okSentinel = path.join(verDir, '.wasm-ok');
  if (fs.existsSync(wasmPath) && fs.existsSync(okSentinel)) return wasmPath;
  return null;
}

function resolveInstalledWasmPath() {
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const primary = path.join(home, '.gm-tools', 'plugkit.wasm');
  const fallback = path.join(home, '.claude', 'gm-tools', 'plugkit.wasm');
  if (fs.existsSync(primary)) return primary;
  if (fs.existsSync(fallback)) return fallback;
  return primary;
}

async function extractNpmPackageWasm(destPath, version, opts) {
  opts = opts || {};
  const log = opts.log || makeLogger('plugkit-bootstrap');
  const { ensureDir } = require('./bootstrap-shared');
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

async function extractNpmPackageWithRetry(destPath, version, opts) {
  opts = opts || {};
  const log = opts.log || makeLogger('plugkit-bootstrap');
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      log(`npm extract attempt ${attempt}/${MAX_ATTEMPTS}: ${NPM_PACKAGE}@${version}`);
      await extractNpmPackageWasm(destPath, version, opts);
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

module.exports = {
  NPM_PACKAGE,
  ATTEMPT_TIMEOUT_MS,
  MAX_ATTEMPTS,
  BACKOFF_MS,
  makeLogger,
  resolveProjectRoot,
  writeBootstrapError,
  clearBootstrapError,
  readVersionFile,
  readShaManifest,
  copyWasmToGmTools,
  resolveCacheWasmPath,
  resolveInstalledWasmPath,
  extractNpmPackageWasm,
  extractNpmPackageWithRetry,
};
