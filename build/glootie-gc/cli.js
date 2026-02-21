#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
const destDir = process.platform === 'win32'
  ? path.join(homeDir, 'AppData', 'Roaming', 'gemini', 'extensions', 'gm')
  : path.join(homeDir, '.gemini', 'extensions', 'gm');

const srcDir = __dirname;
const isUpgrade = fs.existsSync(destDir);

console.log(isUpgrade ? 'Upgrading glootie-gc...' : 'Installing glootie-gc...');

try {
  fs.mkdirSync(destDir, { recursive: true });

  const filesToCopy = [
    ['agents', 'agents'],
    ['hooks', 'hooks'],
    ['.mcp.json', '.mcp.json'],
    ['gemini-extension.json', 'gemini-extension.json'],
    ['README.md', 'README.md'],
    ['GEMINI.md', 'GEMINI.md']
  ];

  function copyRecursive(src, dst) {
    if (!fs.existsSync(src)) return;
    if (fs.statSync(src).isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      fs.readdirSync(src).forEach(f => copyRecursive(path.join(src, f), path.join(dst, f)));
    } else {
      fs.copyFileSync(src, dst);
    }
  }

  filesToCopy.forEach(([src, dst]) => copyRecursive(path.join(srcDir, src), path.join(destDir, dst)));

  const destPath = process.platform === 'win32'
    ? destDir.replace(/\\/g, '/')
    : destDir;
  console.log(`✓ glootie-gc ${isUpgrade ? 'upgraded' : 'installed'} to ${destPath}`);
  console.log('Restart Gemini CLI to activate.');
} catch (e) {
  console.error('Installation failed:', e.message);
  process.exit(1);
}
