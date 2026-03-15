#!/usr/bin/env bun

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || process.env.GEMINI_PROJECT_DIR || process.env.OC_PLUGIN_ROOT || process.env.KILO_PLUGIN_ROOT;
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

  if (pluginRoot) {
    const gmMdPath = path.join(pluginRoot, '/agents/gm.md');
    try {
      const gmMdContent = fs.readFileSync(gmMdPath, 'utf-8');
      outputs.push(gmMdContent);
    } catch (e) {}
  }

  const codeSearchContext = `## Semantic Code Search Available

Describe what you need in plain language to search the codebase:
- "Find authentication validation" locates auth checks, guards, permission logic
- "Where is database initialization?" finds connection setup, migrations, schemas
- "Show error handling patterns" discovers try/catch patterns, error boundaries

Use the code-search skill for all codebase exploration.`;
  outputs.push(codeSearchContext);

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
  outputs.push('Use gm as a philosophy to coordinate all plans and the gm subagent to create and execute all plans');
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
