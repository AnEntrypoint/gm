#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const isGemini = process.env.GEMINI_PROJECT_DIR !== undefined;

const writeTools = ['Write', 'write_file'];
const searchTools = ['glob', 'search_file_content', 'Search', 'search'];
const forbiddenTools = ['find', 'Find', 'Glob', 'Grep'];

const run = () => {
  try {
    const input = fs.readFileSync(0, 'utf-8');
    const data = JSON.parse(input);
    const { tool_name, tool_input } = data;

    if (!tool_name) return { allow: true };

    if (forbiddenTools.includes(tool_name)) {
      return { block: true, reason: 'Use the code-search skill for codebase exploration instead of Grep/Glob/find. Describe what you need in plain language — it understands intent, not just patterns.' };
    }

    if (writeTools.includes(tool_name)) {
      const file_path = tool_input?.file_path || '';
      const ext = path.extname(file_path);
      const inSkillsDir = file_path.includes('/skills/') || file_path.includes('\\skills\\');
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
        return { block: true, reason: 'Test files forbidden on disk. Use Bash tool with real services for all testing.' };
      }
    }

    if (searchTools.includes(tool_name)) {
      return { allow: true };
    }

    if (tool_name === 'Task') {
      const subagentType = tool_input?.subagent_type || '';
      if (subagentType === 'Explore') {
        return { block: true, reason: 'Use gm:thorns-overview for codebase insight, then use gm:code-search' };
      }
    }

    if (tool_name === 'EnterPlanMode') {
      return { block: true, reason: 'Plan mode is disabled. Use GM agent planning (PLAN→EXECUTE→EMIT→VERIFY→COMPLETE state machine) via gm:gm subagent instead.' };
    }

    if (tool_name === 'Skill') {
      const skill = (tool_input?.skill || '').toLowerCase().replace(/^gm:/, '');
      if (skill === 'explore' || skill === 'search') {
        return { block: true, reason: 'Use the code-search skill for codebase exploration. Describe what you need in plain language — it understands intent, not just patterns.' };
      }
    }

    if (tool_name === 'Bash') {
      const command = (tool_input?.command || '').trim();
      if (!/^bun x mcp-gm(\s|$)/.test(command)) {
        return { block: true, reason: 'Bash is restricted to: bun x mcp-gm. All other commands are blocked.' };
      }
    }

    // Allow essential tools explicitly
    const allowedTools = ['agent-browser', 'Skill', 'code-search', 'electron', 'TaskOutput', 'ReadMcpResourceTool', 'ListMcpResourcesTool'];
    if (allowedTools.includes(tool_name)) {
      return { allow: true };
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
      console.log(JSON.stringify({ decision: 'block', reason: result.reason }));
    }
    process.exit(0);
  }

  if (isGemini) {
    console.log(JSON.stringify({ decision: 'allow' }));
  }

  process.exit(0);
} catch (error) {
  process.exit(0);
}
