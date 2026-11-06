import { randomBytes } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export const PENDING_FILE = 'pending.jsonl';
export const PENDING_KINDS = new Set(['job', 'job-killed', 'job-stuck', 'job-unstuck', 'rules-notice', 'recovery', 'host-idle', 'row-added']);
const LOCK_FILE = 'pending.lock';
const LOCK_STALE_MS = 2000;
const LOCK_WAIT_MS = 5000;
const SLEEP = new Int32Array(new SharedArrayBuffer(4));
const READING = /^pending\.\d+-[0-9a-f]+(?:-(\d+))?\.reading$/;

const listeners = new Set();
export function onPendingAppended(listener) {
  listeners.add(listener);
}
export function offPendingAppended(listener) {
  listeners.delete(listener);
}

export function appendPending(runDir, event) {
  const record = { id: event.seq, ...event };
  withQueueLock(runDir, () => appendFileSync(join(runDir, PENDING_FILE), `${JSON.stringify(record)}\n`));
  for (const listener of listeners) listener(record);
}

export function takePending(runDir) {
  const files = [];
  for (const name of readdirSync(runDir).filter((entry) => READING.test(entry)).sort()) {
    if (!readerGone(READING.exec(name)[1])) continue;
    const copy = claim(runDir, name);
    if (copy !== null) files.push(copy);
  }
  const queued = withQueueLock(runDir, () => claim(runDir, PENDING_FILE));
  if (queued !== null) files.push(queued);
  const records = [];
  for (const file of files) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.trim() !== '') records.push(JSON.parse(line));
    }
  }
  return { records, files };
}

function claim(runDir, name) {
  const copy = join(runDir, `pending.${Date.now()}-${randomBytes(4).toString('hex')}-${process.pid}.reading`);
  try {
    renameSync(join(runDir, name), copy);
    return copy;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function readerGone(pid) {
  if (pid === undefined) return true;
  try {
    process.kill(Number(pid), 0);
    return false;
  } catch (err) {
    return err.code === 'ESRCH';
  }
}

function withQueueLock(runDir, fn) {
  const lock = join(runDir, LOCK_FILE);
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      closeSync(openSync(lock, 'wx'));
      break;
    } catch (err) {
      if (err.code !== 'EEXIST' && err.code !== 'EPERM') throw err;
      removeStaleLock(lock);
      if (Date.now() >= deadline) throw new Error(`the pending queue stayed locked: ${lock}`);
      Atomics.wait(SLEEP, 0, 0, 1);
    }
  }
  try {
    return fn();
  } finally {
    removeFile(lock);
  }
}

function removeStaleLock(lock) {
  try {
    if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) unlinkSync(lock);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function removeFile(file) {
  try {
    unlinkSync(file);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

export function hasPending(runDir) {
  return existsSync(join(runDir, PENDING_FILE)) || readdirSync(runDir).some((name) => READING.test(name) && readerGone(READING.exec(name)[1]));
}

export function clearPending(files) {
  for (const file of files) removeFile(file);
}
