const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync, execFileSync, spawn } = require('child_process');
const crypto = require('crypto');
const os = require('os');
const spool = require('./spool.js');

function resolveToolsDir() {
  const primary = path.join(os.homedir(), '.gm-tools');
  const fallback = path.join(os.homedir(), '.claude', 'gm-tools');
  if (fs.existsSync(primary)) return primary;
  if (fs.existsSync(fallback)) return fallback;
  return primary;
}
const PLUGKIT_TOOLS_DIR = resolveToolsDir();
const PLUGKIT_VERSION_FILE = path.join(PLUGKIT_TOOLS_DIR, 'plugkit.version');
const PLUGKIT_WASM_PATH = path.join(PLUGKIT_TOOLS_DIR, 'plugkit.wasm');
const PLUGKIT_WASM_WRAPPER = path.join(PLUGKIT_TOOLS_DIR, 'plugkit-wasm-wrapper.js');
const PLUGKIT_SUPERVISOR = path.join(PLUGKIT_TOOLS_DIR, 'plugkit-supervisor.js');
const BOOTSTRAP_STATUS_FILE = path.join(os.homedir(), '.gm', 'bootstrap-status.json');
const BOOTSTRAP_ERROR_FILE = path.join(os.homedir(), '.gm', 'bootstrap-error.json');
const LOG_DIR = path.join(os.homedir(), '.claude', 'gm-log');

function getPlugkitPath() {
  return PLUGKIT_WASM_PATH;
}

function emitBootstrapEvent(severity, message, details) {
  try {
    const date = new Date().toISOString().split('T')[0];
    const logDir = path.join(LOG_DIR, date);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logFile = path.join(logDir, 'bootstrap.jsonl');
    const entry = {
      ts: new Date().toISOString(),
      severity,
      message,
      ...details,
    };
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error(`[bootstrap] Failed to emit event: ${e.message}`);
  }
}

function resolveFromCandidates(candidates, requireResolveId) {
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  if (requireResolveId) {
    try {
      const resolved = require.resolve(requireResolveId);
      if (fs.existsSync(resolved)) return resolved;
    } catch (e) {
    }
  }
  return null;
}

function readManifest() {
  try {
    const gmJsonPath = resolveFromCandidates([
      path.join(__dirname, '..', 'gm.json'),
      path.join(__dirname, '..', '..', 'gm.json'),
    ], 'gm-skill/gm.json');
    if (!gmJsonPath) {
      throw new Error('gm.json not found relative to skill-bootstrap.js');
    }
    const gm = JSON.parse(fs.readFileSync(gmJsonPath, 'utf8'));
    const version = gm.plugkitVersion;

    const sha256Path = resolveFromCandidates([
      path.join(__dirname, '..', 'bin', 'plugkit.wasm.sha256'),
      path.join(__dirname, '..', '..', 'bin', 'plugkit.wasm.sha256'),
    ], 'gm-skill/bin/plugkit.wasm.sha256');
    if (!sha256Path) {
      throw new Error('bin/plugkit.wasm.sha256 not found relative to skill-bootstrap.js');
    }
    const sha256Content = fs.readFileSync(sha256Path, 'utf8').trim();
    const expectedHash = sha256Content.split(/\s+/)[0];

    return { version, expectedHash };
  } catch (e) {
    emitBootstrapEvent('error', 'Failed to read manifest', { error: e.message });
    throw e;
  }
}

function getInstalledVersion() {
  try {
    if (fs.existsSync(PLUGKIT_VERSION_FILE)) {
      return fs.readFileSync(PLUGKIT_VERSION_FILE, 'utf8').trim();
    }
    return null;
  } catch (e) {
    return null;
  }
}

function computeFileHash(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function httpGet(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs, headers: { 'accept': 'application/json', 'user-agent': 'gm-skill-bootstrap' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        httpGet(res.headers.location, timeoutMs).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(new Error(`timeout ${timeoutMs}ms ${url}`)); });
    req.on('error', reject);
  });
}

