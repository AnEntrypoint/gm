#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.env.GEMINI_PROJECT_DIR || process.env.OC_PROJECT_DIR || process.cwd();
const verificationFile = path.join(projectDir, '.glootie-stop-verified');

try {
  let additionalContext = 'always use gm sub agent for everything';

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

  if (isGemini) {
    console.log(JSON.stringify({
      systemMessage: `Hook error: ${error.message}`
    }, null, 2));
  } else if (isOpenCode) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'message.updated',
        additionalContext: `Hook error: ${error.message}`
      }
    }, null, 2));
  } else {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: `Hook error: ${error.message}`
      }
    }, null, 2));
  }
  process.exit(0);
}
