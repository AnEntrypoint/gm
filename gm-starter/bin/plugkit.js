#!/usr/bin/env node
'use strict';
// Hot path: spawnSync to ~/.claude/gm-tools/plugkit.exe with inherited stdio.
// Cold path (session-start / prompt-submit OR missing binary): synchronously
// ensure gm-tools/plugkit{.exe} matches the pinned version, then run hook.
// Cache-aware: when local matches the pin (sha-checked), zero network calls.

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const wrapperDir = __dirname;

function toolsBin() {
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const exe = process.platform === 'win32' ? 'plugkit.exe' : 'plugkit';
  return path.join(home, '.claude', 'gm-tools', exe);
}

function sha256OfFileSync(filePath) {
  try {
    const crypto = require('crypto');
    const h = crypto.createHash('sha256');
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(1 << 20);
      let n;
      while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
    } finally { fs.closeSync(fd); }
    return h.digest('hex');
  } catch (_) { return null; }
}

function platformAsset() {
  const p = process.platform;
  const a = process.arch;
  if (p === 'win32') return a === 'arm64' ? 'plugkit-win32-arm64.exe' : 'plugkit-win32-x64.exe';
  if (p === 'darwin') return a === 'arm64' ? 'plugkit-darwin-arm64' : 'plugkit-darwin-x64';
  return (a === 'arm64' || a === 'aarch64') ? 'plugkit-linux-arm64' : 'plugkit-linux-x64';
}

function readPinnedVersion() {
  try { return fs.readFileSync(path.join(wrapperDir, 'plugkit.version'), 'utf8').trim(); } catch (_) { return null; }
}

function readExpectedSha() {
  try {
    const manifest = fs.readFileSync(path.join(wrapperDir, 'plugkit.sha256'), 'utf8');
    const asset = platformAsset();
    for (const line of manifest.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2 && parts[parts.length - 1].replace(/^\*/, '') === asset) {
        return parts[0].toLowerCase();
      }
    }
  } catch (_) {}
  return null;
}

// Returns true if gm-tools binary matches pinned version by sha. Fast: no network.
function isReady() {
  const bin = toolsBin();
  if (!fs.existsSync(bin)) return false;
  const expected = readExpectedSha();
  if (!expected) return true; // no manifest to compare against — trust existence
  const actual = sha256OfFileSync(bin);
  return actual && actual.toLowerCase() === expected;
}

// Synchronously run bootstrap.js in a child node. Blocks until install finishes
// (or fails). Bootstrap itself is cache-aware: re-download only when sha differs
// from manifest. Wraps stdio:inherit so the user sees progress.
function ensureReady(silent) {
  if (isReady()) return true;
  const bootstrap = path.join(wrapperDir, 'bootstrap.js');
  const r = spawnSync(process.execPath, [bootstrap], {
    stdio: silent ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
  });
  return r.status === 0 && isReady();
}

function main() {
  const args = process.argv.slice(2);
  const isHook = args[0] === 'hook';
  const hookSubcmd = isHook ? (args[1] || '') : '';

  // Synchronous readiness check on these hooks. Hot path: isReady() is sha-match
  // against pinned manifest, returns true in <50ms with no network.
  const blocksUntilReady = hookSubcmd === 'session-start' || hookSubcmd === 'prompt-submit';

  if (blocksUntilReady) {
    if (!ensureReady(false)) {
      process.stderr.write('[plugkit] bootstrap failed; aborting hook\n');
      process.exit(1);
    }
  } else if (!fs.existsSync(toolsBin())) {
    // For non-blocking hooks (pre-tool-use, post-tool-use, stop, etc.): if the
    // binary doesn't exist yet, exit cleanly — session-start will populate it.
    if (isHook) process.exit(0);
    process.exit(1);
  }

  const bin = toolsBin();
  const r = spawnSync(bin, args, { stdio: 'inherit', windowsHide: true });
  let status = r.status ?? 1;
  if (isHook && status === 2) status = 0;
  process.exit(status);
}

main();
