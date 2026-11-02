import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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

export function openRun({ runDir, rules, meta }) {
  const file = join(runDir, 'log.jsonl');
  if (existsSync(file)) return { log: openLog(file), resumed: true };
  // A completed run that retention compressed has its record in log.jsonl.gz. A new log beside that record would not be a resume, so it is refused.
  if (existsSync(`${file}.gz`)) throw new Error(`run ${runDir} is compressed, so it cannot be resumed; start a new run`);
  return { log: createRun({ runDir, rules, meta }), resumed: false };
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
