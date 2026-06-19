#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

function wrapperSha12OnDisk() {
  try {
    const primary = path.join(os.homedir(), '.gm-tools', 'plugkit-wasm-wrapper.js');
    const fallback = path.join(os.homedir(), '.claude', 'gm-tools', 'plugkit-wasm-wrapper.js');
    const wp = fs.existsSync(primary) ? primary : fallback;
    return crypto.createHash('sha256').update(fs.readFileSync(wp)).digest('hex').slice(0, 12);
  } catch (_) { return null; }
}

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const spoolDir = path.join(projectDir, '.gm', 'exec-spool');
fs.mkdirSync(spoolDir, { recursive: true });

const STATUS_PATH = path.join(spoolDir, '.status.json');
const SHUTDOWN_REASON_PATH = path.join(spoolDir, '.shutdown-reason.json');
const SUPERVISOR_PATH = path.join(spoolDir, '.supervisor.json');
const SUPERVISOR_PID_PATH = path.join(spoolDir, '.supervisor.pid');
const LOG_PATH = path.join(spoolDir, '.watcher.log');
const GM_LOG_ROOT = process.env.GM_LOG_DIR || path.join(os.homedir(), '.claude', 'gm-log');

const POLL_INTERVAL_MS = 10_000;
const STATUS_STALE_MS = 30_000;
const MAX_RESTART_BURST = 5;
const RESTART_WINDOW_MS = 60_000;
const BURST_BACKOFF_MS = 60_000;
const VERSION_DRIFT_COOLDOWN_MS = 60_000;

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
      cwd: process.cwd(),
      role: 'supervisor',
      ...fields,
    }) + '\n';
    fs.appendFileSync(path.join(dir, 'plugkit.jsonl'), line);
  } catch (e) { try { console.error('[supervisor] logEvent write failed:', e); } catch (_) {} }
}

function writeSupervisorStatus(state, extra) {
  try {
    fs.writeFileSync(SUPERVISOR_PATH, JSON.stringify({
      pid: process.pid,
      ts: Date.now(),
      state,
      ...(extra || {}),
    }));
  } catch (_) {}
}

function pidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