async function getLatestRemoteVersion() {
  let version = null;
  let source = null;
  try {
    const buf = await httpGet('https://registry.npmjs.org/plugkit-wasm/latest', 3000);
    const pkg = JSON.parse(buf.toString('utf-8'));
    if (pkg && pkg.version) {
      version = pkg.version;
      source = 'npm-plugkit-wasm';
    }
  } catch (e) {
    emitBootstrapEvent('warn', 'npm plugkit-wasm lookup failed', { error: e.message });
  }
  if (!version) {
    try {
      const buf = await httpGet('https://registry.npmjs.org/gm-plugkit/latest', 3000);
      const pkg = JSON.parse(buf.toString('utf-8'));
      if (pkg && pkg.plugkitVersion) {
        version = pkg.plugkitVersion;
        source = 'npm-gm-plugkit';
      } else if (pkg && pkg.version) {
        version = pkg.version;
        source = 'npm-gm-plugkit-fallback';
      }
    } catch (e) {
      emitBootstrapEvent('warn', 'npm gm-plugkit fallback lookup failed', { error: e.message });
    }
  }
  if (!version) {
    emitBootstrapEvent('warn', 'All latest-version lookups failed; falling back to manifest');
    return null;
  }
  let sha = '';
  try {
    const shaBuf = await httpGet(`https://github.com/AnEntrypoint/plugkit-bin/releases/download/v${version}/plugkit.wasm.sha256`, 3000);
    sha = shaBuf.toString('utf-8').trim().split(/\s+/)[0];
  } catch (e) {
    emitBootstrapEvent('warn', 'sha fetch failed; will verify after download', { error: e.message, version });
  }
  emitBootstrapEvent('info', 'Resolved latest plugkit version', { version, source, hasSha: Boolean(sha) });
  return { version, sha, source };
}

