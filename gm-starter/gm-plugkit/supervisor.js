#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const spoolDir = path.join(projectDir, '.gm', 'exec-spool');
fs.mkdirSync(spoolDir, { recursive: true });

const STATUS_PATH = path.join(spoolDir, '.status.json');
const SHUTDOWN_REASON_PATH = path.join(spoolDir, '.shutdown-reason.json');
const SUPERVISOR_PATH = path.join(spoolDir, '.supervisor.json');
const LOG_PATH = path.join(spoolDir, '.watcher.log');
const GM_LOG_ROOT = process.env.GM_LOG_DIR || path.join(os.homedir(), '.claude', 'gm-log');

const POLL_INTERVAL_MS = 10_000;
const STATUS_STALE_MS = 30_000;
const MAX_RESTART_BURST = 5;
const RESTART_WINDOW_MS = 60_000;

function logEvent(event, fields) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.join(GM_LOG_ROOT, day);
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      ts: Date.now(),
      sub: 'plugkit',
      event,
      pid: process.pid,
      sess: process.env.CLAUDE_SESSION_ID || '',
      cwd: process.cwd(),
      role: 'supervisor',
      ...fields,
    }) + '\n';
    fs.appendFileSync(path.join(dir, 'plugkit.jsonl'), line);
  } catch (_) {}
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

function readStatus() {
  try { return JSON.parse(fs.readFileSync(STATUS_PATH, 'utf-8')); } catch (_) { return null; }
}

function readShutdownReason() {
  try { return JSON.parse(fs.readFileSync(SHUTDOWN_REASON_PATH, 'utf-8')); } catch (_) { return null; }
}

let lastSpawnedAt = 0;
let restartTimestamps = [];
let currentChildPid = null;
let currentBootReason = 'initial';

function spawnWatcher(bootReason) {
  lastSpawnedAt = Date.now();
  restartTimestamps.push(Date.now());
  restartTimestamps = restartTimestamps.filter(t => Date.now() - t < RESTART_WINDOW_MS);
  if (restartTimestamps.length > MAX_RESTART_BURST) {
    logEvent('supervisor.giving-up', {
      reason: 'restart-burst-exceeded',
      restarts_in_window: restartTimestamps.length,
      window_ms: RESTART_WINDOW_MS,
      max: MAX_RESTART_BURST,
      severity: 'critical',
    });
    writeSupervisorStatus('giving-up', { reason: 'restart-burst-exceeded' });
    process.exit(2);
  }

  const wrapper = path.join(os.homedir(), '.claude', 'gm-tools', 'plugkit-wasm-wrapper.js');
  if (!fs.existsSync(wrapper)) {
    logEvent('supervisor.wrapper-missing', { wrapper, severity: 'critical' });
    writeSupervisorStatus('error', { error: 'wrapper-missing' });
    process.exit(3);
  }

  let runtime = process.env.PLUGKIT_RUNTIME || 'bun';
  let cmd = runtime;
  let args = [wrapper, 'spool'];
  try {
    spawnSync(runtime, ['--version'], { stdio: 'ignore', windowsHide: true });
  } catch (_) {
    cmd = process.execPath;
    args = [wrapper, 'spool'];
  }

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
    logEvent(idleClean ? 'supervisor.watcher-exited-idle' : 'supervisor.watcher-exited-unexpectedly', {
      watcher_pid: currentChildPid,
      exit_code: code,
      signal,
      shutdown_reason: reason || null,
      had_shutdown_reason_file: shutdownReason !== null,
      severity: idleClean ? 'info' : 'critical',
      uptime_ms: Date.now() - lastSpawnedAt,
    });
    if (idleClean) {
      writeSupervisorStatus('exited-idle', { watcher_pid: currentChildPid });
      try { fs.unlinkSync(SUPERVISOR_PATH); } catch (_) {}
      process.exit(0);
    }
    writeSupervisorStatus('restarting', {
      prior_watcher_pid: currentChildPid,
      prior_exit_code: code,
      prior_signal: signal,
      prior_shutdown_reason: reason || null,
    });
    setTimeout(() => spawnWatcher('unplanned-restart-after-exit'), 1500);
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
  const age = Date.now() - (status.ts || 0);
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
  process.exit(0);
});

writeSupervisorStatus('starting', {});
logEvent('supervisor.starting', { spool_dir: spoolDir });
spawnWatcher('initial');
setInterval(checkWatcherHealth, POLL_INTERVAL_MS);
setInterval(() => writeSupervisorStatus('watching', { watcher_pid: currentChildPid, boot_reason: currentBootReason }), 10_000);
