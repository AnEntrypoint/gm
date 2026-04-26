#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch (_) {}
if (!raw.trim()) raw = process.env.CLAUDE_HOOK_INPUT || '{}';
const input = JSON.parse(raw);
const toolName = input.tool_name || input.tool_use?.name || '';
const toolOutput = input.tool_result || input.output || '';
const gmDir = path.join(process.cwd(), '.gm');
const tsPath = path.join(gmDir, 'turn-state.json');
const readState = () => { try { return JSON.parse(fs.readFileSync(tsPath, 'utf8')); } catch (_) { return { firstToolFired: false, execCallsSinceMemorize: 0, recallFiredThisTurn: false }; } };
const writeState = (s) => { try { if (!fs.existsSync(gmDir)) fs.mkdirSync(gmDir, { recursive: true }); fs.writeFileSync(tsPath, JSON.stringify(s), 'utf8'); } catch (_) {} };
const state = readState();
const messages = [];
if (!state.firstToolFired) {
  state.firstToolFired = true;
  state.firstToolName = toolName;
}
const isMemorize = toolName === 'Agent' && /memorize/i.test(JSON.stringify(input.tool_input || input.tool_use?.input || {}));
if (isMemorize) {
  state.execCallsSinceMemorize = 0;
  try { fs.unlinkSync(path.join(gmDir, 'no-memorize-this-turn')); } catch (_) {}
}
if (toolName === 'Bash') {
  const cmd = (input.tool_input && input.tool_input.command) || (input.tool_use && input.tool_use.input && input.tool_use.input.command) || '';
  if (/^\s*exec:recall\b/.test(cmd)) state.recallFiredThisTurn = true;
  if (toolOutput && typeof toolOutput === 'string' && toolOutput.length > 20 && !/^\s*exec:(recall|memorize|codesearch|wait|sleep|status|runner|type|kill-port|close|pause)/.test(cmd)) {
    state.execCallsSinceMemorize = (state.execCallsSinceMemorize || 0) + 1;
    messages.push('exec: run completed. MEMORIZE CHECK: did this output resolve any prior unknown? If YES → spawn Agent(subagent_type=\'gm:memorize\', model=\'haiku\', run_in_background=true, prompt=\'## CONTEXT TO MEMORIZE\\n<fact>\') NOW. Skipping = memory leak. (Counter: ' + state.execCallsSinceMemorize + '/3 before hard block.)');
  }
}
writeState(state);
if (messages.length) process.stdout.write(JSON.stringify({ systemMessage: messages.join('\n\n') }));
