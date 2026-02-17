#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.env.GEMINI_PROJECT_DIR || process.env.OC_PROJECT_DIR || process.cwd();
const verificationFile = path.join(projectDir, '.glootie-stop-verified');

const COERCIVE_CONTEXT = `
CRITICAL TOOL POLICY - AUTOMATIC ENFORCEMENT:
- NEVER use glob, grep, find, search directly - these are BLOCKED
- NEVER use bash for file exploration - use plugin:gm:dev exclusively  
- ALWAYS use codesearch tool for code exploration (semantic, not syntax)
- ALWAYS use plugin:gm:dev for command execution and testing
- Explore with intent: "codesearch: find code that handles X" not "grep pattern"
- Execute with dev: run all commands in plugin:gm:dev environment
`.trim();

const getBaseContext = (resetMsg = '') => {
  let ctx = 'always use gm sub agent for everything';
  if (resetMsg) {
    ctx += ' - ' + resetMsg;
  }
  return ctx;
};

try {
  let stdinData = '';
  try {
    stdinData = fs.readFileSync(0, 'utf-8');
  } catch (e) {
  }

  let userPrompt = '';
  try {
    if (stdinData) {
      const parsed = JSON.parse(stdinData);
      userPrompt = parsed.prompt || parsed.message || parsed.text || '';
    }
  } catch (e) {
  }

  const promptLower = userPrompt.toLowerCase();
  const explorationTriggers = ['find', 'search', 'look', 'where', 'how', 'what', 'check', 'explore', 'list', 'show', 'get', 'locate', 'identify'];
  const needsCodesearch = explorationTriggers.some(t => promptLower.includes(t)) && userPrompt.length > 10;
  
  let additionalContext = getBaseContext();
  
  if (needsCodesearch) {
    additionalContext += ` | EXPLORATION DETECTED: use codesearch tool (NOT glob/grep/find) to find relevant code patterns. Do NOT use bash for exploration.`;
  }
  
  additionalContext += ` | ${COERCIVE_CONTEXT}`;

  if (fs.existsSync(verificationFile)) {
    try {
      fs.unlinkSync(verificationFile);
      additionalContext += ' - verification file reset for new session';
    } catch (e) {
      additionalContext += ` - could not delete verification file: ${e.message}`;
    }
  }

  const isGemini = process.env.GEMINI_PROJECT_DIR !== undefined;
  const isOpenCode = process.env.OC_PLUGIN_ROOT !== undefined;

  if (isGemini) {
    console.log(JSON.stringify({
      systemMessage: additionalContext
    }, null, 2));
  } else if (isOpenCode) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'message.updated',
        additionalContext
      }
    }, null, 2));
  } else {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext
      }
    }, null, 2));
  }
} catch (error) {
  const isGemini = process.env.GEMINI_PROJECT_DIR !== undefined;
  const isOpenCode = process.env.OC_PLUGIN_ROOT !== undefined;
  
  const fallbackContext = getBaseContext(`hook error: ${error.message}`) + ` | ${COERCIVE_CONTEXT}`;

  if (isGemini) {
    console.log(JSON.stringify({
      systemMessage: fallbackContext
    }, null, 2));
  } else if (isOpenCode) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'message.updated',
        additionalContext: fallbackContext
      }
    }, null, 2));
  } else {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: fallbackContext
      }
    }, null, 2));
  }
  process.exit(0);
}