function acquireSingleInstance() {
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
          const TAKEOVER_STALE_MS = 45_000;
          const now = Date.now();
          let supTs = 0;
          try { supTs = (JSON.parse(fs.readFileSync(SUPERVISOR_PATH, 'utf-8')).ts) || 0; } catch (_) {}
          const spool = readStatus();
          const spoolBusy = spool && spool.busy_until && spool.busy_until > now;
          const spoolTs = (spool && spool.ts) || 0;
          const holderWedged = !spoolBusy
            && (now - supTs) > TAKEOVER_STALE_MS
            && (now - spoolTs) > TAKEOVER_STALE_MS;
          if (!holderWedged) {
            logEvent('supervisor.refused-duplicate', { existing_pid: other, severity: 'warn' });
            return false;
          }
          logEvent('supervisor.takeover-wedged', {
            existing_pid: other,
            supervisor_status_age_ms: now - supTs,
            spool_status_age_ms: now - spoolTs,
            severity: 'critical',
          });
          try { process.kill(other, 'SIGTERM'); } catch (_) {}
          if (process.platform === 'win32') {
            try { spawnSync('taskkill', ['/F', '/T', '/PID', String(other)], { stdio: 'ignore', windowsHide: true, timeout: 3000 }); } catch (_) {}
          }
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

function readStatus() {
  try { return JSON.parse(fs.readFileSync(STATUS_PATH, 'utf-8')); } catch (_) { return null; }
}

function readShutdownReason() {
  try { return JSON.parse(fs.readFileSync(SHUTDOWN_REASON_PATH, 'utf-8')); } catch (_) { return null; }
}

let lastSpawnedAt = 0;
let lastVersionDriftActionAt = 0;
let restartTimestamps = [];
let currentChildPid = null;
let currentBootReason = 'initial';

function spawnWatcher(bootReason) {
  lastSpawnedAt = Date.now();
  restartTimestamps.push(Date.now());
  restartTimestamps = restartTimestamps.filter(t => Date.now() - t < RESTART_WINDOW_MS);
  if (restartTimestamps.length > MAX_RESTART_BURST) {
    logEvent('supervisor.restart-burst-backoff', {
      reason: 'restart-burst-exceeded',
      restarts_in_window: restartTimestamps.length,
      window_ms: RESTART_WINDOW_MS,
      max: MAX_RESTART_BURST,
      backoff_ms: BURST_BACKOFF_MS,
      severity: 'warn',
    });
    writeSupervisorStatus('backoff', { reason: 'restart-burst-exceeded', backoff_ms: BURST_BACKOFF_MS });
    restartTimestamps = [];
    setTimeout(() => spawnWatcher('post-burst-backoff'), BURST_BACKOFF_MS);
    return;
  }

  const primaryWrapper = path.join(os.homedir(), '.gm-tools', 'plugkit-wasm-wrapper.js');
  const fallbackWrapper = path.join(os.homedir(), '.claude', 'gm-tools', 'plugkit-wasm-wrapper.js');
  const wrapper = fs.existsSync(primaryWrapper) ? primaryWrapper : fallbackWrapper;
  if (!fs.existsSync(wrapper)) {
    logEvent('supervisor.wrapper-missing', { wrapper, severity: 'critical' });
    writeSupervisorStatus('error', { error: 'wrapper-missing' });
    process.exit(3);
  }

  const isNodeExe = (p) => /(^|[\\/])node(\.exe)?$/i.test(String(p || ''));
  const resolveNode = () => {
    const candidates = [];
    if (isNodeExe(process.env.PLUGKIT_RUNTIME)) candidates.push(process.env.PLUGKIT_RUNTIME);
    if (isNodeExe(process.execPath)) candidates.push(process.execPath);
    if (process.env.GM_NODE_PATH) candidates.push(process.env.GM_NODE_PATH);
    try {
      const which = process.platform === 'win32' ? 'where' : 'which';
      const out = spawnSync(which, ['node'], { encoding: 'utf8', windowsHide: true });
      if (out && out.stdout) {
        const first = out.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
        if (first) candidates.push(first);
      }
    } catch (_) {}
    for (const c of candidates) {
      try { const r = spawnSync(c, ['--version'], { stdio: 'ignore', windowsHide: true }); if (r && r.status === 0) return c; } catch (_) {}
    }
    return process.execPath;
  };
  let cmd = resolveNode();
  let args = [wrapper, 'spool'];

  let logFd = null;
  try { logFd = fs.openSync(LOG_PATH, 'a'); } catch (_) {}
  try {
    if (logFd !== null) fs.writeSync(logFd, `\n--- watcher spawn ${new Date().toISOString()} supervisor=${process.pid} reason=${bootReason} ---\n`);
  } catch (_) {}

  const child = spawn(cmd, args, {
    detached: false,
    stdio: ['ignore', logFd || 'ignore', logFd || 'ignore'],
    windowsHide: true,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: projectDir,
      PLUGKIT_BOOT_REASON: bootReason,
      PLUGKIT_SUPERVISOR_PID: String(process.pid),
    },
  });

  try { if (logFd !== null) fs.closeSync(logFd); } catch (_) {}
  currentChildPid = child.pid;
  currentBootReason = bootReason;
  writeSupervisorStatus('watching', { watcher_pid: child.pid, boot_reason: bootReason });
  logEvent('supervisor.spawned-watcher', { watcher_pid: child.pid, boot_reason: bootReason, runtime: cmd });

  child.on('exit', (code, signal) => {
    const shutdownReason = readShutdownReason();
    const reason = shutdownReason && shutdownReason.reason;
    const idleClean = reason === 'idle';
    const lockRejected = code === 75;
    const cleanExit = code === 0;
    const plannedReasons = new Set(['idle', 'sigterm', 'version-change', 'wrapper-change', 'peer-stale-takeover', 'external-planned', 'process-exit']);
    const isPlanned = plannedReasons.has(reason) || lockRejected || cleanExit;
    const eventName = idleClean
      ? 'supervisor.watcher-exited-idle'
      : reason === 'version-change'
        ? 'supervisor.watcher-exited-for-update'
        : lockRejected
          ? 'supervisor.watcher-exited-lock-rejected'
          : cleanExit
            ? 'supervisor.watcher-exited-clean'
            : 'supervisor.watcher-exited-unexpectedly';
    logEvent(eventName, {
      watcher_pid: currentChildPid,
      exit_code: code,
      signal,
      shutdown_reason: reason || null,
      had_shutdown_reason_file: shutdownReason !== null,
      severity: isPlanned ? 'info' : 'critical',
      uptime_ms: Date.now() - lastSpawnedAt,
      ...(shutdownReason || {}),
    });
    if (idleClean) {
      writeSupervisorStatus('exited-idle', { watcher_pid: currentChildPid });
      try { fs.unlinkSync(SUPERVISOR_PATH); } catch (_) {}
      process.exit(0);
    }
    if (lockRejected) {
      writeSupervisorStatus('exited-lock-rejected', { watcher_pid: currentChildPid });
      try { fs.unlinkSync(SUPERVISOR_PATH); } catch (_) {}
      process.exit(0);
    }
    const respawnReason = reason === 'version-change'
      ? 'planned-restart-version-change'
      : isPlanned
        ? `planned-restart-after-${reason || (cleanExit ? 'clean-exit' : 'exit')}`
        : 'unplanned-restart-after-exit';
    writeSupervisorStatus('restarting', {
      prior_watcher_pid: currentChildPid,
      prior_exit_code: code,
      prior_signal: signal,
      prior_shutdown_reason: reason || null,
      respawn_reason: respawnReason,
    });
    setTimeout(() => spawnWatcher(respawnReason), 1500);
  });

  child.on('error', (err) => {
    logEvent('supervisor.spawn-error', { error: err.message, severity: 'critical' });
  });
}

