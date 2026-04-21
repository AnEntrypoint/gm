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
    const out = (r.stdout || '').trim();
    const m = out.match(/(\d+\.\d+\.\d+)/);
    return m ? m[1] : null;
  } catch { return null; }
}

function downloadBin(version, dest, callback) {
  const IS_WIN = process.platform === 'win32';
  const asset = IS_WIN ? 'plugkit.exe' : 'plugkit';
  const tag = version ? `v${version}` : 'latest';
  const urlPath = version
    ? `/AnEntrypoint/rs-plugkit/releases/download/v${version}/${asset}`
    : `/AnEntrypoint/rs-plugkit/releases/latest/download/${asset}`;

  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  const follow = (url) => {
    const isHttps = url.startsWith('https');
    const mod = isHttps ? https : require('http');
    const options = typeof url === 'string'
      ? { ...require('url').parse(url), headers: { 'User-Agent': 'gm-postinstall' } }
      : url;
    mod.get(options, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return follow(res.headers.location);
      }
      if (res.statusCode !== 200) return callback(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          fs.writeFileSync(dest, Buffer.concat(chunks));
          try { fs.chmodSync(dest, 0o755); } catch {}
          callback(null);
        } catch (e) { callback(e); }
      });
    }).on('error', callback);
  };

  follow(`https://github.com${urlPath}`);
}

function install() {
  if (!isInsideNodeModules()) return;
  const projectRoot = getProjectRoot();
  if (!projectRoot) return;

  const claudeDir = path.join(projectRoot, '.claude');
  const sourceDir = path.dirname(__dirname);

  safeCopyDirectory(path.join(sourceDir, 'agents'), path.join(claudeDir, 'agents'));
  safeCopyDirectory(path.join(sourceDir, 'hooks'), path.join(claudeDir, 'hooks'));
  safeCopyFile(path.join(sourceDir, '.mcp.json'), path.join(claudeDir, '.mcp.json'));

  updateGitignore(projectRoot);

  const IS_WIN = process.platform === 'win32';
  const binDest = path.join(claudeDir, 'bin', IS_WIN ? 'plugkit.exe' : 'plugkit');
  const requiredVersion = getRequiredVersion(sourceDir);
  const installedVersion = fs.existsSync(binDest) ? getInstalledVersion(binDest) : null;

  if (!installedVersion || (requiredVersion && installedVersion !== requiredVersion)) {
    downloadBin(requiredVersion, binDest, (err) => {
      if (err) process.stderr.write('plugkit download failed: ' + err.message + '\n');
    });
  }
}

install();
