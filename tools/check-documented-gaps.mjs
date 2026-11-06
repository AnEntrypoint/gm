#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = join(root, 'research', 'documented-gaps-2026-11-06.json');
const SOURCE = join(root, 'native', 'tests', 'parity', 'run.mjs');
const NOTE = 'live verdicts come from the parity harness run by hand (node native/tests/parity/run.mjs --bin <gm>); this check covers the snapshot and the source only';

const source = readFileSync(SOURCE, 'utf8');
const pinned = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
const rows = Array.isArray(pinned.rows) ? pinned.rows : [];
const failures = [];

const inSource = (text) => source.includes(text) || source.includes(text.replace(/'/g, "\\'"));
const rowInSource = (row) => [row, row.replace(/^mcp /, '')].some((name) => source.includes(`'${name}'`) || source.includes(`"${name}"`));

if (rows.length === 0) failures.push('snapshot has no rows');
for (const entry of rows) {
  if (entry.verdict !== 'documented-gap') failures.push(`${entry.row}: verdict is ${entry.verdict}`);
  if (!rowInSource(entry.row)) failures.push(`row not in ${SOURCE}: ${entry.row}`);
  if (!Array.isArray(entry.reasons) || entry.reasons.length === 0) failures.push(`${entry.row}: no reasons pinned`);
  for (const reason of entry.reasons ?? []) {
    if (!inSource(reason)) failures.push(`${entry.row}: reason not in source: ${reason.slice(0, 80)}`);
  }
}

if (failures.length > 0) {
  console.error(`check-documented-gaps: failed: ${failures.length}\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`check-documented-gaps: passed: ${rows.length} documented-gap rows and their reasons are in native/tests/parity/run.mjs; ${NOTE}`);
