#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PRD_PATH = path.join(process.cwd(), '.gm', 'prd.yml');
const STATE_PATH = path.join(process.cwd(), '.gm', 'prd-state.json');
const MAX_CONSECUTIVE_BLOCKS = 20;

function allowSilently(msg) {
  if (msg) process.stderr.write(`prd-stop-reminder: ${msg}\n`);
  process.exit(0);
}

function parsePrd(text) {
  const items = [];
  let cur = null;
  const srcLines = text.split('\n');
  for (let i = 0; i < srcLines.length; i++) {
    const line = srcLines[i];
    const idM = /^\s{2}-\s+id:\s+(.+?)\s*$/.exec(line);
    const statusM = /^\s{4}status:\s+([a-z_]+)\s*$/.exec(line);
    const subjectM = /^\s{4}subject:\s+(.+?)\s*$/.exec(line);
    if (idM) { if (cur) items.push(cur); cur = { id: idM[1].trim(), status: 'pending', subject: '', lineNo: i + 1 }; }
    else if (statusM && cur) cur.status = statusM[1].trim();
    else if (subjectM && cur) cur.subject = subjectM[1].trim();
  }
  if (cur) items.push(cur);
  return items;
}

if (!fs.existsSync(PRD_PATH)) allowSilently('no .gm/prd.yml — nothing to enforce');

let text;
try { text = fs.readFileSync(PRD_PATH, 'utf8'); } catch (e) { allowSilently(`cannot read prd: ${e.message}`); }

const items = parsePrd(text);
if (items.length === 0) allowSilently('prd.yml has no parseable items — nothing to enforce');

const counts = {
  total: items.length,
  completed: items.filter(i => i.status === 'completed').length,
  deleted: items.filter(i => i.status === 'deleted').length,
  in_progress: items.filter(i => i.status === 'in_progress').length,
  pending: items.filter(i => i.status === 'pending').length,
};
const open = items.filter(i => i.status !== 'completed' && i.status !== 'deleted');

let state = { baselineIds: null, baselineHash: null, consecutiveBlocks: 0 };
if (fs.existsSync(STATE_PATH)) {
  try { state = Object.assign(state, JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))); } catch {}
}

const currentIds = items.map(i => i.id).sort();
const currentHash = crypto.createHash('sha256').update(currentIds.join('\n')).digest('hex').slice(0, 16);

if (!state.baselineIds) {
  state.baselineIds = currentIds;
  state.baselineHash = currentHash;
}

const missingIds = state.baselineIds.filter(id => !currentIds.includes(id));
const regressions = [];
if (missingIds.length > 0) {
  regressions.push(`PRD items removed since baseline: ${missingIds.join(', ')} — items must be marked completed or deleted in-place, not removed from the file.`);
}

const srcLines = text.split('\n');
const suspiciouslyCompleted = [];
for (const item of items.filter(i => i.status === 'completed')) {
  const start = item.lineNo;
  const nextBlockLine = items
    .filter(j => j.lineNo > start)
    .map(j => j.lineNo)
    .sort((a, b) => a - b)[0] || srcLines.length;
  const block = srcLines.slice(start - 1, nextBlockLine - 1).join('\n');
  if (!/acceptance:|description:/.test(block)) suspiciouslyCompleted.push(item.id);
}
if (suspiciouslyCompleted.length > 0 && suspiciouslyCompleted.length <= 5) {
  regressions.push(`Completed items lacking acceptance/description — verify real: ${suspiciouslyCompleted.join(', ')}`);
}

if (open.length === 0 && regressions.length === 0) {
  state.consecutiveBlocks = 0;
  state.baselineIds = currentIds;
  state.baselineHash = currentHash;
  try { fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2)); } catch {}
  process.stdout.write(`PRD complete: ${counts.completed}/${counts.total} done, ${counts.deleted} deleted. Stop allowed.\n`);
  process.exit(0);
}

state.consecutiveBlocks = (state.consecutiveBlocks || 0) + 1;
try { fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2)); } catch {}

if (state.consecutiveBlocks > MAX_CONSECUTIVE_BLOCKS) {
  process.stdout.write(`PRD enforcement: circuit breaker tripped after ${state.consecutiveBlocks} consecutive blocks. Allowing stop. Delete .gm/prd-state.json to reset.\n`);
  process.exit(0);
}

const inProgress = open.filter(i => i.status === 'in_progress');
const pending = open.filter(i => i.status === 'pending');

const out = [];
out.push(`PRD BLOCK [${state.consecutiveBlocks}/${MAX_CONSECUTIVE_BLOCKS}]: ${open.length} open items in .gm/prd.yml.`);
out.push('');
out.push(`Totals: ${counts.completed} completed | ${counts.in_progress} in_progress | ${counts.pending} pending | ${counts.deleted} deleted | ${counts.total} total`);

if (regressions.length > 0) {
  out.push('');
  out.push('REGRESSIONS:');
  for (const r of regressions) out.push(`  ! ${r}`);
}

if (inProgress.length > 0) {
  out.push('');
  out.push(`In progress (finish first):`);
  for (const i of inProgress.slice(0, 5)) out.push(`  - ${i.id}: ${i.subject}`);
}
if (pending.length > 0) {
  out.push('');
  out.push(`Pending (${pending.length}):`);
  for (const i of pending.slice(0, 10)) out.push(`  - ${i.id}: ${i.subject}`);
  if (pending.length > 10) out.push(`  ... +${pending.length - 10} more`);
}

out.push('');
out.push('Required: pick pending -> in_progress -> implement -> push -> CI green -> status: completed. Repeat until open == 0.');
out.push('Do not remove items; use status: deleted with reason if truly out of scope.');

process.stdout.write(JSON.stringify({ decision: 'block', reason: out.join('\n') }) + '\n');
