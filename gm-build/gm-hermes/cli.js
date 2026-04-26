#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
const destDir = path.join(homeDir, '.hermes', 'skills', 'gm');

const srcDir = __dirname;
const isUpgrade = fs.existsSync(destDir);

console.log(isUpgrade ? 'Upgrading gm-hermes...' : 'Installing gm-hermes...');

try {
  fs.mkdirSync(destDir, { recursive: true });

  const filesToCopy = [["skills","."],["README.md","README.md"]];

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

  const destPath = process.platform === 'win32' ? destDir.replace(/\\/g, '/') : destDir;
  console.log(`✓ gm-hermes ${isUpgrade ? 'upgraded' : 'installed'} to ${destPath}`);
  console.log('Restart Hermes to activate skills. Invoke via /gm or /planning.');
} catch (e) {
  console.error('Installation failed:', e.message);
  process.exit(1);
}
