'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { pidAlive, sha256OfFileSync } = require('./gm-process');


const LOCK_STALE_MS = 30 * 60 * 1000;
const ATTEMPT_TIMEOUT_MS = 10 * 60 * 1000;

function obsEvent(subsystem, event, fields) {
  if (process.env.GM_LOG_DISABLE) return;
  try {
    const root = process.env.GM_LOG_DIR || path.join(os.homedir(), '.claude', 'gm-log');
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.join(root, day);
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      sub: subsystem,
      event,
      pid: process.pid,
      sess: process.env.CLAUDE_SESSION_ID || process.env.GM_SESSION_ID || '',
      ...fields,
    });
    fs.appendFileSync(path.join(dir, `${subsystem}.jsonl`), line + '\n');
  } catch (_) {}
}

function cacheRoot() {
  const home = os.homedir();
  if (process.env.PLUGKIT_CACHE_DIR) return process.env.PLUGKIT_CACHE_DIR;
  if (os.platform() === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return path.join(base, 'plugkit', 'bin');
  }
  if (os.platform() === 'darwin') return path.join(home, 'Library', 'Caches', 'plugkit', 'bin');
  const xdg = process.env.XDG_CACHE_HOME || path.join(home, '.cache');
  return path.join(xdg, 'plugkit', 'bin');
}

function fallbackCacheRoot() {
  return path.join(os.tmpdir(), 'plugkit-cache', 'bin');
}

function gmToolsDir() {
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const primary = path.join(home, '.gm-tools');
  const fallback = path.join(home, '.claude', 'gm-tools');
  if (fs.existsSync(primary)) return primary;
  if (fs.existsSync(fallback)) return fallback;
  return primary;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function acquireLock(lockPath) {
  const start = Date.now();
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let stale = false;
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) stale = true;
        const owner = parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
        if (Number.isFinite(owner) && owner !== process.pid && !pidAlive(owner)) stale = true;
      } catch (_) { stale = true; }
      if (stale) {
        try { fs.unlinkSync(lockPath); } catch (_) {}
        continue;
      }
      if (Date.now() - start > ATTEMPT_TIMEOUT_MS) throw new Error(`lock wait timeout: ${lockPath}`);
      try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000); }
      catch (e) { obsEvent('bootstrap', 'acquire-lock.atomics-wait-failed', { error: e.message, lockPath }); }
    }
  }
}

function releaseLock(lockPath) {
  try { fs.unlinkSync(lockPath); } catch (_) {}
}

function isLockStale(lockPath) {
  try {
    const st = fs.statSync(lockPath);
    if (Date.now() - st.mtimeMs > LOCK_STALE_MS) return true;
    const owner = parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
    if (Number.isFinite(owner) && !pidAlive(owner)) return true;
  } catch (_) { return true; }
  return false;
}

function pruneOldVersions(root, keepVersion) {
  try {
    const entries = fs.readdirSync(root);
    for (const e of entries) {
      if (!e.startsWith('v')) continue;
      if (e === `v${keepVersion}`) continue;
      const dir = path.join(root, e);
      const lock = path.join(dir, '.lock');
      if (fs.existsSync(lock) && !isLockStale(lock)) continue;
      if (fs.existsSync(lock)) { try { fs.unlinkSync(lock); } catch (_) {} }
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 1, retryDelay: 50 });
      } catch (_) {}
    }
  } catch (_) {}
}

function healIfShaMatches(binPath, expectedSha, sentinelPath, partialPath, kind) {
  if (!fs.existsSync(binPath)) return false;
  if (partialPath) { try { if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath); } catch (_) {} }
  if (!expectedSha) return false;
  let got;
  try { got = sha256OfFileSync(binPath); }
  catch (_) { return false; }
  if (got !== expectedSha) {
    try { fs.unlinkSync(binPath); } catch (_) {}
    return false;
  }
  try { fs.writeFileSync(sentinelPath, new Date().toISOString()); } catch (_) { return false; }
  obsEvent('bootstrap', 'cache.heal', { path: binPath, kind });
  return true;
}

function daemonVersionSentinel() {
  const root = (() => {
    try { const r = cacheRoot(); ensureDir(r); return r; }
    catch (_) { const r = fallbackCacheRoot(); ensureDir(r); return r; }
  })();
  return path.join(root, '.daemon-version');
}

function readDaemonVersion() {
  try { return fs.readFileSync(daemonVersionSentinel(), 'utf8').trim(); }
  catch (_) { return null; }
}

function writeDaemonVersion(v) {
  try { fs.writeFileSync(daemonVersionSentinel(), String(v)); } catch (_) {}
}

function pidCommandLineForKillGuard(pid) {
  try {
    if (process.platform === 'win32') {
      const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      return String((r && r.stdout) || '');
    }
    const r = spawnSync('ps', ['-p', String(pid), '-o', 'args='], { encoding: 'utf8', timeout: 5000 });
    return String((r && r.stdout) || '');
  } catch (_) { return ''; }
}

function pidIsPlugkitProcess(pid) {
  return /agentplug-runner(\.exe)?/i.test(pidCommandLineForKillGuard(pid));
}

