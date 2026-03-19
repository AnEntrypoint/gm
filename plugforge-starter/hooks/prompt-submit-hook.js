#!/usr/bin/env bun

if (process.env.AGENTGUI_SUBPROCESS === '1') {
  console.log(JSON.stringify({ additionalContext: '' }));
  process.exit(0);
}

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
  const localThorns = path.join(process.env.HOME || '/root', 'mcp-thorns', 'index.js');
  const thornsBin = fs.existsSync(localThorns) ? `node ${localThorns}` : 'bun x mcp-thorns@latest';
  try {
    const out = execSync(`${thornsBin} ${projectDir}`, {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000, killSignal: 'SIGTERM'
    });
    return `=== mcp-thorns ===\n${out.trim()}`;
  } catch (e) {
    return e.killed ? '=== mcp-thorns ===\nSkipped (timeout)' : '';
  }
};

const runCodeSearch = (prompt) => {
  if (!prompt || !projectDir) return '';
  try {
    const out = execSync(`bun x codebasesearch ${JSON.stringify(prompt)}`, {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000, killSignal: 'SIGTERM',
      cwd: projectDir
    });
    return `=== codebasesearch ===\n${out.trim()}`;
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
    const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf-8'));
    prompt = input.prompt || input.message || input.userMessage || '';
  } catch (e) {}

  ensureGitignore();

  const parts = [];
  parts.push('Invoke the `gm` skill to begin. DO NOT use EnterPlanMode. DO NOT use gm subagent directly — use the `gm` skill via the Skill tool.');

  const search = runCodeSearch(prompt);
  if (search) parts.push(search);

  const thorns = runThorns();
  if (thorns) parts.push(thorns);

  emit(parts.join('\n\n'));
} catch (error) {
  emit('Invoke the `gm` skill to begin. Hook error: ' + error.message);
  process.exit(0);
}
