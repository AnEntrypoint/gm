const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const os = require('os');
const spool = require('./spool.js');

// Resolve a bare command name to its .exe on Windows. cmd.exe + .cmd shim
// chains re-enter conhost (visible window flash) even with windowsHide:true
// on the parent. Spawning the real .exe directly lets CREATE_NO_WINDOW
// propagate cleanly. Falls back to the original name if no .exe is found.
// See [[windows-spawn-cmd-shim-flash]] for the discipline rationale.
function resolveWindowsExe(cmd) {
  if (process.platform !== 'win32') return cmd;
  try {
    const out = execSync(`where ${cmd}`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      timeout: 800,
    });
    const lines = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const exe = lines.find(l => /\.exe$/i.test(l));
    return exe || lines[0] || cmd;
  } catch {
    return cmd;
  }
}

const LOG_DIR = path.join(os.homedir(), '.claude', 'gm-log');
const GM_STATE_DIR = path.join(os.homedir(), '.gm');

function emitDaemonEvent(daemon, severity, message, details) {
  try {
    const date = new Date().toISOString().split('T')[0];
    const logDir = path.join(LOG_DIR, date);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logFile = path.join(logDir, 'daemon.jsonl');
    const entry = {
      ts: new Date().toISOString(),
      daemon,
      severity,
      message,
      ...details,
    };
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error(`[daemon-bootstrap] Failed to emit event: ${e.message}`);
  }
}

function getPlatformKey() {
  const plat = process.platform;
  if (plat === 'win32') return plat;
  if (plat === 'darwin') return plat;
  if (plat === 'linux') return plat;
  throw new Error(`Unsupported platform: ${plat}`);
}

function getSessionId() {
  return process.env.CLAUDE_SESSION_ID || 'unknown';
}

function isDaemonRunning(daemonName) {
  try {
    const plat = getPlatformKey();
    if (plat === 'win32') {
      const output = execSync('tasklist /FO CSV /NH', { encoding: 'utf8' });
      const lines = output.split('\n').filter(Boolean);
      return lines.some(line => {
        const parts = line.split(',').map(p => p.trim().replace(/^"/, '').replace(/"$/, ''));
        return parts[0].includes(daemonName);
      });
    } else {
      try {
        execSync(`pgrep -f "${daemonName}" > /dev/null 2>&1`);
        return true;
      } catch {
        return false;
      }
    }
  } catch (e) {
    return false;
  }
}

function checkPortReachable(host, port, timeoutMs = 500) {
  return spool.execSpool('health', 'health', { timeoutMs, sessionId: getSessionId() })
    .then((r) => !!(r && r.ok))
    .catch(() => false);
}

function computeIndexDigest(cwd = process.cwd()) {
  try {
    let mtimeSum = 0;
    const walkDir = (dir) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
              walkDir(path.join(dir, entry.name));
            }
          } else {
            const fullPath = path.join(dir, entry.name);
            const stat = fs.statSync(fullPath);
            mtimeSum += stat.mtimeMs;
          }
        }
      } catch (e) {
        return;
      }
    };

    walkDir(cwd);

    let gitHead = '';
    try {
      gitHead = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();
    } catch {
      gitHead = 'unknown';
    }

    let dirtyStatus = 'clean';
    try {
      const porcelain = execSync('git status --porcelain', { cwd, encoding: 'utf8' }).trim();
      if (porcelain.length > 0) {
        dirtyStatus = 'dirty';
      }
    } catch {
      dirtyStatus = 'unknown';
    }

    const digestInput = `${mtimeSum}:${gitHead}:${dirtyStatus}`;
    const digest = crypto.createHash('sha256').update(digestInput).digest('hex');
    return `v1:${digest}:files=${mtimeSum}`;
  } catch (e) {
    emitDaemonEvent('digest', 'error', 'Failed to compute digest', { error: e.message });
    return '';
  }
}

function writeStatusFile(daemonName, status, sessionId, childPid) {
  try {
    fs.mkdirSync(GM_STATE_DIR, { recursive: true });
    const statusFile = path.join(GM_STATE_DIR, `${daemonName}-status.json`);
    const payload = {
      daemon: daemonName,
      status,
      sessionId,
      timestamp: new Date().toISOString(),
      pid: Number.isFinite(childPid) ? childPid : process.pid,
      parent_pid: process.pid,
    };
    fs.writeFileSync(statusFile, JSON.stringify(payload, null, 2));
    emitDaemonEvent(daemonName, 'info', 'Status written', { file: statusFile });
  } catch (e) {
    emitDaemonEvent(daemonName, 'warn', 'Failed to write status file', { error: e.message });
  }
}

