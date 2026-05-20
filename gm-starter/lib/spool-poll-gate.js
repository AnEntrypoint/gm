#!/usr/bin/env node
const { isSpoolPollCommand, SPOOL_POLL_REASON, logDeviation, recordBrowserEdit, isBrowserRunningFile } = require('./spool-dispatch.js');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let event = {};
  try { event = JSON.parse(raw || '{}'); } catch (_) { event = {}; }
  const tool = event.tool_name || event.tool || '';
  const input = event.tool_input || event.input || {};
  const cwd = event.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') {
    const fp = input.file_path || input.filePath || input.path || '';
    if (fp && isBrowserRunningFile(require('path').relative(cwd, fp))) {
      try { recordBrowserEdit(cwd, fp); } catch (_) {}
      try {
        logDeviation('browser-edit.recorded', {
          operation: tool.toLowerCase(),
          file: fp,
          sess: event.session_id || process.env.CLAUDE_SESSION_ID || process.env.GM_SESSION_ID || '',
        });
      } catch (_) {}
    }
    process.stdout.write(JSON.stringify({ continue: true }));
    process.exit(0);
  }

  if (tool !== 'Bash') {
    process.stdout.write(JSON.stringify({ continue: true }));
    process.exit(0);
  }
  const command = input.command || input.cmd || '';
  const pattern = isSpoolPollCommand(command);
  if (!pattern) {
    process.stdout.write(JSON.stringify({ continue: true }));
    process.exit(0);
  }
  try {
    logDeviation('deviation.spool-poll', {
      operation: 'bash',
      pattern,
      command_excerpt: String(command).slice(0, 200),
      via: 'pre-tool-use-hook',
      sess: event.session_id || process.env.CLAUDE_SESSION_ID || process.env.GM_SESSION_ID || '',
    });
  } catch (_) {}
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: SPOOL_POLL_REASON,
  }));
  process.exit(2);
});
