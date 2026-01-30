#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const run = () => {
  try {
    const input = fs.readFileSync(0, 'utf-8');
    const data = JSON.parse(input);
    const { tool_name, tool_input } = data;

    if (!tool_name) {
      return { allow: true };
    }

    // Block Bash - use dev execute instead
    if (tool_name === 'Bash') {
      return {
        block: true,
        reason: 'Use dev execute instead for all command execution'
      };
    }

    // Block Write for documentation files (except CLAUDE.md, readme.md, skills/)
    if (tool_name === 'Write') {
      const file_path = tool_input?.file_path || '';
      const file_extension = path.extname(file_path);
      const inSkillsDir = file_path.includes('/skills/');
      const basename = path.basename(file_path);
      
      if ((file_extension === '.md' || file_extension === '.txt' || basename.startsWith('features_list')) && 
          !basename.toLowerCase().startsWith('claude') && 
          !basename.toLowerCase().startsWith('readme') && 
          !inSkillsDir) {
        return {
          block: true,
          reason: 'Cannot create documentation files. Only CLAUDE.md and readme.md are maintained.'
        };
      }
    }

    // Block Glob and Grep - use code search instead
    if (tool_name === 'Glob' || tool_name === 'Grep') {
      return {
        block: true,
        reason: `Use gm:code-search skill or plugin:gm:dev for code exploration`
      };
    }

    // Block Explore subagent
    if (tool_name === 'Task') {
      const subagentType = tool_input?.subagent_type || '';
      if (subagentType === 'Explore') {
        return {
          block: true,
          reason: 'Use gm:thorns-overview for codebase insight, then use gm:code-search or plugin:gm:dev'
        };
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
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: result.reason
      }
    }, null, 2));
    process.exit(2);
  }

  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow'
    }
  }, null, 2));
  process.exit(0);
} catch (error) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow'
    }
  }, null, 2));
  process.exit(0);
}
