#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.env.GEMINI_PROJECT_DIR || process.env.OC_PROJECT_DIR || process.cwd();
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || process.env.GEMINI_PROJECT_DIR || process.env.OC_PLUGIN_ROOT;
const prdFile = path.join(projectDir, '.prd');

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

    // Check if .prd file exists and has content
    if (fs.existsSync(prdFile)) {
      const prdContent = fs.readFileSync(prdFile, 'utf-8').trim();
      if (prdContent.length > 0) {
        // .prd has content, block with message about unfinished work
        return {
          decision: 'block',
          reason: `Work items remain in ${prdFile}. Use code execution to verify all work is complete before stopping. Remove completed items from ${prdFile} as they finish. Current items:\n\n${prdContent}`
        };
      }
    }

    // .prd doesn't exist or is empty, allow stop to proceed
    return { decision: undefined };
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



