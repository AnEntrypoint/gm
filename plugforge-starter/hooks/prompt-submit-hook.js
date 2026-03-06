#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || process.env.GEMINI_PROJECT_DIR || process.env.OC_PLUGIN_ROOT || process.env.KILO_PLUGIN_ROOT || path.join(__dirname, '..');
const projectDir = process.env.CLAUDE_PROJECT_DIR || process.env.GEMINI_PROJECT_DIR || process.env.OC_PROJECT_DIR || process.env.KILO_PROJECT_DIR;

const COMPACT_CONTEXT = 'use gm agent | ref: TOOL_INVARIANTS | codesearch for exploration | Bash for execution';
const PLAN_MODE_BLOCK = 'DO NOT use EnterPlanMode or any plan mode tool. Use GM agent planning (PLAN→EXECUTE→EMIT→VERIFY→COMPLETE state machine) instead. Plan mode is blocked.';

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
  } catch (e) {
    // Silently fail - not critical
  }
};


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

const readGmAgent = () => {
  if (!pluginRoot) return '';
  try {
    return fs.readFileSync(path.join(pluginRoot, 'agents/gm.md'), 'utf-8');
  } catch (e) {
    return '';
  }
};

const runMcpThorns = () => {
  if (!projectDir || !fs.existsSync(projectDir)) return '';
  try {
    let thornOutput;
    try {
      thornOutput = execSync('bun x mcp-thorns', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: projectDir,
        timeout: 180000,
        killSignal: 'SIGTERM'
      });
    } catch (bunErr) {
      if (bunErr.killed && bunErr.signal === 'SIGTERM') {
        thornOutput = '=== mcp-thorns ===\nSkipped (3min timeout)';
      } else {
        try {
          thornOutput = execSync('npx -y mcp-thorns', {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: projectDir,
            timeout: 180000,
            killSignal: 'SIGTERM'
          });
        } catch (npxErr) {
          if (npxErr.killed && npxErr.signal === 'SIGTERM') {
            thornOutput = '=== mcp-thorns ===\nSkipped (3min timeout)';
          } else {
            thornOutput = `=== mcp-thorns ===\nSkipped (error: ${bunErr.message.split('\n')[0]})`;
          }
        }
      }
    }
    return `=== Repository analysis ===\n${thornOutput}`;
  } catch (e) {
    return `=== mcp-thorns ===\nSkipped (error: ${e.message.split('\n')[0]})`;
  }
};

const runCodeSearch = (query, cwd) => {
  if (!query || !cwd || !fs.existsSync(cwd)) return '';
  try {
    const escaped = query.replace(/"/g, '\\"').substring(0, 200);
    let out;
    try {
      out = execSync(`bun x codebasesearch "${escaped}"`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd,
        timeout: 55000,
        killSignal: 'SIGTERM'
      });
    } catch (bunErr) {
      if (bunErr.killed) return '';
      out = execSync(`npx -y codebasesearch "${escaped}"`, {
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

  const prompt = readStdinPrompt();
  const parts = [];

  // Always: include gm.md and mcp-thorns
  const gmContent = readGmAgent();
  if (gmContent) {
    parts.push(gmContent);
  }

  const thornOutput = runMcpThorns();
  parts.push(thornOutput);

  // Always: base context and codebasesearch
  parts.push(getBaseContext() + ' | ' + COMPACT_CONTEXT + ' | ' + PLAN_MODE_BLOCK);

  if (prompt && projectDir) {
    const searchResults = runCodeSearch(prompt, projectDir);
    if (searchResults) {
      parts.push(`=== Semantic code search results ===\n${searchResults}`);
    }
  }

  emit(parts.join('\n\n'));
} catch (error) {
  emit(getBaseContext('hook error: ' + error.message) + ' | ' + COMPACT_CONTEXT);
  process.exit(0);
}