function detectBuildToolConfigs(cwd) {
  const detectors = [
    { tool: 'vite', patterns: ['vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'vite.config.cjs'] },
    { tool: 'vitest', patterns: ['vitest.config.js', 'vitest.config.ts', 'vitest.config.mjs'] },
    { tool: 'astro', patterns: ['astro.config.js', 'astro.config.ts', 'astro.config.mjs'] },
    { tool: 'next', patterns: ['next.config.js', 'next.config.ts', 'next.config.mjs', 'next.config.cjs'] },
    { tool: 'jest', patterns: ['jest.config.js', 'jest.config.ts', 'jest.config.mjs', 'jest.config.cjs', 'jest.config.json'] },
    { tool: 'webpack', patterns: ['webpack.config.js', 'webpack.config.ts', 'webpack.config.cjs', 'webpack.config.mjs'] },
    { tool: 'rollup', patterns: ['rollup.config.js', 'rollup.config.ts', 'rollup.config.mjs'] },
    { tool: 'nuxt', patterns: ['nuxt.config.js', 'nuxt.config.ts', 'nuxt.config.mjs'] },
  ];
  const found = [];
  for (const d of detectors) {
    for (const p of d.patterns) {
      const fp = path.join(cwd, p);
      if (fs.existsSync(fp)) {
        found.push({ tool: d.tool, file: p, fullPath: fp });
        break;
      }
    }
  }
  return found;
}

function patchJestJsonConfig(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const cfg = JSON.parse(raw);
  const want = '<rootDir>/.gm/';
  const existing = Array.isArray(cfg.watchPathIgnorePatterns) ? cfg.watchPathIgnorePatterns : [];
  if (existing.includes(want)) return false;
  cfg.watchPathIgnorePatterns = [...existing, want];
  fs.writeFileSync(filePath, JSON.stringify(cfg, null, 2) + '\n');
  return true;
}

function patchPackageJsonJest(cwd) {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  const raw = fs.readFileSync(pkgPath, 'utf-8');
  let pkg;
  try { pkg = JSON.parse(raw); } catch (_) { return null; }
  if (!pkg.jest || typeof pkg.jest !== 'object') return null;
  const want = '<rootDir>/.gm/';
  const existing = Array.isArray(pkg.jest.watchPathIgnorePatterns) ? pkg.jest.watchPathIgnorePatterns : [];
  if (existing.includes(want)) return false;
  pkg.jest.watchPathIgnorePatterns = [...existing, want];
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  return true;
}

function ensureBuildToolIgnores(cwd) {
  try {
    const found = detectBuildToolConfigs(cwd);
    const automated = [];
    const advisory = [];

    for (const f of found) {
      if (f.tool === 'jest' && f.file.endsWith('.json')) {
        try {
          const changed = patchJestJsonConfig(f.fullPath);
          automated.push({ tool: 'jest', file: f.file, changed });
        } catch (e) {
          advisory.push({ ...f, reason: `patch failed: ${e.message}` });
        }
      } else {
        advisory.push(f);
      }
    }

    try {
      const pkgChanged = patchPackageJsonJest(cwd);
      if (pkgChanged !== null) automated.push({ tool: 'jest', file: 'package.json#jest', changed: pkgChanged });
    } catch (_) {}

    const snippets = {
      vite: "server: { watch: { ignored: ['**/.gm/**'] } }",
      vitest: "test: { watchExclude: ['**/.gm/**'] }",
      astro: "vite: { server: { watch: { ignored: ['**/.gm/**'] } } }",
      next: "webpack: (config) => { config.watchOptions = { ...config.watchOptions, ignored: ['**/.gm/**', ...(config.watchOptions?.ignored || [])] }; return config; }",
      jest: "watchPathIgnorePatterns: ['<rootDir>/.gm/']",
      webpack: "watchOptions: { ignored: ['**/.gm/**', '**/node_modules/**'] }",
      rollup: "watch: { exclude: ['.gm/**'] }",
      nuxt: "vite: { server: { watch: { ignored: ['**/.gm/**'] } } }",
    };

    const gmDir = path.join(cwd, '.gm');
    const advisoryPath = path.join(gmDir, 'build-tool-ignores.md');
    if (advisory.length === 0) {
      try { if (fs.existsSync(advisoryPath)) fs.unlinkSync(advisoryPath); } catch (_) {}
    } else {
      fs.mkdirSync(gmDir, { recursive: true });
      const lines = [
        '# Build-tool ignore advisories',
        '',
        '`.gitignore` already excludes `.gm/`. Tools whose watchers honor `.gitignore` (vite, vitest, astro, nuxt with chokidar defaults) need no further action.',
        '',
        'For watchers that do NOT honor `.gitignore` automatically, paste these snippets into the corresponding config file:',
        '',
      ];
      for (const f of advisory) {
        const snip = snippets[f.tool];
        if (!snip) continue;
        lines.push(`## ${f.tool} (\`${f.file}\`)`, '', '```', snip, '```', '');
      }
      lines.push('---', '', 'Regenerated each bootstrap. Delete after applying -- file is gitignored.');
      fs.writeFileSync(advisoryPath, lines.join('\n'));
    }

    emitBootstrapEvent('info', 'Build-tool ignore handling complete', {
      automated: automated.map(a => ({ tool: a.tool, file: a.file, changed: a.changed })),
      advisory: advisory.map(a => ({ tool: a.tool, file: a.file })),
    });
  } catch (e) {
    emitBootstrapEvent('warn', 'ensureBuildToolIgnores failed', { error: e.message });
  }
}


function ensureSkillMdCurrent() {
  try {
    const bundledPath = resolveFromCandidates([
      path.join(__dirname, '..', 'skills', 'gm-skill', 'SKILL.md'),
      path.join(__dirname, '..', '..', 'skills', 'gm-skill', 'SKILL.md'),
    ], 'gm-skill/skills/gm-skill/SKILL.md');
    if (!bundledPath || !fs.existsSync(bundledPath)) {
      emitBootstrapEvent('warn', 'bundled SKILL.md not found; skipping refresh');
      return { refreshed: [], skipped: true };
    }
    const bundled = fs.readFileSync(bundledPath, 'utf8');
    const _norm = s => s.replace(/\r\n/g, '\n');
    const bundledHash = crypto.createHash('sha256').update(_norm(bundled)).digest('hex');
    const targets = [
      path.join(os.homedir(), '.agents', 'skills', 'gm-skill', 'SKILL.md'),
      path.join(os.homedir(), '.claude', 'skills', 'gm-skill', 'SKILL.md'),
    ];
    const refreshed = [];
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
          refreshed.push(target);
        }
      } catch (e) {
        emitBootstrapEvent('warn', 'SKILL.md refresh failed for target', { target, error: e.message });
      }
    }
    if (refreshed.length > 0) {
      emitBootstrapEvent('info', 'SKILL.md refreshed', { hash: bundledHash.slice(0, 12), targets: refreshed });
    }
    return { refreshed, bundledHash };
  } catch (e) {
    emitBootstrapEvent('warn', 'ensureSkillMdCurrent failed', { error: e.message });
    return { refreshed: [], error: e.message };
  }
}

