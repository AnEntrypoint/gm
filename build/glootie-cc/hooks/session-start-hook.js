#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || process.env.GEMINI_PROJECT_DIR || process.env.OC_PLUGIN_ROOT;
const projectDir = process.env.CLAUDE_PROJECT_DIR || process.env.GEMINI_PROJECT_DIR || process.env.OC_PROJECT_DIR;

const ensureGitignore = () => {
  if (!projectDir) return;
  const gitignorePath = path.join(projectDir, '.gitignore');
  const entry = '.glootie-stop-verified';
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

ensureGitignore();

try {
  let outputs = [];

  // 1. Read ./start.md
  if (pluginRoot) {
    const startMdPath = path.join(pluginRoot, '/agents/gm.md');
    try {
      const startMdContent = fs.readFileSync(startMdPath, 'utf-8');
      outputs.push(startMdContent);
    } catch (e) {
      // File may not exist in this context
    }
  }

  // 2. Add semantic code-search explanation
  const codeSearchContext = `## 🔍 Semantic Code Search Now Available

Your prompts will trigger **semantic code search** - intelligent, intent-based exploration of your codebase.

### How It Works
Describe what you need in plain language, and the search understands your intent:
- "Find authentication validation" → locates auth checks, guards, permission logic
- "Where is database initialization?" → finds connection setup, migrations, schemas
- "Show error handling patterns" → discovers try/catch patterns, error boundaries

NOT syntax-based regex matching - truly semantic understanding across files.

### Example
Instead of regex patterns, simply describe your intent:
"Find where API authorization is checked"

The search will find permission validations, role checks, authentication guards - however they're implemented.

### When to Use Code Search
When exploring unfamiliar code, finding similar patterns, understanding integrations, or locating feature implementations across your codebase.`;
  outputs.push(codeSearchContext);

  // 3. Run mcp-thorns (bunx with npx fallback)
  if (projectDir && fs.existsSync(projectDir)) {
    try {
      let thornOutput;
      try {
        thornOutput = execSync(`bunx mcp-thorns@latest`, {
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
            thornOutput = execSync(`npx -y mcp-thorns@latest`, {
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

  if (isGemini) {
    const result = {
      systemMessage: additionalContext
    };
    console.log(JSON.stringify(result, null, 2));
  } else if (isOpenCode) {
    const result = {
      hookSpecificOutput: {
        hookEventName: 'session.created',
        additionalContext
      }
    };
    console.log(JSON.stringify(result, null, 2));
  } else {
    const result = {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext
      }
    };
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  const isGemini = process.env.GEMINI_PROJECT_DIR !== undefined;
  const isOpenCode = process.env.OC_PLUGIN_ROOT !== undefined;

  if (isGemini) {
    console.log(JSON.stringify({
      systemMessage: `Error executing hook: ${error.message}`
    }, null, 2));
  } else if (isOpenCode) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'session.created',
        additionalContext: `Error executing hook: ${error.message}`
      }
    }, null, 2));
  } else {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: `Error executing hook: ${error.message}`
      }
    }, null, 2));
  }
  process.exit(0);
}








