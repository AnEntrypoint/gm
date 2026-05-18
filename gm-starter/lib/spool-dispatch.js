const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const GM_LOG_ROOT = process.env.GM_LOG_DIR || path.join(os.homedir(), '.claude', 'gm-log');

function logDeviation(event, fields) {
  if (process.env.GM_LOG_DISABLE) return;
  try {
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.join(GM_LOG_ROOT, day);
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      sub: 'hook',
      event,
      pid: process.pid,
      sess: process.env.CLAUDE_SESSION_ID || process.env.GM_SESSION_ID || '',
      cwd: process.cwd(),
      ...fields,
    });
    fs.appendFileSync(path.join(dir, 'hook.jsonl'), line + '\n');
  } catch (_) {}
}

function isWorktreeDirty(cwd) {
  try {
    const r = spawnSync('git', ['status', '--porcelain'], {
      cwd: cwd || process.cwd(), encoding: 'utf8', timeout: 1500, windowsHide: true
    });
    if (r.status !== 0) return { dirty: false, files: [], available: false };
    const lines = r.stdout.split('\n').filter(l => l.length > 0);
    return { dirty: lines.length > 0, files: lines, available: true };
  } catch (_) {
    return { dirty: false, files: [], available: false };
  }
}

function hasUnpushedCommits(cwd) {
  try {
    const r = spawnSync('git', ['log', '@{u}..HEAD', '--oneline'], {
      cwd: cwd || process.cwd(), encoding: 'utf8', timeout: 1500, windowsHide: true
    });
    if (r.status !== 0) return { unpushed: false, count: 0, available: false };
    const lines = r.stdout.split('\n').filter(l => l.length > 0);
    return { unpushed: lines.length > 0, count: lines.length, available: true };
  } catch (_) {
    return { unpushed: false, count: 0, available: false };
  }
}

const TOPLEVEL_DOC_ALLOWLIST = new Set(['AGENTS.md', 'CLAUDE.md', 'README.md', 'SKILLS.md', 'CHANGELOG.md', 'LICENSE', 'LICENSE.md']);

function unsolicitedDocs(cwd) {
  try {
    const r = spawnSync('git', ['status', '--porcelain'], {
      cwd: cwd || process.cwd(), encoding: 'utf8', timeout: 1500, windowsHide: true
    });
    if (r.status !== 0) return { count: 0, files: [], available: false };
    const flagged = [];
    for (const line of r.stdout.split('\n')) {
      if (!line.startsWith('?? ')) continue;
      const rel = line.slice(3).trim();
      if (!rel) continue;
      if (!/\.(md|txt)$/i.test(rel)) continue;
      if (rel.includes('/')) {
        if (rel.startsWith('node_modules/') || rel.startsWith('target/') || rel.startsWith('.gm/') || rel.startsWith('dist/') || rel.startsWith('build/')) continue;
      } else {
        if (TOPLEVEL_DOC_ALLOWLIST.has(rel)) continue;
      }
      flagged.push(rel);
    }
    return { count: flagged.length, files: flagged, available: true };
  } catch (_) {
    return { count: 0, files: [], available: false };
  }
}

async function dispatchSpool(cmd, lang, body, timeoutMs, sessionId) {
  const taskId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const langDir = lang.match(/^(nodejs|python|bash|typescript|go|rust|c|cpp|java|deno)$/) ? lang : 'nodejs';
  const ext = {
    nodejs: 'js',
    python: 'py',
    bash: 'sh',
    typescript: 'ts',
    go: 'go',
    rust: 'rs',
    c: 'c',
    cpp: 'cpp',
    java: 'java',
    deno: 'ts'
  }[langDir] || 'js';

  const inDir = path.join(process.cwd(), '.gm', 'exec-spool', 'in', langDir);
  const outDir = path.join(process.cwd(), '.gm', 'exec-spool', 'out');
  const inFile = path.join(inDir, `${taskId}.${ext}`);
  const jsonFile = path.join(outDir, `${taskId}.json`);

  fs.mkdirSync(inDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  const code = sessionId ? `const SESSION_ID = '${sessionId}';\n${body}` : body;
  fs.writeFileSync(inFile, code, 'utf8');

  return pollForCompletion(jsonFile, timeoutMs, taskId);
}

async function pollForCompletion(jsonFile, timeoutMs, taskId) {
  const start = Date.now();
  const interval = 50;

  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(jsonFile)) {
      try {
        const metadata = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
        const outFile = jsonFile.replace(/\.json$/, '.out');
        const errFile = jsonFile.replace(/\.json$/, '.err');
        const stdout = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
        const stderr = fs.existsSync(errFile) ? fs.readFileSync(errFile, 'utf8') : '';
        return {
          ok: metadata.exitCode === 0 && !metadata.timedOut,
          exitCode: metadata.exitCode,
          stdout,
          stderr,
          durationMs: metadata.durationMs,
          taskId,
          timedOut: metadata.timedOut || false
        };
      } catch (e) {
        await new Promise(r => setTimeout(r, interval));
      }
    } else {
      await new Promise(r => setTimeout(r, interval));
    }
  }

  return {
    ok: false,
    exitCode: -1,
    stdout: '',
    stderr: `[spool dispatch timeout after ${timeoutMs}ms]`,
    durationMs: Date.now() - start,
    taskId,
    timedOut: true
  };
}