function writeSessionSidecar(sessionId) {
  try {
    const spool = path.join(process.cwd(), '.gm', 'exec-spool');
    fs.mkdirSync(spool, { recursive: true });
    let sess = sessionId || process.env.CLAUDE_SESSION_ID || process.env.GM_SESSION_ID || '';
    if (!sess) {
      const fallbackFile = path.join(spool, '.session-fallback');
      try { sess = fs.readFileSync(fallbackFile, 'utf8').trim(); } catch (_) {}
      if (!sess) {
        const cwdHash = require('crypto').createHash('sha1').update(process.cwd()).digest('hex').slice(0, 8);
        sess = `machine-${cwdHash}-${Date.now().toString(36)}`;
        try { fs.writeFileSync(fallbackFile, sess); } catch (_) {}
      }
    }
    fs.writeFileSync(path.join(spool, '.session-current'), sess);
  } catch (_) {}
}

async function downloadPlugkitBinary(version) {
  const binaryName = 'plugkit.wasm';
  const url = `https://github.com/AnEntrypoint/plugkit-bin/releases/download/v${version}/${binaryName}`;
  emitBootstrapEvent('info', 'Starting WASM download', { version, url });
  try {
    const buf = await httpGet(url, 30000);
    emitBootstrapEvent('info', 'WASM download complete', { bytes: buf.length });
    return buf;
  } catch (e) {
    emitBootstrapEvent('error', 'Download failed', { error: e.message });
    throw e;
  }
}

function findPlugkitWasmPids() {
  const pids = [];
  try {
    if (process.platform === 'win32') {
      const ps = "Get-CimInstance Win32_Process -Filter \"Name='bun.exe' OR Name='node.exe'\" | Where-Object { $_.CommandLine -match 'plugkit-wasm-wrapper' } | Select-Object -ExpandProperty ProcessId";
      const output = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true });
      for (const line of output.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (/^\d+$/.test(trimmed)) pids.push(trimmed);
      }
    } else {
      const output = execSync("ps -eo pid,args", { encoding: 'utf8' });
      const lines = output.split('\n').filter(Boolean);
      for (const line of lines) {
        if (!line.includes('plugkit-wasm-wrapper')) continue;
        const m = line.trim().match(/^(\d+)\s/);
        if (m) pids.push(m[1]);
      }
    }
  } catch (e) {
  }
  return pids;
}

function isProcessRunning() {
  if (findPlugkitWasmPids().length > 0) return true;
  try {
    const supervisorPidFile = path.join(process.cwd(), '.gm', 'exec-spool', '.supervisor.pid');
    if (!fs.existsSync(supervisorPidFile)) return false;
    const pid = parseInt(fs.readFileSync(supervisorPidFile, 'utf8').trim(), 10);
    if (!Number.isFinite(pid) || pid <= 0) return false;
    try { process.kill(pid, 0); return true; } catch (_) { return false; }
  } catch (_) { return false; }
}

function killExistingPlugkit() {
  try {
    const pids = findPlugkitWasmPids();
    try {
      const supervisorPidFile = path.join(process.cwd(), '.gm', 'exec-spool', '.supervisor.pid');
      if (fs.existsSync(supervisorPidFile)) {
        const sp = parseInt(fs.readFileSync(supervisorPidFile, 'utf8').trim(), 10);
        if (Number.isFinite(sp) && sp > 0) {
          try { process.kill(sp, 0); pids.unshift(String(sp)); } catch (_) {}
        }
      }
    } catch (_) {}
    if (pids.length === 0) {
      emitBootstrapEvent('info', 'No existing plugkit WASM watcher to kill');
      return;
    }
    for (const pid of pids) {
      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        } else {
          execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
        }
      } catch (e) {
      }
    }
    emitBootstrapEvent('info', 'Killed existing plugkit WASM watcher', { pids });
  } catch (e) {
    emitBootstrapEvent('warn', 'Failed to kill existing plugkit', { error: e.message });
  }
}

async function ensureBinaryWritable(filePath) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) {
    throw new Error(`Cannot write to ${filePath}: ${e.message}`);
  }
}

