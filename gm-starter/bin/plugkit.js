#!/usr/bin/env node
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');

const dir = __dirname;
const platform = os.platform();
const arch = os.arch();

let bin;
if (platform === 'win32') {
  bin = path.join(dir, arch === 'arm64' ? 'plugkit-win32-arm64.exe' : 'plugkit-win32-x64.exe');
  if (!require('fs').existsSync(bin)) bin = path.join(dir, 'plugkit.exe');
} else if (platform === 'darwin') {
  bin = path.join(dir, arch === 'arm64' ? 'plugkit-darwin-arm64' : 'plugkit-darwin-x64');
} else {
  bin = path.join(dir, arch === 'arm64' || arch === 'aarch64' ? 'plugkit-linux-arm64' : 'plugkit-linux-x64');
}

const result = spawnSync(bin, process.argv.slice(2), { stdio: 'inherit' });
process.exit(result.status ?? 1);