function sessionMarkerPath(sessionId, kind) {
  const cwd = process.cwd();
  return path.join(cwd, '.gm', 'exec-spool', `.session-${kind}-${sessionId || 'anon'}`);
}

function hasDispatchedInstruction(sessionId) {
  try {
    const outDir = path.join(process.cwd(), '.gm', 'exec-spool', 'out');
    if (!fs.existsSync(outDir)) return false;
    for (const f of fs.readdirSync(outDir)) {
      if (f.startsWith('instruction-')) return true;
    }
  } catch (_) {}
  return fs.existsSync(sessionMarkerPath(sessionId, 'instruction-seen'));
}

function markInstructionSeen(sessionId) {
  try {
    fs.mkdirSync(path.dirname(sessionMarkerPath(sessionId, 'instruction-seen')), { recursive: true });
    fs.writeFileSync(sessionMarkerPath(sessionId, 'instruction-seen'), String(Date.now()));
  } catch (_) {}
}

function checkDispatchGates(sessionId, operation, extra) {
  const cwd = process.cwd();
  const gm = path.join(cwd, '.gm');
  const prdPath = path.join(gm, 'prd.yml');
  const mutsPath = path.join(gm, 'mutables.yml');
  const needsGmPath = path.join(gm, 'needs-gm');
  const gmFiredPath = path.join(gm, `gm-fired-${sessionId}`);

  if (['stop', 'complete'].includes(operation)) {
    const residuals = [];
    if (fs.existsSync(prdPath)) {
      try {
        const content = fs.readFileSync(prdPath, 'utf8');
        if (content.includes('status: pending') || content.includes('status: in_progress')) {
          residuals.push('PRD has open items — resolve or name-and-stop before declaring done');
        }
      } catch (_) {}
    }
    if (fs.existsSync(mutsPath)) {
      try {
        const content = fs.readFileSync(mutsPath, 'utf8');
        if (content.includes('status: unknown')) {
          residuals.push('unresolved mutables present — resolve with witness_evidence before declaring done');
        }
      } catch (_) {}
    }
    const dirty = isWorktreeDirty(cwd);
    if (dirty.available && dirty.dirty) {
      residuals.push(`worktree dirty (${dirty.files.length} file${dirty.files.length === 1 ? '' : 's'}) — commit and push before declaring done`);
    }
    const unpushed = hasUnpushedCommits(cwd);
    if (unpushed.available && unpushed.unpushed) {
      residuals.push(`${unpushed.count} unpushed commit${unpushed.count === 1 ? '' : 's'} — push to remote before declaring done`);
    }
    const docs = unsolicitedDocs(cwd);
    if (docs.available && docs.count > 0) {
      residuals.push(`${docs.count} unsolicited doc${docs.count === 1 ? '' : 's'} (${docs.files.slice(0, 3).join(', ')}${docs.files.length > 3 ? ', …' : ''}) — delete or fold into commit/PRD/memorize, do not ship`);
      for (const f of docs.files) {
        logDeviation('deviation.unsolicited-doc-created', { file: f, operation });
      }
    }
    if (residuals.length > 0) {
      logDeviation('deviation.gate-deny', { operation, reason: 'stop-gate residuals', residuals });
      return { allowed: false, reason: `stop-gate residuals: ${residuals.join('; ')}`, residuals };
    }
    return { allowed: true };
  }

  if (['write', 'edit'].includes(operation) && !hasDispatchedInstruction(sessionId)) {
    logDeviation('deviation.write-before-instruction', { operation, sessionId });
  }

  if (operation === 'mutable-resolve' && extra && (!extra.witness_evidence || String(extra.witness_evidence).trim() === '')) {
    logDeviation('deviation.mutable-without-evidence', { mutable_id: extra.id || null });
  }

  if (!['write', 'edit', 'git'].includes(operation)) return { allowed: true };

  if (fs.existsSync(prdPath) && fs.existsSync(needsGmPath) && !fs.existsSync(gmFiredPath)) {
    logDeviation('deviation.gate-deny', { operation, reason: 'gm orchestration in progress' });
    return { allowed: false, reason: 'gm orchestration in progress; skills must complete work before tools execute' };
  }

  if (fs.existsSync(mutsPath)) {
    try {
      const content = fs.readFileSync(mutsPath, 'utf8');
      if (content.includes('status: unknown')) {
        logDeviation('deviation.gate-deny', { operation, reason: 'unresolved mutables' });
        return { allowed: false, reason: 'unresolved mutables block tool execution; resolve all mutables before proceeding' };
      }
    } catch (_) {}
  }

  return { allowed: true };
}

module.exports = { dispatchSpool, checkDispatchGates, isWorktreeDirty, hasUnpushedCommits, unsolicitedDocs, logDeviation, markInstructionSeen, hasDispatchedInstruction };
