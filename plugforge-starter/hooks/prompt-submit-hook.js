#!/usr/bin/env node

if (process.env.AGENTGUI_SUBPROCESS === '1') {
  console.log(JSON.stringify({ additionalContext: '' }));
  process.exit(0);
}

const fs = require('fs');
const path = require('path');

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || process.env.GEMINI_PROJECT_DIR || process.env.OC_PLUGIN_ROOT || process.env.KILO_PLUGIN_ROOT || path.join(__dirname, '..');
const projectDir = process.env.CLAUDE_PROJECT_DIR || process.env.GEMINI_PROJECT_DIR || process.env.OC_PROJECT_DIR || process.env.KILO_PROJECT_DIR;

const COMPACT_CONTEXT = 'use gm agent | ref: TOOL_INVARIANTS | codesearch for exploration | bun x gm-exec for execution';
const PLAN_MODE_BLOCK = 'DO NOT use EnterPlanMode. Use GM agent planning (PLAN→EXECUTE→EMIT→VERIFY→COMPLETE state machine) instead. Plan mode is blocked.';

const ensureGitignore = () => {
  if (!projectDir) return;
  const gitignorePath = path.join(projectDir, '.gitignore');
  const entry = '.gm-stop-verified';
  try {
    let content = '';
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, 'utf-8');
    }
    if (!content.split('\n').some(line => line.trim() === entry)) {
      const newContent = content.endsWith('\n') || content === ''
        ? content + entry + '\n'
        : content + '\n' + entry + '\n';
      fs.writeFileSync(gitignorePath, newContent);
    }
  } catch (e) {}
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
  ensureGitignore();
  emit('use gm agent | ' + COMPACT_CONTEXT + ' | ' + PLAN_MODE_BLOCK);
} catch (error) {
  emit('use gm agent | hook error: ' + error.message);
  process.exit(0);
}
