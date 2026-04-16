#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const input = JSON.parse(process.env.CLAUDE_HOOK_INPUT || '{}');
const toolName = input.tool_name || input.tool_use?.name || '';
const toolInput = input.tool_input || input.tool_use?.input || {};

if (toolName === 'Skill' && toolInput.skill) {
  try {
    const gmDir = path.join(process.cwd(), '.gm');
    if (!fs.existsSync(gmDir)) fs.mkdirSync(gmDir, { recursive: true });
    fs.writeFileSync(path.join(gmDir, 'lastskill'), toolInput.skill, 'utf8');
  } catch (_) {}
}
