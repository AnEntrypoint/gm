#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const pluginRoot = process.env.GEMINI_PROJECT_DIR ? path.join(__dirname, '..') : (process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '..'));
const projectDir = process.env.GEMINI_PROJECT_DIR || process.cwd();
const readStdinPrompt = () => {
  try { return JSON.parse(fs.readFileSync(0, 'utf-8')).prompt || ''; } catch (e) { return ''; }
};
const readGmAgent = () => {
  try { return fs.readFileSync(path.join(pluginRoot, 'agents/gm.md'), 'utf-8'); } catch (e) { return ''; }
};
const runMcpThorns = () => {
  if (!projectDir || !fs.existsSync(projectDir)) return '';
  try {
    const out = execSync('plugkit codeinsight ' + JSON.stringify(projectDir), { encoding: 'utf-8', stdio: 'pipe', cwd: projectDir, timeout: 55000 });
    if (!out || out.startsWith('Error')) return '';
    return '=== This is your initial insight of the repository, look at every possible aspect of this for initial opinionation and to offset the need for code exploration ===\n' + out;
  } catch (e) { return ''; }
};
const runCodeSearch = (query) => {
  if (!query || !projectDir) return '';
  try {
    const q = query.replace(/"/g, '\\"').substring(0, 200);
    let out;
    try { out = execSync(`bun x codebasesearch "${q}"`, { encoding: 'utf-8', stdio: 'pipe', cwd: projectDir, timeout: 55000 }); }
    catch (e) { out = execSync(`npx -y codebasesearch "${q}"`, { encoding: 'utf-8', stdio: 'pipe', cwd: projectDir, timeout: 55000 }); }
    const lines = out.split('\n');
    const start = lines.findIndex(l => l.includes('Searching for:'));
    return start >= 0 ? lines.slice(start).join('\n').trim() : out.trim();
  } catch (e) { return ''; }
};
try {
  const prompt = readStdinPrompt();
  const parts = [];
  const gm = readGmAgent();
  if (gm) parts.push(gm);
  parts.push('use gm agent | ref: TOOL_INVARIANTS | codesearch for exploration | exec: for execution');
  console.log(JSON.stringify({ systemMessage: parts.join('\n\n') }, null, 2));
} catch (e) {
  console.log(JSON.stringify({ systemMessage: 'use gm agent' }, null, 2));
}
