#!/usr/bin/env node
'use strict';
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { bootstrap, resolveCachedBinary, resolveCachedRtk, obsEvent } = require('./bootstrap');

const dir = __dirname;

function envWithRtkOnPath() {
  const rtkPath = resolveCachedRtk({ wrapperDir: dir });
  if (!rtkPath) return process.env;
  const rtkDir = path.dirname(rtkPath);
  const sep = process.platform === 'win32' ? ';' : ':';
  return { ...process.env, PATH: `${rtkDir}${sep}${process.env.PATH || ''}` };
}

async function resolveBinary() {
  const cached = resolveCachedBinary({ wrapperDir: dir });
  if (cached) return cached;
  return await bootstrap({ wrapperDir: dir });
}

async function main() {
  const args = process.argv.slice(2);
  const isHook = args[0] === 'hook';
  const startedAt = Date.now();
  obsEvent('plugkit_wrapper', 'invoke', { argv: args.slice(0, 4), is_hook: isHook });
  let bin;
  try {
    bin = await resolveBinary();
  } catch (err) {
    process.stderr.write(`[plugkit] bootstrap failed: ${err.message}\n`);
    obsEvent('plugkit_wrapper', 'bootstrap_failed', { err: err.message });
    const legacy = legacyFallback();
    if (legacy) { bin = legacy; }
    else if (isHook) { process.exit(0); }
    else process.exit(1);
  }

  const env = envWithRtkOnPath();

  if (isHook && !process.stdin.isTTY) {
    const chunks = [];
    process.stdin.on('data', c => chunks.push(c));
    process.stdin.on('end', () => {
      const child = spawn(bin, args, { stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true, env });
      child.stdin.end(Buffer.concat(chunks));
      child.on('close', code => process.exit(code ?? 1));
      child.on('error', () => process.exit(1));
    });
    process.stdin.on('error', () => process.exit(1));
  } else {
    const result = spawnSync(bin, args, { stdio: 'inherit', windowsHide: true, env });
    obsEvent('plugkit_wrapper', 'exit', { dur_ms: Date.now() - startedAt, code: result.status ?? -1 });
    process.exit(result.status ?? 1);
  }
}

function legacyFallback() {
  const os = require('os');
  const p = os.platform();
  const a = os.arch();
  let candidates = [];
  if (p === 'win32') {
    candidates = [
      path.join(dir, a === 'arm64' ? 'plugkit-win32-arm64.exe' : 'plugkit-win32-x64.exe'),
      path.join(dir, 'plugkit.exe'),
    ];
  } else if (p === 'darwin') {
    candidates = [path.join(dir, a === 'arm64' ? 'plugkit-darwin-arm64' : 'plugkit-darwin-x64')];
  } else {
    candidates = [path.join(dir, (a === 'arm64' || a === 'aarch64') ? 'plugkit-linux-arm64' : 'plugkit-linux-x64')];
  }
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

main().catch(err => {
  process.stderr.write(`[plugkit] fatal: ${err.message}\n`);
  process.exit(1);
});
