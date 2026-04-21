#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
const destDir = path.join(homeDir, '.codex', 'plugins', 'gm-codex');

const srcDir = __dirname;
const isUpgrade = fs.existsSync(destDir);

console.log(isUpgrade ? 'Upgrading gm-codex...' : 'Installing gm-codex...');

try {
  fs.mkdirSync(destDir, { recursive: true });

  const filesToCopy = [["agents","agents"],["hooks","hooks"],["scripts","scripts"],["skills","skills"],["bin","bin"],[".agents",".agents"],[".codex-plugin",".codex-plugin"],["assets","assets"],[".app.json",".app.json"],[".mcp.json",".mcp.json"],["plugin.json","plugin.json"],["gm.json","gm.json"],["README.md","README.md"],["CLAUDE.md","CLAUDE.md"],["AGENTS.md","AGENTS.md"]];

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
  console.log(`✓ gm-codex ${isUpgrade ? 'upgraded' : 'installed'} to ${destPath}`);
  console.log('Restart Codex to activate.');
} catch (e) {
  console.error('Installation failed:', e.message);
  process.exit(1);
}
