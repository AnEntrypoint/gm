#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
const kiloConfigDir = path.join(homeDir, '.config', 'kilo');
const srcDir = __dirname;
const pluginMarker = path.join(kiloConfigDir, 'plugins', 'gm-kilo.mjs');
const isUpgrade = fs.existsSync(pluginMarker);

console.log(isUpgrade ? 'Upgrading gm-kilo...' : 'Installing gm-kilo...');

try {
  fs.mkdirSync(path.join(kiloConfigDir, 'plugins'), { recursive: true });
  fs.mkdirSync(path.join(kiloConfigDir, 'agents'), { recursive: true });

  function copyRecursive(src, dst) {
    if (!fs.existsSync(src)) return;
    if (fs.statSync(src).isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      fs.readdirSync(src).forEach(f => copyRecursive(path.join(src, f), path.join(dst, f)));
    } else {
      fs.copyFileSync(src, dst);
    }
  }

  fs.copyFileSync(path.join(srcDir, 'gm-kilo.mjs'), path.join(kiloConfigDir, 'plugins', 'gm-kilo.mjs'));
  copyRecursive(path.join(srcDir, 'agents'), path.join(kiloConfigDir, 'agents'));

  const kiloJsonPath = path.join(kiloConfigDir, 'kilocode.json');
  let kiloConfig = {};
  try {
    const raw = fs.readFileSync(kiloJsonPath, 'utf-8');
    kiloConfig = JSON.parse(raw);
    if (kiloConfig['']) { delete kiloConfig['']; }
  } catch (e) {}
  delete kiloConfig.mcp;
  kiloConfig['$schema'] = 'https://kilo.ai/config.json';
  kiloConfig.default_agent = 'gm';
  const kiloPluginPath = path.join(kiloConfigDir, 'plugins', 'gm-kilo.mjs');
  if (!Array.isArray(kiloConfig.plugin)) kiloConfig.plugin = [];
  kiloConfig.plugin = kiloConfig.plugin.filter(p => !p.includes('gm-kilo'));
  kiloConfig.plugin.push(kiloPluginPath);
  fs.writeFileSync(kiloJsonPath, JSON.stringify(kiloConfig, null, 2) + '\n');

  const oldDir = process.platform === 'win32'
    ? path.join(homeDir, 'AppData', 'Roaming', 'kilo', 'plugin') : null;
  if (oldDir && fs.existsSync(oldDir)) {
    try { fs.rmSync(oldDir, { recursive: true, force: true }); } catch (e) {}
  }

    const { execSync: execSync2 } = require('child_process');
  try {
    execSync2('bunx skills add AnEntrypoint/plugforge --full-depth --all --global --yes --exclude=gm', { stdio: 'inherit' });
  } catch (e) {
    try {
      execSync2('bunx skills add AnEntrypoint/plugforge --full-depth --all --global --yes', { stdio: 'inherit' });
    } catch (e2) {
      console.warn('Warning: skills install failed (non-fatal):', e2.message);
    }
  }

  console.log(`✓ gm-kilo ${isUpgrade ? 'upgraded' : 'installed'} to ${kiloConfigDir}`);
  console.log('Restart Kilo CLI to activate.');
} catch (e) {
  console.error('Installation failed:', e.message);
  process.exit(1);
}
