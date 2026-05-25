#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { ensureReady, startSpoolDaemon } = require('./bootstrap');

const usage = `gm-plugkit — Bootstrap and daemon-spawn for gm plugkit binary.

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
`;

function readDiskWasmVersion() {
  try {
    const versionFile = path.join(os.homedir(), '.gm-tools', 'plugkit.version');
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
    const wrapperPath = path.join(os.homedir(), '.gm-tools', 'plugkit-wasm-wrapper.js');
    if (!fs.existsSync(wrapperPath)) {
      console.log(JSON.stringify({ ok: false, error: 'wrapper not installed at ~/.gm-tools/plugkit-wasm-wrapper.js' }));
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
          cp.execFileSync('taskkill', ['/F', '/PID', String(s.pid)], { stdio: 'ignore', windowsHide: true });
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
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return path.join(projectDir, '.gm', 'exec-spool');
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

(async () => {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage);
    process.exit(0);
  }

  if (args.includes('--kill-stale-watchers')) {
    process.exit(killStaleWatchers());
  }

  ensureSpoolDir();
  writeCliStatus({ phase: 'starting', args });

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

  writeCliStatus({ phase: 'ready', version: bootstrapResult.version, daemon_pid: daemon.pid, log: daemon.logPath });

  console.log(JSON.stringify({
    ok: true,
    binary: bootstrapResult.binaryPath,
    daemon,
    message: 'plugkit ready, spool watcher running'
  }));
  process.exit(0);
})().catch((err) => {
  writeCliError('uncaught', err);
  console.error('gm-plugkit failed:', err && err.message ? err.message : err);
  process.exit(1);
});