async function writeBinaryWithRetry(filePath, data, maxRetries = 3) {
  let lastErr;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await ensureBinaryWritable(filePath);
      fs.writeFileSync(filePath, data);
      fs.chmodSync(filePath, 0o755);
      emitBootstrapEvent('info', 'Binary written successfully', { path: filePath });
      return;
    } catch (e) {
      lastErr = e;
      emitBootstrapEvent('warn', `Write attempt ${attempt + 1} failed`, { error: e.message });
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 50 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastErr;
}

async function verifyBinaryHealth(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const stat = fs.statSync(filePath);
    if (stat.size < 1024) {
      throw new Error(`File too small: ${stat.size} bytes`);
    }
    emitBootstrapEvent('info', 'Binary health check passed', { size: stat.size });
    return true;
  } catch (e) {
    emitBootstrapEvent('warn', 'Binary health check failed', { error: e.message });
    return false;
  }
}

function openWatcherLog(projectDir) {
  const spoolDir = path.join(projectDir, '.gm', 'exec-spool');
  fs.mkdirSync(spoolDir, { recursive: true });
  const logPath = path.join(spoolDir, '.watcher.log');
  try {
    const stat = fs.statSync(logPath);
    if (stat.size > 10 * 1024 * 1024) {
      const rotated = path.join(spoolDir, '.watcher.log.1');
      try { fs.unlinkSync(rotated); } catch (_) {}
      fs.renameSync(logPath, rotated);
    }
  } catch (_) {}
  const fd = fs.openSync(logPath, 'a');
  const header = `\n--- watcher boot ${new Date().toISOString()} pid=${process.pid} ---\n`;
  try { fs.writeSync(fd, header); } catch (_) {}
  return fd;
}

function ensureSupervisorInstalled() {
  try {
    let src = null;
    try {
      const gmPlugkit = require('gm-plugkit');
      const base = path.dirname(gmPlugkit.getPath ? gmPlugkit.getPath() : require.resolve('gm-plugkit'));
      const cand = path.join(base, 'supervisor.js');
      if (fs.existsSync(cand)) src = cand;
    } catch (_) {}
    if (!src) {
      src = resolveFromCandidates([
        path.join(__dirname, '..', 'gm-plugkit', 'supervisor.js'),
        path.join(__dirname, '..', '..', 'gm-plugkit', 'supervisor.js'),
      ], 'gm-skill/gm-plugkit/supervisor.js');
    }
    if (!src || !fs.existsSync(src)) {
      emitBootstrapEvent('warn', 'bundled plugkit-supervisor.js not found; supervisor unavailable');
      return null;
    }
    fs.mkdirSync(PLUGKIT_TOOLS_DIR, { recursive: true });
    let needsWrite = true;
    if (fs.existsSync(PLUGKIT_SUPERVISOR)) {
      try {
        const a = crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex');
        const b = crypto.createHash('sha256').update(fs.readFileSync(PLUGKIT_SUPERVISOR)).digest('hex');
        if (a === b) needsWrite = false;
      } catch (_) {}
    }
    if (needsWrite) {
      const tmp = PLUGKIT_SUPERVISOR + '.tmp';
      fs.copyFileSync(src, tmp);
      fs.renameSync(tmp, PLUGKIT_SUPERVISOR);
      emitBootstrapEvent('info', 'plugkit-supervisor.js installed', { target: PLUGKIT_SUPERVISOR });
    }
    return PLUGKIT_SUPERVISOR;
  } catch (e) {
    emitBootstrapEvent('warn', 'ensureSupervisorInstalled failed', { error: e.message });
    return null;
  }
}

