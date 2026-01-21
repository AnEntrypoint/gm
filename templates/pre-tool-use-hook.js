#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DECISION_DENY = 'deny';
const DECISION_ALLOW = 'allow';

const run = () => {
  try {
    const input = fs.readFileSync(0, 'utf-8');
    const data = JSON.parse(input);
    const { tool_name, tool_input } = data;

    if (!tool_name) {
      return { decision: DECISION_ALLOW };
    }

    const bashTools = ['${TOOL_BASH}', 'run_shell_command'];
    const writeTools = ['${TOOL_WRITE}', 'write_file'];
    const searchTools = ['${TOOL_GLOB}', '${TOOL_GREP}', 'glob', 'search_file_content', 'search'];

    if (bashTools.includes(tool_name)) {
      return {
        decision: DECISION_DENY,
        reason: 'Use dev execute instead for all command execution'
      };
    }

    if (writeTools.includes(tool_name)) {
      const file_path = tool_input?.file_path || '';
      const file_extension = path.extname(file_path);
      const baseName = path.basename(file_path);
      const isMdOrTxt = file_extension === '.md' || file_extension === '.txt';
      const isAllowed = baseName.startsWith('CLAUDE') || baseName.startsWith('GEMINI') || baseName.startsWith('readme');

      if (isMdOrTxt && !isAllowed) {
        return {
          decision: DECISION_DENY,
          reason: 'As a coding agent you may not create any new text documents, you may only maintain a continuously reduced technical caveats-only version of context files (only by editing), and continuously remove anything it doesnt need from that perspective every time you edit it'
        };
      }
    }

    if (searchTools.includes(tool_name)) {
      return {
        decision: DECISION_DENY,
        reason: 'For semantic codebase search and exploration, use the code search sub agent, or if not available use mcp code-search, otherwise use dev execute over MCP using code for direct code exploration instead using code to intelligently navigate and understand the structure'
      };
    }

    if (tool_name === 'Task') {
      const subagentType = tool_input?.subagent_type || '';
      if (subagentType === 'Explore') {
        return {
          decision: DECISION_DENY,
          reason: 'Use gm sub agent with tell it to look at its initial codebase insight, use only code search sub agent or dev execute for code execution and code-search mcp for codebase exploration and call it many times with different statements if the sub agent is unavailable'
        };
      }
      return { decision: DECISION_ALLOW };
    }

    return { decision: DECISION_ALLOW };
  } catch (error) {
    return { decision: DECISION_ALLOW };
  }
};

try {
  const result = run();
  ${HOOK_OUTPUT_WRAPPER_START}
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      ...result
    }
  };
  ${HOOK_OUTPUT_WRAPPER_END}
  console.log(JSON.stringify(${HOOK_OUTPUT_EXTRACT}, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    ${HOOK_OUTPUT_WRAPPER_START}
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      decision: 'allow'
    }
    ${HOOK_OUTPUT_WRAPPER_END}
  }, null, 2));
}
