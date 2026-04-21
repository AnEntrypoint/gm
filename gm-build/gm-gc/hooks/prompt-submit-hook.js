#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const pluginRoot = process.env.GEMINI_PROJECT_DIR ? path.join(__dirname, '..') : (process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '..'));
const plugkitBin = path.join(pluginRoot, 'bin', 'plugkit.js');
const projectDir = process.env.GEMINI_PROJECT_DIR || process.cwd();
const readStdinPrompt = () => {
  try { return JSON.parse(fs.readFileSync(0, 'utf-8')).prompt || ''; } catch (e) { return ''; }
};
const runCodeinsight = () => {
  if (!projectDir || !fs.existsSync(projectDir)) return '';
  try {
    const r = spawnSync('node', [plugkitBin, 'codeinsight', projectDir], { encoding: 'utf-8', stdio: 'pipe', windowsHide: true, cwd: projectDir, timeout: 10000 });
    const out = (r.stdout || '').trim();
    if (!out || out.startsWith('Error') || r.status !== 0) return '';
    return out;
  } catch (e) { return ''; }
};
const runSearch = (query) => {
  if (!query || !projectDir) return '';
  try {
    const r = spawnSync('node', [plugkitBin, 'search', '--path', projectDir, query.substring(0, 200)], { encoding: 'utf-8', stdio: 'pipe', windowsHide: true, cwd: projectDir, timeout: 5000 });
    const out = (r.stdout || '').trim();
    if (!out || r.status !== 0) return '';
    return out;
  } catch (e) { return ''; }
};
try {
  const prompt = readStdinPrompt();
  const insight = runCodeinsight();
  const search = runSearch(prompt);
  const sections = ['Invoke the gm skill to begin. DO NOT use EnterPlanMode.'];
  if (insight) sections.push('=== codeinsight ===\n' + insight);
  if (search) sections.push('=== search ===\n' + search);
  const injection = '<system-reminder>\n' + sections.join('\n\n') + '\n</system-reminder>';
  console.log(JSON.stringify({ decision: 'deny', reason: injection }, null, 2));
} catch (e) {
  console.log(JSON.stringify({ decision: 'deny', reason: '<system-reminder>\nInvoke the gm skill to begin. DO NOT use EnterPlanMode.\n</system-reminder>' }, null, 2));
}
