#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');

const PLUGKIT_REPO = 'AnEntrypoint/rs-plugkit';

function isInsideNodeModules() {
  return __dirname.includes(path.sep + 'node_modules' + path.sep);
}

function getProjectRoot() {
  if (!isInsideNodeModules()) return null;
  let current = __dirname;
  while (current !== path.dirname(current)) {
    current = path.dirname(current);
    if (path.basename(current) === 'node_modules') return path.dirname(current);
  }
  return null;
}

function safeCopyFile(src, dst) {
  try {
    const dstDir = path.dirname(dst);
    if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
    fs.writeFileSync(dst, fs.readFileSync(src));
    return true;
  } catch { return false; }
}

function safeCopyDirectory(src, dst) {
  try {
    if (!fs.existsSync(src)) return false;
    fs.mkdirSync(dst, { recursive: true });
    fs.readdirSync(src, { withFileTypes: true }).forEach(entry => {
      const srcPath = path.join(src, entry.name);
      const dstPath = path.join(dst, entry.name);
      if (entry.isDirectory()) safeCopyDirectory(srcPath, dstPath);
      else if (entry.isFile()) safeCopyFile(srcPath, dstPath);
    });
    return true;
  } catch { return false; }
}

function updateGitignore(projectRoot) {
  try {
    const gitignorePath = path.join(projectRoot, '.gitignore');
    const entry = '.gm-stop-verified';
    let content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
    if (content.includes(entry)) return;
    if (content && !content.endsWith('\n')) content += '\n';
    fs.writeFileSync(gitignorePath, content + entry + '\n', 'utf-8');
  } catch {}
}

function getRequiredVersion(sourceDir) {
  try {
    const gm = JSON.parse(fs.readFileSync(path.join(sourceDir, 'gm.json'), 'utf-8'));
    return gm.plugkitVersion || null;
  } catch { return null; }
}

function getInstalledVersion(binPath) {
  try {
    const { spawnSync } = require('child_process');
    const r = spawnSync(binPath, ['--version'], { encoding: 'utf8', timeout: 5000 });
    const m = (r.stdout || '').trim().match(/(\d+\.\d+\.\d+)/);
    return m ? m[1] : null;
  } catch { return null; }
}

function downloadBin(version, dest, callback) {
  const IS_WIN = process.platform === 'win32';
  const asset = IS_WIN ? 'plugkit.exe' : 'plugkit';
  const urlPath = version
    ? `/AnEntrypoint/rs-plugkit/releases/download/v${version}/${asset}`
    : `/AnEntrypoint/rs-plugkit/releases/latest/download/${asset}`;
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const follow = (url) => {
    const mod = url.startsWith('https') ? https : require('http');
    const opts = { ...require('url').parse(url), headers: { 'User-Agent': 'gm-postinstall' } };
    mod.get(opts, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return follow(res.headers.location);
      if (res.statusCode !== 200) return callback(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { try { fs.writeFileSync(dest, Buffer.concat(chunks)); try { fs.chmodSync(dest, 0o755); } catch {} callback(null); } catch (e) { callback(e); } });
    }).on('error', callback);
  };
  follow(`https://github.com${urlPath}`);
}

function install() {
  if (!isInsideNodeModules()) return;
  const projectRoot = getProjectRoot();
  if (!projectRoot) return;
  const ocDir = path.join(projectRoot, '.config', 'opencode');
  const sourceDir = path.dirname(__dirname);

  safeCopyDirectory(path.join(sourceDir, 'agents'), path.join(ocDir, 'agents'));
  safeCopyDirectory(path.join(sourceDir, 'hooks'), path.join(ocDir, 'hooks'));
  safeCopyDirectory(path.join(sourceDir, 'skills'), path.join(ocDir, 'skills'));
  safeCopyFile(path.join(sourceDir, 'opencode.json'), path.join(ocDir, 'opencode.json'));
  safeCopyFile(path.join(sourceDir, '.mcp.json'), path.join(ocDir, '.mcp.json'));
  safeCopyFile(path.join(sourceDir, 'gm.mjs'), path.join(ocDir, 'gm.mjs'));
  safeCopyFile(path.join(sourceDir, 'index.mjs'), path.join(ocDir, 'index.mjs'));
  safeCopyFile(path.join(sourceDir, 'README.md'), path.join(ocDir, 'README.md'));
  safeCopyFile(path.join(sourceDir, 'LICENSE'), path.join(ocDir, 'LICENSE'));
  safeCopyFile(path.join(sourceDir, 'CONTRIBUTING.md'), path.join(ocDir, 'CONTRIBUTING.md'));
  safeCopyFile(path.join(sourceDir, '.gitignore'), path.join(ocDir, '.gitignore'));
  safeCopyFile(path.join(sourceDir, '.editorconfig'), path.join(ocDir, '.editorconfig'));

  const pluginsDir = path.join(ocDir, 'plugins');
  if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });
  const gmMjsSrc = path.join(sourceDir, 'gm.mjs');
  if (fs.existsSync(gmMjsSrc)) safeCopyFile(gmMjsSrc, path.join(pluginsDir, 'gm-oc.mjs'));

  updateGitignore(projectRoot);

  const IS_WIN = process.platform === 'win32';
  const binDest = path.join(ocDir, 'hooks', 'bin', IS_WIN ? 'plugkit.exe' : 'plugkit');
  const requiredVersion = getRequiredVersion(sourceDir);
  const installedVersion = fs.existsSync(binDest) ? getInstalledVersion(binDest) : null;
  if (!installedVersion || (requiredVersion && installedVersion !== requiredVersion)) {
    downloadBin(requiredVersion, binDest, (err) => {
      if (err) process.stderr.write('plugkit download failed: ' + err.message + '\n');
    });
  }
}

install();
