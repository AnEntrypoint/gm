'use strict';

const fs = require('fs');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// Pure-leaf helpers shared byte-for-byte between bin/bootstrap.js and
// gm-plugkit/bootstrap.js (they were identical inline copies in both). Only
// node builtins, no bootstrap-local state -- safe to centralize here.
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function sha256OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(filePath);
    s.on('data', c => h.update(c));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

function sha256OfFileSync(filePath) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      h.update(buf.subarray(0, n));
    }
  } finally { try { fs.closeSync(fd); } catch (_) {} }
  return h.digest('hex');
}

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

module.exports = { ensureDir, pidAlive, sha256OfFile, sha256OfFileSync, pidCommandLineForKillGuard, pidAliveSync, waitForPidDeath };
