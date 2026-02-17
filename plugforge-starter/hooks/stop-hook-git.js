#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

const getCounterPath = () => {
  const hash = crypto.createHash('md5').update(projectDir).digest('hex');
  return path.join('/tmp', `glootie-git-block-counter-${hash}.json`);
};

const readCounter = () => {
  try {
    const counterPath = getCounterPath();
    if (fs.existsSync(counterPath)) {
      const data = fs.readFileSync(counterPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {}
  return { count: 0, lastGitHash: null };
};

const writeCounter = (data) => {
  try {
    const counterPath = getCounterPath();
    fs.writeFileSync(counterPath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {}
};

const getCurrentGitHash = () => {
  try {
    const hash = execSync('git rev-parse HEAD', {
      cwd: projectDir,
      stdio: 'pipe',
      encoding: 'utf-8'
    }).trim();
    return hash;
  } catch (e) {
    return null;
  }
};

const resetCounterIfCommitted = (currentHash) => {
  const counter = readCounter();
  if (counter.lastGitHash && currentHash && counter.lastGitHash !== currentHash) {
    counter.count = 0;
    counter.lastGitHash = currentHash;
    writeCounter(counter);
    return true;
  }
  return false;
};

const incrementCounter = (currentHash) => {
  const counter = readCounter();
  counter.count = (counter.count || 0) + 1;
  counter.lastGitHash = currentHash;
  writeCounter(counter);
  return counter.count;
};

const getGitStatus = () => {
  try {
    execSync('git rev-parse --git-dir', {
      cwd: projectDir,
      stdio: 'pipe'
    });
  } catch (e) {
    return { isRepo: false };
  }

  try {
    const status = execSync('git status --porcelain', {
      cwd: projectDir,
      stdio: 'pipe',
      encoding: 'utf-8'
    }).trim();

    const isDirty = status.length > 0;

    let unpushedCount = 0;
    try {
      const unpushed = execSync('git rev-list --count @{u}..HEAD', {
        cwd: projectDir,
        stdio: 'pipe',
        encoding: 'utf-8'
      }).trim();
      unpushedCount = parseInt(unpushed, 10) || 0;
    } catch (e) {
      unpushedCount = -1;
    }

    let behindCount = 0;
    try {
      const behind = execSync('git rev-list --count HEAD..@{u}', {
        cwd: projectDir,
        stdio: 'pipe',
        encoding: 'utf-8'
      }).trim();
      behindCount = parseInt(behind, 10) || 0;
    } catch (e) {}

    return {
      isRepo: true,
      isDirty,
      unpushedCount,
      behindCount,
      statusOutput: status
    };
  } catch (e) {
    return { isRepo: true, isDirty: false, unpushedCount: 0, behindCount: 0 };
  }
};

const run = () => {
  const gitStatus = getGitStatus();
  if (!gitStatus.isRepo) return { ok: true };

  const currentHash = getCurrentGitHash();
  resetCounterIfCommitted(currentHash);

  const issues = [];
  if (gitStatus.isDirty) {
    issues.push('Uncommitted changes exist');
  }
  if (gitStatus.unpushedCount > 0) {
    issues.push(`${gitStatus.unpushedCount} commit(s) not pushed`);
  }
  if (gitStatus.unpushedCount === -1) {
    issues.push('Unable to verify push status - may have unpushed commits');
  }
  if (gitStatus.behindCount > 0) {
    issues.push(`${gitStatus.behindCount} upstream change(s) not pulled`);
  }

  if (issues.length > 0) {
    const blockCount = incrementCounter(currentHash);
    return {
      ok: false,
      reason: `Git: ${issues.join(', ')}, must push to remote`,
      blockCount
    };
  }

  const counter = readCounter();
  if (counter.count > 0) {
    counter.count = 0;
    writeCounter(counter);
  }

  return { ok: true };
};

try {
  const result = run();
  if (!result.ok) {
    if (result.blockCount >= 1) {
      console.log(JSON.stringify({
        decision: 'approve',
        reason: `⚠️ Git warning (attempt #${result.blockCount}): ${result.reason} - Please commit and push your changes before the next session.`
      }, null, 2));
    } else {
      console.log(JSON.stringify({
        decision: 'approve',
        reason: `⚠️ Git warning: ${result.reason} - Please commit and push your changes.`
      }, null, 2));
    }
  } else {
    console.log(JSON.stringify({
      decision: 'approve'
    }, null, 2));
  }
  process.exit(0);
} catch (e) {
  console.log(JSON.stringify({
    decision: 'approve'
  }, null, 2));
  process.exit(0);
}
