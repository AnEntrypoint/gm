#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
if (!pluginRoot) process.exit(0);

const IS_WIN = process.platform === 'win32';
const binDir = path.join(pluginRoot, 'bin');
const binPath = path.join(binDir, IS_WIN ? 'plugkit.exe' : 'plugkit');
const pendingPath = binPath + '.pending';
const versionFile = path.join(binDir, '.plugkit-version');
const pendingVersionFile = pendingPath + '.version';

function getAssetName() {
  const os = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const cpu = process.arch === 'arm64' ? 'arm64' : 'x64';
  const ext = process.platform === 'win32' ? '.exe' : '';
  return `plugkit-${os}-${cpu}${ext}`;
}

function killDaemon() {
  try {
    execFileSync(binPath, ['runner', 'stop'], { timeout: 5000, stdio: 'ignore' });
  } catch {}
  if (IS_WIN) {
    try { execFileSync('taskkill', ['/F', '/IM', 'plugkit.exe'], { timeout: 3000, stdio: 'ignore' }); } catch {}
  }
}

function applyPending() {
  if (!fs.existsSync(pendingPath)) return;
  killDaemon();
  try {
    if (fs.existsSync(binPath)) fs.unlinkSync(binPath);
    fs.renameSync(pendingPath, binPath);
    if (fs.existsSync(pendingVersionFile)) {
      try { fs.renameSync(pendingVersionFile, versionFile); } catch {}
    }
  } catch {}
}

applyPending();

function getRequiredVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(pluginRoot, 'gm.json'), 'utf8')).plugkitVersion || null;
  } catch { return null; }
}

function getCurrentVersion() {
  try { return fs.readFileSync(versionFile, 'utf8').trim() || null; } catch { return null; }
}

const required = getRequiredVersion();
const current = getCurrentVersion();
if (current && current === required) process.exit(0);

function download(version, dest, cb) {
  const asset = getAssetName();
  const urlPath = `/AnEntrypoint/rs-plugkit/releases/download/v${version}/${asset}`;
  if (!fs.existsSync(path.dirname(dest))) fs.mkdirSync(path.dirname(dest), { recursive: true });
  let done = false;
  const timer = setTimeout(() => { if (!done) { done = true; cb(new Error('download timeout')); } }, 30000);
  const follow = (url) => {
    const mod = url.startsWith('https') ? https : require('http');
    const opts = { ...require('url').parse(url), headers: { 'User-Agent': 'gm-bootstrap' }, timeout: 15000 };
    const req = mod.get(opts, res => {
      if (done) return res.destroy();
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return follow(res.headers.location);
      if (res.statusCode !== 200) { clearTimeout(timer); if (!done) { done = true; cb(new Error(`HTTP ${res.statusCode}`)); } return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        clearTimeout(timer);
        if (done) return;
        done = true;
        try {
          fs.writeFileSync(dest, Buffer.concat(chunks));
          try { fs.chmodSync(dest, 0o755); } catch {}
          cb(null);
        } catch (e) { cb(e); }
      });
    });
    req.on('error', (e) => { clearTimeout(timer); if (!done) { done = true; cb(e); } });
    req.on('timeout', () => { req.destroy(); clearTimeout(timer); if (!done) { done = true; cb(new Error('connect timeout')); } });
  };
  follow(`https://github.com${urlPath}`);
}

killDaemon();

download(required, binPath, (err) => {
  if (err && err.code === 'EBUSY') {
    download(required, pendingPath, (err2) => {
      if (err2) {
        process.stderr.write(`bootstrap: pending failed: ${err2.message}\n`);
        process.exit(fs.existsSync(binPath) ? 0 : 1);
      }
      try { fs.writeFileSync(pendingVersionFile, required); } catch {}
      process.exit(0);
    });
    return;
  }
  if (err) {
    process.stderr.write(`bootstrap: ${err.message}\n`);
    process.exit(fs.existsSync(binPath) ? 0 : 1);
  }
  try { fs.writeFileSync(versionFile, required); } catch {}
  process.exit(0);
});
