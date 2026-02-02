#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const configDir = process.env.XDG_CONFIG_HOME ? path.join(process.env.XDG_CONFIG_HOME, 'opencode') : path.join(os.homedir(), '.config', 'opencode');
const pluginDir = path.join(configDir, 'plugins', 'glootie');
const scriptDir = __dirname;

console.log('Installing glootie plugin globally...');
console.log('Target directory:', pluginDir);

try {
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  const parentDir = path.dirname(pluginDir);
  if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
  const files = fs.readdirSync(scriptDir);
  files.forEach(file => {
    const src = path.join(scriptDir, file);
    const dest = path.join(pluginDir, file);
    if (file !== 'node_modules' && file !== '.git') copyRecursive(src, dest);
  });
  console.log('Installation complete!');
} catch (err) {
  console.error('Installation failed:', err.message);
  process.exit(1);
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach(file => copyRecursive(path.join(src, file), path.join(dest, file)));
  } else fs.copyFileSync(src, dest);
}