function ensureWrapperInstalled() {
  try {
    let src = null;
    try {
      const gmPlugkit = require('gm-plugkit');
      const base = path.dirname(gmPlugkit.getPath ? gmPlugkit.getPath() : require.resolve('gm-plugkit'));
      const cand = path.join(base, 'plugkit-wasm-wrapper.js');
      if (fs.existsSync(cand)) src = cand;
    } catch (_) {}
    if (!src) {
      src = resolveFromCandidates([
        path.join(__dirname, '..', 'gm-plugkit', 'plugkit-wasm-wrapper.js'),
        path.join(__dirname, '..', '..', 'gm-plugkit', 'plugkit-wasm-wrapper.js'),
      ], 'gm-skill/gm-plugkit/plugkit-wasm-wrapper.js');
    }
    if (!src || !fs.existsSync(src)) {
      emitBootstrapEvent('warn', 'bundled plugkit-wasm-wrapper.js not found; wrapper refresh skipped');
      return null;
    }
    fs.mkdirSync(PLUGKIT_TOOLS_DIR, { recursive: true });
    let needsWrite = true;
    if (fs.existsSync(PLUGKIT_WASM_WRAPPER)) {
      try {
        const a = crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex');
        const b = crypto.createHash('sha256').update(fs.readFileSync(PLUGKIT_WASM_WRAPPER)).digest('hex');
        if (a === b) needsWrite = false;
      } catch (_) {}
    }
    if (needsWrite) {
      const tmp = PLUGKIT_WASM_WRAPPER + '.tmp';
      fs.copyFileSync(src, tmp);
      fs.renameSync(tmp, PLUGKIT_WASM_WRAPPER);
      emitBootstrapEvent('info', 'plugkit-wasm-wrapper.js refreshed', { target: PLUGKIT_WASM_WRAPPER });
    }
    return PLUGKIT_WASM_WRAPPER;
  } catch (e) {
    emitBootstrapEvent('warn', 'ensureWrapperInstalled failed', { error: e.message });
    return null;
  }
}

function findSupervisorPid() {
  try {
    const supervisorPidFile = path.join(process.cwd(), '.gm', 'exec-spool', '.supervisor.pid');
    if (!fs.existsSync(supervisorPidFile)) return null;
    const pid = parseInt(fs.readFileSync(supervisorPidFile, 'utf8').trim(), 10);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    try { process.kill(pid, 0); return pid; } catch (_) { return null; }
  } catch (_) { return null; }
}

async function spawnPlugkitWatcher(wasmPath) {
  try {
    emitBootstrapEvent('info', 'Spawning plugkit supervisor');

    let wrapperPath;
    try {
      const gmPlugkit = require('gm-plugkit');
      wrapperPath = path.join(path.dirname(gmPlugkit.getPath ? gmPlugkit.getPath() : require.resolve('gm-plugkit')), 'plugkit-wasm-wrapper.js');
    } catch (e) {
      emitBootstrapEvent('warn', 'gm-plugkit npm not available, using bundled wrapper', { error: e.message });
      wrapperPath = path.join(path.dirname(wasmPath), 'plugkit-wasm-wrapper.js');
    }

    if (!fs.existsSync(wrapperPath)) {
      throw new Error(`WASM wrapper not found at ${wrapperPath}`);
    }

    const supervisorPath = ensureSupervisorInstalled();
    ensureWrapperInstalled();
    const projectDir = process.cwd();

    const existingSupervisor = findSupervisorPid();
    if (existingSupervisor) {
      emitBootstrapEvent('info', 'Plugkit supervisor already running', { pid: existingSupervisor });
      return existingSupervisor;
    }

    if (!supervisorPath) {
      emitBootstrapEvent('warn', 'falling back to direct watcher spawn (no supervisor)');
      const logFd = openWatcherLog(projectDir);
      const runtime = process.platform === 'win32' ? 'bun.exe' : 'bun';
      const proc = spawn(runtime, [wrapperPath, 'spool'], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        windowsHide: true,
        env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
        ...(process.platform === 'win32' ? { creationFlags: 0x08000000 | 0x00000008 } : {}),
      });
      try { fs.closeSync(logFd); } catch (_) {}
      const pid = proc.pid;
      proc.unref();
      emitBootstrapEvent('info', 'Plugkit watcher spawned (unsupervised)', { pid });
      return pid;
    }

    const logFd = openWatcherLog(projectDir);
    try { fs.writeSync(logFd, `\n--- supervisor spawn ${new Date().toISOString()} parent=${process.pid} ---\n`); } catch (_) {}

    const proc = spawn(process.execPath, [supervisorPath], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
      ...(process.platform === 'win32' ? { creationFlags: 0x08000000 | 0x00000008 } : {}),
    });

    try { fs.closeSync(logFd); } catch (_) {}

    const pid = proc.pid;
    proc.unref();

    emitBootstrapEvent('info', 'Plugkit supervisor spawned', { pid, supervisor: supervisorPath, logPath: path.join(projectDir, '.gm', 'exec-spool', '.watcher.log') });
    return pid;
  } catch (e) {
    emitBootstrapEvent('error', 'Failed to spawn plugkit supervisor', { error: e.message });
    throw e;
  }
}

