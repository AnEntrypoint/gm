#!/usr/bin/env bun

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.env.GEMINI_PROJECT_DIR || process.env.OC_PROJECT_DIR || process.env.KILO_PROJECT_DIR;

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

ensureGitignore();

try {
  let outputs = [];

  outputs.push('Invoke the `gm` skill to begin. All code execution uses exec:<lang> via the Bash tool — never direct Bash(node ...) or Bash(npm ...) or Bash(npx ...).');

  if (projectDir && fs.existsSync(projectDir)) {
    try {
      let thornOutput;
      try {
        thornOutput = execSync(`bun x mcp-thorns@latest`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: projectDir,
          timeout: 15000,
          killSignal: 'SIGTERM'
        });
      } catch (bunErr) {
        thornOutput = bunErr.killed
          ? '=== mcp-thorns ===\nSkipped (timeout)'
          : `=== mcp-thorns ===\nSkipped (error: ${bunErr.message.split('\n')[0]})`;
      }
      outputs.push(`=== This is your initial insight of the repository, look at every possible aspect of this for initial opinionation and to offset the need for code exploration ===\n${thornOutput}`);
    } catch (e) {
      if (e.killed && e.signal === 'SIGTERM') {
        outputs.push(`=== mcp-thorns ===\nSkipped (3min timeout)`);
      } else {
        outputs.push(`=== mcp-thorns ===\nSkipped (error: ${e.message.split('\n')[0]})`);
      }
    }
  }
  const additionalContext = outputs.join('\n\n');

  const isGemini = process.env.GEMINI_PROJECT_DIR !== undefined;
  const isOpenCode = process.env.OC_PLUGIN_ROOT !== undefined;
  const isKilo = process.env.KILO_PLUGIN_ROOT !== undefined;

  if (isGemini) {
    console.log(JSON.stringify({ systemMessage: additionalContext }, null, 2));
  } else if (isOpenCode || isKilo) {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'session.created', additionalContext } }, null, 2));
  } else {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }, null, 2));
  }
} catch (error) {
  const isGemini = process.env.GEMINI_PROJECT_DIR !== undefined;
  const isOpenCode = process.env.OC_PLUGIN_ROOT !== undefined;
  const isKilo = process.env.KILO_PLUGIN_ROOT !== undefined;

  if (isGemini) {
    console.log(JSON.stringify({ systemMessage: `Error executing hook: ${error.message}` }, null, 2));
  } else if (isOpenCode || isKilo) {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'session.created', additionalContext: `Error executing hook: ${error.message}` } }, null, 2));
  } else {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `Error executing hook: ${error.message}` } }, null, 2));
  }
  process.exit(0);
}
