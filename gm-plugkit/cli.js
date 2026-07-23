#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { ensureReady, startSpoolDaemon, gmToolsDir, readVersionFile, ensureGmPlugkitVersionFresh, ensureSkillMdFresh, isReady, getWasmPath, readPinnedGmPlugkitVersion, spawnPinnedBoot, resolveProjectRoot } = require('./bootstrap');
const { pidAliveSync, waitForPidDeath } = require('./gm-process');

function getWasmPathSafe() {
  try { return getWasmPath(); } catch (_) { return null; }
}

function spawnBackgroundFreshnessCheck(reason) {
  try {
    const child = cp.spawn(process.execPath, [__filename.replace(/cli\.js$/, 'bootstrap.js')], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, GM_PLUGKIT_BACKGROUND_REFRESH: reason },
    });
    child.unref();
  } catch (_) {}
}

function spawnDaemonOrExit(version, binaryPath, message) {
  let daemon;
  try {
    daemon = startSpoolDaemon();
  } catch (err) {
    writeCliError('start-daemon', err);
    console.error('Daemon start failed:', err.message);
    process.exit(1);
  }
  if (!daemon || !daemon.ok) {
    const errMsg = (daemon && daemon.error) || 'startSpoolDaemon returned non-ok';
    writeCliError('start-daemon', new Error(errMsg));
    console.error('Daemon start failed:', errMsg);
    process.exit(1);
  }
  writeCliStatus({ phase: 'daemon-spawned', version, daemon_pid: daemon.pid, log: daemon.logPath });
  console.log(JSON.stringify({ ok: true, binary: binaryPath, daemon, message }));
  process.exit(0);
}

function readUpdateAvailableMarker(dir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, '.update-available.json'), 'utf-8'));
    if (raw && raw.installed && raw.latest && raw.installed !== raw.latest) return raw;
  } catch (_) {}
  return null;
}

const usage = `gm-plugkit -- Bootstrap and daemon-spawn for gm plugkit binary.

Usage:
  bun x gm-plugkit@latest                    Bootstrap + start spool daemon
  bun x gm-plugkit@latest spool              Same as default (explicit)
  bun x gm-plugkit@latest --daemon           Same as default
  bun x gm-plugkit@latest --binary           Print binary path only
  bun x gm-plugkit@latest --status           JSON status check
  bun x gm-plugkit@latest --help             Show this help

Opt-in pinned fast-path (skips bunx's own @latest npm-registry resolution):
  GM_PLUGKIT_PREFER_PINNED=1 bun x gm-plugkit@latest spool
  bun x gm-plugkit@latest spool --pinned
                                             Reads ~/.gm-tools/gm-plugkit.version
                                             (written by every successful boot) and
                                             re-execs 'bun x gm-plugkit@<pinned-exact-version>'
                                             with the remaining args -- bunx skips registry
                                             resolution for an exact version once cached, so
                                             this is genuinely faster than @latest on repeat
                                             boots. Falls back to normal @latest-driven
                                             behavior automatically when no pin file exists
                                             yet (first-ever boot) or the pinned invocation
                                             fails (stale/unpublished pinned version).
                                             Opt-in only -- the default boot line above is
                                             unaffected.
`;

function spoolDir() {
  const projectDir = resolveProjectRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  return path.join(projectDir, '.gm', 'exec-spool');
}

function readStatus(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, '.status.json'), 'utf-8')); } catch (_) { return null; }
}

function statusServing(st, freshMs) {
  if (!st || !st.pid) return false;
  const now = Date.now();
  if (Number.isFinite(st.busy_until) && st.busy_until > now) return true;
  return Number.isFinite(st.ts) && (now - st.ts) < freshMs;
}

function ensureSpoolDir() {
  try { fs.mkdirSync(spoolDir(), { recursive: true }); } catch (_) {}
}

function writeCliStatus(spec) {
  try {
    ensureSpoolDir();
    fs.writeFileSync(
      path.join(spoolDir(), '.cli-status.json'),
      JSON.stringify({ ts: new Date().toISOString(), pid: process.pid, ...spec }, null, 2)
    );
  } catch (_) {}
}

function writeCliError(phase, err) {
  try {
    ensureSpoolDir();
    const msg = err && err.message ? err.message : String(err);
    const stack = err && err.stack ? err.stack : null;
    fs.writeFileSync(
      path.join(spoolDir(), '.bootstrap-error.json'),
      JSON.stringify({ ts: new Date().toISOString(), pid: process.pid, error_phase: phase, error_message: msg, stack }, null, 2)
    );
  } catch (_) {}
}

function tryDelegateToRunner(args) {
  if (process.env.GM_PLUGKIT_NO_RUNNER_DELEGATE === '1') return false;
  const exeName = process.platform === 'win32' ? 'agentplug-runner.exe' : 'agentplug-runner';
  const runnerPath = path.join(gmToolsDir(), exeName);
  if (!fs.existsSync(runnerPath)) return false;
  try {
    const result = cp.spawnSync(runnerPath, args, { stdio: 'inherit', windowsHide: true });
    if (result.error) return false;
    process.exit(typeof result.status === 'number' ? result.status : 0);
  } catch (_) {
    return false;
  }
  return true;
}

