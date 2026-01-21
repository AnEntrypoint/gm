#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
const projectDir = process.env.CLAUDE_PROJECT_DIR;

// Ensure .glootie-stop-verified is in .gitignore
const ensureGitignore = () => {
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
  const startMdPath = path.join(pluginRoot, '/agents/gm.md');
  const startMdContent = fs.readFileSync(startMdPath, 'utf-8');
  outputs.push(startMdContent);

  // 2. Run mcp-thorns (npx)
  try {
    const thornOutput = execSync(`npx -y gxe@latest AnEntrypoint/mcp-thorns thorns`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: projectDir,
      timeout: 180000,
      killSignal: 'SIGTERM'
    });
    outputs.push(`=== This is your initial insight of the repository, look at every possible aspect of this for initial opinionation and to offset the need for code exploration ===\n${thornOutput}`);
  } catch (e) {
    if (e.killed && e.signal === 'SIGTERM') {
      outputs.push(`=== mcp-thorns ===\nSkipped (3min timeout)`);
    } else {
      outputs.push(`=== mcp-thorns ===\nSkipped (error: ${e.message.split('\n')[0]})`);
    }
  }
  outputs.push('Use gm as a philosophy to coordinate all plans and the gm subagent to create and execute all plans');
  const additionalContext = outputs.join('\n\n');

  const result = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext
    }
  };

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `Error executing hook: ${error.message}`
    }
  }, null, 2));
  process.exit(1);
}








