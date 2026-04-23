#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const prdPath = path.join(process.cwd(), '.gm', 'prd.yml');
if (!fs.existsSync(prdPath)) process.exit(0);

let text;
try { text = fs.readFileSync(prdPath, 'utf8'); } catch { process.exit(0); }

const items = [];
let cur = null;
for (const line of text.split('\n')) {
  const idM = /^\s{2}-\s+id:\s+(.+?)\s*$/.exec(line);
  const statusM = /^\s{4}status:\s+(.+?)\s*$/.exec(line);
  const subjectM = /^\s{4}subject:\s+(.+?)\s*$/.exec(line);
  if (idM) { if (cur) items.push(cur); cur = { id: idM[1], status: 'pending', subject: '' }; }
  else if (statusM && cur) cur.status = statusM[1];
  else if (subjectM && cur) cur.subject = subjectM[1];
}
if (cur) items.push(cur);

const open = items.filter(i => i.status !== 'completed' && i.status !== 'deleted');
if (open.length === 0) process.exit(0);

const inProgress = open.filter(i => i.status === 'in_progress');
const pending = open.filter(i => i.status === 'pending');

const lines = [];
lines.push(`# PRD reminder: ${open.length} open item${open.length === 1 ? '' : 's'} in .gm/prd.yml`);
if (inProgress.length) {
  lines.push('');
  lines.push(`## In progress (${inProgress.length})`);
  for (const i of inProgress.slice(0, 5)) lines.push(`- ${i.id}: ${i.subject}`);
}
if (pending.length) {
  lines.push('');
  lines.push(`## Next up (${pending.length} pending)`);
  for (const i of pending.slice(0, 8)) lines.push(`- ${i.id}: ${i.subject}`);
}
lines.push('');
lines.push('Continue executing PRD items or explicitly close them. Update status in-place in .gm/prd.yml.');

process.stdout.write(JSON.stringify({
  decision: 'block',
  reason: lines.join('\n')
}) + '\n');
