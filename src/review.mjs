import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const VERDICTS = ['pass', 'fail', 'needs-changes'];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  return value;
}

function fileAt(root, rel) {
  if (typeof rel !== 'string' || rel === '') return null;
  const at = resolve(root, rel);
  return existsSync(at) && statSync(at).isFile() ? at : null;
}

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

function specShaAt(root, commit, spec) {
  if (!root || !commit || !spec) return null;
  const result = spawnSync('git', ['show', `${commit}:${spec}`], { cwd: root, timeout: 10000, maxBuffer: 64 * 1024 * 1024 });
  return result.status === 0 ? sha256(result.stdout) : null;
}

function currentSpecSha(root, spec) {
  if (!root || !spec) return null;
  const at = fileAt(root, spec);
  return at === null ? null : sha256(readFileSync(at));
}
