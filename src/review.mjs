import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// Review functions. A review packet names a spec, its sha256, and the paths it refers to. A review record is the verdict of
// a fresh reviewer on one packet, and the host spawns that reviewer and passes its reply here. Both are plain functions with
// no tool name. gm does not verify the reviewer's isolation: each record says isolation host-attested. The join reads the
// log, and attributes the outcomes that follow a record, in order, to that record, up to the next record.
const VERDICTS = ['pass', 'fail', 'needs-changes'];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  return value;
}

// The file at a path, inside or outside the workspace, or null. A relative path is taken from the workspace.
function fileAt(root, rel) {
  if (typeof rel !== 'string' || rel === '') return null;
  const at = resolve(root, rel);
  return existsSync(at) && statSync(at).isFile() ? at : null;
}

// A packet is the spec's path, the spec's sha256, and the sorted referenced paths. Its hash is the sha256 of that content in
// canonical JSON, so the same spec and references always give the same hash.
export function reviewPacket({ root, log, spec, refs = [] }) {
  const refuse = (reason) => {
    log?.append('review-refused', { reason, stage: 'packet' });
    return { ok: false, error: `refused: ${reason}` };
  };
  if (!Array.isArray(refs) || !refs.every((ref) => typeof ref === 'string')) return refuse('refs must be a list of paths');
  const specAt = fileAt(root, spec);
  if (specAt === null) return refuse(`spec ${spec} is not a file`);
  const missing = refs.filter((ref) => fileAt(root, ref) === null);
  if (missing.length > 0) return refuse(`referenced paths do not exist: ${missing.join(', ')}`);
  const specSha = sha256(readFileSync(specAt));
  const sortedRefs = [...refs].sort();
  const hash = sha256(JSON.stringify(sortKeys({ spec, specSha, refs: sortedRefs })));
  log?.append('review-packet', { packet: hash, spec, specSha, refs: sortedRefs });
  return { ok: true, packet: hash, spec, specSha, refs: sortedRefs };
}

// A record is one reviewer's verdict on one packet. It is refused when the packet is not in this log, when the packet already
// has a record, when the verdict is not one of VERDICTS, when there is no reviewer, or when the spec's sha has changed since
// the packet. A refusal is logged as review-refused, and nothing else is written.
export function reviewRecord({ root, log, packet, verdict, reviewer, notes = '' }) {
  const refuse = (reason) => {
    log?.append('review-refused', { packet, reason, stage: 'record' });
    return { ok: false, error: `refused: ${reason}` };
  };
  const events = log.events();
  const made = events.find((event) => event.kind === 'review-packet' && event.packet === packet);
  if (!made) return refuse(`no review packet ${packet} in this log`);
  if (events.some((event) => event.kind === 'review' && event.packet === packet)) return refuse(`packet ${packet} already has a record`);
  if (!VERDICTS.includes(verdict)) return refuse(`verdict must be one of ${VERDICTS.join(', ')}`);
  if (typeof reviewer !== 'string' || reviewer.trim() === '') return refuse('reviewer must name the fresh reviewer that the host spawned');
  if (typeof notes !== 'string') return refuse('notes must be a string');
  const specAt = fileAt(root, made.spec);
  const nowSha = specAt === null ? null : sha256(readFileSync(specAt));
  if (nowSha !== made.specSha) return refuse(`the spec changed since packet ${packet}: packet sha ${made.specSha}, now ${nowSha ?? 'missing'}`);
  log.append('review', { packet, verdict, reviewer, notes, isolation: 'host-attested', specSha: made.specSha });
  return { ok: true, packet, verdict };
}

// The join: one row per record, with the outcomes that follow it, up to the next record. The spec's sha is read at each commit
// from the commit's own tree (git show <sha>:<spec>), and at the end from the working tree. An outcome whose spec sha is not the
// packet's sha is after-edit: it goes to unattributed, and it is not attributed to the record. A commit whose spec cannot be read
// at the commit goes to unattributed too. A git_commit result follows its commit, and it takes the commit's attribution.
export function reviewJoin(events, root) {
  const packets = new Map();
  for (const event of events) if (event.kind === 'review-packet') packets.set(event.packet, event);
  const rows = [];
  let row = null;
  let commitCovered = true;
  for (const event of events) {
    if (event.kind === 'review') {
      const made = packets.get(event.packet);
      row = { packet: event.packet, verdict: event.verdict, reviewer: event.reviewer, isolation: event.isolation, seq: event.seq, spec: made?.spec ?? null, specSha: made?.specSha ?? null, outcomes: [], unattributed: [] };
      rows.push(row);
    } else if (row === null) {
      continue;
    } else if (event.kind === 'commit') {
      const specAt = specShaAt(root, event.sha, row.spec);
      commitCovered = specAt !== null && specAt === row.specSha;
      const item = { seq: event.seq, kind: 'commit', gateOk: Array.isArray(event.gate) ? event.gate.every((check) => check.ok) : null, sha: event.sha ?? null, specSha: specAt };
      place(row, commitCovered, item, specAt === null ? 'no spec at the commit' : 'after-edit');
    } else if (event.kind === 'result' && event.tool === 'git_commit') {
      const ok = event.ok === true;
      const covered = ok ? commitCovered : true;
      place(row, covered, { seq: event.seq, kind: 'git_commit', ok }, 'its commit is after-edit');
    } else if (event.kind === 'end') {
      const now = currentSpecSha(root, row.spec);
      const covered = now !== null && now === row.specSha;
      place(row, covered, { seq: event.seq, kind: 'end', status: event.status, witness: event.witness ?? null, specSha: now }, now === null ? 'no spec on disk' : 'after-edit');
    }
  }
  return rows;
}

function place(row, covered, item, reason) {
  if (covered) row.outcomes.push(item);
  else row.unattributed.push({ ...item, reason });
}

// The spec's sha in the commit's tree, or null when the commit or the path is not there.
function specShaAt(root, commit, spec) {
  if (!root || !commit || !spec) return null;
  const result = spawnSync('git', ['show', `${commit}:${spec}`], { cwd: root, timeout: 10000, maxBuffer: 64 * 1024 * 1024 });
  return result.status === 0 ? sha256(result.stdout) : null;
}

// The spec's sha in the working tree now, or null when it is missing.
function currentSpecSha(root, spec) {
  if (!root || !spec) return null;
  const at = fileAt(root, spec);
  return at === null ? null : sha256(readFileSync(at));
}
