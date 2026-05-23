const path = require('path');
const fs = require('fs');
const os = require('os');

const GIT_USER = 'lanmower';
const GIT_EMAIL = 'almagestfraternite@gmail.com';

function emitGitEvent(severity, message, data = {}) {
  const logDir = path.join(os.homedir(), '.claude', 'gm-log', new Date().toISOString().split('T')[0]);
  if (!fs.existsSync(logDir)) {
    try { fs.mkdirSync(logDir, { recursive: true }); } catch (e) {}
  }
  const logFile = path.join(logDir, 'git.jsonl');
  try {
    fs.appendFileSync(logFile, JSON.stringify({
      ts: new Date().toISOString(),
      subsystem: 'git',
      severity,
      message,
      ...data,
    }) + '\n');
  } catch (e) {}
}

function escapeShellArg(arg) {
  if (os.platform() === 'win32') {
    if (!arg) return '""';
    if (/^[a-zA-Z0-9._\-/:=\\]+$/.test(arg)) return arg;
    return '"' + arg.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`') + '"';
  }
  if (!arg) return "''";
  if (/^[a-zA-Z0-9._\-/:=]+$/.test(arg)) return arg;
  return "'" + arg.replace(/'/g, "'\"'\"'") + "'";
}

function parseGitStatus(porcelain) {
  const isDirty = porcelain.trim().length > 0;
  const lines = porcelain.trim().split('\n').filter(l => l.length > 0);
  const modified = lines.filter(l => /^[ AM][MD]/.test(l)).map(l => l.substring(3));
  const untracked = lines.filter(l => /^\?\?/.test(l)).map(l => l.substring(3));
  const deleted = lines.filter(l => /^[ A]D/.test(l)).map(l => l.substring(3));
  return { isDirty, modified, untracked, deleted, all: modified.concat(untracked, deleted) };
}

async function sendSpoolRequest(lang, code, timeoutMs = 30000) {
  const gmDir = path.join(process.cwd(), '.gm');
  const spoolIn = path.join(gmDir, 'exec-spool', 'in', lang);
  const spoolOut = path.join(gmDir, 'exec-spool', 'out');

  if (!fs.existsSync(spoolIn)) {
    try { fs.mkdirSync(spoolIn, { recursive: true }); } catch (e) {}
  }

  let taskId = '';
  try {
    taskId = fs.readdirSync(spoolOut).filter(f => f.endsWith('.json')).length + 1;
  } catch (e) {
    taskId = Math.random().toString(36).substring(7);
  }

  const ext = lang === 'bash' ? 'sh' : 'js';
  const inPath = path.join(spoolIn, `${taskId}.${ext}`);
  const outPath = path.join(spoolOut, `${taskId}.out`);
  const errPath = path.join(spoolOut, `${taskId}.err`);
  const jsonPath = path.join(spoolOut, `${taskId}.json`);

  try {
    fs.writeFileSync(inPath, code, 'utf8');
  } catch (e) {
    emitGitEvent('error', 'Could not write spool file', { path: inPath, error: e.message });
    throw new Error(`Could not write spool request: ${e.message}`);
  }

  const startTime = Date.now();
  const deadline = startTime + timeoutMs;

  while (Date.now() < deadline) {
    if (fs.existsSync(jsonPath)) {
      try {
        const metadata = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const stdout = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
        const stderr = fs.existsSync(errPath) ? fs.readFileSync(errPath, 'utf8') : '';
        return { ok: !metadata.timedOut && metadata.exitCode === 0, stdout, stderr, exitCode: metadata.exitCode, durationMs: metadata.durationMs };
      } catch (e) {
        emitGitEvent('error', 'Could not parse spool response', { path: jsonPath, error: e.message });
      }
    }
    await new Promise(r => setTimeout(r, 100));
  }

  throw new Error(`Spool request timed out after ${timeoutMs}ms`);
}

async function commit(message, files = [], sessionId = 'unknown') {
  emitGitEvent('info', 'commit() called', { message: message.substring(0, 72), fileCount: files.length, sessionId });

  if (!message || message.trim().length === 0) {
    emitGitEvent('error', 'commit message required', { sessionId });
    throw new Error('Commit message required');
  }

  const summary = message.split('\n')[0];
  if (summary.length > 72) {
    emitGitEvent('warn', 'commit summary exceeds 72 chars', { length: summary.length, sessionId });
  }

  const filesToStage = files && files.length > 0 ? files : ['.'];
  const stageCmd = filesToStage.map(f => `git add ${escapeShellArg(f)}`).join(' && ');
  const commitMsg = message.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
  const commitCmd = `git -c user.name=${escapeShellArg(GIT_USER)} -c user.email=${escapeShellArg(GIT_EMAIL)} commit -m "${commitMsg}"`;

  const script = `${stageCmd} && ${commitCmd}`;

  try {
    const result = await sendSpoolRequest('bash', script, 30000);
    if (!result.ok) {
      const err = result.stderr || result.stdout || 'unknown error';
      emitGitEvent('error', 'commit failed', { error: err.substring(0, 200), sessionId });
      throw new Error(`Commit failed: ${err}`);
    }
    emitGitEvent('info', 'commit succeeded', { message: summary, fileCount: files.length, sessionId });
    return { ok: true, message: summary };
  } catch (e) {
    emitGitEvent('error', 'commit error', { error: e.message, sessionId });
    throw e;
  }
}

async function push(branch = 'main', sessionId = 'unknown') {
  emitGitEvent('info', 'push() called', { branch, sessionId });

  const pushCmd = `git push origin ${escapeShellArg(branch)} 2>&1`;

  try {
    const result = await sendSpoolRequest('bash', pushCmd, 60000);
    if (!result.ok || result.stderr.includes('fatal') || result.stdout.includes('fatal')) {
      const err = result.stderr || result.stdout || 'unknown error';

      if (err.includes('remote: error') || err.includes('Permission denied')) {
        emitGitEvent('error', 'push auth failed', { branch, sessionId });
        throw new Error(`Push authentication failed. Check credentials for branch: ${branch}\n${err}`);
      }
      if (err.includes('no changes added') || err.includes('nothing to commit')) {
        emitGitEvent('info', 'push: nothing to push', { branch, sessionId });
        return { ok: true, message: 'nothing to push' };
      }
      emitGitEvent('error', 'push failed', { error: err.substring(0, 200), branch, sessionId });
      throw new Error(`Push failed: ${err}`);
    }
    emitGitEvent('info', 'push succeeded', { branch, sessionId });
    return { ok: true, message: `pushed ${branch}` };
  } catch (e) {
    emitGitEvent('error', 'push error', { error: e.message, branch, sessionId });
    throw e;
  }
}

async function status(sessionId = 'unknown') {
  emitGitEvent('info', 'status() called', { sessionId });

  const statusCmd = 'git status --porcelain';

  try {
    const result = await sendSpoolRequest('bash', statusCmd, 10000);
    if (!result.ok) {
      emitGitEvent('error', 'status failed', { error: result.stderr, sessionId });
      throw new Error(`Status check failed: ${result.stderr}`);
    }

    const parsed = parseGitStatus(result.stdout);
    emitGitEvent('info', 'status retrieved', { isDirty: parsed.isDirty, modifiedCount: parsed.modified.length, sessionId });
    return { ok: true, ...parsed };
  } catch (e) {
    emitGitEvent('error', 'status error', { error: e.message, sessionId });
    throw e;
  }
}

async function diff(sessionId = 'unknown') {
  emitGitEvent('info', 'diff() called', { sessionId });

  const diffCmd = 'git diff HEAD';

  try {
    const result = await sendSpoolRequest('bash', diffCmd, 30000);
    if (!result.ok && !result.stdout) {
      emitGitEvent('error', 'diff failed', { error: result.stderr, sessionId });
      throw new Error(`Diff failed: ${result.stderr}`);
    }

    emitGitEvent('info', 'diff retrieved', { hasChanges: result.stdout.length > 0, sessionId });
    return { ok: true, diff: result.stdout };
  } catch (e) {
    emitGitEvent('error', 'diff error', { error: e.message, sessionId });
    throw e;
  }
}

async function log(sessionId = 'unknown', count = 10) {
  emitGitEvent('info', 'log() called', { count, sessionId });

  const logCmd = `git log -${count} --oneline`;

  try {
    const result = await sendSpoolRequest('bash', logCmd, 10000);
    if (!result.ok) {
      emitGitEvent('error', 'log failed', { error: result.stderr, sessionId });
      throw new Error(`Log failed: ${result.stderr}`);
    }

    const commits = result.stdout.trim().split('\n').filter(l => l.length > 0);
    emitGitEvent('info', 'log retrieved', { commitCount: commits.length, sessionId });
    return { ok: true, commits };
  } catch (e) {
    emitGitEvent('error', 'log error', { error: e.message, sessionId });
    throw e;
  }
}

async function checkout(branch, sessionId = 'unknown') {
  emitGitEvent('info', 'checkout() called', { branch, sessionId });

  if (!branch || branch.trim().length === 0) {
    emitGitEvent('error', 'branch name required', { sessionId });
    throw new Error('Branch name required');
  }

  const checkCmd = `git rev-parse --verify ${escapeShellArg(branch)} 2>&1`;

  try {
    const checkResult = await sendSpoolRequest('bash', checkCmd, 10000);
    if (!checkResult.ok || checkResult.stderr.includes('fatal') || checkResult.stdout.includes('fatal')) {
      emitGitEvent('error', 'checkout: branch not found', { branch, sessionId });
      throw new Error(`Branch not found: ${branch}`);
    }

    const checkoutCmd = `git checkout ${escapeShellArg(branch)}`;
    const result = await sendSpoolRequest('bash', checkoutCmd, 10000);

    if (!result.ok) {
      emitGitEvent('error', 'checkout failed', { error: result.stderr, branch, sessionId });
      throw new Error(`Checkout failed: ${result.stderr}`);
    }

    emitGitEvent('info', 'checkout succeeded', { branch, sessionId });
    return { ok: true, branch };
  } catch (e) {
    emitGitEvent('error', 'checkout error', { error: e.message, branch, sessionId });
    throw e;
  }
}

async function rebase(upstream, sessionId = 'unknown') {
  emitGitEvent('info', 'rebase() called', { upstream, sessionId });

  if (!upstream || upstream.trim().length === 0) {
    emitGitEvent('error', 'upstream branch required', { sessionId });
    throw new Error('Upstream branch required');
  }

  const rebaseCmd = `git rebase ${escapeShellArg(upstream)} 2>&1`;

  try {
    const result = await sendSpoolRequest('bash', rebaseCmd, 60000);

    if (result.stderr.includes('CONFLICT') || result.stdout.includes('CONFLICT')) {
      emitGitEvent('warn', 'rebase: conflicts detected', { upstream, sessionId });
      const statusCmd = 'git status --porcelain';
      const statusResult = await sendSpoolRequest('bash', statusCmd, 10000);
      const conflicts = statusResult.stdout.split('\n').filter(l => l.startsWith('UU') || l.startsWith('AA') || l.startsWith('DD'));
      return { ok: false, conflicts: true, conflictFiles: conflicts, message: 'Rebase halted due to conflicts. Resolve conflicts and run git rebase --continue' };
    }

    if (!result.ok) {
      emitGitEvent('error', 'rebase failed', { error: result.stderr, upstream, sessionId });
      throw new Error(`Rebase failed: ${result.stderr}`);
    }

    emitGitEvent('info', 'rebase succeeded', { upstream, sessionId });
    return { ok: true, upstream };
  } catch (e) {
    emitGitEvent('error', 'rebase error', { error: e.message, upstream, sessionId });
    throw e;
  }
}

async function cherryPick(commit, sessionId = 'unknown') {
  emitGitEvent('info', 'cherryPick() called', { commit, sessionId });

  if (!commit || commit.trim().length === 0) {
    emitGitEvent('error', 'commit hash required', { sessionId });
    throw new Error('Commit hash required');
  }

  const pickCmd = `git cherry-pick ${escapeShellArg(commit)} 2>&1`;

  try {
    const result = await sendSpoolRequest('bash', pickCmd, 60000);

    if (result.stderr.includes('CONFLICT') || result.stdout.includes('CONFLICT')) {
      emitGitEvent('warn', 'cherry-pick: conflicts detected', { commit, sessionId });
      return { ok: false, conflicts: true, message: 'Cherry-pick halted due to conflicts. Resolve conflicts and run git cherry-pick --continue' };
    }

    if (!result.ok) {
      emitGitEvent('error', 'cherry-pick failed', { error: result.stderr, commit, sessionId });
      throw new Error(`Cherry-pick failed: ${result.stderr}`);
    }

    emitGitEvent('info', 'cherry-pick succeeded', { commit, sessionId });
    return { ok: true, commit };
  } catch (e) {
    emitGitEvent('error', 'cherry-pick error', { error: e.message, commit, sessionId });
    throw e;
  }
}

module.exports = {
  commit,
  push,
  status,
  diff,
  log,
  checkout,
  rebase,
  cherryPick,
  escapeShellArg,
  parseGitStatus,
  GIT_USER,
  GIT_EMAIL,
};
