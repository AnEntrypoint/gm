#!/usr/bin/env node
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const wrapperDir = __dirname;

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

function readPinnedVersion() {
  try { return fs.readFileSync(path.join(wrapperDir, 'plugkit.version'), 'utf8').trim(); } catch (_) { return null; }
}

function readExpectedSha() {
  try {
    const manifest = fs.readFileSync(path.join(wrapperDir, 'plugkit.sha256'), 'utf8');
    for (const line of manifest.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2 && parts[parts.length - 1].replace(/^\*/, '') === 'plugkit.wasm') {
        return parts[0].toLowerCase();
      }
    }
  } catch (_) {}
  return null;
}

function isReady() {
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const primaryWasm = path.join(home, '.gm-tools', 'plugkit.wasm');
  const fallbackWasm = path.join(home, '.claude', 'gm-tools', 'plugkit.wasm');
  const wasmBin = fs.existsSync(primaryWasm) ? primaryWasm : fallbackWasm;
  if (!fs.existsSync(wasmBin)) return false;
  const expected = readExpectedSha();
  if (!expected) return true;
  const actual = sha256OfFileSync(wasmBin);
  return actual && actual.toLowerCase() === expected;
}

function ensureReady(silent) {
  if (isReady()) return true;
  const bootstrap = path.join(wrapperDir, 'bootstrap.js');
  const r = spawnSync(process.execPath, [bootstrap], {
    stdio: silent ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
  });
  return r.status === 0 && isReady();
}

function wasmPath() {
  return path.join(wrapperDir, 'plugkit.wasm');
}

function shouldUseWasm() {
  if (process.env.GM_USE_WASM === '1') return true;
  if (fs.existsSync(wasmPath())) return true;
  return false;
}

async function runWasm(args) {
  try {
    const WasmHost = require('../lib/wasm-host');
    const host = new WasmHost(wasmPath());
    const verb = args[0] || 'health';
    const body = args.slice(1).join(' ') || '{}';
    const result = await host.dispatch(verb, body);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    console.error('[plugkit wasm]', err.message);
    process.exit(1);
  }
}

function main() {
  const args = process.argv.slice(2);
  const isHook = args[0] === 'hook';
  const hookSubcmd = isHook ? (args[1] || '') : '';

  if (shouldUseWasm()) {
    return runWasm(args);
  }

  const blocksUntilReady = hookSubcmd === 'session-start' || hookSubcmd === 'prompt-submit';

  if (blocksUntilReady) {
    if (!ensureReady(false)) {
      process.stderr.write('[plugkit] bootstrap failed; aborting hook\n');
      process.exit(1);
    }
    return runWasm(args);
  }

  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const primaryWasm = path.join(home, '.gm-tools', 'plugkit.wasm');
  const fallbackWasm = path.join(home, '.claude', 'gm-tools', 'plugkit.wasm');
  const wasmBin = fs.existsSync(primaryWasm) ? primaryWasm : fallbackWasm;
  if (!fs.existsSync(wasmBin)) {
    if (isHook) process.exit(0);
    process.exit(1);
  }

  runWasm(args);
}

main();
