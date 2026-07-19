#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { ensureReady, startSpoolDaemon, gmToolsDir, readVersionFile, ensureGmPlugkitVersionFresh, ensureSkillMdFresh, ensureWrapperFresh, isReady, getWasmPath, readPinnedGmPlugkitVersion, spawnPinnedBoot, resolveProjectRoot } = require('./bootstrap');
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
  bun x gm-plugkit@latest --kill-stale-watchers
                                             Kill plugkit watchers whose in-memory
                                             wrapper sha differs from on-disk
                                             (lets new wrapper code load on next bootstrap)
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

function readDiskWasmVersion() {
  try {
    const versionFile = path.join(gmToolsDir(), 'plugkit.version');
    return fs.readFileSync(versionFile, 'utf-8').trim() || null;
  } catch (_) { return null; }
}

function readWatcherInstanceVersion(pid) {
  try {
    const ps = process.platform === 'win32'
      ? `(Get-WmiObject Win32_Process -Filter "ProcessId=${pid}").CommandLine`
      : null;
    if (!ps) return null;
    const out = cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf-8', windowsHide: true });
    const m = out.match(/([A-Z]:\\[^"\s]+\.gm[\\/]exec-spool)/i);
    if (!m) return null;
    const statusPath = path.join(m[1].replace(/[\\/]exec-spool.*$/, ''), 'exec-spool', '.status.json');
    if (!fs.existsSync(statusPath)) return null;
    const status = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
    return status && status.instance_version ? status.instance_version : null;
  } catch (_) { return null; }
}

function killStaleWatchers() {
  try {
    const wrapperPath = path.join(gmToolsDir(), 'plugkit-wasm-wrapper.js');
    if (!fs.existsSync(wrapperPath)) {
      console.log(JSON.stringify({ ok: false, error: `wrapper not installed at ${wrapperPath}` }));
      return 1;
    }
    const diskMtime = fs.statSync(wrapperPath).mtimeMs;
    const diskWasmVersion = readDiskWasmVersion();
    let localStatus = null;
    try {
      const localStatusPath = path.join(process.cwd(), '.gm', 'exec-spool', '.status.json');
      if (fs.existsSync(localStatusPath)) localStatus = JSON.parse(fs.readFileSync(localStatusPath, 'utf-8'));
    } catch (_) { localStatus = null; }
    const stale = [];
    const fresh = [];
    function consider(pid, startedMs) {
      const reasons = [];
      if (startedMs < diskMtime) reasons.push('wrapper-mtime');
      let instV = readWatcherInstanceVersion(pid);
      if (!instV && localStatus && localStatus.pid === pid) {
        instV = localStatus.instance_version || localStatus.version || null;
      }
      if (diskWasmVersion && instV && instV !== diskWasmVersion) reasons.push(`wasm-drift:${instV}->${diskWasmVersion}`);
      if (reasons.length > 0) stale.push({ pid, started_ms: startedMs, instance_version: instV, reasons });
      else fresh.push({ pid, started_ms: startedMs, instance_version: instV });
    }
    if (process.platform === 'win32') {
      const ps = `Get-WmiObject Win32_Process -Filter "name='node.exe' OR name='bun.exe'" | Where-Object { $_.CommandLine -match 'plugkit-wasm-wrapper' } | ForEach-Object { $_.ProcessId.ToString() + '|' + $_.CreationDate }`;
      const out = cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf-8', windowsHide: true });
      for (const line of out.split(/\r?\n/).filter(Boolean)) {
        const [pidStr, creation] = line.split('|');
        const pid = parseInt(pidStr, 10);
        if (!Number.isFinite(pid)) continue;
        const m = creation && creation.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d+))?(?:([+-])(\d+))?/);
        if (!m) continue;
        const localMs = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? Math.round(+('0.' + m[7]) * 1000) : 0).getTime();
        consider(pid, localMs);
      }
    } else {
      const out = cp.execFileSync('ps', ['-eo', 'pid,lstart,command'], { encoding: 'utf-8' });
      for (const line of out.split('\n').slice(1)) {
        if (!line.includes('plugkit-wasm-wrapper')) continue;
        const m = line.match(/^\s*(\d+)\s+(.+?\d{4})\s+/);
        if (!m) continue;
        const pid = parseInt(m[1], 10);
        const start = Date.parse(m[2]);
        if (!Number.isFinite(pid) || !Number.isFinite(start)) continue;
        consider(pid, start);
      }
    }
    const killed = [];
    const failed = [];
    for (const s of stale) {
      try {
        if (process.platform === 'win32') {
          cp.execFileSync('taskkill', ['/F', '/T', '/PID', String(s.pid)], { stdio: 'ignore', windowsHide: true });
        } else {
          process.kill(s.pid, 'SIGTERM');
        }
        killed.push(s.pid);
      } catch (e) {
        failed.push({ pid: s.pid, error: e.message });
      }
    }
    console.log(JSON.stringify({
      ok: true,
      disk_wrapper_mtime_ms: diskMtime,
      disk_wasm_version: diskWasmVersion,
      stale_found: stale.length,
      fresh_found: fresh.length,
      stale_detail: stale,
      killed,
      failed,
    }, null, 2));
    return 0;
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: e.message }));
    return 1;
  }
}

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

