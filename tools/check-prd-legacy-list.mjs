#!/usr/bin/env node
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const workspace = mkdtempSync(join(tmpdir(), 'gm-rows-legacy-'));
const id = 'legacy-no-kind';
const NL = String.fromCharCode(10);

try {
  mkdirSync(join(workspace, '.gm', 'prd'), { recursive: true });
  const rowLines = [
    'id: ' + id,
    'status: pending',
    'subject: Drain the legacy PRD rows',
    'description: A legacy row written before kind was recorded.',
    '',
  ];
  writeFileSync(join(workspace, '.gm', 'prd', id + '.yml'), rowLines.join(NL));
  globalThis.host = {
    workspace,
    runDir: workspace,
    read_file: ({ path }) => {
      try { return readFileSync(path, 'utf8'); }
      catch (error) { return { ok: false, error: 'ENOENT ' + error.code }; }
    },
    list_dir: ({ path }) => {
      try { return readdirSync(path); }
      catch (error) { return { ok: false, error: 'ENOENT ' + error.code }; }
    },
    stat_file: () => ({ ok: true }),
  };
  const { verbs } = await import(pathToFileURL(join(root, 'native', 'leaves', 'rows.mjs')).href);
  const verb = (name) => verbs.find((entry) => entry.name === name);
  const open = verb('prd_list').call({ status: 'open' });
  const pending = verb('prd_list').call({ status: 'pending' });
  const all = verb('prd_list').call({ status: 'all' });
  const unknown = verb('unknown_list').call({ status: 'open' });
  if (open.ok !== true) failures.push('prd_list open refused: ' + open.error);
  if (open.output === '(none)') failures.push('prd_list open returned (none) for a pending legacy row');
  if (!open.output.includes(id)) failures.push('prd_list open did not list ' + id + ': ' + open.output);
  if (!pending.output.includes(id)) failures.push('prd_list pending did not list ' + id);
  if (!all.output.includes(id)) failures.push('prd_list all did not list ' + id);
  if (unknown.output.includes(id)) failures.push('unknown_list open claimed a legacy work item: ' + unknown.output);
  const description = verb('prd_list').description;
  if (description.includes('no kind is not listed')) failures.push('prd_list description still says a legacy row without kind is not listed');
  if (!description.includes('treated as a prd work item')) failures.push('prd_list description omits the legacy default');
} catch (error) {
  failures.push('threw: ' + error.message);
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error('check-prd-legacy-list: failed: ' + failures.length + '; ' + failures.join('; '));
  process.exit(1);
}
console.log('check-prd-legacy-list: passed: ' + id + ' (no kind, status pending) appears in prd_list open/pending/all, unknown_list open does not claim it, and the served description names the legacy default');
