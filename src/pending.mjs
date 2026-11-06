// The pending queue of a run: the events an agent must act on, kept apart from the log, which stays the whole record. A record is appended
// only after the log holds its event, and it carries the event's seq as its id. A reader claims the queue by renaming pending.jsonl to a copy
// of its own, and removes the copy (clearPending) after the records are written out. The queue lock is held by an append and by a claim, so a
// claim never renames the queue while an append writes to it. A copy is named with its reader's pid, and another reader claims a copy only when
// that pid is gone, so two live readers never deliver one record. A crash between the write and the removal delivers those records once more,
// and never loses them. A consumer skips an id it has seen.
import { randomBytes } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export const PENDING_FILE = 'pending.jsonl';
export const PENDING_KINDS = new Set(['job', 'job-killed', 'job-stuck', 'job-unstuck', 'rules-notice', 'recovery', 'host-idle', 'row-added']);
const LOCK_FILE = 'pending.lock';
// A holder keeps the lock for one append or one rename, so a lock older than LOCK_STALE_MS was left by a holder that died. A waiter that
// waits LOCK_WAIT_MS without a stale lock gives up.
const LOCK_STALE_MS = 2000;
const LOCK_WAIT_MS = 5000;
const SLEEP = new Int32Array(new SharedArrayBuffer(4));
// A copy is named pending.<ms>-<hex>-<pid>.reading. A copy with no pid is from an earlier version, and is treated as abandoned.
const READING = /^pending\.\d+-[0-9a-f]+(?:-(\d+))?\.reading$/;

// A listener is called with each record after it is in the file. next_context uses one to hold a call until an event lands.
const listeners = new Set();
export function onPendingAppended(listener) {
  listeners.add(listener);
}
export function offPendingAppended(listener) {
  listeners.delete(listener);
}

// The file is opened for each append, not kept open: a claim renames it, and a descriptor held open would write into the copy that is being
// read. The write is made under the queue lock, so no claim renames the queue between the open and the write of an append.
export function appendPending(runDir, event) {
  const record = { id: event.seq, ...event };
  withQueueLock(runDir, () => appendFileSync(join(runDir, PENDING_FILE), `${JSON.stringify(record)}\n`));
  for (const listener of listeners) listener(record);
}

// The records not yet delivered, in the order they were written. Copies of readers that are gone are claimed first, then the queue. The files
// are returned so that the caller removes them after it has delivered the records. A file another reader claimed first is skipped.
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
