const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync, execFileSync, spawn } = require('child_process');
const crypto = require('crypto');
const os = require('os');
const spool = require('./spool.js');

const PLUGKIT_TOOLS_DIR = path.join(os.homedir(), '.claude', 'gm-tools');
const PLUGKIT_VERSION_FILE = path.join(PLUGKIT_TOOLS_DIR, 'plugkit.version');
const PLUGKIT_WASM_PATH = path.join(PLUGKIT_TOOLS_DIR, 'plugkit.wasm');
const PLUGKIT_WASM_WRAPPER = path.join(PLUGKIT_TOOLS_DIR, 'plugkit-wasm-wrapper.js');
const BOOTSTRAP_STATUS_FILE = path.join(os.homedir(), '.gm', 'bootstrap-status.json');
const BOOTSTRAP_ERROR_FILE = path.join(os.homedir(), '.gm', 'bootstrap-error.json');
const LOG_DIR = path.join(os.homedir(), '.claude', 'gm-log');

function getPlugkitPath() {
  if (fs.existsSync(PLUGKIT_WASM_WRAPPER) && fs.existsSync(PLUGKIT_WASM_PATH)) {
    return PLUGKIT_WASM_WRAPPER;
  }
  throw new Error(`plugkit WASM not found at ${PLUGKIT_WASM_PATH}`);
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
    const buf = await httpGet('https://api.github.com/repos/AnEntrypoint/plugkit-bin/releases/latest', 3000);
    const rel = JSON.parse(buf.toString('utf-8'));
    const tag = rel && rel.tag_name;
    if (tag) {
      version = tag.replace(/^v/, '');
      source = 'github-releases';
    }
  } catch (e) {
    emitBootstrapEvent('warn', 'GitHub Releases lookup failed', { error: e.message });
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
      emitBootstrapEvent('warn', 'npm fallback lookup failed', { error: e.message });
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

function gitignorePath(cwd) { return path.join(cwd, '.gitignore'); }

function getManagedGitignoreEntries() {
  return [
    '.gm/exec-spool/',
    '.gm/gm-fired-*',
    '.gm/needs-gm',
    '.gm/lastskill',
    '.gm/turn-state.json',
    '.gm/turn-state.json.corrupted-*',
    '.gm/residual-check-fired',
    '.gm/bootstrap-status.json',
    '.gm/bootstrap-error.json',
    '.gm/rslearn-counter.json',
    '.gm/trajectory-drafts/',
    '.gm/ingest-drafts/',
    '.gm/prd-state.json',
    '.gm/subagent-*.json',
    '.plugkit-browser-profile/',
    '.plugkit-browser-profile-*/',
  ];
}

function getMustStayTracked() {
  return [
    '.gm/rs-learn.db',
    '.gm/code-search/',
    '.gm/disciplines/',
    '.gm/prd.yml',
    '.gm/mutables.yml',
    'gm-data/rs-learn.db',
    'gm-data/code-search/',
    'gm-data/disciplines/',
  ];
}

function ensureManagedGitignore(cwd) {
  try {
    const gi = gitignorePath(cwd);
    let content = '';
    try { content = fs.readFileSync(gi, 'utf-8'); } catch (_) {}
    const START = '# >>> plugkit managed';
    const END = '# <<< plugkit managed';
    const entries = getManagedGitignoreEntries();
    const block = [START, ...entries, END].join('\n');
    const startIdx = content.indexOf(START);
    const endIdx = content.indexOf(END);
    let cleaned;
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const before = content.slice(0, startIdx).replace(/\n+$/, '');
      const after = content.slice(endIdx + END.length).replace(/^\n+/, '');
      cleaned = [before, block, after].filter(Boolean).join('\n');
    } else {
      cleaned = content.replace(/\n+$/, '');
      cleaned = cleaned ? `${cleaned}\n\n${block}` : block;
    }
    if (!cleaned.endsWith('\n')) cleaned += '\n';
    if (cleaned !== content) {
      fs.writeFileSync(gi, cleaned);
      emitBootstrapEvent('info', 'Managed .gitignore block updated', { path: gi, entries: entries.length });
    }
    const mustTrack = getMustStayTracked();
    const lines = cleaned.split(/\r?\n/);
    const inManaged = (idx) => {
      let inside = false;
      for (let i = 0; i <= idx; i++) {
        if (lines[i] === START) inside = true;
        else if (lines[i] === END) inside = false;
      }
      return inside;
    };
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t || t.startsWith('#')) continue;
      if (inManaged(i)) continue;
      if (mustTrack.includes(t)) {
        emitBootstrapEvent('warn', 'Hostile .gitignore entry — must stay tracked', { entry: t, line: i + 1 });
      }
    }
  } catch (e) {
    emitBootstrapEvent('warn', 'ensureManagedGitignore failed', { error: e.message });
  }
}