async function ensureRsLearningDaemonRunning() {
  const daemonName = 'rs-learn';
  const sessionId = getSessionId();
  const startTime = Date.now();

  try {
    emitDaemonEvent(daemonName, 'info', 'Daemon startup check initiated', { sessionId });

    if (isDaemonRunning(daemonName)) {
      emitDaemonEvent(daemonName, 'info', 'Daemon already running', { sessionId });
      writeStatusFile(daemonName, 'running', sessionId);
      return { ok: true, already_running: true };
    }

    emitDaemonEvent(daemonName, 'info', 'Spawning daemon', { sessionId });

    const env = Object.assign({}, process.env, {
      CLAUDE_SESSION_ID: sessionId,
    });

    // CREATE_NO_WINDOW (0x08000000) is inherited by all descendants —
    // .cmd shims that bun-x downloads/launches never get a console window.
    // DETACHED_PROCESS (0x00000008) detaches the process group. Windows-only;
    // Node ignores creationFlags on POSIX.
    const proc = spawn(resolveWindowsExe('bun'), ['x', 'rs-learn@latest'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env,
      creationFlags: 0x08000000 | 0x00000008,
    });

    const pid = proc.pid;
    proc.unref();

    emitDaemonEvent(daemonName, 'info', 'Daemon spawned successfully', { pid, sessionId });
    writeStatusFile(daemonName, 'started', sessionId);

    return {
      ok: true,
      pid,
      sessionId,
      durationMs: Date.now() - startTime,
    };
  } catch (e) {
    emitDaemonEvent(daemonName, 'error', 'Daemon spawn failed', {
      error: e.message,
      sessionId,
      durationMs: Date.now() - startTime,
    });
    writeStatusFile(daemonName, 'error', sessionId);
    throw e;
  }
}

async function ensureAcptoapiRunning() {
  const sessionId = getSessionId();
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const statusPath = path.join(projectDir, '.gm', 'acptoapi-status.json');

  const host = '127.0.0.1';
  const port = 4800;

  try {
    const reachable = await checkPortReachable(host, port);

    if (reachable) {
      emitDaemonEvent('acptoapi', 'info', 'Already running', { port, sessionId });
      writeStatusFile('acptoapi', 'running', sessionId);
      return { ok: true, message: 'acptoapi already running' };
    }

    emitDaemonEvent('acptoapi', 'info', 'Spawning daemon', { port, sessionId });

    const env = Object.assign({}, process.env, {
      CLAUDE_SESSION_ID: sessionId,
    });

    try {
      // CREATE_NO_WINDOW | DETACHED_PROCESS — see ensureRsLearningDaemonRunning
      // above. Inherited by acptoapi's 11 ACP sub-daemons so they don't pop
      // conhost windows when bun-x launches their .cmd shims.
      const child = spawn(resolveWindowsExe('bun'), ['x', 'acptoapi@latest'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env,
        creationFlags: 0x08000000 | 0x00000008,
      });
      child.unref();
      emitDaemonEvent('acptoapi', 'info', 'Daemon spawned', { pid: child.pid, port, sessionId });
      writeStatusFile('acptoapi', 'spawned', sessionId, child.pid);
      return { ok: true, message: 'acptoapi spawned', pid: child.pid };
    } catch (spawnErr) {
      emitDaemonEvent('acptoapi', 'warn', 'Spawn failed, fallback to SDK', {
        error: spawnErr.message,
        sessionId,
      });
      writeStatusFile('acptoapi', 'spawn_failed', sessionId);
      return { ok: false, message: 'acptoapi spawn failed, fallback to Anthropic SDK', error: spawnErr.message };
    }
  } catch (err) {
    emitDaemonEvent('acptoapi', 'error', 'Check failed', {
      error: err.message,
      sessionId,
    });
    writeStatusFile('acptoapi', 'check_error', sessionId);
    return { ok: false, message: 'acptoapi check failed, fallback to Anthropic SDK', error: err.message };
  }
}

async function ensureRsCodeinsightDaemonRunning() {
  const daemonName = 'rs-codeinsight';
  const sessionId = getSessionId();
  const startTime = Date.now();

  try {
    emitDaemonEvent(daemonName, 'info', 'Daemon startup check initiated', { sessionId });

    if (isDaemonRunning(daemonName)) {
      emitDaemonEvent(daemonName, 'info', 'Daemon already running', { sessionId });
      writeStatusFile(daemonName, 'running', sessionId);
      return { ok: true, already_running: true };
    }

    emitDaemonEvent(daemonName, 'info', 'Spawning daemon', { sessionId });

    const env = Object.assign({}, process.env, {
      CLAUDE_SESSION_ID: sessionId,
    });

    const proc = spawn(resolveWindowsExe('bun'), ['x', 'rs-codeinsight@latest'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env,
      creationFlags: 0x08000000 | 0x00000008,
    });

    const pid = proc.pid;
    proc.unref();

    emitDaemonEvent(daemonName, 'info', 'Daemon spawned successfully', { pid, sessionId });
    writeStatusFile(daemonName, 'started', sessionId);

    return { ok: true, pid, sessionId, durationMs: Date.now() - startTime };
  } catch (e) {
    emitDaemonEvent(daemonName, 'error', 'Daemon spawn failed', {
      error: e.message,
      sessionId,
      durationMs: Date.now() - startTime,
    });
    writeStatusFile(daemonName, 'error', sessionId);
    throw e;
  }
}

