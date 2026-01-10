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

const run = () => {
  if (aborted) return { decision: undefined };

  try {
    const stopInput = readStopHookInput();
    const transcriptPath = stopInput.transcript_path;
    const stopHookActive = stopInput.stop_hook_active || false;

    if (stopHookActive) {
      return { decision: undefined };
    }

    // Read and analyze last transcript entries
    const entries = readTranscriptEntries(transcriptPath, 5);

    if (entries.length === 0) {
      // No transcript to verify, just create the verification file
      fs.writeFileSync(verificationFile, 'VERIFIED');

      // Verify file was created
      if (!fs.existsSync(verificationFile)) {
        return {
          decision: 'block',
          reason: 'Verification file creation failed - unable to confirm stop hook completion'
        };
      }

      return { decision: undefined };
    }

    // Create context for glootie execution
    const entriesJson = JSON.stringify(entries, null, 2);
    const verificationCode = `
const entries = ${entriesJson};
const result = {
  entriesAnalyzed: entries.length,
  lastEntry: entries[entries.length - 1],
  hasErrors: entries.some(e => e.parseError || e.entry?.error),
  analysis: entries.map(e => ({
    line: e.line,
    type: e.entry?.event || 'unknown'
  }))
};
console.log(JSON.stringify(result, null, 2));
`;

    // Execute verification through glootie
    try {
      const output = execSync(`node -e "${verificationCode.replace(/"/g, '\\"')}"`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000
      });

      // Parse glootie output
      const result = JSON.parse(output);

      // Create verification file when done
      const verificationData = {
        timestamp: new Date().toISOString(),
        entriesAnalyzed: result.entriesAnalyzed,
        lastEntry: result.lastEntry,
        analysis: result.analysis
      };

      fs.writeFileSync(verificationFile, JSON.stringify(verificationData, null, 2));

      // Verify file was created
      if (!fs.existsSync(verificationFile)) {
        return {
          decision: 'block',
          reason: 'Verification file creation failed - unable to confirm stop hook completion'
        };
      }

      return { decision: undefined };
    } catch (e) {
      // Even on error, create verification file to proceed
      fs.writeFileSync(verificationFile, JSON.stringify({
        timestamp: new Date().toISOString(),
        error: e.message,
        verified: false
      }, null, 2));

      // Verify error file was created
      if (!fs.existsSync(verificationFile)) {
        return {
          decision: 'block',
          reason: `Stop hook verification failed: ${e.message} - unable to create verification file`
        };
      }

      return { decision: undefined };
    }
  } catch (error) {
    return { decision: undefined };
  }
};

try {
  const result = run();
  if (result.decision === 'block') {
    console.log(JSON.stringify({ decision: result.decision, reason: result.reason }));
  }
} catch (e) {
}
