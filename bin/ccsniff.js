#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const C = { r:'\x1b[31m', g:'\x1b[32m', y:'\x1b[33m', b:'\x1b[34m', m:'\x1b[35m', c:'\x1b[36m', d:'\x1b[2m', x:'\x1b[0m', bold:'\x1b[1m' };
const useColor = process.stdout.isTTY;
const col = (k, s) => useColor ? C[k] + s + C.x : s;

function parseDuration(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d+)([smhd])$/);
  if (!m) return null;
  return parseInt(m[1],10) * ({s:1000,m:60000,h:3600000,d:86400000}[m[2]]);
}

function parseArgs(argv) {
  const flags = new Set();
  let since = null, project = null;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--since') { since = parseDuration(argv[++i]); continue; }
    if (a === '--project') { project = argv[++i]; continue; }
    if (a.startsWith('--')) flags.add(a.slice(2));
  }
  return { flags, since, project };
}

function encodeCwd(cwd) {
  return cwd.replace(/[\\/:]+/g, '-').replace(/^-+/, '');
}

function findTranscripts(project) {
  const root = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(root)) { console.log(col('d', `no log at ${root}`)); return []; }
  const out = [];
  const targetEnc = project ? encodeCwd(project) : null;
  for (const dir of fs.readdirSync(root)) {
    if (targetEnc && !dir.includes(targetEnc)) continue;
    const full = path.join(root, dir);
    if (!fs.statSync(full).isDirectory()) continue;
    for (const f of fs.readdirSync(full)) {
      if (f.endsWith('.jsonl')) out.push({ project: dir, file: path.join(full, f) });
    }
  }
  return out;
}

function* iterTurns(file) {
  let lines;
  try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/); }
  catch { return; }
  for (const line of lines) {
    if (!line) continue;
    try { yield JSON.parse(line); } catch {}
  }
}

function extractBashCommands(turn) {
  const out = [];
  const msg = turn.message;
  if (!msg || !Array.isArray(msg.content)) return out;
  for (const c of msg.content) {
    if (c.type === 'tool_use' && (c.name === 'Bash' || c.name === 'PowerShell')) {
      out.push({ tool: c.name, cmd: c.input?.command || '', id: c.id });
    }
  }
  return out;
}

function turnTs(turn) {
  return Date.parse(turn.timestamp || '') || 0;
}

function gitDisciplineScan(transcripts, cutoff) {
  const findings = [];
  for (const { project, file } of transcripts) {
    let lastCommitTs = null, lastCommitSess = null, sawPushAfterCommit = false;
    for (const turn of iterTurns(file)) {
      const ts = turnTs(turn);
      if (cutoff && ts && ts < cutoff) continue;
      const cmds = extractBashCommands(turn);
      for (const { tool, cmd } of cmds) {
        if (!cmd) continue;
        if (/\bgit\s+push\b/.test(cmd) && !/exec-spool|spool-dispatch|git_push/.test(cmd)) {
          findings.push({ kind: 'raw-push', project, file: path.basename(file), ts, tool, cmd: cmd.slice(0, 120), sess: turn.sessionId });
          sawPushAfterCommit = true;
        }
        if (/\bgit\s+commit\b/.test(cmd)) {
          if (lastCommitTs && !sawPushAfterCommit) {
            findings.push({ kind: 'commit-without-push', project, file: path.basename(file), ts: lastCommitTs, sess: lastCommitSess, cmd: '(prior commit had no push)' });
          }
          lastCommitTs = ts; lastCommitSess = turn.sessionId; sawPushAfterCommit = false;
        }
        if (/git\s+push.*--force\b/.test(cmd)) {
          findings.push({ kind: 'force-push', project, file: path.basename(file), ts, tool, cmd: cmd.slice(0,120), sess: turn.sessionId });
        }
      }
    }
  }
  return findings;
}

