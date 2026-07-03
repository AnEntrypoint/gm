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
    const f = fields || {};
    const sessOverride = (f.sess !== undefined) ? f.sess : null;
    const rest = { ...f };
    delete rest.sess;
    const sess = (sessOverride && String(sessOverride).length > 0)
      ? String(sessOverride)
      : (process.env.CLAUDE_SESSION_ID || process.env.GM_SESSION_ID || '');
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      sub: 'hook',
      event,
      pid: process.pid,
      sess,
      cwd: process.cwd(),
      ...rest,
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

const BROWSER_FILE_ALWAYS_RE = /\.(html?|tsx|jsx|vue|svelte)$/i;
const BROWSER_FILE_DIRGATED_RE = /\.(mjs|cjs|js|ts|css|scss|sass)$/i;
const BROWSER_FILE_DIR_RE = /^(src|public|site|app|pages|components|client|web)[\\/]/i;

function isBrowserRunningFile(rel) {
  if (!rel) return false;
  const norm = String(rel).replace(/\\/g, '/');
  if (BROWSER_FILE_ALWAYS_RE.test(norm)) return true;
  if (BROWSER_FILE_DIRGATED_RE.test(norm) && BROWSER_FILE_DIR_RE.test(norm)) return true;
  return false;
}

function browserEditsFile(cwd) {
  return path.join(cwd || process.cwd(), '.gm', 'exec-spool', '.turn-browser-edits.json');
}
function browserWitnessFile(cwd) {
  return path.join(cwd || process.cwd(), '.gm', 'exec-spool', '.turn-browser-witnessed');
}

function hashFileShort(root, rel) {
  try {
    const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
    const buf = fs.readFileSync(abs);
    return require('crypto').createHash('sha256').update(buf).digest('hex').slice(0, 12);
  } catch (_) { return ''; }
}

function recordBrowserEdit(cwd, filePath) {
  try {
    const root = cwd || process.cwd();
    let rel = filePath;
    try { rel = path.relative(root, filePath); } catch (_) {}
    if (!isBrowserRunningFile(rel)) return false;
    const f = browserEditsFile(root);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    let list = [];
    try { list = JSON.parse(fs.readFileSync(f, 'utf8')); if (!Array.isArray(list)) list = []; } catch (_) {}
    const relPath = rel.replace(/\\/g, '/');
    const hash = hashFileShort(root, relPath);
    const idx = list.findIndex(e => e && e.file === relPath);
    const entry = { file: relPath, ts: Date.now(), hash };
    if (idx === -1) list.push(entry); else list[idx] = entry;
    fs.writeFileSync(f, JSON.stringify(list));
    return true;
  } catch (_) { return false; }
}

function clearBrowserTurnMarkers(cwd) {
  const root = cwd || process.cwd();
  for (const p of [browserEditsFile(root), browserWitnessFile(root)]) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
  }
}

function markBrowserWitnessed(cwd, meta) {
  try {
    const root = cwd || process.cwd();
    const f = browserWitnessFile(root);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const edits = readBrowserEdits(root);
    const witnessed_hashes = {};
    for (const e of edits) {
      if (!e || !e.file) continue;
      witnessed_hashes[e.file] = hashFileShort(root, e.file);
    }
    fs.writeFileSync(f, JSON.stringify({ ts: Date.now(), witnessed_hashes, ...(meta || {}) }));
  } catch (_) {}
}

