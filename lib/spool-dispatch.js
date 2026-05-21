const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class SpoolDispatcher {
  constructor(gmDir = '.gm') {
    this.gmDir = gmDir;
    this.prdPath = path.join(gmDir, 'prd.yml');
    this.mutablesPath = path.join(gmDir, 'mutables.yml');
    this.needsGmPath = path.join(gmDir, 'needs-gm');
    this.spoolDir = path.join(gmDir, 'exec-spool');
  }

  checkPrdExists() {
    return fs.existsSync(this.prdPath);
  }

  checkUnresolvedMutables() {
    if (!fs.existsSync(this.mutablesPath)) {
      return null;
    }

    const content = fs.readFileSync(this.mutablesPath, 'utf8');
    const unresolvedIds = [];

    const lines = content.split('\n');
    let currentId = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.match(/^\s*-\s+id:\s*(.+)/)) {
        const match = line.match(/^\s*-\s+id:\s*(.+)/);
        currentId = match[1].trim();
      }

      if (line.match(/^\s*status:\s*unknown/) && currentId) {
        unresolvedIds.push(currentId);
      }
    }

    return unresolvedIds.length > 0 ? unresolvedIds : null;
  }

  checkGmFired(sessionId) {
    const markerPath = path.join(this.gmDir, `gm-fired-${sessionId}`);
    return fs.existsSync(markerPath);
  }

  checkNeedsGm() {
    return fs.existsSync(this.needsGmPath);
  }

  setNeedsGm() {
    fs.writeFileSync(this.needsGmPath, '');
  }

  clearNeedsGm() {
    if (fs.existsSync(this.needsGmPath)) {
      fs.unlinkSync(this.needsGmPath);
    }
  }

  setGmFired(sessionId) {
    const markerPath = path.join(this.gmDir, `gm-fired-${sessionId}`);
    fs.writeFileSync(markerPath, '');
  }

  clearGmFired(sessionId) {
    const markerPath = path.join(this.gmDir, `gm-fired-${sessionId}`);
    if (fs.existsSync(markerPath)) {
      fs.unlinkSync(markerPath);
    }
  }

  canDispatchToolUse(sessionId) {
    const needsGm = this.checkNeedsGm();
    if (!needsGm) {
      return { allowed: true };
    }

    const gmFired = this.checkGmFired(sessionId);
    if (!gmFired) {
      return {
        allowed: false,
        reason: 'PRD exists but gm skill has not run this turn. Execute Skill(gm:gm) or Agent(subagent_type="gm:gm") first.'
      };
    }

    return { allowed: true };
  }

  canExecuteWrite(sessionId) {
    const unresolvedMutables = this.checkUnresolvedMutables();
    if (unresolvedMutables) {
      return {
        allowed: false,
        reason: `Cannot write/edit while mutables are unresolved: ${unresolvedMutables.join(', ')}. Resolve all unknowns in .gm/mutables.yml first.`
      };
    }

    return { allowed: true };
  }

  canExecuteGit(sessionId) {
    const unresolvedMutables = this.checkUnresolvedMutables();
    if (unresolvedMutables) {
      return {
        allowed: false,
        reason: `Cannot commit/push while mutables are unresolved: ${unresolvedMutables.join(', ')}. Resolve all unknowns in .gm/mutables.yml first.`
      };
    }

    return { allowed: true };
  }

  canExecutePush(sessionId) {
    const base = this.canExecuteGit(sessionId);
    if (!base.allowed) return base;
    try {
      const { execSync } = require('child_process');
      const porcelain = execSync('git status --porcelain', { encoding: 'utf8', timeout: 5000 });
      if (porcelain.trim().length > 0) {
        return {
          allowed: false,
          reason: 'Cannot push: worktree dirty. Commit or revert outstanding changes before pushing — a push from a dirty tree orphans the unstaged delta and breaks the next session.'
        };
      }
    } catch (e) {
      return {
        allowed: false,
        reason: `Cannot push: porcelain probe failed (${e.message}). Confirm git is available and rerun.`
      };
    }
    return { allowed: true };
  }

  checkDispatchGates(sessionId, operation) {
    switch (operation) {
      case 'tool-use':
        return this.canDispatchToolUse(sessionId);
      case 'write':
      case 'edit':
        return this.canExecuteWrite(sessionId);
      case 'git-commit':
        return this.canExecuteGit(sessionId);
      case 'git-push':
        return this.canExecutePush(sessionId);
      default:
        return { allowed: true };
    }
  }

  getPrdStatus() {
    if (!this.checkPrdExists()) {
      return { empty: true, items: [] };
    }

    const content = fs.readFileSync(this.prdPath, 'utf8');
    const items = [];
    let currentItem = null;

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.match(/^\s*-\s+id:/)) {
        if (currentItem) items.push(currentItem);
        currentItem = {};
      }

      if (currentItem) {
        if (line.match(/^\s*id:\s*(.+)/)) {
          currentItem.id = line.match(/^\s*id:\s*(.+)/)[1].trim();
        }
        if (line.match(/^\s*status:\s*(.+)/)) {
          currentItem.status = line.match(/^\s*status:\s*(.+)/)[1].trim();
        }
        if (line.match(/^\s*subject:\s*(.+)/)) {
          currentItem.subject = line.match(/^\s*subject:\s*(.+)/)[1].trim();
        }
      }
    }

    if (currentItem && currentItem.id) {
      items.push(currentItem);
    }

    return { empty: items.length === 0, items };
  }

  getMutablesStatus() {
    if (!fs.existsSync(this.mutablesPath)) {
      return { empty: true, items: [] };
    }

    const content = fs.readFileSync(this.mutablesPath, 'utf8');
    const items = [];
    let currentItem = null;

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.match(/^\s*-\s+id:/)) {
        if (currentItem) items.push(currentItem);
        currentItem = {};
      }

      if (currentItem) {
        if (line.match(/^\s*id:\s*(.+)/)) {
          currentItem.id = line.match(/^\s*id:\s*(.+)/)[1].trim();
        }
        if (line.match(/^\s*status:\s*(.+)/)) {
          currentItem.status = line.match(/^\s*status:\s*(.+)/)[1].trim();
        }
        if (line.match(/^\s*claim:\s*(.+)/)) {
          currentItem.claim = line.match(/^\s*claim:\s*(.+)/)[1].trim();
        }
      }
    }

    if (currentItem && currentItem.id) {
      items.push(currentItem);
    }

    return { empty: items.length === 0, items };
  }

  queueTask(lang, code, sessionId, timeoutMs = 300000) {
    const taskId = crypto.randomBytes(8).toString('hex');
    const inDir = path.join(this.spoolDir, 'in', lang);

    if (!fs.existsSync(inDir)) {
      fs.mkdirSync(inDir, { recursive: true });
    }

    const taskPath = path.join(inDir, `${taskId}.txt`);
    fs.writeFileSync(taskPath, code, 'utf8');

    return taskId;
  }

  pollResult(taskId, pollMs = 200, maxMs = 30000) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const outDir = path.join(this.spoolDir, 'out');

      const checkResult = () => {
        const jsonPath = path.join(outDir, `${taskId}.json`);
        const outPath = path.join(outDir, `${taskId}.out`);
        const errPath = path.join(outDir, `${taskId}.err`);

        if (fs.existsSync(jsonPath)) {
          try {
            const metadata = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            const stdout = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
            const stderr = fs.existsSync(errPath) ? fs.readFileSync(errPath, 'utf8') : '';

            resolve({
              ok: metadata.ok === true,
              taskId,
              exitCode: metadata.exitCode || (metadata.ok ? 0 : 1),
              stdout,
              stderr,
              durationMs: metadata.durationMs || 0
            });
          } catch (e) {
            resolve({
              ok: false,
              taskId,
              error: `Failed to parse result: ${e.message}`
            });
          }
        } else if (Date.now() - startTime > maxMs) {
          resolve({
            ok: false,
            taskId,
            error: `Poll timeout after ${maxMs}ms`
          });
        } else {
          setTimeout(checkResult, pollMs);
        }
      };

      checkResult();
    });
  }

  runTask(lang, code, sessionId, timeoutMs = 300000) {
    const taskId = this.queueTask(lang, code, sessionId, timeoutMs);
    return this.pollResult(taskId, 200, timeoutMs);
  }

  getSpoolStatus() {
    const statusPath = path.join(this.spoolDir, '.status.json');
    if (fs.existsSync(statusPath)) {
      try {
        return JSON.parse(fs.readFileSync(statusPath, 'utf8'));
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  getRecentErrors(n = 5) {
    const status = this.getSpoolStatus();
    if (!status || !status.errors_ring) {
      return [];
    }
    return status.errors_ring.slice(-n);
  }
}

module.exports = SpoolDispatcher;