function ensureNextStepWiring(cwd) {
  const gmDir = path.join(cwd, '.gm');
  try { fs.mkdirSync(gmDir, { recursive: true }); } catch (_) {}

  const nextStepPath = path.join(gmDir, 'next-step.md');
  const nextStepBody = '# Next step\n\nDispatch the `instruction` verb to plugkit by writing `.gm/exec-spool/in/instruction/<N>.txt` (any unique N) with body `{}` (or `{"prompt":"<user request>"}` on the first dispatch of the turn). Read the response from `.gm/exec-spool/out/<N>.json` and follow the imperative in the `instruction` field.\n\nThis file is auto-rewritten by plugkit on every instruction dispatch.\n';
  try {
    if (!fs.existsSync(nextStepPath)) {
      fs.writeFileSync(nextStepPath, nextStepBody);
      emitBootstrapEvent('info', 'Seeded .gm/next-step.md', { path: nextStepPath });
    }
  } catch (e) {
    emitBootstrapEvent('warn', 'Failed to seed .gm/next-step.md', { error: e.message });
  }

  const claudeMdPath = path.join(cwd, 'CLAUDE.md');
  try {
    if (!fs.existsSync(claudeMdPath)) {
      fs.writeFileSync(claudeMdPath, '@AGENTS.md\n');
    } else {
      const cur = fs.readFileSync(claudeMdPath, 'utf8');
      const hasLine = cur.split(/\r?\n/).some(l => l.trim() === '@AGENTS.md');
      if (!hasLine) fs.writeFileSync(claudeMdPath, '@AGENTS.md\n' + cur);
    }
  } catch (_) {}

  const agentsMdPath = path.join(cwd, 'AGENTS.md');
  try {
    if (fs.existsSync(agentsMdPath)) {
      const cur = fs.readFileSync(agentsMdPath, 'utf8');
      const hasLine = cur.split(/\r?\n/).some(l => l.trim() === '@.gm/next-step.md');
      if (!hasLine) {
        const sep = cur.endsWith('\n') ? '' : '\n';
        fs.writeFileSync(agentsMdPath, cur + sep + '\n@.gm/next-step.md\n');
      }
    }
  } catch (_) {}
}