function readBrowserWitness(cwd) {
  try {
    const f = browserWitnessFile(cwd);
    if (!fs.existsSync(f)) return null;
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (_) { return null; }
}

function readBrowserEdits(cwd) {
  try {
    const f = browserEditsFile(cwd);
    if (!fs.existsSync(f)) return [];
    const list = JSON.parse(fs.readFileSync(f, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (_) { return []; }
}

function isBrowserWitnessed(cwd) {
  try { return fs.existsSync(browserWitnessFile(cwd)); } catch (_) { return false; }
}

function unsolicitedDocs(cwd) {
  try {
    const r = spawnSync('git', ['status', '--porcelain'], {
      cwd: cwd || process.cwd(), encoding: 'utf8', timeout: 1500, windowsHide: true
    });
    if (r.status !== 0) return { count: 0, files: [], available: false };
    const flagged = [];
    for (const line of r.stdout.split('\n')) {
      if (!line || line.length < 4) continue;
      const code = line.slice(0, 2);
      let rel;
      if (code === '??') {
        rel = line.slice(3).trim();
      } else if (/^[MADRCU ][MADRCU ]$/.test(code)) {
        const rest = line.slice(3).trim();
        const arrowIdx = rest.indexOf(' -> ');
        rel = arrowIdx >= 0 ? rest.slice(arrowIdx + 4).trim() : rest;
      } else {
        continue;
      }
      if (!rel) continue;
      if (!/\.(md|txt)$/i.test(rel)) continue;
      const base = rel.includes('/') ? rel.slice(rel.lastIndexOf('/') + 1) : rel;
      if (TOPLEVEL_DOC_ALLOWLIST.has(base)) continue;
      if (rel.startsWith('node_modules/') || rel.startsWith('target/') || rel.startsWith('.gm/') || rel.startsWith('dist/') || rel.startsWith('build/')) continue;
      flagged.push(rel);
    }
    return { count: flagged.length, files: flagged, available: true };
  } catch (_) {
    return { count: 0, files: [], available: false };
  }
}

function yamlStatusValues(content) {
  const values = [];
  for (const raw of String(content).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '');
    const m = line.match(/^\s*(?:-\s*)?status\s*:\s*([A-Za-z0-9_-]+)\s*$/);
    if (m) values.push(m[1]);
  }
  return values;
}

function sessionMarkerPath(sessionId, kind) {
  const cwd = process.cwd();
  return path.join(cwd, '.gm', 'exec-spool', `.session-${kind}-${sessionId || 'anon'}`);
}

function hasDispatchedInstruction(sessionId) {
  return fs.existsSync(sessionMarkerPath(sessionId, 'instruction-seen'));
}

function markInstructionSeen(sessionId) {
  try {
    fs.mkdirSync(path.dirname(sessionMarkerPath(sessionId, 'instruction-seen')), { recursive: true });
    fs.writeFileSync(sessionMarkerPath(sessionId, 'instruction-seen'), String(Date.now()));
  } catch (_) {}
}

const SPOOL_POLL_PATTERNS = [
  /\bsleep\s+\d+(?:\.\d+)?\s*[;&]+\s*(?:cat|ls|tail|head|find|test|grep)\b[^|]*\.gm[\\/](?:exec-spool|spool)/i,
  /\bStart-Sleep\b[^;|]*?[;|]\s*(?:Get-Content|Test-Path|Get-ChildItem|cat|ls|gci|gc|tp)\b[^|]*\.gm[\\/](?:exec-spool|spool)/i,
  /\b(?:cat|ls|tail|head|Get-Content|Test-Path|Get-ChildItem)\b[^|]*\.gm[\\/](?:exec-spool|spool)[^|]*?[;&|]+\s*(?:sleep|Start-Sleep)\b/i,
  /\bwhile\b[^;]*?(?:!|-not)\s*(?:-(?:f|e)\s+|Test-Path\s+)[^;]*?\.gm[\\/](?:exec-spool|spool)/i,
  /\buntil\b[^;]*?(?:-f|-e|Test-Path)\s+[^;]*?\.gm[\\/](?:exec-spool|spool)/i,
  /\bfor\s+i\s+in\b[^;]*?;\s*do\b[^;]*?(?:sleep|Start-Sleep)[^;]*?\.gm[\\/](?:exec-spool|spool)/i,
  /\b(?:ls|dir|Get-ChildItem|gci)\s+(?:-[A-Za-z]+\s+)*['"]?[^'"|;&]*\.gm[\\/](?:exec-spool|spool)(?:[\\/](?:in|out)?)?[\\/]?['"]?\s*(?:$|[|;&])/i,
  /\b(?:test|Test-Path|tp)\s+(?:-[A-Za-z]+\s+)?['"]?[^'"|;&]*\.gm[\\/](?:exec-spool|spool)[\\/](?:out|in)[\\/]/i,
  /\bfind\b[^|]*['"]?[^'"|;&]*\.gm[\\/](?:exec-spool|spool)\b/i,
  /\b(?:xargs|parallel|fzf)\b[^|]*\.gm[\\/](?:exec-spool|spool)/i,
];

const SPOOL_POLL_REASON = 'spool POLLING (sleep+cat, while !test, ls/find on the spool dirs) is forbidden -- plugkit is synchronous from your view, so the response file is there the moment the watcher finishes the verb. Specific replacements:\n\n- Instead of `ls .gm/exec-spool/out/` -> check the specific response file you wrote, e.g. `Read .gm/exec-spool/out/<verb>-<N>.json`\n- Instead of `sleep N; cat .gm/exec-spool/<...>` -> just Read the response file directly; if it doesn\'t exist yet, the watcher is dead (the SKILL.md boot probe `cat .gm/exec-spool/.status.json; date +%s%3N` is the way to check liveness) or the verb is slow (Read .gm/exec-spool/.watcher.log for the dispatch trace)\n- Instead of `while [ ! -f ... ]; do sleep ...; done` -> write the request, Read the response in the same message, accept the file-not-found and re-Read in the next message\n\nThe SKILL.md-prescribed boot probe (`cat .gm/exec-spool/.status.json; date +%s%3N`) is NOT a violation -- it is the canonical liveness check because it pipes with `date` for ts comparison. The Read tool can\'t do that in one call. What this gate denies is the *polling* pattern around the spool dirs, not the boot-probe cat. You are the state machine. Plugkit serves the response the moment you write the request file.';

function stripHeredocsAndStringLiterals(command) {
  let s = String(command);
  s = s.replace(/<<-?\s*'([A-Z_]+)'[\s\S]*?\n\1/g, '');
  s = s.replace(/<<-?\s*"?([A-Z_]+)"?[\s\S]*?\n\1/g, '');
  s = s.replace(/\$\(cat\s+<<-?\s*'?([A-Z_]+)'?[\s\S]*?\n\1\s*\)/g, '');
  s = s.replace(/-m\s+(['"])(?:\\.|(?!\1)[^\\])*\1/g, '-m STR');
  s = s.replace(/--message[= ]+(['"])(?:\\.|(?!\1)[^\\])*\1/g, '--message STR');
  return s;
}

function isSpoolPollCommand(command) {
  if (!command) return null;
  const stripped = stripHeredocsAndStringLiterals(command);
  for (const re of SPOOL_POLL_PATTERNS) {
    if (re.test(stripped)) return re.source;
  }
  return null;
}

const NATIVE_SEARCH_PATTERNS = [
  /\bgrep\s+-(?!-)[A-Za-z]*[rR][A-Za-z]*(?:[=\s]|$)/,
  /\bgrep\s+--recursive\b/,
  /(?:^|[\n;&|]|&&)\s*rg\s+(?!-{1,2}(?:version|help)\b)/,
];

const NATIVE_SEARCH_REASON = 'native code/file/symbol search (grep -r / rg over the tree) is forbidden -- route the lookup through the codesearch verb so it hits the committed code-search index and stays in the spool ledger. Write .gm/exec-spool/in/codesearch/<N>.txt with {"query":"..."} and Read the response; use the recall verb for prior knowledge. A pipe-filter on command output (cmd | grep X) and grep on a single named file are fine; what this gate denies is searching the tree natively (grep -r/-R/-rl/-rn, ripgrep), which bypasses the index and is non-portable across harnesses.';

function isNativeSearchCommand(command) {
  if (!command) return null;
  const stripped = stripHeredocsAndStringLiterals(command);
  for (const re of NATIVE_SEARCH_PATTERNS) {
    if (re.test(stripped)) return re.source;
  }
  return null;
}

const DEFER_MARKERS = [
  'next pass', 'next session', 'next turn',
  'defer to later', 'deferred to later', 'deferred for later',
  'future pass', 'future session', 'future turn',
  'address it next', 'address this next', 'leave for next',
  'documented for next', 'documented for future',
  'below criticality', 'skip for now', 'punt for now',
  'do later', 'fix later', 'later pass',
];

function deferMarkerIn(text) {
  if (!text) return null;
  const lower = String(text).toLowerCase();
  for (const m of DEFER_MARKERS) {
    if (lower.includes(m)) return m;
  }
  return null;
}

function readPendingStep(cwd) {
  try {
    const f = path.join(cwd, '.gm', 'turn-state.json');
    if (!fs.existsSync(f)) return null;
    const st = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!st || !st.pending_step_id) return null;
    const deadline = Number(st.pending_step_deadline_ms || 0);
    if (deadline && Date.now() > deadline) return null;
    return { step_id: st.pending_step_id, deadline_ms: deadline };
  } catch (_) { return null; }
}

const AWAIT_RESULT_ALLOWED_VERBS = new Set(['memorize-continue', 'instruction', 'phase-status', 'health']);

function checkDispatchGates(sessionId, operation, extra) {
  const cwd = process.cwd();
  const gm = path.join(cwd, '.gm');
  const prdPath = path.join(gm, 'prd.yml');
  const mutsPath = path.join(gm, 'mutables.yml');
  const needsGmPath = path.join(gm, 'needs-gm');
  const gmFiredPath = path.join(gm, `gm-fired-${sessionId}`);

  if (operation === 'verb' && extra && extra.verb) {
    const pending = readPendingStep(cwd);
    if (pending && !AWAIT_RESULT_ALLOWED_VERBS.has(extra.verb)) {
      logDeviation('deviation.await-result-violation', { verb: extra.verb, step_id: pending.step_id });
      return {
        allowed: false,
        reason: `pipeline suspended at step_id=${pending.step_id}; only memorize-continue advances state. Read the AWAIT-RESULT instruction (dispatch \`instruction\`), compute the step inline using its prompt_template, then dispatch memorize-continue with the result. No other verb is valid until this completes.`,
        await_result: true,
        pending_step_id: pending.step_id,
      };
    }

    if (['bash', 'sh', 'shell', 'zsh', 'powershell', 'ps1'].includes(extra.verb)) {
      const cmd = String((extra.body && (extra.body.command || extra.body.code || extra.body.script)) || extra.command || '').trim();
      const isGitToken = (tok) => tok === 'git' || /[\\/]git(\.exe)?$/i.test(tok);
      const segments = cmd
        .split(/&&|\|\||[;&|]|(?<=["'])\s*&\s*(?=["'])/)
        .map((s) => s.trim())
        .filter(Boolean);
      const GIT_SUBCOMMAND_RE = /(^|[\s"'(;&|])git(\.exe)?\s+(add|am|apply|bisect|branch|checkout|cherry-pick|clean|clone|commit|config|diff|fetch|finalize|gc|grep|init|log|merge|mv|notes|pull|push|rebase|reflog|remote|reset|restore|revert|rm|show|stash|status|submodule|switch|tag|worktree)\b/i;
      const gitDominant = segments.some((seg) => {
        const stripped = seg.replace(/^["']|["']$/g, '');
        const tokens = stripped.split(/\s+/).filter(Boolean);
        for (let i = 0; i < tokens.length; i++) {
          const tok = tokens[i].replace(/^["']|["']$/g, '');
          if (isGitToken(tok)) return true;
          if (tok === 'env' || tok === 'exec' || tok === 'cd') continue;
          break;
        }
        return GIT_SUBCOMMAND_RE.test(stripped);
      });
      if (gitDominant) {
        logDeviation('deviation.bash-git-bypass', { verb: extra.verb, cmd: cmd.slice(0, 80) });
        return {
          allowed: false,
          reason: `bash-git-bypass: a \`${extra.verb}\` verb invoking \`git\` is denied -- git is a first-class spool surface, not a shell command. Use the git verb: git_status/git_log/git_diff/git_show/git_branch (inspect); git_add/git_commit/git_finalize/git_push (stage/commit/push); git_checkout/git_fetch/git_rm/git_revert/git_reset (mutate). git_finalize {message} bundles add->commit->porcelain-gate->push in ONE dispatch.`,
        };
      }
    }
  }

  if (['stop', 'complete'].includes(operation)) {
    const residuals = [];
    if (fs.existsSync(prdPath)) {
      try {
        const raw = fs.readFileSync(prdPath, 'utf8');
        if (raw.trim().length === 0) {
          residuals.push('prd.yml is empty/truncated -- cannot confirm PRD is actually done; restore from git or re-scope before declaring done');
        } else {
          const statuses = yamlStatusValues(raw);
          if (statuses.includes('pending') || statuses.includes('in_progress')) {
            residuals.push('PRD has open items -- resolve or name-and-stop before declaring done');
          }
        }
      } catch (e) {
        residuals.push(`prd.yml unreadable (${e.message}) -- cannot verify PRD state`);
      }
    }
    if (fs.existsSync(mutsPath)) {
      try {
        const raw = fs.readFileSync(mutsPath, 'utf8');
        if (raw.trim().length === 0) {
          residuals.push('mutables.yml is empty/truncated -- cannot confirm mutables are actually resolved; restore from git or re-scope before declaring done');
        } else {
          const statuses = yamlStatusValues(raw);
          if (statuses.includes('unknown')) {
            residuals.push('unresolved mutables present -- resolve with witness_evidence before declaring done');
          }
        }
      } catch (e) {
        residuals.push(`mutables.yml unreadable (${e.message}) -- cannot verify mutable state`);
      }
    }
    const dirty = isWorktreeDirty(cwd);
    if (!dirty.available) {
      residuals.push('worktree git state UNKNOWN (git status failed or timed out) -- cannot confirm a clean tree; re-run git status and commit/push any residual before declaring done');
    } else if (dirty.dirty) {
      residuals.push(`worktree dirty (${dirty.files.length} file${dirty.files.length === 1 ? '' : 's'}) -- commit and push before declaring done`);
    }
    const unpushed = hasUnpushedCommits(cwd);
    if (!unpushed.available) {
      residuals.push('unpushed-commit state UNKNOWN (git log @{u}..HEAD failed or timed out) -- cannot confirm origin reflects HEAD; verify and push before declaring done');
    } else if (unpushed.unpushed) {
      residuals.push(`${unpushed.count} unpushed commit${unpushed.count === 1 ? '' : 's'} -- push to remote before declaring done`);
    }
    const docs = unsolicitedDocs(cwd);
    if (docs.available && docs.count > 0) {
      residuals.push(`${docs.count} unsolicited doc${docs.count === 1 ? '' : 's'} (${docs.files.slice(0, 3).join(', ')}${docs.files.length > 3 ? ', ...' : ''}) -- delete or fold into commit/PRD/memorize, do not ship`);
      for (const f of docs.files) {
        logDeviation('deviation.unsolicited-doc-created', { file: f, operation });
      }
    }
    const browserEdits = readBrowserEdits(cwd);
    if (browserEdits.length > 0 && !isBrowserWitnessed(cwd)) {
      const files = browserEdits.map(e => e.file);
      const shown = files.slice(0, 5).join(', ') + (files.length > 5 ? `, +${files.length - 5} more` : '');
      residuals.push(`Browser Witness required: you edited ${shown} without dispatching the browser verb to witness the change in a live page. This is non-negotiable. Either dispatch browser to verify the edit works in-browser, or revert the changes.`);
      logDeviation('deviation.browser-witness-missing', { files, operation });
    } else if (browserEdits.length > 0 && isBrowserWitnessed(cwd)) {
      const witness = readBrowserWitness(cwd) || {};
      const wh = witness.witnessed_hashes || {};
      const mismatches = [];
      for (const e of browserEdits) {
        if (!e || !e.file) continue;
        const witnessed = wh[e.file];
        if (!witnessed) {
          mismatches.push({ file: e.file, reason: 'no witnessed hash recorded (file edited after witness, or witness predates edit)' });
          continue;
        }
        const current = hashFileShort(cwd || process.cwd(), e.file);
        if (current !== witnessed) {
          mismatches.push({ file: e.file, witnessed_hash: witnessed, current_hash: current || '(unreadable)' });
        }
      }
      if (mismatches.length > 0) {
        const summary = mismatches.slice(0, 3).map(m =>
          `${m.file} (witnessed=${m.witnessed_hash || 'none'}, current=${m.current_hash || '(none)'}${m.reason ? '; ' + m.reason : ''})`
        ).join('; ');
        residuals.push(`Browser Witness hash mismatch: you witnessed file(s) at one state, but their current content differs. Either the witness was on a different state or the file was reverted/re-edited without re-witnessing. Re-run the browser verb against the current state. Mismatches: ${summary}${mismatches.length > 3 ? `, +${mismatches.length - 3} more` : ''}`);
        logDeviation('deviation.browser-witness-hash-mismatch', { mismatches, operation });
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

  if (operation === 'bash' && extra && extra.command) {
    const pattern = isSpoolPollCommand(extra.command);
    if (pattern) {
      logDeviation('deviation.spool-poll', { operation, pattern, command_excerpt: String(extra.command).slice(0, 200) });
      return { allowed: false, reason: SPOOL_POLL_REASON };
    }
    const searchPattern = isNativeSearchCommand(extra.command);
    if (searchPattern) {
      logDeviation('deviation.native-search-bash', { operation, pattern: searchPattern, command_excerpt: String(extra.command).slice(0, 200) });
      return { allowed: false, reason: NATIVE_SEARCH_REASON };
    }
  }

  if (operation === 'mutable-resolve' && extra && (!extra.witness_evidence || String(extra.witness_evidence).trim() === '')) {
    logDeviation('deviation.mutable-without-evidence', { mutable_id: extra.id || null });
  }

  if (operation === 'git' && extra && extra.commit_message) {
    const marker = deferMarkerIn(extra.commit_message);
    if (marker) {
      logDeviation('deviation.commit-message-defer', { marker, operation });
      return {
        allowed: false,
        reason: `commit message rejected: deferral phrase '${marker}' detected. Defer markers force closure: either inline-fix and re-witness, or split the deferred work as a separate PRD item with blockedBy: [external] before committing. Rewrite the commit message and retry.`,
      };
    }
  }

  if (!['write', 'edit', 'git'].includes(operation)) return { allowed: true };

  if (fs.existsSync(prdPath) && fs.existsSync(needsGmPath) && !fs.existsSync(gmFiredPath)) {
    logDeviation('deviation.gate-deny', { operation, reason: 'gm orchestration in progress' });
    return { allowed: false, reason: 'gm orchestration in progress; skills must complete work before tools execute' };
  }

  if (fs.existsSync(mutsPath)) {
    try {
      const content = fs.readFileSync(mutsPath, 'utf8');
      if (yamlStatusValues(content).includes('unknown')) {
        logDeviation('deviation.gate-deny', { operation, reason: 'unresolved mutables' });
        return { allowed: false, reason: 'unresolved mutables block tool execution; resolve all mutables before proceeding' };
      }
    } catch (_) {}
  }

  return { allowed: true };
}

module.exports = { checkDispatchGates, isWorktreeDirty, hasUnpushedCommits, unsolicitedDocs, logDeviation, markInstructionSeen, hasDispatchedInstruction, isSpoolPollCommand, isNativeSearchCommand, SPOOL_POLL_REASON, recordBrowserEdit, markBrowserWitnessed, clearBrowserTurnMarkers, isBrowserRunningFile, readBrowserEdits, isBrowserWitnessed };
