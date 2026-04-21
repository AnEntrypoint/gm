#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');

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
    const entry = '.gm/';
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
  const kiloDir = path.join(projectRoot, '.config', 'kilo');
  const sourceDir = path.dirname(__dirname);

  safeCopyDirectory(path.join(sourceDir, 'agents'), path.join(kiloDir, 'agents'));
  safeCopyDirectory(path.join(sourceDir, 'hooks'), path.join(kiloDir, 'hooks'));
  safeCopyDirectory(path.join(sourceDir, 'skills'), path.join(kiloDir, 'skills'));
  safeCopyFile(path.join(sourceDir, 'kilocode.json'), path.join(kiloDir, 'kilocode.json'));
  safeCopyFile(path.join(sourceDir, '.mcp.json'), path.join(kiloDir, '.mcp.json'));
  safeCopyFile(path.join(sourceDir, 'gm-kilo.mjs'), path.join(kiloDir, 'plugins', 'gm-kilo.mjs'));
  safeCopyFile(path.join(sourceDir, 'gm.json'), path.join(kiloDir, 'gm.json'));
  safeCopyFile(path.join(sourceDir, 'README.md'), path.join(kiloDir, 'README.md'));
  safeCopyFile(path.join(sourceDir, 'LICENSE'), path.join(kiloDir, 'LICENSE'));
  safeCopyFile(path.join(sourceDir, 'CONTRIBUTING.md'), path.join(kiloDir, 'CONTRIBUTING.md'));
  safeCopyFile(path.join(sourceDir, '.gitignore'), path.join(kiloDir, '.gitignore'));
  safeCopyFile(path.join(sourceDir, '.editorconfig'), path.join(kiloDir, '.editorconfig'));

  safeCopyDirectory(path.join(sourceDir, 'skills'), path.join(kiloDir, 'skills'));
  safeCopyDirectory(path.join(sourceDir, 'lang'), path.join(kiloDir, 'lang'));
  safeCopyDirectory(path.join(sourceDir, 'bin'), path.join(kiloDir, 'bin'));

  updateGitignore(projectRoot);

  const IS_WIN = process.platform === 'win32';
  const binDest = path.join(kiloDir, 'hooks', 'bin', IS_WIN ? 'plugkit.exe' : 'plugkit');
  const requiredVersion = getRequiredVersion(sourceDir);
  const installedVersion = fs.existsSync(binDest) ? getInstalledVersion(binDest) : null;
  if (!installedVersion || (requiredVersion && installedVersion !== requiredVersion)) {
    downloadBin(requiredVersion, binDest, (err) => {
      if (err) process.stderr.write('plugkit download failed: ' + err.message + '\n');
    });
  }
}

install();
