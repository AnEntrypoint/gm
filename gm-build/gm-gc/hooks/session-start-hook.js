#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const pluginRoot = path.join(__dirname, '..');
const projectDir = process.env.GEMINI_PROJECT_DIR || process.cwd();
try {
  const parts = [];
  try { parts.push(fs.readFileSync(path.join(pluginRoot, 'agents/gm.md'), 'utf-8')); } catch (e) {}
  if (projectDir && fs.existsSync(projectDir)) {
    try {
      const out = execSync('plugkit codeinsight ' + JSON.stringify(projectDir), { encoding: 'utf-8', stdio: 'pipe', cwd: projectDir, timeout: 55000 });
      if (out && !out.startsWith('Error')) parts.push('=== This is your initial insight of the repository, look at every possible aspect of this for initial opinionation and to offset the need for code exploration ===\n' + out);
    } catch (e) {}
  }
  parts.push('Use gm as a philosophy to coordinate all plans and the gm subagent to create and execute all plans');
  console.log(JSON.stringify({ systemMessage: parts.join('\n\n') }, null, 2));
} catch (e) {
  console.log(JSON.stringify({ systemMessage: 'use gm agent' }, null, 2));
}
