#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
const destDir = process.platform === 'win32'
  ? path.join(homeDir, 'AppData', 'Roaming', 'codex', 'plugins', 'gm')
  : path.join(homeDir, '.codex', 'plugins', 'gm');

const srcDir = __dirname;
const isUpgrade = fs.existsSync(destDir);

console.log(isUpgrade ? 'Upgrading gm-codex...' : 'Installing gm-codex...');

try {
  fs.mkdirSync(destDir, { recursive: true });

  const filesToCopy = [["agents","agents"],["hooks","hooks"],[".mcp.json",".mcp.json"],["plugin.json","plugin.json"],["README.md","README.md"]];

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

  const { execSync: execSync } = require('child_process');
  try {
    execSync('bunx skills add AnEntrypoint/plugforge --full-depth --all --global --yes --exclude=gm', { stdio: 'inherit' });
  } catch (e) {
    try {
      execSync('bunx skills add AnEntrypoint/plugforge --full-depth --all --global --yes', { stdio: 'inherit' });
    } catch (e2) {
      console.warn('Warning: skills install failed (non-fatal):', e2.message);
    }
  }

  const destPath = process.platform === 'win32' ? destDir.replace(/\\/g, '/') : destDir;
  console.log(`✓ gm-codex ${isUpgrade ? 'upgraded' : 'installed'} to ${destPath}`);
  console.log('Restart Codex to activate.');
} catch (e) {
  console.error('Installation failed:', e.message);
  process.exit(1);
}