function checkWatcherHealth() {
  if (!currentChildPid) return;
  if (!pidAlive(currentChildPid)) {
    return;
  }
  const status = readStatus();
  if (!status) {
    logEvent('supervisor.status-missing', {
      watcher_pid: currentChildPid,
      severity: 'warn',
    });
    return;
  }
  const now = Date.now();
  if (status.busy_until && status.busy_until > now) {
    return;
  }
  const age = now - (status.ts || 0);
  if (age > STATUS_STALE_MS) {
    logEvent('supervisor.heartbeat-stale', {
      watcher_pid: currentChildPid,
      status_pid: status.pid,
      status_age_ms: age,
      stale_limit_ms: STATUS_STALE_MS,
      severity: 'critical',
    });
    try { process.kill(currentChildPid, 'SIGTERM'); } catch (_) {}
    if (process.platform === 'win32') {
      try { spawnSync('taskkill', ['/F', '/T', '/PID', String(currentChildPid)], { stdio: 'ignore', windowsHide: true, timeout: 3000 }); } catch (_) {}
    }
    return;
  }
  const reported = status.wrapper_sha || null;
  const onDisk = wrapperSha12OnDisk();
  if (reported && onDisk && reported !== onDisk) {
    logEvent('supervisor.wrapper-sha-drift', {
      watcher_pid: currentChildPid,
      reported_sha: reported,
      on_disk_sha: onDisk,
      severity: 'info',
    });
    try { process.kill(currentChildPid, 'SIGTERM'); } catch (_) {}
    if (process.platform === 'win32') {
      try { spawnSync('taskkill', ['/F', '/T', '/PID', String(currentChildPid)], { stdio: 'ignore', windowsHide: true, timeout: 3000 }); } catch (_) {}
    }
    return;
  }
  if (status.version_drifted === true) {
    if (now - lastVersionDriftActionAt < VERSION_DRIFT_COOLDOWN_MS) {
      return;
    }
    lastVersionDriftActionAt = now;
    logEvent('supervisor.version-drift', {
      watcher_pid: currentChildPid,
      instance_version: status.instance_version || null,
      file_version: status.file_version || null,
      cooldown_ms: VERSION_DRIFT_COOLDOWN_MS,
      severity: 'critical',
    });
    try {
      const home = process.env.USERPROFILE || process.env.HOME || require('os').homedir();
      const gmTools = fs.existsSync(path.join(home, '.gm-tools'))
        ? path.join(home, '.gm-tools')
        : path.join(home, '.claude', 'gm-tools');
      for (const f of ['plugkit.wasm', 'plugkit.version', 'plugkit.wasm.sha256']) {
        try { fs.unlinkSync(path.join(gmTools, f)); } catch (_) {}
      }
    } catch (_) {}
    try { process.kill(currentChildPid, 'SIGTERM'); } catch (_) {}
    if (process.platform === 'win32') {
      try { spawnSync('taskkill', ['/F', '/T', '/PID', String(currentChildPid)], { stdio: 'ignore', windowsHide: true, timeout: 3000 }); } catch (_) {}
    }
  }
}

process.on('SIGINT', () => {
  logEvent('supervisor.shutdown', { reason: 'sigint' });
  writeSupervisorStatus('shutdown', { reason: 'sigint' });
  if (currentChildPid && pidAlive(currentChildPid)) {
    try { process.kill(currentChildPid, 'SIGTERM'); } catch (_) {}
  }
  process.exit(0);
});
process.on('SIGTERM', () => {
  logEvent('supervisor.shutdown', { reason: 'sigterm' });
  writeSupervisorStatus('shutdown', { reason: 'sigterm' });
  if (currentChildPid && pidAlive(currentChildPid)) {
    try { process.kill(currentChildPid, 'SIGTERM'); } catch (_) {}
  }
  releaseSingleInstance();
  process.exit(0);
});
process.on('exit', () => { releaseSingleInstance(); });

if (!acquireSingleInstance()) {
  process.stderr.write('[plugkit-supervisor] another supervisor is alive; exiting\n');
  process.exit(0);
}
writeSupervisorStatus('starting', {});
logEvent('supervisor.starting', { spool_dir: spoolDir });
try { fs.unlinkSync(path.join(spoolDir, '.pre-supervised-watcher.json')); } catch (_) {}
spawnWatcher('initial');
setInterval(checkWatcherHealth, POLL_INTERVAL_MS);
setInterval(() => writeSupervisorStatus('watching', { watcher_pid: currentChildPid, boot_reason: currentBootReason }), 10_000);
