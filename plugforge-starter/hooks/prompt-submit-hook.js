#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const COMPACT_CONTEXT = 'use gm agent | ref: TOOL_INVARIANTS | codesearch for exploration | plugin:gm:dev for execution';

const getBaseContext = (resetMsg = '') => {
  let ctx = 'use gm agent';
  if (resetMsg) {
    ctx += ' - ' + resetMsg;
  }
  return ctx;
};

try {
  let additionalContext = getBaseContext();

  additionalContext += ' | ' + COMPACT_CONTEXT;

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
  
  const fallbackContext = getBaseContext('hook error: ' + error.message) + ' | ' + COMPACT_CONTEXT;

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
