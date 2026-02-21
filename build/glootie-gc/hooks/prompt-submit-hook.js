#!/usr/bin/env node

const fs = require('fs');
const { execSync } = require('child_process');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.env.GEMINI_PROJECT_DIR || process.env.OC_PROJECT_DIR;

const COMPACT_CONTEXT = 'use gm agent | ref: TOOL_INVARIANTS | codesearch for exploration | plugin:gm:dev for execution';

const getBaseContext = (resetMsg = '') => {
  let ctx = 'use gm agent';
  if (resetMsg) ctx += ' - ' + resetMsg;
  return ctx;
};

const readStdinPrompt = () => {
  try {
    const raw = fs.readFileSync(0, 'utf-8');
    const data = JSON.parse(raw);
    return data.prompt || '';
  } catch (e) {
    return '';
  }
};

const runCodeSearch = (query, cwd) => {
  if (!query || !cwd || !fs.existsSync(cwd)) return '';
  try {
    const escaped = query.replace(/"/g, '\\"').substring(0, 200);
    let out;
    try {
      out = execSync(`bunx codebasesearch@latest "${escaped}"`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd,
        timeout: 55000,
        killSignal: 'SIGTERM'
      });
    } catch (bunErr) {
      if (bunErr.killed) return '';
      out = execSync(`npx -y codebasesearch@latest "${escaped}"`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd,
        timeout: 55000,
        killSignal: 'SIGTERM'
      });
    }
    const lines = out.split('\n');
    const resultStart = lines.findIndex(l => l.includes('Searching for:'));
    return resultStart >= 0 ? lines.slice(resultStart).join('\n').trim() : out.trim();
  } catch (e) {
    return '';
  }
};

const emit = (additionalContext) => {
  const isGemini = process.env.GEMINI_PROJECT_DIR !== undefined;
  const isOpenCode = process.env.OC_PLUGIN_ROOT !== undefined;

  if (isGemini) {
    console.log(JSON.stringify({ systemMessage: additionalContext }, null, 2));
  } else if (isOpenCode) {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'message.updated', additionalContext } }, null, 2));
  } else {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } }, null, 2));
  }
};

try {
  const prompt = readStdinPrompt();
  const parts = [getBaseContext() + ' | ' + COMPACT_CONTEXT];

  if (prompt && projectDir) {
    const searchResults = runCodeSearch(prompt, projectDir);
    if (searchResults) {
      parts.push(`=== Semantic code search results for initial prompt ===\n${searchResults}`);
    }
  }

  emit(parts.join('\n\n'));
} catch (error) {
  emit(getBaseContext('hook error: ' + error.message) + ' | ' + COMPACT_CONTEXT);
  process.exit(0);
}
