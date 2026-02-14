#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Postinstall script for glootie-cc
 * Implements Mode 1: Standalone .claude/ directory installation
 * 
 * When installed via npm in a project:
 * - Copies agents/, hooks/, .mcp.json to project's .claude/
 * - Updates .gitignore with .glootie-stop-verified
 * - Runs silently, never breaks npm install
 * - Safe to run multiple times (idempotent)
 */

function isInsideNodeModules() {
  // Check if __dirname contains /node_modules/ in its path
  // Example: /project/node_modules/glootie-cc/scripts
  return __dirname.includes(path.sep + 'node_modules' + path.sep);
}

function getProjectRoot() {
  // From /project/node_modules/glootie-cc/scripts
  // Navigate to /project
  if (!isInsideNodeModules()) {
    return null;
  }
  
  // Find the node_modules parent (project root)
  let current = __dirname;
  while (current !== path.dirname(current)) { // While not at root
    current = path.dirname(current);
    const parent = path.dirname(current);
    if (path.basename(current) === 'node_modules') {
      return parent;
    }
  }
  return null;
}

function safeCopyFile(src, dst) {
  try {
    const content = fs.readFileSync(src, 'utf-8');
    const dstDir = path.dirname(dst);
    if (!fs.existsSync(dstDir)) {
      fs.mkdirSync(dstDir, { recursive: true });
    }
    fs.writeFileSync(dst, content, 'utf-8');
    return true;
  } catch (err) {
    // Silently skip errors
    return false;
  }
}

function safeCopyDirectory(src, dst) {
  try {
    if (!fs.existsSync(src)) {
      return false; // Source doesn't exist, skip
    }
    
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
    // Silently skip errors
    return false;
  }
}

function updateGitignore(projectRoot) {
  try {
    const gitignorePath = path.join(projectRoot, '.gitignore');
    const entry = '.glootie-stop-verified';
    
    // Read existing content
    let content = '';
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, 'utf-8');
    }
    
    // Check if entry already exists
    if (content.includes(entry)) {
      return true; // Already there
    }
    
    // Append entry
    if (content && !content.endsWith('\n')) {
      content += '\n';
    }
    content += entry + '\n';
    
    fs.writeFileSync(gitignorePath, content, 'utf-8');
    return true;
  } catch (err) {
    // Silently skip errors
    return false;
  }
}

function install() {
  // Only run if inside node_modules
  if (!isInsideNodeModules()) {
    return; // Silent exit
  }
  
  const projectRoot = getProjectRoot();
  if (!projectRoot) {
    return; // Silent exit
  }
  
  const claudeDir = path.join(projectRoot, '.claude');
  const sourceDir = __dirname.replace(/[\/]scripts$/, ''); // Remove /scripts
  
  // Copy files
  safeCopyDirectory(path.join(sourceDir, 'agents'), path.join(claudeDir, 'agents'));
  safeCopyDirectory(path.join(sourceDir, 'hooks'), path.join(claudeDir, 'hooks'));
  safeCopyFile(path.join(sourceDir, '.mcp.json'), path.join(claudeDir, '.mcp.json'));
  
  // Update .gitignore
  updateGitignore(projectRoot);
  
  // Silent success
}

install();