// gm-runner is a genuine, sha256-verified drop-in replacement for this
// entire bun/node boot path -- when it's installed, delegate to it
// immediately and exit, before any bun/node-specific bootstrap logic runs.
// This is the actual code-level enforcement of what was previously only a
// documented convention (SKILL.md telling an LLM agent to manually prefer
// gm-runner) -- with this in place bun/node are only ever exercised on a
// platform neither runner has a published binary for, or during the
// one-time install before either runner lands on disk.
//
// agentplug-runner is tried FIRST, gm-runner second -- agentplug-runner
// serves the identical spool ABI (same in/out layout, same verb names;
// gm.wasm is just one of its loadable plugins now) so it's a strict
// superset, not an alternative; gm-runner stays as the fallback for any
// install that has it but hasn't picked up agentplug-runner yet (installer
// re-run pending, or a platform agentplug-bin hasn't published for yet
// while gm-runner-bin already has).
function tryDelegateToRunner(args) {
  if (process.env.GM_PLUGKIT_NO_RUNNER_DELEGATE === '1') return false;
  const candidates = process.platform === 'win32'
    ? ['agentplug-runner.exe', 'gm-runner.exe']
    : ['agentplug-runner', 'gm-runner'];
  for (const exeName of candidates) {
    const runnerPath = path.join(gmToolsDir(), exeName);
    if (!fs.existsSync(runnerPath)) continue;
    try {
      const result = cp.spawnSync(runnerPath, args, { stdio: 'inherit', windowsHide: true });
      if (result.error) continue; // this candidate genuinely failed to start -- try the next one
      process.exit(typeof result.status === 'number' ? result.status : 0);
    } catch (_) {
      continue;
    }
    return true;
  }
  return false;
}

(async () => {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage);
    process.exit(0);
  }

  tryDelegateToRunner(args);

  if (args.includes('--kill-stale-watchers')) {
    process.exit(killStaleWatchers());
  }

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
    let wrapperRefreshed = false;
    try { wrapperRefreshed = ensureWrapperFresh(); } catch (_) {}
    if (wrapperRefreshed) {
      writeCliStatus({ phase: 'wrapper-drift-detected', reason: 'on-disk-wrapper-refreshed', running_pid: already.pid });
      console.error(`[gm-plugkit] running watcher (pid=${already.pid}) serves a stale wrapper; on-disk copy just refreshed -- forcing reboot`);
      try {
        if (process.platform === 'win32') cp.execFileSync('taskkill', ['/F', '/T', '/PID', String(already.pid)], { stdio: 'ignore', windowsHide: true });
        else process.kill(already.pid, 'SIGTERM');
      } catch (_) {}
      waitForPidDeath(already.pid, 5000);
    } else {
      writeCliStatus({ phase: 'ready', already_serving: true, watcher_pid: already.pid });
      console.log(JSON.stringify({
        ok: true,
        already_serving: true,
        watcher_pid: already.pid,
        version: already.version,
        skills_refreshed: skillRefresh && skillRefresh.refreshed || [],
        wrapper_refreshed: false,
        message: 'plugkit already serving, no bootstrap/spawn needed',
      }));
      process.exit(0);
    }
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

  const wrapperPath = path.join(gmToolsDir(), 'plugkit-wasm-wrapper.js');
  if (isReady() && fs.existsSync(wrapperPath)) {
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