function writeKillAttribution(targetSpoolDir, info) {
  try {
    fs.mkdirSync(targetSpoolDir, { recursive: true });
    fs.writeFileSync(path.join(targetSpoolDir, '.kill-attribution.json'), JSON.stringify({ killer_pid: process.pid, killer_cwd: process.cwd(), killer_script: __filename, ts: Date.now(), ...info }, null, 2));
  } catch (_) {}
}

function killPid(pid) {
  if (!Number.isFinite(pid) || pid === process.pid || !pidAlive(pid)) return false;
  try { process.kill(pid, 'SIGTERM'); }
  catch (_) { try { process.kill(pid); } catch (_) {} }
  if (os.platform() === 'win32' && pidAlive(pid)) {
    try { spawnSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true, timeout: 3000, killSignal: 'SIGKILL' }); } catch (_) {}
  }
  return true;
}

function killSpoolWatcherInCwd(reason) {
  try {
    const pidPath = path.join(process.cwd(), '.gm', 'exec-spool', '.watcher.pid');
    if (!fs.existsSync(pidPath)) return null;
    const pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
    if (pidAlive(pid) && !pidIsPlugkitProcess(pid)) {
      obsEvent('bootstrap', 'watcher.kill-skipped-pid-reused', { pid, reason });
      try { fs.unlinkSync(pidPath); } catch (_) {}
      return null;
    }
    writeKillAttribution(path.join(process.cwd(), '.gm', 'exec-spool'), { reason, target_pid: pid, via: 'killSpoolWatcherInCwd' });
    if (killPid(pid)) {
      obsEvent('bootstrap', 'watcher.killed', { pid, reason });
      try { fs.unlinkSync(pidPath); } catch (_) {}
      return pid;
    }
    try { fs.unlinkSync(pidPath); } catch (_) {}
  } catch (_) {}
  return null;
}

function proactiveKillForNewInstall(installedVersion) {
  try {
    const reason = `install:v${installedVersion}`;
    killSpoolWatcherInCwd(reason);
    writeDaemonVersion(installedVersion);
  } catch (_) {}
}

function ensureNextStepWiring(cwd) {
  const changes = [];
  const gmDir = path.join(cwd, '.gm');
  try { fs.mkdirSync(gmDir, { recursive: true }); }
  catch (e) { obsEvent('bootstrap', 'next-step.wiring.target-failed', { target: gmDir, error: e.message }); }

  const nextStepPath = path.join(gmDir, 'next-step.md');
  const nextStepBody = '# Next step\n\nDispatch the `instruction` verb to plugkit by writing `.gm/exec-spool/in/instruction/<N>.txt` (any unique N) with body `{}` (or `{"prompt":"<user request>"}` on the first dispatch of the turn). Read the response from `.gm/exec-spool/out/<N>.json` and follow the imperative in the `instruction` field.\n\nThis file is auto-rewritten by plugkit on every instruction dispatch.\n';
  try {
    if (!fs.existsSync(nextStepPath)) {
      fs.writeFileSync(nextStepPath, nextStepBody);
      changes.push('seeded .gm/next-step.md');
    }
  } catch (e) { obsEvent('bootstrap', 'next-step.wiring.target-failed', { target: nextStepPath, error: e.message }); }

  const claudeMdPath = path.join(cwd, 'CLAUDE.md');
  try {
    if (!fs.existsSync(claudeMdPath)) {
      fs.writeFileSync(claudeMdPath, '@AGENTS.md\n');
      changes.push('created CLAUDE.md');
    } else {
      const cur = fs.readFileSync(claudeMdPath, 'utf8');
      const hasLine = cur.split(/\r?\n/).some(l => l.trim() === '@AGENTS.md');
      if (!hasLine) {
        fs.writeFileSync(claudeMdPath, '@AGENTS.md\n' + cur);
        changes.push('prepended @AGENTS.md to CLAUDE.md');
      }
    }
  } catch (e) { obsEvent('bootstrap', 'next-step.wiring.target-failed', { target: claudeMdPath, error: e.message }); }

  const agentsMdPath = path.join(cwd, 'AGENTS.md');
  try {
    if (fs.existsSync(agentsMdPath)) {
      const cur = fs.readFileSync(agentsMdPath, 'utf8');
      const hasLine = cur.split(/\r?\n/).some(l => l.trim() === '@.gm/next-step.md');
      if (!hasLine) {
        const sep = cur.endsWith('\n') ? '' : '\n';
        fs.writeFileSync(agentsMdPath, cur + sep + '\n@.gm/next-step.md\n');
        changes.push('appended @.gm/next-step.md to AGENTS.md');
      }
    }
  } catch (e) { obsEvent('bootstrap', 'next-step.wiring.target-failed', { target: agentsMdPath, error: e.message }); }

  return changes;
}

module.exports = {
  obsEvent,
  cacheRoot,
  fallbackCacheRoot,
  gmToolsDir,
  ensureDir,
  acquireLock,
  releaseLock,
  isLockStale,
  pruneOldVersions,
  healIfShaMatches,
  daemonVersionSentinel,
  readDaemonVersion,
  writeDaemonVersion,
  pidCommandLineForKillGuard,
  pidIsPlugkitProcess,
  writeKillAttribution,
  killPid,
  killSpoolWatcherInCwd,
  proactiveKillForNewInstall,
  ensureNextStepWiring,
};