async function bootstrapPlugkit(sessionId, options) {
  const startTime = Date.now();
  const opts = options || {};
  const forceLatest = Boolean(opts.latest);

  try {
    emitBootstrapEvent('info', 'Bootstrap started', { forceLatest });

    writeSessionSidecar(sessionId);
    ensureBuildToolIgnores(process.cwd());
    ensureNextStepWiring(process.cwd());
    ensureSkillMdCurrent();
    ensureWrapperInstalled();

    const manifest = readManifest();
    let targetVersion = manifest.version;
    let expectedHash = manifest.expectedHash;

    if (forceLatest) {
      const latest = await getLatestRemoteVersion();
      if (latest && latest.version) {
        targetVersion = latest.version;
        expectedHash = latest.sha || expectedHash;
        if (latest.version !== manifest.version) {
          emitBootstrapEvent('info', 'forceLatest: using newer remote version', { latest: latest.version, manifest: manifest.version });
        }
      }
    }

    const installedVersion = getInstalledVersion();
    const plugkitPath = getPlugkitPath();

    const manifestVersion = targetVersion;
    const versionMismatch = installedVersion !== targetVersion;
    const binaryMissing = !fs.existsSync(plugkitPath);

    if (!binaryMissing && !versionMismatch) {
      emitBootstrapEvent('info', 'Binary up-to-date', { version: installedVersion });

      if (isProcessRunning()) {
        emitBootstrapEvent('info', 'Plugkit watcher already running');
        const statusPayload = {
          ok: true,
          version: installedVersion,
          status: 'running',
          sessionId: sessionId || null,
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        };
        fs.mkdirSync(path.dirname(BOOTSTRAP_STATUS_FILE), { recursive: true });
        fs.writeFileSync(BOOTSTRAP_STATUS_FILE, JSON.stringify(statusPayload, null, 2));
        return { ok: true, binaryPath: PLUGKIT_WASM_PATH };
      }
    }

    if (binaryMissing || versionMismatch) {
      emitBootstrapEvent('info', 'Downloading binary', {
        reason: binaryMissing ? 'missing' : 'version-mismatch',
        version: manifestVersion,
      });

      let binaryData;
      try {
        binaryData = await downloadPlugkitBinary(manifestVersion);
      } catch (downloadErr) {
        emitBootstrapEvent('error', 'Download failed, checking for cached binary', {
          error: downloadErr.message,
          fallback: fs.existsSync(plugkitPath),
        });

        if (!fs.existsSync(plugkitPath)) {
          throw downloadErr;
        }
        emitBootstrapEvent('info', 'Using cached binary as fallback');
        binaryData = null;
      }

      if (binaryData) {
        const downloadedHash = crypto.createHash('sha256').update(binaryData).digest('hex');
        if (expectedHash && downloadedHash !== expectedHash) {
          throw new Error(`Hash mismatch: got ${downloadedHash}, expected ${expectedHash}`);
        }
        if (!expectedHash) {
          emitBootstrapEvent('warn', 'No expected hash; trusting npm-resolved download', { sha: downloadedHash, version: manifestVersion });
        }

        killExistingPlugkit();
        await writeBinaryWithRetry(plugkitPath, binaryData);

        fs.mkdirSync(path.dirname(PLUGKIT_VERSION_FILE), { recursive: true });
        fs.writeFileSync(PLUGKIT_VERSION_FILE, manifestVersion + '\n');
        emitBootstrapEvent('info', 'Binary installed', { version: manifestVersion });
      }
    }

    const isHealthy = await verifyBinaryHealth(plugkitPath);
    if (!isHealthy) {
      emitBootstrapEvent('warn', 'Binary health check failed, but proceeding');
    }

    const watcherRunning = isProcessRunning();
    let watcherPid;
    if (!watcherRunning) {
      watcherPid = await spawnPlugkitWatcher(PLUGKIT_WASM_PATH);
    } else {
      watcherPid = 'already-running';
      emitBootstrapEvent('info', 'Watcher already running');
    }

    const currentVersion = getInstalledVersion() || manifestVersion;
    const statusPayload = {
      ok: true,
      version: currentVersion,
      watcherPid,
      sessionId: sessionId || null,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    };

    fs.mkdirSync(path.dirname(BOOTSTRAP_STATUS_FILE), { recursive: true });
    fs.writeFileSync(BOOTSTRAP_STATUS_FILE, JSON.stringify(statusPayload, null, 2));

    emitBootstrapEvent('info', 'Bootstrap completed successfully', statusPayload);
    return { ok: true, binaryPath: PLUGKIT_WASM_PATH };
  } catch (err) {
    const errorPayload = {
      ok: false,
      error: err.message,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      stack: err.stack,
    };

    fs.mkdirSync(path.dirname(BOOTSTRAP_ERROR_FILE), { recursive: true });
    fs.writeFileSync(BOOTSTRAP_ERROR_FILE, JSON.stringify(errorPayload, null, 2));

    emitBootstrapEvent('error', 'Bootstrap failed', errorPayload);
    console.error(`[skill-bootstrap] ${err.message}`);

    return { ok: false, error: err.message };
  }
}

async function checkPortReachable(host, port, timeoutMs = 500) {
  const net = require('net');
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch (e) {}
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    try {
      socket.connect(port, host);
    } catch (e) {
      finish(false);
    }
  });
}

async function getSnapshot(sessionId, cwd) {
  try {
    const sid = sessionId || process.env.CLAUDE_SESSION_ID || 'default';
    const c = cwd || process.cwd();
    const result = await spool.execSpool('snapshot', 'snapshot', { sessionId: sid, cwd: c, timeoutMs: 5000 });
    if (result && typeof result === 'object') return result;
    return { git: { ok: false }, tasks: [], error: 'no snapshot result' };
  } catch (e) {
    emitBootstrapEvent('warn', 'Failed to get snapshot', { error: e.message });
    return { git: { ok: false }, tasks: [], error: e.message };
  }
}

module.exports = {
  bootstrapPlugkit,
  getSnapshot,
  checkPortReachable,
  ensureBuildToolIgnores,
  detectBuildToolConfigs,
  ensureSkillMdCurrent,
};