async function downloadPlugkitBinary(version) {
  const binaryName = 'plugkit.wasm';
  const url = `https://github.com/AnEntrypoint/plugkit-bin/releases/download/v${version}/${binaryName}`;

  emitBootstrapEvent('info', 'Starting WASM download', { version, url });

  return new Promise((resolve, reject) => {
    https
      .get(url, { timeout: 30000 }, (res) => {
        if (res.statusCode === 404) {
          reject(new Error(`WASM not found: v${version}`));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} downloading plugkit.wasm`));
          return;
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const data = Buffer.concat(chunks);
          emitBootstrapEvent('info', 'WASM download complete', { bytes: data.length });
          resolve(data);
        });
      })
      .on('error', (e) => {
        emitBootstrapEvent('error', 'Download failed', { error: e.message });
        reject(e);
      });
  });
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
  return findPlugkitWasmPids().length > 0;
}

function killExistingPlugkit() {
  try {
    const pids = findPlugkitWasmPids();
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

async function spawnPlugkitWatcher(wasmPath) {
  try {
    emitBootstrapEvent('info', 'Spawning plugkit WASM watcher daemon');

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

    const projectDir = process.cwd();
    const logFd = openWatcherLog(projectDir);

    const runtime = process.platform === 'win32' ? 'bun.exe' : 'bun';
    const proc = spawn(runtime, [wrapperPath, 'spool'], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    });

    try { fs.closeSync(logFd); } catch (_) {}

    const pid = proc.pid;
    proc.unref();

    emitBootstrapEvent('info', 'Plugkit WASM watcher spawned', { pid, logPath: path.join(projectDir, '.gm', 'exec-spool', '.watcher.log') });
    return pid;
  } catch (e) {
    emitBootstrapEvent('error', 'Failed to spawn plugkit WASM watcher', { error: e.message });
    throw e;
  }
}

async function bootstrapPlugkit(sessionId, options) {
  const startTime = Date.now();
  const opts = options || {};
  const forceLatest = Boolean(opts.latest);

  try {
    emitBootstrapEvent('info', 'Bootstrap started', { forceLatest });

    ensureManagedGitignore(process.cwd());

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

async function bootstrapAcptoapi() {
  const port = 4800;
  const running = await checkPortReachable('127.0.0.1', port);
  if (running) return { ok: true, status: 'already-running' };

  emitBootstrapEvent('info', 'Spawning acptoapi daemon');
  try {
    const child = spawn('bun', ['x', 'acptoapi@latest'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    emitBootstrapEvent('info', 'acptoapi spawned', { pid: child.pid });
    return { ok: true, status: 'spawned', pid: child.pid };
  } catch (e) {
    emitBootstrapEvent('error', 'Failed to spawn acptoapi', { error: e.message });
    return { ok: false, error: e.message };
  }
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
  bootstrapAcptoapi,
  getSnapshot,
  checkPortReachable
};
