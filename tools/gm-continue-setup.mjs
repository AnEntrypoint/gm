#!/usr/bin/env node
// gm-continue setup. It reads the rows (work/rows) and the git state, and it writes nothing. It runs before any work starts: it
// plans the whole batch of actionable rows, and it prints the handoff only after the witness pass has run.
// Flags: --repo <dir> (default: the current directory), --extra <dir> (more rows), --before <file> (resolved row ids before the
// last pass), --pass <file> (the last pass record: attempted rows, each row's outcome, and witnessPass).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at < 0 ? null : args[at + 1];
};
const REPO = flag('--repo') ?? process.cwd();
const EXTRA = flag('--extra');
const BEFORE = flag('--before');
const PASS = flag('--pass');

function readRows(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.yml'))
    .map((name) => {
      const row = {};
      for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
        const match = /^(\w+): (.*)$/.exec(line);
        if (match) row[match[1]] = JSON.parse(match[2]);
      }
      return row;
    });
}

// The run logs under runs/ with no end event, to depth three.
function openRuns(dir, depth = 0) {
  if (!existsSync(dir) || depth > 3) return [];
  const found = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (!statSync(path).isDirectory()) continue;
    const log = join(path, 'log.jsonl');
    if (existsSync(log)) {
      if (!readFileSync(log, 'utf8').includes('"kind":"end"')) found.push(path.slice(REPO.length + 1));
    } else {
      found.push(...openRuns(path, depth + 1));
    }
  }
  return found;
}

const git = (...argv) => execFileSync('git', argv, { cwd: REPO, encoding: 'utf8' }).trim();
const head = git('rev-parse', '--short', 'HEAD');
const ahead = Number(git('rev-list', '--count', 'origin/main..main'));
const changed = git('status', '--short').split('\n').filter(Boolean);

const rows = [...readRows(join(REPO, 'work', 'rows')), ...readRows(EXTRA)];
const open = rows.filter((row) => row.status !== 'resolved');
const actionable = open.filter((row) => row.status === 'open' && row.owner !== true && row.triggerMet === true);
const blocked = open.filter((row) => row.status === 'blocked');
const owner = open.filter((row) => row.owner === true);
const runs = openRuns(join(REPO, 'runs'));

const out = [];
out.push('GM-CONTINUE SETUP (read-only)');
out.push(`HEAD ${head}; ${ahead} commit(s) ahead of origin; working tree: ${changed.length} changed`);
out.push(`Batch plan: ${actionable.length} actionable row(s), planned before any work starts.`);
for (const row of actionable) out.push(`  plan ${row.id}: ${row.title}`);
out.push(`Open rows: ${open.length}; held: ${blocked.length}; owner decisions: ${owner.length}; open runs: ${runs.length}`);

const pass = PASS && existsSync(PASS) ? JSON.parse(readFileSync(PASS, 'utf8')) : null;
const before = BEFORE && existsSync(BEFORE) ? JSON.parse(readFileSync(BEFORE, 'utf8')).sort() : null;
const resolvedNow = rows.filter((row) => row.status === 'resolved').map((row) => row.id).sort();
const closed = before === null ? null : resolvedNow.filter((id) => !before.includes(id));

// Every actionable row must be attempted in the last pass, and must end resolved, or blocked with a named fact.
const attempted = new Set(pass?.attempted ?? []);
const defects = [];
const ended = [];
for (const row of actionable) {
  if (pass === null) break;
  if (!attempted.has(row.id)) {
    defects.push(`${row.id} is actionable and was left unattempted`);
    continue;
  }
  const outcome = pass.outcomes?.[row.id];
  if (!outcome || (outcome.status !== 'resolved' && outcome.status !== 'blocked') || (outcome.status === 'blocked' && !outcome.fact)) {
    defects.push(`${row.id} was attempted and did not end resolved, or blocked with a named fact`);
    continue;
  }
  ended.push({ id: row.id, status: outcome.status, fact: outcome.fact ?? '' });
}
if (defects.length > 0) out.push(`Pass defect (reported): ${defects.join('; ')}.`);

if (pass === null) {
  out.push('Re-entry: no pass record yet. The batch is built first, then the witness pass runs once over all of it.');
} else if (before === null) {
  out.push('Re-entry: first pass; re-enter the gm skill while actionable rows remain.');
} else if (closed.length > 0) {
  out.push(`Re-entry: ${closed.length} row(s) closed in the last pass (${closed.join(', ')}); re-enter the gm skill while actionable rows remain.`);
} else if (defects.length > 0) {
  out.push('Re-entry: the last pass closed no row and has a defect, so this is not a stop.');
} else {
  out.push('Re-entry: the last pass closed no row, and every actionable row ended resolved or blocked with a named fact. Stop.');
  if (pass.witnessPass === true) {
    out.push('HANDOFF');
    out.push(`  HEAD ${head}; held: ${blocked.length}; owner decisions: ${owner.length}; open runs: ${runs.length}`);
    for (const result of ended) out.push(`  attempted this pass, ${result.status}: ${result.id}: ${result.fact}`);
    for (const row of new Set([...blocked, ...owner])) out.push(`  ${row.id}: ${row.body}`);
  } else {
    out.push('Handoff withheld: the witness pass has not run. It prints only after the witness pass.');
  }
}
process.stdout.write(out.join('\n') + '\n');
