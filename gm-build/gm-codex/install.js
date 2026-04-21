#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

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

function safeCopyDirectory(src, dst) {
  try {
    if (!fs.existsSync(src)) return false;
    fs.mkdirSync(dst, { recursive: true });
    fs.readdirSync(src, { withFileTypes: true }).forEach(entry => {
      const s = path.join(src, entry.name), d = path.join(dst, entry.name);
      if (entry.isDirectory()) safeCopyDirectory(s, d);
      else { fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, d); try { fs.chmodSync(d, fs.statSync(s).mode); } catch (e) {} }
    });
    return true;
  } catch (e) { return false; }
}

function install() {
  if (!isInsideNodeModules()) return;
  const projectRoot = getProjectRoot();
  if (!projectRoot) return;
  const codexDir = path.join(projectRoot, '.codex', 'plugins', 'gm-codex');
  const sourceDir = __dirname;
  safeCopyDirectory(path.join(sourceDir, 'agents'), path.join(codexDir, 'agents'));
  safeCopyDirectory(path.join(sourceDir, 'hooks'), path.join(codexDir, 'hooks'));
  safeCopyDirectory(path.join(sourceDir, 'scripts'), path.join(codexDir, 'scripts'));
  safeCopyDirectory(path.join(sourceDir, 'skills'), path.join(codexDir, 'skills'));
  safeCopyDirectory(path.join(sourceDir, 'bin'), path.join(codexDir, 'bin'));
  safeCopyDirectory(path.join(sourceDir, '.agents'), path.join(codexDir, '.agents'));
  safeCopyDirectory(path.join(sourceDir, '.codex-plugin'), path.join(codexDir, '.codex-plugin'));
  safeCopyDirectory(path.join(sourceDir, 'assets'), path.join(codexDir, 'assets'));
  try { fs.copyFileSync(path.join(sourceDir, '.mcp.json'), path.join(codexDir, '.mcp.json')); } catch {}
  try { fs.copyFileSync(path.join(sourceDir, '.app.json'), path.join(codexDir, '.app.json')); } catch {}
  try { fs.copyFileSync(path.join(sourceDir, 'plugin.json'), path.join(codexDir, 'plugin.json')); } catch {}
  try { fs.copyFileSync(path.join(sourceDir, 'gm.json'), path.join(codexDir, 'gm.json')); } catch {}
  try { fs.copyFileSync(path.join(sourceDir, 'README.md'), path.join(codexDir, 'README.md')); } catch {}
  try { fs.copyFileSync(path.join(sourceDir, 'CLAUDE.md'), path.join(codexDir, 'CLAUDE.md')); } catch {}
  try { fs.copyFileSync(path.join(sourceDir, 'AGENTS.md'), path.join(codexDir, 'AGENTS.md')); } catch {}
}

install();
