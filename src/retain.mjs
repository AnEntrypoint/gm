// Retention for runs/. A completed run is one whose log has an end event. At worker start, the completed runs older than a set age are
// compressed: log.jsonl becomes log.jsonl.gz, after the gzip is read back and found equal to the original. When the runs still take more
// than a cap, the oldest completed runs are compressed next until they do not. Nothing is deleted: a log is the record of its run. The
// sweep returns what it did, and the worker logs it in its own run, so the owner can see every change.
import { existsSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

export const DEFAULT_RETAIN_DAYS = 7;
export const DEFAULT_CAP_BYTES = 1024 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

// The log text of a run, from log.jsonl or, once compressed, from log.jsonl.gz. Null when the run has neither.
export function readLogText(file) {
  if (existsSync(file)) return readFileSync(file, 'utf8');
  if (existsSync(`${file}.gz`)) return gunzipSync(readFileSync(`${file}.gz`)).toString('utf8');
  return null;
}

// Every run directory under root: a directory that holds a log.jsonl, at any depth (runs/<id> and runs/self/<id> both occur).
function runDirs(root) {
  const out = [];
  const visit = (dir) => {
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    if (names.includes('log.jsonl') || names.includes('log.jsonl.gz')) out.push(dir);
    for (const name of names) {
      const path = join(dir, name);
      if (name !== 'log.jsonl' && name !== 'log.jsonl.gz' && statSync(path).isDirectory()) visit(path);
    }
  };
  visit(root);
  return out;
}

// The bytes of a run's log, compressed or not. Its modified time is the time it last had an event.
function logOf(dir) {
  const plain = join(dir, 'log.jsonl');
  if (existsSync(plain)) return { file: plain, compressed: false, bytes: statSync(plain).size, mtime: statSync(plain).mtimeMs };
  const gz = join(dir, 'log.jsonl.gz');
  return { file: gz, compressed: true, bytes: statSync(gz).size, mtime: statSync(gz).mtimeMs };
}

// Whether a run has ended: its log has an end event. An open run is never compressed.
function completed(dir) {
  const text = readLogText(join(dir, 'log.jsonl'));
  return text !== null && text.includes('"kind":"end"');
}

// Compresses one run's log, after reading the gzip back and finding it equal to the original.
function compress(dir) {
  const plain = join(dir, 'log.jsonl');
  const text = readFileSync(plain);
  const packed = gzipSync(text, { level: 9 });
  if (!gunzipSync(packed).equals(text)) throw new Error(`the gzip of ${plain} did not read back equal`);
  const tmp = `${plain}.gz.tmp`;
  writeFileSync(tmp, packed);
  renameSync(tmp, `${plain}.gz`);
  unlinkSync(plain);
  return { run: dir, before: text.length, after: packed.length };
}

// Compresses the completed runs under root that are older than maxAgeDays, then the oldest completed runs until the total is under capBytes.
// current is the run directory of this worker, which is never touched. It returns { compressed, bytesBefore, bytesAfter, overCap }.
export function sweepRuns(root, { current, maxAgeDays = DEFAULT_RETAIN_DAYS, capBytes = DEFAULT_CAP_BYTES, now = Date.now() } = {}) {
  if (!existsSync(root)) return { compressed: [], bytesBefore: 0, bytesAfter: 0, overCap: false };
  const dirs = runDirs(root).filter((dir) => dir !== current);
  const logs = dirs.map((dir) => ({ dir, ...logOf(dir) }));
  const total = (rows) => rows.reduce((sum, row) => sum + row.bytes, 0);
  const bytesBefore = total(logs) + (current && existsSync(join(current, 'log.jsonl')) ? statSync(join(current, 'log.jsonl')).size : 0);
  const compressed = [];
  const old = logs.filter((row) => !row.compressed && now - row.mtime > maxAgeDays * DAY_MS && completed(row.dir));
  for (const row of old) compressed.push(compress(row.dir));
  let left = logs.map((row) => {
    const done = compressed.find((entry) => entry.run === row.dir);
    return done ? { ...row, bytes: done.after, compressed: true } : row;
  });
  if (total(left) > capBytes) {
    const oldestFirst = left.filter((row) => !row.compressed && completed(row.dir)).sort((a, b) => a.mtime - b.mtime);
    for (const row of oldestFirst) {
      if (total(left) <= capBytes) break;
      const done = compress(row.dir);
      compressed.push(done);
      left = left.map((other) => (other.dir === row.dir ? { ...other, bytes: done.after, compressed: true } : other));
    }
  }
  const bytesAfter = total(left) + (current && existsSync(join(current, 'log.jsonl')) ? statSync(join(current, 'log.jsonl')).size : 0);
  return { compressed: compressed.map(({ run, before, after }) => ({ run, before, after })), bytesBefore, bytesAfter, overCap: bytesAfter > capBytes };
}
