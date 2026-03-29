#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
if (!pluginRoot) process.exit(0);

const IS_WIN = process.platform === 'win32';
const binPath = path.join(pluginRoot, 'bin', IS_WIN ? 'plugkit.exe' : 'plugkit');

function getVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(pluginRoot, 'gm.json'), 'utf8')).plugkitVersion || null;
  } catch { return null; }
}

function getCurrentVersion() {
  if (!fs.existsSync(binPath)) return null;
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync(binPath, ['--version'], { timeout: 5000 }).toString().trim();
    const m = out.match(/(\d+\.\d+\.\d+)/);
    return m ? m[1] : null;
  } catch { return null; }
}

const pendingPath = binPath + '.pending';

function applyPending() {
  if (!fs.existsSync(pendingPath)) return;
  try {
    if (fs.existsSync(binPath)) fs.unlinkSync(binPath);
    fs.renameSync(pendingPath, binPath);
  } catch {}
}

applyPending();

const required = getVersion();
const current = getCurrentVersion();
if (current && current === required) process.exit(0);

function download(version, dest, cb) {
  const asset = IS_WIN ? 'plugkit.exe' : 'plugkit';
  const urlPath = version
    ? `/AnEntrypoint/rs-plugkit/releases/download/v${version}/${asset}`
    : `/AnEntrypoint/rs-plugkit/releases/latest/download/${asset}`;
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const follow = (url) => {
    const mod = url.startsWith('https') ? https : require('http');
    const opts = { ...require('url').parse(url), headers: { 'User-Agent': 'gm-bootstrap' } };
    mod.get(opts, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return follow(res.headers.location);
      if (res.statusCode !== 200) return cb(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { try { fs.writeFileSync(dest, Buffer.concat(chunks)); try { fs.chmodSync(dest, 0o755); } catch {} cb(null); } catch (e) { cb(e); } });
    }).on('error', cb);
  };
  follow(`https://github.com${urlPath}`);
}

download(required, binPath, (err) => {
  if (err && err.message.includes('EBUSY')) {
    download(required, pendingPath, (err2) => {
      if (err2) {
        process.stderr.write(`bootstrap: ${err2.message}\n`);
        process.exit(fs.existsSync(binPath) ? 0 : 1);
      }
      process.exit(0);
    });
    return;
  }
  if (err) {
    process.stderr.write(`bootstrap: ${err.message}\n`);
    process.exit(fs.existsSync(binPath) ? 0 : 1);
  }
  process.exit(0);
});
