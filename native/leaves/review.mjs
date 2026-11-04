const VERDICTS = ['pass', 'fail', 'needs-changes'];
const OUTPUT_PAGE = 20000;
const READ_PAGE = 20000;
const GIT_SHOW_TIMEOUT_MS = 10000;
const str = { type: 'string' };
const list = { type: 'array', items: str };
const obj = (properties, required = []) => ({ type: 'object', properties, required });

const ROUND = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function utf8Bytes(text) {
  const bytes = [];
  for (const ch of text) {
    let code = ch.codePointAt(0);
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return bytes;
}

function sha256(text) {
  const bytes = utf8Bytes(text);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x100000000);
  for (const word of [high, bitLength >>> 0]) bytes.push((word >>> 24) & 255, (word >>> 16) & 255, (word >>> 8) & 255, word & 255);
  const state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let block = 0; block < bytes.length; block += 64) {
    for (let i = 0; i < 16; i += 1) {
      const at = block + i * 4;
      w[i] = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i += 1) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + ROUND[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((value, i) => {
      state[i] = (state[i] + value) >>> 0;
    });
  }
  return state.map((word) => word.toString(16).padStart(8, '0')).join('');
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  return value;
}

const isAbsolute = (path) => path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);

function normalizeAbsolute(path) {
  const drive = /^[A-Za-z]:/.test(path) ? path.slice(0, 2) : '';
  const parts = [];
  for (const part of path.slice(drive.length).split(/[\\/]/)) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `${drive}/${parts.join('/')}`;
}

function readWhole(path) {
  let text = '';
  let offset = 0;
  for (;;) {
    const reply = host.read_file({ path, unit: 'chars', offset, limit: READ_PAGE });
    if (reply?.ok === false) return null;
    if (typeof reply?.content === 'string') return reply.content;
    text += reply?.output ?? '';
    if (reply?.next === null || reply?.next === undefined) return text;
    offset = reply.next;
  }
}

function typeOf(path) {
  const reply = host.stat_file({ path });
  if (reply?.ok === false) return null;
  if (typeof reply?.output === 'string') {
    try {
      return JSON.parse(reply.output).type;
    } catch {
      return null;
    }
  }
  return reply?.type ?? null;
}

function fileAt(root, rel) {
  if (typeof rel !== 'string' || rel === '') return null;
  const at = normalizeAbsolute(isAbsolute(rel) ? rel : `${root}/${rel}`);
  return typeOf(at) === 'file' ? at : null;
}

function shaOfFile(at) {
  const text = readWhole(at);
  return text === null ? null : sha256(text);
}

const append = (kind, fields) => host.logAppend({ kind, fields });

function runEvents() {
  const text = readWhole(`${host.runDir}/log.jsonl`) ?? '';
  const events = [];
  for (const line of text.split('\n')) {
    if (line === '') continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return events;
}

function reviewPacket({ root, spec, refs = [] }) {
  const refuse = (reason) => {
    append('review-refused', { reason, stage: 'packet' });
    return { ok: false, error: `refused: ${reason}` };
  };
  if (!Array.isArray(refs) || !refs.every((ref) => typeof ref === 'string')) return refuse('refs must be a list of paths');
  const specAt = fileAt(root, spec);
  if (specAt === null) return refuse(`spec ${spec} is not a file`);
  const missing = refs.filter((ref) => fileAt(root, ref) === null);
  if (missing.length > 0) return refuse(`referenced paths do not exist: ${missing.join(', ')}`);
  const specSha = shaOfFile(specAt);
  const sortedRefs = [...refs].sort();
  const hash = sha256(JSON.stringify(sortKeys({ spec, specSha, refs: sortedRefs })));
  append('review-packet', { packet: hash, spec, specSha, refs: sortedRefs });
  return { ok: true, packet: hash, spec, specSha, refs: sortedRefs };
}

function reviewRecord({ root, packet, verdict, reviewer, notes = '' }) {
  const refuse = (reason) => {
    append('review-refused', { packet, reason, stage: 'record' });
    return { ok: false, error: `refused: ${reason}` };
  };
  const events = runEvents();
  const made = events.find((event) => event.kind === 'review-packet' && event.packet === packet);
  if (!made) return refuse(`no review packet ${packet} in this log`);
  if (events.some((event) => event.kind === 'review' && event.packet === packet)) return refuse(`packet ${packet} already has a record`);
  if (!VERDICTS.includes(verdict)) return refuse(`verdict must be one of ${VERDICTS.join(', ')}`);
  if (typeof reviewer !== 'string' || reviewer.trim() === '') return refuse('reviewer must name the fresh reviewer that the host spawned');
  if (typeof notes !== 'string') return refuse('notes must be a string');
  const specAt = fileAt(root, made.spec);
  const nowSha = specAt === null ? null : shaOfFile(specAt);
  if (nowSha !== made.specSha) return refuse(`the spec changed since packet ${packet}: packet sha ${made.specSha}, now ${nowSha ?? 'missing'}`);
  append('review', { packet, verdict, reviewer, notes, isolation: 'host-attested', specSha: made.specSha });
  return { ok: true, packet, verdict };
}

function place(row, covered, item, reason) {
  if (covered) row.outcomes.push(item);
  else row.unattributed.push({ ...item, reason });
}

function specShaAt(root, commit, spec) {
  if (!root || !commit || !spec) return null;
  const shown = host.run({ argv: ['git', 'show', `${commit}:${spec}`], cwd: root, timeoutMs: GIT_SHOW_TIMEOUT_MS });
  return shown?.started && !shown.timedOut && shown.exitCode === 0 ? sha256(shown.out) : null;
}

function currentSpecSha(root, spec) {
  if (!root || !spec) return null;
  const at = fileAt(root, spec);
  return at === null ? null : shaOfFile(at);
}

function reviewJoin(events, root) {
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

export const verbs = [
  {
    name: 'review_packet',
    description: 'Open a review of a spec file and the files it refers to. The references must exist. Returns the packet hash that review_record takes. A missing reference, or a spec that is not a file, is refused and logged.',
    inputSchema: obj({ spec: str, refs: list }, ['spec']),
    call: (args = {}) => {
      const result = reviewPacket({ root: host.workspace, spec: args.spec, refs: args.refs ?? [] });
      return result.ok ? { ok: true, output: JSON.stringify(result) } : result;
    },
  },
  {
    name: 'review_record',
    description: 'Record one reviewer verdict (pass, fail or needs-changes) on a packet, with the reviewer and its notes. Refused when the spec changed since the packet, when the packet already has a record, or when the verdict is unknown. Each record says isolation host-attested.',
    inputSchema: obj({ packet: str, verdict: str, reviewer: str, notes: str }, ['packet', 'verdict', 'reviewer']),
    call: (args = {}) => {
      const result = reviewRecord({ root: host.workspace, packet: args.packet, verdict: args.verdict, reviewer: args.reviewer, notes: args.notes ?? '' });
      return result.ok ? { ok: true, output: JSON.stringify(result) } : result;
    },
  },
  {
    name: 'review_join',
    description: 'Join the review records of this run with the commits and the ends after them: each commit with its gate outcome, and each end with its status and witness. A commit made after its spec changed is unattributed.',
    inputSchema: obj({}),
    call: () => {
      const text = JSON.stringify(reviewJoin(runEvents(), host.workspace), null, 1);
      return { ok: true, output: text.length > OUTPUT_PAGE ? `${text.slice(0, OUTPUT_PAGE)}\n(truncated at ${OUTPUT_PAGE} characters)` : text };
    },
  },
];
