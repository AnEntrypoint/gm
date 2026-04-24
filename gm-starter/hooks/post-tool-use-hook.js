#!/usr/bin/env node

const fs = require('fs');

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch (_) {}
if (!raw.trim()) raw = process.env.CLAUDE_HOOK_INPUT || '{}';

const input = JSON.parse(raw);
const toolName = input.tool_name || input.tool_use?.name || '';
const toolOutput = input.tool_result || input.output || '';

const EXEC_TOOLS = new Set(['Bash']);
const isExecTool = EXEC_TOOLS.has(toolName);

if (isExecTool && toolOutput && typeof toolOutput === 'string' && toolOutput.length > 20) {
  process.stdout.write(JSON.stringify({
    systemMessage: 'exec: run completed. MEMORIZE CHECK: did this output resolve any prior unknown (API shape, version, behavior, env quirk, root cause, user preference)? If YES → spawn Agent(subagent_type=\'memorize\', model=\'haiku\', run_in_background=true, prompt=\'## CONTEXT TO MEMORIZE\\n<fact>\') NOW, before your next tool call. One call per fact. Skipping = memory leak = bug.'
  }));
}
