#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');

function wrapperSha12OnDisk() {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(resolveWrapper())).digest('hex').slice(0, 12);
  } catch (_) { return null; }
}

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const spoolDir = path.join(projectDir, '.gm', 'exec-spool');
fs.mkdirSync(spoolDir, { recursive: true });

const STATUS_PATH = path.join(spoolDir, '.status.json');
const SHUTDOWN_REASON_PATH = path.join(spoolDir, '.shutdown-reason.json');
const SUPERVISOR_STATUS_PATH = path.join(spoolDir, '.supervisor-status.json');
const SUPERVISOR_PID_PATH = path.join(spoolDir, '.supervisor.pid');
const LOG_PATH = path.join(spoolDir, '.watcher.log');
const GM_LOG_ROOT = process.env.GM_LOG_DIR || path.join(os.homedir(), '.claude', 'gm-log');

const HEARTBEAT_STALE_MS = 60_000;
const HEALTH_POLL_MS = 5_000;
const SUPERVISOR_HEARTBEAT_MS = 5_000;
const SIGTERM_GRACE_MS = 5_000;
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_CAP_MS = 30_000;

function logEvent(event, fields) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.join(GM_LOG_ROOT, day);
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      sub: 'plugkit',
      event,
      pid: process.pid,
      sess: process.env.CLAUDE_SESSION_ID || '',
      cwd: projectDir,
      role: 'supervisor',
      ...fields,
    }) + '\n';
    fs.appendFileSync(path.join(dir, 'plugkit.jsonl'), line);
  } catch (_) {}
}

function writeSupervisorStatus(state, extra) {
  try {
    fs.writeFileSync(SUPERVISOR_STATUS_PATH, JSON.stringify({
      pid: process.pid,
      ts: Date.now(),
      iso: new Date().toISOString(),
      state,
      watcher_pid: currentChildPid,
      ...(extra || {}),
    }));
  } catch (_) {}
}

function writeShutdownReason(reason, extra) {
  try {
    fs.writeFileSync(SHUTDOWN_REASON_PATH, JSON.stringify({
      ts: new Date().toISOString(),
      reason,
      written_by: 'supervisor',
      supervisor_pid: process.pid,
      watcher_pid: currentChildPid,
      ...(extra || {}),
    }));
  } catch (_) {}
}

function pidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

function readStatus() {
  try { return JSON.parse(fs.readFileSync(STATUS_PATH, 'utf-8')); } catch (_) { return null; }
}

function statusMtime() {
  try { return fs.statSync(STATUS_PATH).mtimeMs; } catch (_) { return 0; }
}

function acquireSingleInstance() {
  // Atomic via O_EXCL ('wx'): exclusive-create fails if the file exists, so when N supervisors
  // race to start in the same instant exactly one wins. A plain existsSync->write is TOCTOU and
  // lets a concurrent burst all pass, which is the duplicate-supervisor churn this guards against.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(SUPERVISOR_PID_PATH, 'wx');
      try { fs.writeSync(fd, String(process.pid)); } finally { fs.closeSync(fd); }
      return true;
    } catch (e) {
      if (e && e.code === 'EEXIST') {
        let other = NaN;
        try { other = parseInt(fs.readFileSync(SUPERVISOR_PID_PATH, 'utf-8').trim(), 10); } catch (_) {}
        if (Number.isFinite(other) && other !== process.pid && pidAlive(other)) {
          logEvent('supervisor.refused-duplicate', { existing_pid: other, severity: 'warn' });
          process.stderr.write(`[plugkit-supervisor] another supervisor is alive (pid=${other}); exiting\n`);
          return false;
        }
        try { fs.unlinkSync(SUPERVISOR_PID_PATH); } catch (_) {}
        continue;
      }
      logEvent('supervisor.pid-write-failed', { error: e && e.message, severity: 'warn' });
      return true;
    }
  }
  return true;
}

function releaseSingleInstance() {
  try {
    if (fs.existsSync(SUPERVISOR_PID_PATH)) {
      const raw = fs.readFileSync(SUPERVISOR_PID_PATH, 'utf-8').trim();
      if (parseInt(raw, 10) === process.pid) fs.unlinkSync(SUPERVISOR_PID_PATH);
    }
  } catch (_) {}
}

let currentChildPid = null;
let currentChild = null;
let restartCount = 0;
let lastSpawnedAt = 0;
let shuttingDown = false;
let killingForHeartbeat = false;

function nextBackoffMs() {
  const ms = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * Math.pow(2, restartCount));
  return ms;
}

function resolveWrapper() {
  const primary = path.join(os.homedir(), '.gm-tools', 'plugkit-wasm-wrapper.js');
  const fallback = path.join(os.homedir(), '.claude', 'gm-tools', 'plugkit-wasm-wrapper.js');
  if (fs.existsSync(primary)) return primary;
  if (fs.existsSync(fallback)) return fallback;
  return primary;
}

