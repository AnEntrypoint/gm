#!/usr/bin/env node

const { execSync } = require('child_process');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

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
    return {
      ok: false,
      reason: `Git: ${issues.join(', ')}, must push to remote`
    };
  }

  return { ok: true };
};

try {
  const result = run();
  if (!result.ok) {
    console.error(result.reason);
    process.exit(2);
  }
  process.exit(0);
} catch (e) {
  process.exit(0);
}
