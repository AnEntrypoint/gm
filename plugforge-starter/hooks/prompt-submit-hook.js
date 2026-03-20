#!/usr/bin/env bun

if (process.env.AGENTGUI_SUBPROCESS === '1') {
  console.log(JSON.stringify({ additionalContext: '' }));
  process.exit(0);
}

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const IS_WIN = process.platform === 'win32';
const TOOLS_DIR = path.join(os.homedir(), '.claude', 'gm-tools');

function localBin(name) {
  const ext = IS_WIN ? '.exe' : '';
  return path.join(TOOLS_DIR, 'node_modules', '.bin', name + ext);
}

function runLocal(name, args, opts = {}) {
  const bin = localBin(name);
  if (fs.existsSync(bin)) {
    return spawnSync(bin, args, { encoding: 'utf8', windowsHide: true, timeout: 30000, ...opts });
  }
  return spawnSync('bun', ['x', name, ...args], { encoding: 'utf8', windowsHide: true, timeout: 30000, ...opts });
}

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.env.GEMINI_PROJECT_DIR || process.env.OC_PROJECT_DIR || process.env.KILO_PROJECT_DIR;

const ensureGitignore = () => {
  if (!projectDir) return;
  const gitignorePath = path.join(projectDir, '.gitignore');
  const entry = '.gm-stop-verified';
  try {
    let content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
    if (!content.split('\n').some(line => line.trim() === entry)) {
      content = (content.endsWith('\n') || content === '' ? content : content + '\n') + entry + '\n';
      fs.writeFileSync(gitignorePath, content);
    }
  } catch (e) {}
};

const runThorns = () => {
  if (!projectDir || !fs.existsSync(projectDir)) return '';
  try {
    const r = runLocal('mcp-thorns', [projectDir], { timeout: 15000 });
    const out = ((r.stdout || '') + (r.stderr || '')).trim();
    return out ? `=== mcp-thorns ===\n${out}` : '';
  } catch (e) {
    return '';
  }
};

const runCodeSearch = (prompt) => {
  if (!prompt || !projectDir) return '';
  try {
    const r = runLocal('codebasesearch', [prompt], { timeout: 10000, cwd: projectDir });
    const out = ((r.stdout || '') + (r.stderr || '')).trim();
    return out ? `=== codebasesearch ===\n${out}` : '';
  } catch (e) {
    return '';
  }
};

const emit = (additionalContext) => {
  const isGemini = process.env.GEMINI_PROJECT_DIR !== undefined;
  const isOpenCode = process.env.OC_PROJECT_DIR !== undefined;
  const isKilo = process.env.KILO_PROJECT_DIR !== undefined;
  if (isGemini) {
    console.log(JSON.stringify({ systemMessage: additionalContext }, null, 2));
  } else if (isOpenCode || isKilo) {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'message.updated', additionalContext } }, null, 2));
  } else {
    console.log(JSON.stringify({ additionalContext }, null, 2));
  }
};

try {
  let prompt = '';
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf-8'));
    prompt = input.prompt || input.message || input.userMessage || '';
  } catch (e) {}

  ensureGitignore();

  const parts = [];
  parts.push('Use the Skill tool with skill: "gm" to begin — do NOT use the Agent tool to load skills. Skills are invoked via the Skill tool only, never as agents. DO NOT use EnterPlanMode.');

  const search = runCodeSearch(prompt);
  if (search) parts.push(search);

  const thorns = runThorns();
  if (thorns) parts.push(thorns);

  emit(parts.join('\n\n'));
} catch (error) {
  emit('Invoke the `gm` skill to begin. Hook error: ' + error.message);
  process.exit(0);
}