function resolveRuntime() {
  const preferred = process.env.PLUGKIT_RUNTIME || 'bun';
  try {
    const r = spawnSync(preferred, ['--version'], { stdio: 'ignore', windowsHide: true, timeout: 1500 });
    if (r.status === 0) return preferred;
  } catch (_) {}
  return process.execPath;
}

function spawnWatcher(bootReason) {
  if (shuttingDown) return;
  const wrapper = resolveWrapper();
  if (!fs.existsSync(wrapper)) {
    logEvent('supervisor.wrapper-missing', { wrapper, severity: 'critical' });
    writeSupervisorStatus('error', { error: 'wrapper-missing', wrapper });
    setTimeout(() => spawnWatcher(bootReason), Math.min(BACKOFF_CAP_MS, nextBackoffMs()));
    restartCount += 1;
    return;
  }
  const runtime = resolveRuntime();
  let logFd = null;
  try { logFd = fs.openSync(LOG_PATH, 'a'); } catch (_) {}
  try {
    if (logFd !== null) fs.writeSync(logFd, `\n--- watcher spawn ${new Date().toISOString()} supervisor=${process.pid} reason=${bootReason} ---\n`);
  } catch (_) {}

  const child = spawn(runtime, [wrapper, 'spool'], {
    detached: false,
    stdio: ['ignore', logFd || 'ignore', logFd || 'ignore'],
    windowsHide: true,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: projectDir,
      PLUGKIT_BOOT_REASON: bootReason,
      PLUGKIT_SUPERVISOR_PID: String(process.pid),
    },
    ...(process.platform === 'win32' ? { creationFlags: 0x08000000 | 0x00000008 } : {}),
  });

  try { if (logFd !== null) fs.closeSync(logFd); } catch (_) {}
  currentChild = child;
  currentChildPid = child.pid;
  lastSpawnedAt = Date.now();
  writeSupervisorStatus('watching', { boot_reason: bootReason, runtime });
  logEvent('supervisor.spawned-watcher', { watcher_pid: child.pid, boot_reason: bootReason, runtime });

  child.on('exit', (code, signal) => {
    const wasKilled = killingForHeartbeat;
    killingForHeartbeat = false;
    const exitedPid = currentChildPid;
    currentChild = null;
    currentChildPid = null;
    if (shuttingDown) return;
    const uptimeMs = Date.now() - lastSpawnedAt;
    const respawnReason = wasKilled ? 'supervisor-killed-stale-heartbeat' : (signal ? `signal-${signal}` : `exit-${code}`);
    logEvent('supervisor.watcher-exited', {
      watcher_pid: exitedPid,
      exit_code: code,
      signal,
      uptime_ms: uptimeMs,
      respawn_reason: respawnReason,
      severity: code === 0 && !signal && !wasKilled ? 'info' : 'critical',
    });
    if (code === 0 && !signal && !wasKilled) {
      restartCount = 0;
    } else {
      restartCount += 1;
    }
    const delay = nextBackoffMs();
    writeSupervisorStatus('restarting', { prior_watcher_pid: exitedPid, prior_exit_code: code, prior_signal: signal, respawn_reason: respawnReason, backoff_ms: delay });
    setTimeout(() => spawnWatcher(respawnReason), delay);
  });

  child.on('error', (err) => {
    logEvent('supervisor.spawn-error', { error: err.message, severity: 'critical' });
  });
}

function killChild(reason) {
  if (!currentChildPid || !pidAlive(currentChildPid)) return;
  killingForHeartbeat = true;
  writeShutdownReason(reason, { uptime_ms: Date.now() - lastSpawnedAt });
  try { process.kill(currentChildPid, 'SIGTERM'); } catch (_) {}
  const pidAtKill = currentChildPid;
  setTimeout(() => {
    if (pidAtKill && pidAlive(pidAtKill)) {
      logEvent('supervisor.sigkill-after-grace', { watcher_pid: pidAtKill, grace_ms: SIGTERM_GRACE_MS, severity: 'warn' });
      if (process.platform === 'win32') {
        try { spawnSync('taskkill', ['/F', '/T', '/PID', String(pidAtKill)], { stdio: 'ignore', windowsHide: true, timeout: 3000 }); } catch (_) {}
      } else {
        try { process.kill(pidAtKill, 'SIGKILL'); } catch (_) {}
      }
    }
  }, SIGTERM_GRACE_MS);
}

