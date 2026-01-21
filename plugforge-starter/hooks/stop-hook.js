#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
const verificationFile = path.join(projectDir, '.glootie-stop-verified');

let aborted = false;
process.on('SIGTERM', () => { aborted = true; });
process.on('SIGINT', () => { aborted = true; });

const readStopHookInput = () => {
  try {
    const input = fs.readFileSync(0, 'utf-8');
    return JSON.parse(input);
  } catch (e) {
    return {};
  }
};

const readTranscriptEntries = (transcriptPath, count = 5) => {
  try {
    const expandedPath = transcriptPath.replace('~', process.env.HOME || '/root');
    if (!fs.existsSync(expandedPath)) {
      return [];
    }

    const content = fs.readFileSync(expandedPath, 'utf-8');
    const lines = content.trim().split('\n');
    const lastLines = lines.slice(-count);

    return lastLines.map((line, idx) => {
      try {
        return { line: lines.length - count + idx, entry: JSON.parse(line) };
      } catch (e) {
        return { line: lines.length - count + idx, entry: null, parseError: true };
      }
    });
  } catch (e) {
    return [];
  }
};

const extractTranscriptContext = (sessionId) => {
  try {
    const home = process.env.HOME || '/root';
    const transcriptPath = path.join(home, '.claude', 'history.jsonl');

    if (!fs.existsSync(transcriptPath)) {
      return null;
    }

    const content = fs.readFileSync(transcriptPath, 'utf-8');
    const lines = content.trim().split('\n');

    const filteredEntries = [];
    lines.forEach((line) => {
      try {
        const entry = JSON.parse(line);
        if (entry.project === projectDir && sessionId && entry.sessionId === sessionId) {
          filteredEntries.push(entry);
        }
      } catch (e) {}
    });

    const lastEntries = filteredEntries.slice(-10);
    const context = [];

    lastEntries.forEach((entry) => {
      if (entry.display) {
        const displayText = typeof entry.display === 'string'
          ? entry.display.substring(0, 300)
          : JSON.stringify(entry.display).substring(0, 300);
        context.push(displayText);
      }
    });

    return context.length > 0 ? context.join('\n---\n') : null;
  } catch (e) {
    return null;
  }
};

const run = () => {
  if (aborted) return { decision: undefined };

  try {
    const stopInput = readStopHookInput();
    const transcriptPath = stopInput.transcript_path;
    const stopHookActive = stopInput.stop_hook_active || false;
    const sessionId = stopInput.sessionId || null;

    if (stopHookActive) {
      return { decision: undefined };
    }

    // Check if verification file exists
    if (fs.existsSync(verificationFile)) {
      // File exists, allow stop to proceed
      return { decision: undefined };
    }

    // Extract context from recent transcript entries (current session only)
    const transcriptContext = extractTranscriptContext(sessionId);

    // Build instruction with context about work being done
    let instruction = `You must verify that the work specified in the recent transcript context below is complete. Use glootie code execution and playwriter to independently confirm all specified tasks are finished. Once verified, touch the file ${verificationFile} to signal completion (do not add any content to the file). You are only authorized to create this on the premise of ground truth evidence, do not make any assumptions, do not ever create this to meet a token limit or any other budget. It is safe to leave it even if the budget is spent. Once completion is achieved, you must update CLAUDE.md and readme.md, remove everything that no longer applies or shouldnt be there, and add only technical caveats and gotchas that are confirmed to apply and were discovered along the way, for future reference\n\n`;

    if (transcriptContext) {
      instruction += `=== RECENT WORK CONTEXT ===\n${transcriptContext}\n\n`;
      instruction += `=== VERIFICATION TASK ===\nDevise a verification mechanism using glootie and playwriter to confirm the work above is complete and functioning correctly. Check:\n1. Code exists and is properly formatted\n2. Tests pass (if applicable)\n3. No errors in execution\n4. All requirements from the context are satisfied\n\nWhen all checks pass, create the verification file: ${verificationFile} VERY IMPORTANT: the last 1% is 99% of the work, if there is any work left plan every aspect of remaining work and proceed with executing that`;
    } else {
      instruction += `No recent context found. Devise a mechanism to verify that the current session work is complete using glootie code execution and playwriter integration testing. When verified, touch ${verificationFile}. (create the file dont add any content, never base your decision on how much context is left or any budget choices, you must continue through even if the remaining context is small)`;
    }

    return {
      decision: 'block',
      reason: instruction
    };
  } catch (error) {
    return { decision: undefined };
  }
};

try {
  const result = run();
  if (result.decision === 'block') {
    console.log(JSON.stringify({
      decision: result.decision,
      reason: result.reason
    }));
  }
} catch (e) {
}



