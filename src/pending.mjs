// The pending queue of a run: the events an agent must act on, kept apart from the log, which stays the whole record. A record is appended
// only after the log holds its event, and it carries the event's seq as its id. A record is delivered once. A reader claims the queue by
// renaming pending.jsonl to a copy of its own, so only one reader gets a record, and it removes the copy (clearPending) after the records are
// written out. A crash between the write and the removal delivers those records once more, and never loses them. A consumer skips an id it has seen.
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export const PENDING_FILE = 'pending.jsonl';
// The event kinds an agent must act on: a job's start and end, a job killed, a stuck or unstuck job, a rules notice, a recovery, a paused
// run (the worker was stopped with the run open, so nothing else wakes the agent), and a host-idle notice (no call for a while).
export const PENDING_KINDS = new Set(['job', 'job-killed', 'job-stuck', 'job-unstuck', 'rules-notice', 'recovery', 'paused', 'host-idle']);
const READING = /^pending\.\d+-[0-9a-f]+\.reading$/;

// A listener is called with each record after it is in the file. next_context uses one to hold a call until an event lands.
const listeners = new Set();
export function onPendingAppended(listener) {
  listeners.add(listener);
}
export function offPendingAppended(listener) {
  listeners.delete(listener);
}

// The file is opened for each append, not kept open: a read-and-clear renames it, and a descriptor held open would then write into the copy
// that is being read.
export function appendPending(runDir, event) {
  const record = { id: event.seq, ...event };
  appendFileSync(join(runDir, PENDING_FILE), `${JSON.stringify(record)}\n`);
  for (const listener of listeners) listener(record);
}

// The records not yet delivered, in the order they were written. Copies left by an earlier crash are claimed first, then the queue. The files
// are returned so that the caller removes them after it has delivered the records. A file another reader claimed first is skipped.
export function takePending(runDir) {
  const files = [];
  for (const name of readdirSync(runDir).filter((entry) => READING.test(entry)).sort()) {
    const copy = claim(runDir, name);
    if (copy !== null) files.push(copy);
  }
  const queued = claim(runDir, PENDING_FILE);
  if (queued !== null) files.push(queued);
  const records = [];
  for (const file of files) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.trim() !== '') records.push(JSON.parse(line));
    }
  }
  return { records, files };
}

// Renames one queue file to a copy with this reader's own name. The rename is the claim: when another reader has renamed the file first, it
// is absent here and the result is null, which is not an error.
function claim(runDir, name) {
  const copy = join(runDir, `pending.${Date.now()}-${randomBytes(4).toString('hex')}.reading`);
  try {
    renameSync(join(runDir, name), copy);
    return copy;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// True when takePending would return records: the queue has some, or a copy from an earlier crash is waiting.
export function hasPending(runDir) {
  return existsSync(join(runDir, PENDING_FILE)) || readdirSync(runDir).some((name) => READING.test(name));
}

// Removes the copies that takePending read. A copy that is already gone is not an error.
export function clearPending(files) {
  for (const file of files) {
    try {
      unlinkSync(file);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
}
