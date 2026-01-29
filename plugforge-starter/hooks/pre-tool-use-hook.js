#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const run = () => {
  try {
    const input = fs.readFileSync(0, 'utf-8');
    const data = JSON.parse(input);
    const { tool_name, tool_input } = data;

    if (!tool_name) {
      return { permissionDecision: 'allow' };
    }

    if (tool_name === 'Bash') {
      return {
        permissionDecision: 'deny',
        permissionDecisionReason: 'Use dev execute instead for all command execution'
      };
    }

    if (tool_name === 'Write') {
      const file_path = tool_input?.file_path || '';
      const file_extension = path.extname(file_path);
      const inSkillsDir = file_path.includes('/skills/');
      if ((file_extension === '.md' || file_extension === '.txt' || path.basename(file_path).startsWith('features_list')) && !path.basename(file_path).startsWith('CLAUDE') && !path.basename(file_path).startsWith('readme') && !inSkillsDir) {
        return {
          permissionDecision: 'deny',
          permissionDecisionReason: 'As a coding agent you may not create any new text documents, you may only maintain a continuously reduced technical caveats-only version of CLAUDE.md and readme.md (only by editing), and continuously remove anything it doesnt need from that perspective every time you edit it'
        };
      }
    }

    if (tool_name === 'Glob' || tool_name === 'Grep') {
      return {
        permissionDecision: 'deny',
        permissionDecisionReason: `For semantic codebase search and exploration, use the code search sub agent, or if not available use mcp code-search, otherwise use dev execute over MCP using code for direct code exploration instead using code to intelligently navigate and understand the structure`
      };
    }

    if (tool_name === 'Task') {
      const subagentType = tool_input?.subagent_type || '';
      if (subagentType === 'Explore') {
        return {
          permissionDecision: 'deny',
          permissionDecisionReason: 'Use gm sub agent with tell it to look at its initial codebase insight, use only code search sub agent or dev execute for code execution and code-search mcp for codebase exploration and call it many times with different statements if the sub agent is unavailable'
        };
      }
      return { permissionDecision: 'allow' };
    }

    return { permissionDecision: 'allow' };
  } catch (error) {
    return { permissionDecision: 'allow' };
  }
};

try {
  const result = run();

  const isGemini = process.env.GEMINI_PROJECT_DIR !== undefined;
  const isOpenCode = process.env.OC_PLUGIN_ROOT !== undefined;

  if (isGemini) {
    const output = {
      decision: result.permissionDecision,
      systemMessage: result.permissionDecisionReason || ''
    };
    console.log(JSON.stringify(output, null, 2));
  } else if (isOpenCode) {
    const output = {
      hookSpecificOutput: {
        hookEventName: 'tool.execute.before',
        decision: result.permissionDecision,
        systemMessage: result.permissionDecisionReason || ''
      }
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    const output = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        ...result
      }
    };
    console.log(JSON.stringify(output, null, 2));
  }
} catch (error) {
  const isGemini = process.env.GEMINI_PROJECT_DIR !== undefined;

  if (isGemini) {
    console.log(JSON.stringify({
      decision: 'allow',
      systemMessage: ''
    }, null, 2));
  } else {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow'
      }
    }, null, 2));
  }
}







