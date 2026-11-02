// The pending queue of a run: the events an agent must act on, kept apart from the log, which stays the whole record. A record is appended
// only after the log holds its event, and it carries the event's seq as its id. The queue is read once and cleared. The file is renamed,
// the renamed copy is read, and the copy is removed after its records are delivered. A crash between the read and the removal delivers
// the records again, and never fewer. A consumer skips an id it has seen.
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export const PENDING_FILE = 'pending.jsonl';
// The event kinds an agent must act on: a job's start and end, a job killed, a stuck or unstuck job, a rules notice, and a recovery.
export const PENDING_KINDS = new Set(['job', 'job-killed', 'job-stuck', 'job-unstuck', 'rules-notice', 'recovery']);
const READING = /^pending\.\d+-[0-9a-f]+\.reading$/;

// The file is opened for each append, not kept open: a read-and-clear renames it, and a descriptor held open would then write into the copy
// that is being read.
export function appendPending(runDir, event) {
  appendFileSync(join(runDir, PENDING_FILE), `${JSON.stringify({ id: event.seq, ...event })}\n`);
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
  const files = names.map((name) => join(runDir, name));
  const records = [];
  for (const file of files) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.trim() !== '') records.push(JSON.parse(line));
    }
  }
  return { records, files };
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
