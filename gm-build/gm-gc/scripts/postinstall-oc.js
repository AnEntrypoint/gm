#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function isInsideNodeModules() {
  return __dirname.includes(path.sep + 'node_modules' + path.sep);
}

function getProjectRoot() {
  if (!isInsideNodeModules()) return null;
  let current = __dirname;
  while (current !== path.dirname(current)) {
    current = path.dirname(current);
    if (path.basename(current) === 'node_modules') {
      return path.dirname(current);
    }
  }
  return null;
}

function safeCopyFile(src, dst) {
  try {
    const content = fs.readFileSync(src, 'utf-8');
    const dstDir = path.dirname(dst);
    if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
    fs.writeFileSync(dst, content, 'utf-8');
    return true;
  } catch (e) {
    return false;
  }
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
  } catch (e) {
    return false;
  }
}

function updateGitignore(projectRoot) {
  try {
    const gitignorePath = path.join(projectRoot, '.gitignore');
    const entry = '.gm-stop-verified';
    let content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
    if (content.includes(entry)) return true;
    if (content && !content.endsWith('\n')) content += '\n';
    fs.writeFileSync(gitignorePath, content + entry + '\n', 'utf-8');
    return true;
  } catch (e) {
    return false;
  }
}

function install() {
  if (!isInsideNodeModules()) return;
  const projectRoot = getProjectRoot();
  if (!projectRoot) return;
  const ocDir = path.join(projectRoot, '.config', 'opencode');
  const sourceDir = __dirname.replace(/[/\\]scripts$/, '');

  // Copy files
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

  // Also write to plugins/gm-oc.mjs - the actual file OpenCode loads
  const pluginsDir = path.join(ocDir, 'plugins');
  if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });
  const gmMjsSrc = path.join(sourceDir, 'gm.mjs');
  if (fs.existsSync(gmMjsSrc)) {
    safeCopyFile(gmMjsSrc, path.join(pluginsDir, 'gm-oc.mjs'));
  }

  // Update .gitignore
  updateGitignore(projectRoot);

  // Warm bun x cache for packages used by hooks
  warmBunCache();

  // Silent success
}

function warmBunCache() {
  const packages = ['mcp-thorns@latest', 'codebasesearch@latest'];
  for (const pkg of packages) {
    try {
      execSync(`bun x ${pkg} --version`, {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 60000
      });
    } catch (e) {
      // Silent - cache warming is best-effort
    }
  }
}

install();