(async () => {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage);
    process.exit(0);
  }

  tryDelegateToRunner(args);

  const wantsPinned = process.env.GM_PLUGKIT_PREFER_PINNED === '1' || args.includes('--pinned');
  const alreadyReexecedPinned = process.env.GM_PLUGKIT_PINNED_REEXEC === '1';
  if (wantsPinned && !alreadyReexecedPinned) {
    const passArgs = args.filter(a => a !== '--pinned');
    const pinned = readPinnedGmPlugkitVersion();
    if (pinned) {
      writeCliStatus({ phase: 'pinned-fast-path', pinned_version: pinned });
      const result = spawnPinnedBoot(passArgs);
      if (result.ok) {
        process.exit(typeof result.status === 'number' ? result.status : 0);
      }
      writeCliStatus({ phase: 'pinned-fast-path-fallback', reason: result.reason, pinned_version: result.pinned_version || null });
      console.error(`[gm-plugkit] pinned fast-path failed (${result.reason}), falling back to @latest resolution`);
    } else {
      writeCliStatus({ phase: 'pinned-fast-path-no-pin-file' });
      console.error('[gm-plugkit] GM_PLUGKIT_PREFER_PINNED set but no ~/.gm-tools/gm-plugkit.version pin file yet -- falling back to @latest resolution (this boot will write the pin for next time)');
    }
  }

  ensureSpoolDir();
  writeCliStatus({ phase: 'starting', args });

  const already = readStatus(spoolDir());
  let onDiskVersion = null;
  try { onDiskVersion = readVersionFile(); } catch (_) { onDiskVersion = null; }
  const localVersionDrifted = !!(already && onDiskVersion && already.version && already.version !== onDiskVersion);
  const remoteUpdate = already ? readUpdateAvailableMarker(spoolDir()) : null;
  const remoteVersionDrifted = !!(remoteUpdate && already && already.version && already.version === remoteUpdate.installed);
  const versionDrifted = localVersionDrifted || remoteVersionDrifted;
  if (statusServing(already, 12000) && !versionDrifted) {
    try { ensureGmPlugkitVersionFresh(); } catch (_) {}
    let skillRefresh = null;
    try { skillRefresh = ensureSkillMdFresh(); } catch (_) {}
    writeCliStatus({ phase: 'ready', already_serving: true, watcher_pid: already.pid });
    console.log(JSON.stringify({
      ok: true,
      already_serving: true,
      watcher_pid: already.pid,
      version: already.version,
      skills_refreshed: skillRefresh && skillRefresh.refreshed || [],
      message: 'plugkit already serving, no bootstrap/spawn needed',
    }));
    process.exit(0);
  }
  if (versionDrifted) {
    const targetVersion = remoteVersionDrifted ? remoteUpdate.latest : onDiskVersion;
    const reason = remoteVersionDrifted ? 'npm-registry-drift' : 'local-cache-drift';
    writeCliStatus({ phase: 'version-drift-detected', reason, running_version: already.version, target_version: targetVersion });
    console.error(`[gm-plugkit] running watcher (pid=${already.pid}) serves stale version ${already.version}, ${reason === 'npm-registry-drift' ? 'npm' : 'disk'} has ${targetVersion} -- forcing reboot`);
    try {
      if (process.platform === 'win32') cp.execFileSync('taskkill', ['/F', '/T', '/PID', String(already.pid)], { stdio: 'ignore', windowsHide: true });
      else process.kill(already.pid, 'SIGTERM');
    } catch (_) {}
    waitForPidDeath(already.pid, 5000);
  }

  if (isReady()) {
    let installedVersion = null;
    try { installedVersion = readVersionFile(); } catch (_) { installedVersion = null; }
    writeCliStatus({ phase: 'bootstrapped', version: installedVersion, binary: getWasmPathSafe() });
    spawnBackgroundFreshnessCheck(versionDrifted ? 'version-drift-respawn' : 'fast-path-spawn');
    spawnDaemonOrExit(
      installedVersion,
      getWasmPathSafe(),
      'plugkit daemon spawned from existing local install, not yet confirmed serving -- check .gm/exec-spool/.status.json for heartbeat freshness; remote freshness check running in background'
    );
  }

  let bootstrapResult;
  try {
    bootstrapResult = await ensureReady();
  } catch (err) {
    writeCliError('ensure-ready', err);
    console.error('Bootstrap failed:', err.message);
    process.exit(1);
  }

  if (!bootstrapResult || !bootstrapResult.ok) {
    const errMsg = (bootstrapResult && bootstrapResult.error) || 'ensureReady returned non-ok';
    writeCliError('ensure-ready', new Error(errMsg));
    console.error('Bootstrap failed:', errMsg);
    process.exit(1);
  }

  writeCliStatus({ phase: 'bootstrapped', version: bootstrapResult.version, binary: bootstrapResult.binaryPath });
  spawnDaemonOrExit(
    bootstrapResult.version,
    bootstrapResult.binaryPath,
    'plugkit daemon spawned, not yet confirmed serving -- check .gm/exec-spool/.status.json for heartbeat freshness'
  );
})().catch((err) => {
  writeCliError('uncaught', err);
  console.error('gm-plugkit failed:', err && err.message ? err.message : err);
  process.exit(1);
});