async function ensureRsSearchDaemonRunning() {
  const daemonName = 'rs-search';
  const sessionId = getSessionId();
  const startTime = Date.now();

  try {
    emitDaemonEvent(daemonName, 'info', 'Daemon startup check initiated', { sessionId });

    if (isDaemonRunning(daemonName)) {
      emitDaemonEvent(daemonName, 'info', 'Daemon already running', { sessionId });
      writeStatusFile(daemonName, 'running', sessionId);
      return { ok: true, already_running: true };
    }

    emitDaemonEvent(daemonName, 'info', 'Spawning daemon', { sessionId });

    const env = Object.assign({}, process.env, {
      CLAUDE_SESSION_ID: sessionId,
    });

    const proc = spawn(resolveWindowsExe('bun'), ['x', 'rs-search@latest'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env,
      creationFlags: 0x08000000 | 0x00000008,
    });

    const pid = proc.pid;
    proc.unref();

    emitDaemonEvent(daemonName, 'info', 'Daemon spawned successfully', { pid, sessionId });
    writeStatusFile(daemonName, 'started', sessionId);

    return { ok: true, pid, sessionId, durationMs: Date.now() - startTime };
  } catch (e) {
    emitDaemonEvent(daemonName, 'error', 'Daemon spawn failed', {
      error: e.message,
      sessionId,
      durationMs: Date.now() - startTime,
    });
    writeStatusFile(daemonName, 'error', sessionId);
    throw e;
  }
}

async function ensureRsCodeinsightReady(sessionId = getSessionId()) {
  const startTime = Date.now();
  const daemonName = 'rs-codeinsight';
  const host = '127.0.0.1';
  const port = 4802;

  try {
    emitDaemonEvent(daemonName, 'info', 'Ensuring daemon readiness', { sessionId, host, port });

    await ensureRsCodeinsightDaemonRunning();

    const maxWaitMs = 30000;
    const pollIntervalMs = 500;
    const deadline = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {
      const reachable = await checkPortReachable(host, port, 1000);
      if (reachable) {
        emitDaemonEvent(daemonName, 'info', 'Daemon ready', {
          host,
          port,
          elapsedMs: Date.now() - startTime,
          sessionId,
        });
        writeStatusFile(daemonName, 'ready', sessionId);
        return { ok: true, host, port, sessionId, durationMs: Date.now() - startTime };
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    emitDaemonEvent(daemonName, 'warn', 'Timeout waiting for readiness', {
      host,
      port,
      maxWaitMs,
      sessionId,
      elapsedMs: Date.now() - startTime,
    });
    writeStatusFile(daemonName, 'timeout', sessionId);
    return { ok: false, error: 'Timeout waiting for codeinsight daemon', durationMs: Date.now() - startTime };
  } catch (e) {
    emitDaemonEvent(daemonName, 'error', 'Failed to ensure readiness', {
      error: e.message,
      sessionId,
      durationMs: Date.now() - startTime,
    });
    writeStatusFile(daemonName, 'error', sessionId);
    return { ok: false, error: e.message, durationMs: Date.now() - startTime };
  }
}

async function ensureBrowserReady(sessionId = getSessionId()) {
  const startTime = Date.now();
  const host = '127.0.0.1';
  const port = 5000;

  try {
    emitDaemonEvent('browser', 'info', 'Checking browser readiness', { sessionId, host, port });

    const maxWaitMs = 10000;
    const pollIntervalMs = 250;
    const deadline = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {
      const reachable = await checkPortReachable(host, port, 1000);
      if (reachable) {
        emitDaemonEvent('browser', 'info', 'Browser ready', {
          host,
          port,
          elapsedMs: Date.now() - startTime,
          sessionId,
        });
        return { ok: true, host, port, sessionId, durationMs: Date.now() - startTime };
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    emitDaemonEvent('browser', 'warn', 'Browser not available', {
      host,
      port,
      maxWaitMs,
      sessionId,
    });
    return { ok: false, error: 'Browser API not available at 127.0.0.1:5000', durationMs: Date.now() - startTime };
  } catch (e) {
    emitDaemonEvent('browser', 'error', 'Failed to check browser', {
      error: e.message,
      sessionId,
    });
    return { ok: false, error: e.message, durationMs: Date.now() - startTime };
  }
}

module.exports = {
  ensureAcptoapiRunning,
  ensureRsCodeinsightDaemonRunning,
  ensureRsCodeinsightReady,
  ensureRsSearchDaemonRunning,
  ensureRsLearningDaemonRunning,
  ensureBrowserReady,
  checkPortReachable,
};
