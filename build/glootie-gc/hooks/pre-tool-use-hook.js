#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const isGemini = process.env.GEMINI_PROJECT_DIR !== undefined;

const shellTools = ['Bash', 'run_shell_command'];
const writeTools = ['Write', 'write_file'];
const searchTools = ['Glob', 'Grep', 'glob', 'search_file_content', 'Search', 'search', 'mcp__plugin_gm_code-search__search'];
const forbiddenTools = ['find', 'Find'];

const run = () => {
  try {
    const input = fs.readFileSync(0, 'utf-8');
    const data = JSON.parse(input);
    const { tool_name, tool_input } = data;

    if (!tool_name) return { allow: true };

    if (forbiddenTools.includes(tool_name)) {
      return { block: true, reason: 'Use gm:code-search or plugin:gm:dev for semantic codebase search instead of filesystem find' };
    }

    if (shellTools.includes(tool_name)) {
      return { block: true, reason: 'Use dev execute instead for all command execution' };
    }

    if (writeTools.includes(tool_name)) {
      const file_path = tool_input?.file_path || '';
      const ext = path.extname(file_path);
      const inSkillsDir = file_path.includes('/skills/');
      const base = path.basename(file_path).toLowerCase();
      if ((ext === '.md' || ext === '.txt' || base.startsWith('features_list')) &&
          !base.startsWith('claude') && !base.startsWith('readme') && !inSkillsDir) {
        return { block: true, reason: 'Cannot create documentation files. Only CLAUDE.md and readme.md are maintained.' };
      }
      if (/\.(test|spec)\.(js|ts|jsx|tsx|mjs|cjs)$/.test(base) ||
          /^(jest|vitest|mocha|ava|jasmine|tap)\.(config|setup)/.test(base) ||
          file_path.includes('/__tests__/') || file_path.includes('/test/') ||
          file_path.includes('/tests/') || file_path.includes('/fixtures/') ||
          file_path.includes('/test-data/') || file_path.includes('/__mocks__/') ||
          /\.(snap|stub|mock|fixture)\.(js|ts|json)$/.test(base)) {
        return { block: true, reason: 'Test files forbidden on disk. Use plugin:gm:dev with real services for all testing.' };
      }
    }

    if (searchTools.includes(tool_name)) {
      return { block: true, reason: 'Use gm:code-search skill or plugin:gm:dev for code exploration' };
    }

    if (tool_name === 'Task') {
      const subagentType = tool_input?.subagent_type || '';
      if (subagentType === 'Explore') {
        return { block: true, reason: 'Use gm:thorns-overview for codebase insight, then use gm:code-search or plugin:gm:dev' };
      }
    }

    return { allow: true };
  } catch (error) {
    return { allow: true };
  }
};

try {
  const result = run();

  if (result.block) {
    if (isGemini) {
      console.log(JSON.stringify({ decision: 'deny', reason: result.reason }));
    } else {
      console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: result.reason } }));
    }
    process.exit(2);
  }

  if (isGemini) {
    console.log(JSON.stringify({ decision: 'allow' }));
  } else {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }));
  }
  process.exit(0);
} catch (error) {
  if (isGemini) {
    console.log(JSON.stringify({ decision: 'allow' }));
  } else {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }));
  }
  process.exit(0);
}
