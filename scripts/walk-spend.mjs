#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const session = process.argv[2];
if (!session) {
  console.error('usage: node scripts/walk-spend.mjs <session_id>');
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const spoolDir = process.env.GM_SPOOL_OUT || path.join(here, '..', '.gm', 'exec-spool', 'out');
const logPath = process.env.GM_MCP_LOG || path.join(homedir(), '.gm-tools', 'gm-mcp-server.log');
const tolMs = Number(process.env.GM_JOIN_TOL_MS || 1500);

if (!existsSync(spoolDir)) {
  console.log(`SKIP: spool out directory ${spoolDir} not found (set GM_SPOOL_OUT); nothing counted`);
  process.exit(0);
}

const records = [];
const phaseEvents = [];

for (const name of readdirSync(spoolDir)) {
  const full = path.join(spoolDir, name);
  if (name.endsWith('.json')) {
    const m = /^(.+)-(\d+)-(\d+)-(\d+)\.json$/.exec(name);
    if (!m) continue;
    let rec;
    try {
      rec = JSON.parse(readFileSync(full, 'utf8'));
    } catch {
      continue;
    }
    const verb = rec.verb;
    if (typeof verb !== 'string' || !/^\d+-/.test(rec.dispatch_id ?? '') || !m[1].startsWith(`${verb}-`)) continue;
    const t = Number(m[3]);
    if (verb === 'phase-status') {
      const d = rec.data ?? {};
      if (d.session_id !== session) continue;
      const phase = d.session_mismatch ? null : (d.phase ?? null);
      records.push({ verb, t, phase });
      if (phase) phaseEvents.push({ t, phase });
      continue;
    }
    if (m[1].slice(verb.length + 1) === session) records.push({ verb, t, phase: null });
  } else if (name.endsWith('.json.reply.txt')) {
    const m = /^(.+)-(\d+)-(\d+)-(\d+)\.json\.reply\.txt$/.exec(name);
    if (!m || m[1] !== session) continue;
    const text = readFileSync(full, 'utf8');
    const verb = /^verb:\s*(\S+)/m.exec(text)?.[1];
    if (!verb || !/^dispatch_id:\s*\d+-/m.test(text)) continue;
    const t = Number(m[3]);
    const phase = /^phase:\s*(\S+)/m.exec(text)?.[1] ?? null;
    records.push({ verb, t, phase: null });
    if (phase) phaseEvents.push({ t, phase });
  }
}

records.sort((a, b) => a.t - b.t);
phaseEvents.sort((a, b) => a.t - b.t);

const phaseAt = (t) => {
  let current = null;
  for (const ev of phaseEvents) {
    if (ev.t > t) break;
    current = ev.phase;
  }
  return current;
};

const entries = new Map();
let prev = null;
for (const ev of phaseEvents) {
  if (ev.phase !== prev) entries.set(ev.phase, (entries.get(ev.phase) ?? 0) + 1);
  prev = ev.phase;
}

const endsByVerb = new Map();
let logNote = null;
if (!existsSync(logPath)) {
  logNote = `NOTE: gm-mcp log ${logPath} not found (set GM_MCP_LOG); wall time unavailable`;
} else {
  for (const line of readFileSync(logPath, 'utf8').split('\n')) {
    if (!line.includes('"dispatch-end"')) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.event !== 'dispatch-end' || typeof ev.verb !== 'string' || typeof ev.ms !== 'number') continue;
    const end = Date.parse(ev.ts);
    if (Number.isNaN(end)) continue;
    const list = endsByVerb.get(ev.verb) ?? [];
    list.push({ start: end - ev.ms, ms: ev.ms, used: false });
    endsByVerb.set(ev.verb, list);
  }
}

const claim = (rec) => {
  const list = endsByVerb.get(rec.verb);
  if (!list) return null;
  let best = null;
  let bestDiff = Infinity;
  for (const cand of list) {
    if (cand.used) continue;
    const diff = Math.abs(cand.start - rec.t);
    if (diff <= tolMs && diff < bestDiff) {
      best = cand;
      bestDiff = diff;
    }
  }
  if (best) best.used = true;
  return best;
};

const median = (xs) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const byPhase = new Map();
let joined = 0;
for (const rec of records) {
  const phase = rec.phase ?? phaseAt(rec.t) ?? '(no phase reported)';
  const row = byPhase.get(phase) ?? { count: 0, walls: [] };
  row.count += 1;
  const hit = logNote ? null : claim(rec);
  if (hit) {
    joined += 1;
    row.walls.push(hit.ms);
  }
  byPhase.set(phase, row);
}

const cols = [24, 10, 12, 10, 16];
const line = (cells) => cells.map((c, i) => (i === 0 ? c.padEnd(cols[i]) : c.padStart(cols[i]))).join('');

console.log(`session: ${session}`);
console.log(`spool records: ${records.length}   joined to server log: ${joined}   tolerance: ${tolMs} ms`);
if (logNote) console.log(logNote);
console.log(`spool dir: ${spoolDir}`);
console.log(`log: ${logPath}`);
console.log('');
console.log(line(['phase', 'entries', 'dispatches', 'timed', 'median_wall_ms']));
for (const phase of [...byPhase.keys()].sort()) {
  const row = byPhase.get(phase);
  const med = median(row.walls);
  console.log(line([
    phase,
    String(entries.get(phase) ?? 0),
    String(row.count),
    String(row.walls.length),
    med === null ? 'n/a' : String(Math.round(med)),
  ]));
}
const allWalls = [...byPhase.values()].flatMap((r) => r.walls);
const totalMed = median(allWalls);
console.log(line([
  'TOTAL',
  String([...entries.values()].reduce((a, b) => a + b, 0)),
  String(records.length),
  String(allWalls.length),
  totalMed === null ? 'n/a' : String(Math.round(totalMed)),
]));
