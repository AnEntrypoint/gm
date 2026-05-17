const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync, spawn } = require('child_process');
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

function readManifest() {
  try {
    const gmJsonPath = path.join(process.cwd(), 'gm-starter', 'gm.json');
    if (!fs.existsSync(gmJsonPath)) {
      throw new Error('gm-starter/gm.json not found');
    }
    const gm = JSON.parse(fs.readFileSync(gmJsonPath, 'utf8'));
    const version = gm.plugkitVersion;

    const sha256Path = path.join(process.cwd(), 'gm-starter', 'bin', 'plugkit.wasm.sha256');
    if (!fs.existsSync(sha256Path)) {
      throw new Error('gm-starter/bin/plugkit.wasm.sha256 not found');
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
      const output = execSync('wmic process where "Name=\'bun.exe\' or Name=\'node.exe\'" get ProcessId,CommandLine /FORMAT:CSV', { encoding: 'utf8' });
      const lines = output.split('\n').filter(Boolean);
      for (const line of lines) {
        if (!line.includes('plugkit-wasm-wrapper.js')) continue;
        const parts = line.split(',');
        const pid = parts[parts.length - 1].trim();
        if (/^\d+$/.test(pid)) pids.push(pid);
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

    const runtime = process.platform === 'win32' ? 'bun.exe' : 'bun';
    const proc = spawn(runtime, [wrapperPath, 'spool'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, CLAUDE_PROJECT_DIR: process.cwd() },
    });

    const pid = proc.pid;
    proc.unref();

    emitBootstrapEvent('info', 'Plugkit WASM watcher spawned', { pid });
    return pid;
  } catch (e) {
    emitBootstrapEvent('error', 'Failed to spawn plugkit WASM watcher', { error: e.message });
    throw e;
  }
}

async function bootstrapPlugkit(sessionId) {
  const startTime = Date.now();

  try {
    emitBootstrapEvent('info', 'Bootstrap started');

    const { version: manifestVersion, expectedHash } = readManifest();
    const installedVersion = getInstalledVersion();
    const plugkitPath = getPlugkitPath();

    const versionMismatch = installedVersion !== manifestVersion;
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
        if (downloadedHash !== expectedHash) {
          throw new Error(`Hash mismatch: got ${downloadedHash}, expected ${expectedHash}`);
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
  try {
    const result = await spool.execSpool('health', 'health', { timeoutMs, sessionId: process.env.CLAUDE_SESSION_ID || 'unknown' });
    return !!(result && result.ok);
  } catch (e) {
    return false;
  }
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
