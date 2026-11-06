import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openLog } from './log.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const RUNS = join(ROOT, 'runs');

export function newRunId() {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `${stamp}-${randomBytes(3).toString('hex')}`;
}

export function createRun({ runDir, rules, meta }) {
  if (existsSync(join(runDir, 'log.jsonl'))) throw new Error(`run directory already has a log: ${runDir}`);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'rules.md'), rules);
  writeFileSync(join(runDir, 'task.json'), `${JSON.stringify(meta, null, 2)}\n`);
  return openLog(join(runDir, 'log.jsonl'));
}

export function currentRunDir(runDir) {
  const seen = new Set();
  let dir = runDir;
  while (!seen.has(dir) && existsSync(join(dir, 'successor'))) {
    seen.add(dir);
    const name = readFileSync(join(dir, 'successor'), 'utf8').trim();
    if (name === '') break;
    dir = join(dirname(dir), name);
  }
  return dir;
}

export function setSuccessor(runDir, successorDir) {
  const file = join(runDir, 'successor');
  writeFileSync(`${file}.tmp`, basename(successorDir));
  renameSync(`${file}.tmp`, file);
}

export function openRun({ runDir, rules, meta }) {
  const file = join(runDir, 'log.jsonl');
  if (existsSync(file)) {
    const log = openLog(file);
    refreshRules(runDir, rules, log);
    return { log, resumed: true };
  }
  return { log: createRun({ runDir, rules, meta }), resumed: false };
}

function refreshRules(runDir, rules, log) {
  const path = join(runDir, 'rules.md');
  const before = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (before === rules) return;
  writeFileSync(path, rules);
  log.append('rules-updated', { from: before === null ? null : hashOf(before), to: hashOf(rules) });
}

function hashOf(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

export function loadTask(value) {
  const path = resolve(value);
  if (isFile(path)) return readFileSync(path, 'utf8');
  return value;
}

export function isDirectory(path) {
  return existsSync(path) && statSync(path).isDirectory();
}

function isFile(path) {
  return existsSync(path) && statSync(path).isFile();
}