function collectPlugkitEvents(cutoff) {
  const roots = [
    path.join(os.homedir(), '.gm-log'),
    path.join(os.homedir(), '.claude', 'gm-log'),
  ].filter(r => fs.existsSync(r));
  const events = [];
  if (roots.length === 0) { console.log(col('d', `no gm-log at ~/.gm-log or ~/.claude/gm-log`)); return events; }
  for (const root of roots) {
    for (const date of fs.readdirSync(root)) {
      const pj = path.join(root, date, 'plugkit.jsonl');
      if (!fs.existsSync(pj)) continue;
      let lines; try { lines = fs.readFileSync(pj, 'utf8').split(/\r?\n/); } catch { continue; }
      for (const line of lines) {
        if (!line) continue;
        try {
          const ev = JSON.parse(line);
          const ts = Date.parse(ev.ts || '') || 0;
          if (cutoff && ts && ts < cutoff) continue;
          ev._ts = ts;
          events.push(ev);
        } catch {}
      }
    }
  }
  return events;
}

function learningXref(transcripts, cutoff) {
  const events = collectPlugkitEvents(cutoff);
  const bySess = new Map();
  for (const ev of events) {
    const s = ev.sess || '';
    if (!s) continue;
    if (!bySess.has(s)) bySess.set(s, []);
    bySess.get(s).push(ev);
  }
  const xrefs = [];
  for (const { project, file } of transcripts) {
    for (const turn of iterTurns(file)) {
      const sess = turn.sessionId;
      const ts = turnTs(turn);
      if (cutoff && ts && ts < cutoff) continue;
      if (!sess || !bySess.has(sess)) continue;
      const candidates = bySess.get(sess).filter(ev => Math.abs((ev._ts||0) - ts) < 60000);
      for (const ev of candidates) {
        xrefs.push({ project, sess, turnTs: ts, evTs: ev._ts, event: ev.event, verb: ev.verb, dur: ev.dur_ms });
      }
    }
  }
  return xrefs;
}

function fmtTs(ts) { return ts ? new Date(ts).toISOString().slice(0,19).replace('T',' ') : '----------'; }

function main() {
  const { flags, since, project } = parseArgs(process.argv);
  const cutoff = since ? Date.now() - since : 0;
  const transcripts = findTranscripts(project);
  console.log(col('bold', `ccsniff — ${transcripts.length} transcript(s)${since ? `, since ${since/1000}s` : ''}${project ? `, project=${project}` : ''}`));
  console.log(col('d', '-'.repeat(80)));

  if (flags.has('git-discipline') || flags.size === 0) {
    const findings = gitDisciplineScan(transcripts, cutoff);
    console.log(col('bold', `git-discipline: ${findings.length} finding(s)`));
    const byKind = {};
    for (const f of findings) byKind[f.kind] = (byKind[f.kind]||0)+1;
    console.log(col('d', '  by kind: ') + Object.entries(byKind).map(([k,v]) => `${col('y',k)}=${v}`).join('  '));
    for (const f of findings.slice(-200)) {
      const tag = f.kind === 'raw-push' ? col('r','RAW-PUSH        ')
                : f.kind === 'commit-without-push' ? col('y','COMMIT-NO-PUSH  ')
                : col('r','FORCE-PUSH      ');
      console.log(`${col('d', fmtTs(f.ts))} ${tag} ${col('m','['+String(f.sess||'').slice(0,8)+']')} ${col('c', f.project.slice(0,40))} ${f.cmd||''}`);
    }
    console.log();
  }

  if (flags.has('learning-xref')) {
    const xrefs = learningXref(transcripts, cutoff);
    console.log(col('bold', `learning-xref: ${xrefs.length} joined turn/event pair(s)`));
    for (const x of xrefs.slice(-200)) {
      console.log(`${col('d', fmtTs(x.turnTs))} ${col('m','['+x.sess.slice(0,8)+']')} ${col('c', x.event||'').padEnd(24)} verb=${x.verb||''} dur=${x.dur||''}ms proj=${x.project.slice(0,30)}`);
    }
  }
}

main();
