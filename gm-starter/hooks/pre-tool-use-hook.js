#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch (_) {}
if (!raw.trim()) raw = process.env.CLAUDE_HOOK_INPUT || '{}';

const input = JSON.parse(raw);
const toolName = input.tool_name || input.tool_use?.name || '';
const toolInput = input.tool_input || input.tool_use?.input || {};
const skillName = toolInput.skill || toolInput.name || '';

const gmDir = path.join(process.cwd(), '.gm');
const needsGmPath = path.join(gmDir, 'needs-gm');
const lastskillPath = path.join(gmDir, 'lastskill');

const isSkillTool = toolName === 'Skill' || toolName === 'skill';

if (isSkillTool && skillName) {
  try {
    if (!fs.existsSync(gmDir)) fs.mkdirSync(gmDir, { recursive: true });
    fs.writeFileSync(lastskillPath, skillName, 'utf8');
    if (skillName === 'gm' || skillName === 'gm:gm') {
      try { fs.unlinkSync(needsGmPath); } catch (_) {}
    }
  } catch (_) {}
  process.exit(0);
}

if (fs.existsSync(needsGmPath)) {
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: 'HARD CONSTRAINT: invoke the Skill tool with skill: "gm" before any other tool. The gm skill must be the first action after every user message.'
  }));
  process.exit(0);
}

const lastSkill = (() => { try { return fs.readFileSync(lastskillPath, 'utf8').trim(); } catch (_) { return ''; } })();
const isFileEdit = ['Write', 'Edit', 'NotebookEdit'].includes(toolName);
const WRITE_BLOCKED_PHASES = new Set(['gm-complete', 'update-docs']);

if (isFileEdit && WRITE_BLOCKED_PHASES.has(lastSkill)) {
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: `File edits are not permitted in ${lastSkill} phase. Regress to gm-execute if changes are needed, or invoke gm-emit to re-emit.`
  }));
  process.exit(0);
}
