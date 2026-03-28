#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
if (!pluginRoot) {
  process.stderr.write('plugkit-runner: CLAUDE_PLUGIN_ROOT not set\n');
  process.exit(1);
}

const IS_WIN = process.platform === 'win32';
const binName = IS_WIN ? 'plugkit.exe' : 'plugkit';
const binPath = path.join(pluginRoot, 'bin', binName);

function getVersion() {
  try {
    const gm = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'gm.json'), 'utf8'));
    return gm.plugkitVersion || null;
  } catch { return null; }
}

function download(version, dest, cb) {
  const asset = IS_WIN ? 'plugkit.exe' : 'plugkit';
  const urlPath = version
    ? `/AnEntrypoint/rs-plugkit/releases/download/v${version}/${asset}`
    : `/AnEntrypoint/rs-plugkit/releases/latest/download/${asset}`;
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const follow = (url) => {
    const mod = url.startsWith('https') ? https : require('http');
    const opts = { ...require('url').parse(url), headers: { 'User-Agent': 'plugkit-runner' } };
    mod.get(opts, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return follow(res.headers.location);
      if (res.statusCode !== 200) return cb(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { fs.writeFileSync(dest, Buffer.concat(chunks)); fs.chmodSync(dest, 0o755); cb(null); }
        catch (e) { cb(e); }
      });
    }).on('error', cb);
  };
  follow(`https://github.com${urlPath}`);
}

function run() {
  const result = spawnSync(binPath, process.argv.slice(2), { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

if (fs.existsSync(binPath)) {
  run();
} else {
  const version = getVersion();
  download(version, binPath, (err) => {
    if (err) { process.stderr.write(`plugkit-runner: download failed: ${err.message}\n`); process.exit(1); }
    run();
  });
}
