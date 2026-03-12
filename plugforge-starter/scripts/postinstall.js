#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
<<<<<<< HEAD

/**
 * Postinstall script for gm-cc
 * Implements Mode 1: Standalone .claude/ directory installation
 * 
 * When installed via npm in a project:
 * - Copies agents/, hooks/, .mcp.json to project's .claude/
 * - Updates .gitignore with .gm-stop-verified
 * - Runs silently, never breaks npm install
 * - Safe to run multiple times (idempotent)
 */

function isInsideNodeModules() {
  // Check if __dirname contains /node_modules/ in its path
  // Example: /project/node_modules/gm-cc/scripts
=======
const { execSync } = require('child_process');

function isInsideNodeModules() {
>>>>>>> b708331285b38456222c1c4738a11addfb57d3f9
  return __dirname.includes(path.sep + 'node_modules' + path.sep);
}

function getProjectRoot() {
<<<<<<< HEAD
  // From /project/node_modules/gm-cc/scripts
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
=======
  if (!isInsideNodeModules()) return null;
  let current = __dirname;
  while (current !== path.dirname(current)) {
    current = path.dirname(current);
    if (path.basename(current) === 'node_modules') {
      return path.dirname(current);
>>>>>>> b708331285b38456222c1c4738a11addfb57d3f9
    }
  }
  return null;
}

function safeCopyFile(src, dst) {
  try {
    const content = fs.readFileSync(src, 'utf-8');
    const dstDir = path.dirname(dst);
<<<<<<< HEAD
    if (!fs.existsSync(dstDir)) {
      fs.mkdirSync(dstDir, { recursive: true });
    }
    fs.writeFileSync(dst, content, 'utf-8');
    return true;
  } catch (err) {
    // Silently skip errors
=======
    if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
    fs.writeFileSync(dst, content, 'utf-8');
    return true;
  } catch (err) {
>>>>>>> b708331285b38456222c1c4738a11addfb57d3f9
    return false;
  }
}

function safeCopyDirectory(src, dst) {
  try {
<<<<<<< HEAD
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
=======
    if (!fs.existsSync(src)) return false;
    fs.mkdirSync(dst, { recursive: true });
    fs.readdirSync(src, { withFileTypes: true }).forEach(entry => {
      const srcPath = path.join(src, entry.name);
      const dstPath = path.join(dst, entry.name);
      if (entry.isDirectory()) safeCopyDirectory(srcPath, dstPath);
      else if (entry.isFile()) safeCopyFile(srcPath, dstPath);
    });
    return true;
  } catch (err) {
>>>>>>> b708331285b38456222c1c4738a11addfb57d3f9
    return false;
  }
}

function updateGitignore(projectRoot) {
  try {
    const gitignorePath = path.join(projectRoot, '.gitignore');
    const entry = '.gm-stop-verified';
<<<<<<< HEAD
    
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
=======
    let content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
    if (content.includes(entry)) return true;
    if (content && !content.endsWith('\n')) content += '\n';
    fs.writeFileSync(gitignorePath, content + entry + '\n', 'utf-8');
    return true;
  } catch (err) {
>>>>>>> b708331285b38456222c1c4738a11addfb57d3f9
    return false;
  }
}

function install() {
<<<<<<< HEAD
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
=======
  if (!isInsideNodeModules()) return;
  const projectRoot = getProjectRoot();
  if (!projectRoot) return;
  const claudeDir = path.join(projectRoot, '.claude');
  const sourceDir = __dirname.replace(/[/\\]scripts$/, '');
>>>>>>> b708331285b38456222c1c4738a11addfb57d3f9
  
  // Copy files
  safeCopyDirectory(path.join(sourceDir, 'agents'), path.join(claudeDir, 'agents'));
  safeCopyDirectory(path.join(sourceDir, 'hooks'), path.join(claudeDir, 'hooks'));
  safeCopyFile(path.join(sourceDir, '.mcp.json'), path.join(claudeDir, '.mcp.json'));
  
  // Update .gitignore
  updateGitignore(projectRoot);
<<<<<<< HEAD
  
  // Silent success
}

=======

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

>>>>>>> b708331285b38456222c1c4738a11addfb57d3f9
install();
