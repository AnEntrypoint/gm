#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.env.GEMINI_PROJECT_DIR || process.env.OC_PROJECT_DIR || process.cwd();

let aborted = false;
process.on('SIGTERM', () => { aborted = true; });
process.on('SIGINT', () => { aborted = true; });

const run = () => {
  if (aborted) return { decision: undefined };
  let blockReasons = [];

  try {
    const ahead = execSync('git rev-list --count origin/main..HEAD', {
      encoding: 'utf-8',
      cwd: projectDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 2000
    }).trim();

    if (parseInt(ahead) > 0) {
      blockReasons.push(`Git: ${ahead} commit(s) ahead of origin/main, must push to remote`);
    }
  } catch (e) {
  }

  try {
    const behind = execSync('git rev-list --count HEAD..origin/main', {
      encoding: 'utf-8',
      cwd: projectDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 2000
    }).trim();

    if (parseInt(behind) > 0) {
      blockReasons.push(`Git: ${behind} commit(s) behind origin/main, must merge from remote`);
    }
  } catch (e) {
  }

  try {
    const status = execSync('git status --porcelain', {
      encoding: 'utf-8',
      cwd: projectDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 2000
    }).trim();

    if (status.length > 0) {
      blockReasons.push(`Git: Working tree is dirty (untracked/modified files), must stage or clean and push`);
    }
  } catch (e) {
  }

  if (blockReasons.length > 0) {
    return {
      decision: "block",
      reason: blockReasons.join(' | ')
    };
  }

  const filesToRun = [];

  const evalJsPath = path.join(projectDir, 'eval.js');
  if (fs.existsSync(evalJsPath)) {
    filesToRun.push('eval.js');
  }

  const evalsDir = path.join(projectDir, 'evals');
  if (fs.existsSync(evalsDir) && fs.statSync(evalsDir).isDirectory()) {
    const files = fs.readdirSync(evalsDir).filter(f => {
      const fullPath = path.join(evalsDir, f);
      return f.endsWith('.js') && fs.statSync(fullPath).isFile() && !fullPath.includes('/lib/');
    }).sort();
    filesToRun.push(...files.map(f => path.join('evals', f)));
  }

  for (const file of filesToRun) {
    if (aborted) return { decision: undefined };

    try {
      execSync(`node ${file}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: projectDir,
        timeout: 60000,
        killSignal: 'SIGTERM'
      });
    } catch (e) {
      if (aborted) return { decision: undefined };

      const errorOutput = e.stdout || '';
      const errorStderr = e.stderr || '';
      const signal = e.signal || 'none';
      const killed = e.killed || false;

      if (signal === 'SIGTERM' && killed) {
        return { decision: undefined };
      }

      const fullError = `Error: ${e.message}\nSignal: ${signal}\nKilled: ${killed}\n\nStdout:\n${errorOutput}\n\nStderr:\n${errorStderr}`;
      return {
        decision: "block",
        reason: `The following errors were reported: ${fullError}`
      };
    }
  }

  return { decision: undefined };
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

