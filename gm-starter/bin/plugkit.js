#!/usr/bin/env node
'use strict';
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const dir = __dirname;
const platform = os.platform();
const arch = os.arch();

let bin;
if (platform === 'win32') {
  bin = path.join(dir, arch === 'arm64' ? 'plugkit-win32-arm64.exe' : 'plugkit-win32-x64.exe');
  if (!fs.existsSync(bin)) bin = path.join(dir, 'plugkit.exe');
} else if (platform === 'darwin') {
  bin = path.join(dir, arch === 'arm64' ? 'plugkit-darwin-arm64' : 'plugkit-darwin-x64');
} else {
  bin = path.join(dir, arch === 'arm64' || arch === 'aarch64' ? 'plugkit-linux-arm64' : 'plugkit-linux-x64');
}

if (platform === 'win32' && fs.existsSync(bin)) {
  try {
    const mtime = fs.statSync(bin).mtimeMs;
    const runDir = path.join(os.tmpdir(), 'plugkit-run');
    fs.mkdirSync(runDir, { recursive: true });
    const ext = path.extname(bin);
    const cached = path.join(runDir, `plugkit-${Math.floor(mtime)}${ext}`);
    if (!fs.existsSync(cached)) {
      const entries = fs.readdirSync(runDir).filter(f => f.startsWith('plugkit-') && f.endsWith(ext));
      for (const old of entries) try { fs.unlinkSync(path.join(runDir, old)); } catch (_) {}
      fs.copyFileSync(bin, cached);
    }
    bin = cached;
  } catch (_) {}
}

const args = process.argv.slice(2);
const isHook = args[0] === 'hook';

if (isHook && !process.stdin.isTTY) {
  // Claude Code pipes JSON to the wrapper's stdin. On Windows, spawnSync with
  // stdio:'inherit' does NOT reliably forward a piped stdin to the native child
  // (the child sees EOF immediately and the hook treats tool_name as empty →
  // silently allows every command). Read stdin ourselves and write it explicitly.
  const chunks = [];
  process.stdin.on('data', c => chunks.push(c));
  process.stdin.on('end', () => {
    const child = spawn(bin, args, { stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true });
    child.stdin.end(Buffer.concat(chunks));
    child.on('close', code => process.exit(code ?? 1));
    child.on('error', () => process.exit(1));
  });
  process.stdin.on('error', () => process.exit(1));
} else {
  const result = spawnSync(bin, args, { stdio: 'inherit', windowsHide: true });
  process.exit(result.status ?? 1);
}
