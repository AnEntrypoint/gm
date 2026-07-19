'use strict';

const { spawnSync } = require('child_process');

function pidCommandLineForKillGuard(pid) {
  try {
    if (process.platform === 'win32') {
      const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-WmiObject Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      return String((r && r.stdout) || '');
    }
    const r = spawnSync('ps', ['-p', String(pid), '-o', 'args='], { encoding: 'utf8', timeout: 5000 });
    return String((r && r.stdout) || '');
  } catch (_) { return ''; }
}

// Is `pid` still alive? signal-0 probe (throws ESRCH once the process is gone).
function pidAliveSync(pid) {
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

// Block (via a short spawnSync sleep, no async) until `pid` dies or timeoutMs
// elapses. Shared by cli.js (daemon recycle) and supervisor.js (killChild) —
// both previously carried a byte-divergent inline copy (execFileSync vs
// spawnSync) of this exact loop.
function waitForPidDeath(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidAliveSync(pid)) return true;
    try { spawnSync(process.platform === 'win32' ? 'ping' : 'sleep', process.platform === 'win32' ? ['-n', '2', '127.0.0.1'] : ['0.3'], { stdio: 'ignore', windowsHide: true }); } catch (_) {}
  }
  return !pidAliveSync(pid);
}

module.exports = { pidCommandLineForKillGuard, pidAliveSync, waitForPidDeath };
