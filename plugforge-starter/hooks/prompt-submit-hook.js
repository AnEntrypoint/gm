#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
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

  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext
    }
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `Hook error: ${error.message}`
    }
  }, null, 2));
  process.exit(1);
}
