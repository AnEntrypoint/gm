// The pending queue of a run: the events an agent must act on, kept apart from the log, which stays the whole record. A record is appended
// only after the log holds its event, and it carries the event's seq as its id. The queue is read once and cleared. The file is renamed,
// the renamed copy is read, and the copy is removed after its records are delivered. A crash between the read and the removal delivers
// the records again, and never fewer. A consumer skips an id it has seen.
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

// The records not yet delivered, in the order they were written. Copies left by an earlier crash come first. The files are returned so
// that the caller removes them after it has delivered the records.
export function takePending(runDir) {
  const names = readdirSync(runDir).filter((name) => READING.test(name)).sort();
  if (existsSync(join(runDir, PENDING_FILE))) {
    const name = `pending.${Date.now()}-${randomBytes(4).toString('hex')}.reading`;
    renameSync(join(runDir, PENDING_FILE), join(runDir, name));
    names.push(name);
  }
  const files = [];
  const records = [];
  for (const name of names) {
    const file = join(runDir, name);
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch (err) {
      // Another reader took this copy after it was listed, so its records are that reader's to deliver.
      if (err.code === 'ENOENT') continue;
      throw err;
    }
    files.push(file);
    for (const line of text.split('\n')) {
      if (line.trim() !== '') records.push(JSON.parse(line));
    }
  }
  return { records, files };
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
