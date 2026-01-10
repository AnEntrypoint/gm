#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
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

const run = () => {
  if (aborted) return { decision: undefined };

  try {
    const stopInput = readStopHookInput();
    const stopHookActive = stopInput.stop_hook_active || false;

    if (stopHookActive) {
      return { decision: undefined };
    }

    // Check if verification file exists
    const fileExists = fs.existsSync(verificationFile);

    if (!fileExists) {
      // File doesn't exist - instruct agent to verify and create it
      const transcriptPath = stopInput.transcript_path;
      const entries = readTranscriptEntries(transcriptPath, 5);
      const instruction = `Use glootie code execution to check the last few json entries in the transcript one by one, devise a mechanism to verify that it's finished, and touch the file ${verificationFile} when confirmed.`;

      return {
        decision: 'block',
        reason: `Verification pending: ${instruction}`,
        hookSpecificOutput: {
          hookEventName: 'Stop',
          additionalContext: instruction,
          transcriptEntries: entries.length > 0 ? entries : null
        }
      };
    }

    // File exists - allow stop to proceed
    return { decision: undefined };
  } catch (error) {
    return { decision: undefined };
  }
};

try {
  const result = run();
  if (result.decision === 'block') {
    const output = {
      decision: result.decision,
      reason: result.reason
    };
    if (result.hookSpecificOutput) {
      output.hookSpecificOutput = result.hookSpecificOutput;
    }
    console.log(JSON.stringify(output, null, 2));
  }
} catch (e) {
}