function checkWatcherHealth() {
  if (shuttingDown) return;
  if (!currentChildPid) return;
  if (!pidAlive(currentChildPid)) return;
  const mtime = statusMtime();
  if (mtime === 0) {
    const age = Date.now() - lastSpawnedAt;
    if (age > HEARTBEAT_STALE_MS) {
      logEvent('supervisor.no-heartbeat-file', { watcher_pid: currentChildPid, age_since_spawn_ms: age, severity: 'critical' });
      killChild('supervisor-killed-no-heartbeat');
    }
    return;
  }
  const age = Date.now() - mtime;
  if (age > HEARTBEAT_STALE_MS) {
    logEvent('supervisor.heartbeat-stale', {
      watcher_pid: currentChildPid,
      status_age_ms: age,
      stale_limit_ms: HEARTBEAT_STALE_MS,
      severity: 'critical',
    });
    killChild('supervisor-killed-stale-heartbeat');
    return;
  }
  // A published wrapper-only fix (no wasm version bump) is copied to ~/.gm-tools by the next
  // bootstrap's ensureWrapperFresh, but a healthy running watcher keeps the old wrapper until it
  // restarts. Compare the watcher's reported wrapper_sha against the on-disk wrapper; on drift,
  // recycle so the fix goes live without a manual kill. Skip while busy (a long verb is running).
  const status = readStatus();
  if (status && !(status.busy_until && status.busy_until > Date.now())) {
    const reported = status.wrapper_sha || null;
    const onDisk = wrapperSha12OnDisk();
    if (reported && onDisk && reported !== onDisk) {
      logEvent('supervisor.wrapper-sha-drift', {
        watcher_pid: currentChildPid,
        reported_sha: reported,
        on_disk_sha: onDisk,
        severity: 'info',
      });
      killChild('supervisor-killed-wrapper-sha-drift');
      return;
    }
    // The watcher reads the wasm's embedded instance_version at load and compares it to the
    // plugkit.version text file (file_version), exposing version_drifted when they disagree.
    // This catches a bumped version text sitting next to a stale wasm build (text claims 635
    // while the binary embeds 634), which ensureReady's text-only drift check never re-downloads.
    // Evict the stale cached wasm so the next bootstrap fails isReady() and redownloads, then recycle.
    if (status.version_drifted === true) {
      logEvent('supervisor.version-drift', {
        watcher_pid: currentChildPid,
        instance_version: status.instance_version || null,
        file_version: status.file_version || null,
        severity: 'critical',
      });
      try {
        const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
        const gmTools = fs.existsSync(path.join(home, '.gm-tools'))
          ? path.join(home, '.gm-tools')
          : path.join(home, '.claude', 'gm-tools');
        for (const f of ['plugkit.wasm', 'plugkit.version', 'plugkit.wasm.sha256']) {
          try { fs.unlinkSync(path.join(gmTools, f)); } catch (_) {}
        }
      } catch (_) {}
      killChild('supervisor-killed-version-drift');
    }
  }
}

function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  logEvent('supervisor.shutdown', { reason });
  writeSupervisorStatus('shutdown', { reason });
  if (currentChildPid && pidAlive(currentChildPid)) {
    writeShutdownReason('supervisor-graceful-shutdown', { trigger: reason, uptime_ms: Date.now() - lastSpawnedAt });
    try { process.kill(currentChildPid, 'SIGTERM'); } catch (_) {}
    const pidAtKill = currentChildPid;
    const start = Date.now();
    const waitInterval = setInterval(() => {
      if (!pidAlive(pidAtKill)) {
        clearInterval(waitInterval);
        releaseSingleInstance();
        process.exit(0);
      } else if (Date.now() - start > SIGTERM_GRACE_MS) {
        clearInterval(waitInterval);
        if (process.platform === 'win32') {
          try { spawnSync('taskkill', ['/F', '/T', '/PID', String(pidAtKill)], { stdio: 'ignore', windowsHide: true, timeout: 3000 }); } catch (_) {}
        } else {
          try { process.kill(pidAtKill, 'SIGKILL'); } catch (_) {}
        }
        releaseSingleInstance();
        process.exit(0);
      }
    }, 200);
  } else {
    releaseSingleInstance();
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('sigint'));
process.on('SIGTERM', () => shutdown('sigterm'));
process.on('uncaughtException', (err) => {
  logEvent('supervisor.uncaught', { error: err.message, stack: err.stack, severity: 'critical' });
  shutdown('uncaught-exception');
});

if (!acquireSingleInstance()) {
  process.exit(0);
}

writeSupervisorStatus('starting', {});
logEvent('supervisor.starting', { spool_dir: spoolDir, heartbeat_stale_ms: HEARTBEAT_STALE_MS });
spawnWatcher('initial');
setInterval(checkWatcherHealth, HEALTH_POLL_MS);
setInterval(() => writeSupervisorStatus('watching', {}), SUPERVISOR_HEARTBEAT_MS);
