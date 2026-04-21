#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
const destDir = path.join(homeDir, '.claude');

const srcDir = __dirname;
const isUpgrade = fs.existsSync(destDir);

console.log(isUpgrade ? 'Upgrading gm-cc...' : 'Installing gm-cc...');

try {
  fs.mkdirSync(destDir, { recursive: true });

  const filesToCopy = [];

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

  const { execSync: exec } = require('child_process');
  const sep = process.platform === 'win32' ? ';' : ':';
  const sanitizedPath = (process.env.PATH || '').split(sep).filter(p => !/[\\/]node_modules[\\/]\.bin$/.test(p.replace(/[\\/]+$/, ''))).join(sep);
  const run = (cmd) => { try { return exec(cmd, { stdio: 'inherit', env: { ...process.env, PATH: sanitizedPath, CLAUDECODE: '' } }); } catch (e) { console.warn('Warning:', e.message); } };

  const gmccHookFiles = ['post-tool-use-hook.js','pre-tool-use-hook.js','prompt-submit-hook.js','session-start-hook.js','stop-hook-git.js','stop-hook.js'];
  const gmccAgentFiles = ['gm.md'];
  const staleLocations = [
    ...gmccHookFiles.map(f => path.join(homeDir, '.claude', 'hooks', f)),
    ...gmccAgentFiles.map(f => path.join(homeDir, '.claude', 'agents', f)),
    ...gmccHookFiles.map(f => path.join(homeDir, '.claude', 'skills', f)),
    ...gmccAgentFiles.map(f => path.join(homeDir, '.claude', 'skills', f)),
    path.join(homeDir, '.claude', 'plugins', 'gm-cc'),
  ];
  staleLocations.forEach(p => {
    try {
      const stat = fs.statSync(p);
      if (stat.isDirectory()) fs.rmSync(p, { recursive: true, force: true });
      else fs.unlinkSync(p);
    } catch (e) {}
  });

  const pluginCacheDir = path.join(homeDir, '.claude', 'plugins', 'cache', 'gm-cc');
  copyRecursive(srcDir, pluginCacheDir);

  run('claude plugin marketplace add AnEntrypoint/gm-cc');
  run('claude plugin install gm@gm-cc --scope user');
  const knownMarketplacesPath = path.join(homeDir, '.claude', 'plugins', 'known_marketplaces.json');
  try {
    const km = JSON.parse(fs.readFileSync(knownMarketplacesPath, 'utf-8'));
    if (km && km['gm-cc'] && km['gm-cc'].source && km['gm-cc'].installLocation) {
      km['gm-cc'].autoUpdate = true;
      km['gm-cc'].lastUpdated = new Date().toISOString();
      fs.writeFileSync(knownMarketplacesPath, JSON.stringify(km, null, 2) + '\n');
    }
  } catch (e) {}

  const destPath = process.platform === 'win32' ? destDir.replace(/\\/g, '/') : destDir;
  console.log(`✓ gm-cc ${isUpgrade ? 'upgraded' : 'installed'} to ${destPath}`);
  console.log('Restart Claude Code to activate.');
} catch (e) {
  console.error('Installation failed:', e.message);
  process.exit(1);
}
