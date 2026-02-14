#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Postinstall script for glootie-oc
 * Implements Mode 1: Standalone .opencode/plugins directory installation
 * 
 * When installed via npm in a project:
 * - Copies essential files to .opencode/plugins/glootie-oc/
 * - Updates .gitignore with .glootie-stop-verified
 * - Runs silently, never breaks npm install
 * - Safe to run multiple times (idempotent)
 */

function isInsideNodeModules() {
  return __dirname.includes(path.sep + 'node_modules' + path.sep);
}

function getProjectRoot() {
  if (!isInsideNodeModules()) {
    return null;
  }
  
  let current = __dirname;
  while (current !== path.dirname(current)) {
    const parent = path.dirname(current);
    if (path.basename(current) === 'node_modules') {
      return parent;
    }
    current = parent;
  }
  return null;
}

function safeCopyFile(src, dst) {
  try {
    if (!fs.existsSync(src)) return false;
    const content = fs.readFileSync(src, 'utf-8');
    const dstDir = path.dirname(dst);
    if (!fs.existsSync(dstDir)) {
      fs.mkdirSync(dstDir, { recursive: true });
    }
    fs.writeFileSync(dst, content, 'utf-8');
    return true;
  } catch (err) {
    return false;
  }
}

function safeCopyDirectory(src, dst) {
  try {
    if (!fs.existsSync(src)) return false;
    fs.mkdirSync(dst, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    entries.forEach(entry => {
      const srcPath = path.join(src, entry.name);
      const dstPath = path.join(dst, entry.name);
      if (entry.isDirectory()) {
        safeCopyDirectory(srcPath, dstPath);
      } else if (entry.isFile()) {
        safeCopyFile(srcPath, dstPath);
      }
    });
    return true;
  } catch (err) {
    return false;
  }
}

function updateGitignore(projectRoot) {
  try {
    const gitignorePath = path.join(projectRoot, '.gitignore');
    const entry = '.glootie-stop-verified';
    let content = '';
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, 'utf-8');
    }
    if (content.includes(entry)) return true;
    if (content && !content.endsWith('\n')) content += '\n';
    content += entry + '\n';
    fs.writeFileSync(gitignorePath, content, 'utf-8');
    return true;
  } catch (err) {
    return false;
  }
}

function install() {
  if (!isInsideNodeModules()) return;
  const projectRoot = getProjectRoot();
  if (!projectRoot) return;
  
  const pluginDir = path.join(projectRoot, '.opencode', 'plugins', 'glootie-oc');
  const sourceDir = path.resolve(__dirname, '..');
  
  // Copy essential files for OpenCode plugin
  safeCopyDirectory(path.join(sourceDir, 'agents'), path.join(pluginDir, 'agents'));
  safeCopyDirectory(path.join(sourceDir, 'hooks'), path.join(pluginDir, 'hooks'));
  safeCopyFile(path.join(sourceDir, 'glootie.mjs'), path.join(pluginDir, 'glootie.mjs'));
  safeCopyFile(path.join(sourceDir, 'index.js'), path.join(pluginDir, 'index.js'));
  safeCopyFile(path.join(sourceDir, 'opencode.json'), path.join(pluginDir, 'opencode.json'));
  safeCopyFile(path.join(sourceDir, '.mcp.json'), path.join(pluginDir, '.mcp.json'));
  
  updateGitignore(projectRoot);
}

install();
