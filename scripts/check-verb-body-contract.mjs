// Usage: node scripts/check-verb-body-contract.mjs [root] [--live]
// --live also dispatches every declared body field of each query verb (side-effect free, per the query list in
// skills/gm/docs/verbs.md) through the local spool, and fails on an undeclared-key refusal. CI runs the static pass only.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const live = args.includes('--live');
const rootArg = args.find((a) => !a.startsWith('--'));
const root = rootArg
  ? path.resolve(rootArg)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gmMcpDir = path.join(root, 'gm-mcp');
const gmMcpSrc = path.join(gmMcpDir, 'src');
if (!fs.existsSync(path.join(gmMcpDir, 'node_modules', 'zod'))) {
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['ci', '--prefix', gmMcpDir, '--ignore-scripts', '--no-audit', '--no-fund'],
    { stdio: 'inherit' });
}
const { VERB_TABLE, runnerVerb } = await import(pathToFileURL(path.join(gmMcpSrc, 'verb-table.js')).href);
const { verbBodySchema } = await import(pathToFileURL(path.join(gmMcpSrc, 'verb-bodies.js')).href);
const docs = fs.readFileSync(path.join(root, 'skills', 'gm', 'docs', 'verbs.md'), 'utf8');

const BODY_TYPES = new Set(['string', 'number', 'boolean', 'integer', 'object', 'array', 'any']);
const queryNames = new Set();
for (const m of docs.matchAll(/((?:`[a-z_-]+`(?:,|\s|and)*)+)\s+(?:are|is)\s+`query`/g)) {
  for (const n of m[1].matchAll(/`([a-z_-]+)`/g)) queryNames.add(n[1]);
}
// The git section lists its query verbs as a bullet list under "Query verbs:" (not in an "are `query`" sentence).
const queryListAt = docs.indexOf("Query verbs:");
if (queryListAt >= 0) {
  let bullets = false;
  for (const line of docs.slice(queryListAt).split("\n").slice(1)) {
    if (line.startsWith("- ")) { bullets = true; for (const n of line.matchAll(/`([a-z_-]+)`/g)) queryNames.add(n[1]); }
    else if (bullets) break;
  }
}
const indexAt = docs.indexOf('## Body field index');
if (indexAt < 0) throw new Error('skills/gm/docs/verbs.md has no "## Body field index" section');
const docTypes = new Map();
for (const line of docs.slice(indexAt).split('\n')) {
  const colon = line.indexOf(':');
  if (!line.startsWith('- ') || colon < 0) continue;
  const keys = [...line.slice(0, colon).matchAll(/`([A-Za-z_][A-Za-z0-9_-]*)`/g)].map((m) => m[1]);
  for (const m of line.slice(colon + 1).matchAll(/`([A-Za-z_][A-Za-z0-9_]*)` \(([a-z|]+)\)/g)) {
    if (!m[2].split('|').every((t) => BODY_TYPES.has(t))) continue;
    for (const key of keys) {
      if (!docTypes.has(key)) docTypes.set(key, new Map());
      docTypes.get(key).set(m[1], m[2]);
    }
  }
}
const failures = [];
let verbs = 0;
let fields = 0;
for (const row of VERB_TABLE) {
  const schema = verbBodySchema(row.canonical);
  if (!schema.declared) continue;
  verbs += 1;
  for (const [field, spec] of Object.entries(schema.fields)) {
    fields += 1;
    const parts = String(spec.type).split('|');
    if (!parts.every((t) => BODY_TYPES.has(t))) failures.push(`${row.canonical}.${field}: type "${spec.type}" is not a body type`);
    if (!docs.includes(`\`${field}\``)) failures.push(`${row.canonical}.${field}: not named in skills/gm/docs/verbs.md`);
    const declaredType = row.body?.fields?.[field]?.type;
    if (declaredType !== undefined && spec.type !== declaredType) failures.push(`${row.canonical}.${field}: gm.describe type "${spec.type}" differs from verb-table type "${declaredType}"`);
    const typed = [row.canonical, runnerVerb(row)].map((k) => docTypes.get(k)?.get(field)).find((t) => t !== undefined);
    if (typed === undefined && queryNames.has(runnerVerb(row))) failures.push(`${row.canonical}.${field}: query verb field has no type in the Body field index of skills/gm/docs/verbs.md`);
    if (typed !== undefined && typed !== String(spec.type)) failures.push(`${row.canonical}.${field}: verbs.md type "${typed}" differs from schema type "${spec.type}"`);
  }
  for (const name of schema.required) {
    if (!(name in schema.fields)) failures.push(`${row.canonical}: required field "${name}" is not in its body schema`);
  }
}

const { GUEST_ACCEPTED_FIELDS, GUEST_ENVELOPE_FIELDS } = await import(pathToFileURL(path.join(gmMcpSrc, 'guest-bodies.js')).href);
const { DISPATCH_BODY_FIELDS } = await import(pathToFileURL(path.join(gmMcpSrc, 'verb-bodies.js')).href);
for (const row of VERB_TABLE) {
  if (!row.body?.fields || runnerVerb(row) === 'codesearch') continue;
  const accepted = GUEST_ACCEPTED_FIELDS[runnerVerb(row)];
  if (!accepted) continue;
  const allowed = new Set([...accepted, ...GUEST_ENVELOPE_FIELDS, ...Object.keys(DISPATCH_BODY_FIELDS)]);
  for (const [name, spec] of Object.entries(row.body.fields)) {
    const names = [name, ...(spec.aliases ?? [])];
    if (!names.some((n) => allowed.has(n))) failures.push(`${row.canonical}.${name}: declared body field is not accepted by the rs-plugkit handler (silently dropped by verbBodySchema)`);
  }
}

if (live) {
  const dispatchVerb = path.join(path.dirname(fileURLToPath(import.meta.url)), 'triage', 'dispatch-verb.mjs');
  const sid = `verify-DRIFT-${process.pid}-${Date.now()}`;
  const send = (verb, body) => {
    let stdout = '';
    try {
      stdout = execFileSync(process.execPath, [dispatchVerb, verb, '--cwd', root, '--raw', JSON.stringify(body), '--sid', sid, '--timeout-ms', '60000'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) {
      stdout = e.stdout ?? '';
    }
    try {
      return JSON.parse(stdout);
    } catch {
      return null;
    }
  };
  const refused = (reply) => reply?.error_code === 'body_undeclared_key' || /undeclared key/.test(String(reply?.error ?? ''));
  const sample = (name, type) => {
    if (type === 'integer' || type === 'number') return 1;
    if (type === 'boolean') return false;
    if (type === 'object') return {};
    if (type === 'array') return [];
    return name === 'status' ? 'pending' : 'drift-probe';
  };
  if (queryNames.has('prd-list')) {
    const control = send('prd-list', { drift_probe_undeclared_key: 1 });
    if (!refused(control)) failures.push('live control: prd-list did not refuse an undeclared key, so the refusal test is not live');
    else console.log(`live control: prd-list refused an undeclared key (dispatch ${control.dispatch_id})`);
  }
  let probed = 0;
  for (const row of VERB_TABLE) {
    const wire = runnerVerb(row);
    if (!queryNames.has(wire)) continue;
    const schema = verbBodySchema(row.canonical);
    if (!schema.declared || Object.keys(schema.fields).length === 0) continue;
    probed += 1;
    const body = Object.fromEntries(Object.entries(schema.fields).map(([name, spec]) => [name, sample(name, String(spec.type))]));
    const reply = send(wire, body);
    if (reply === null) failures.push(`live ${wire}: no parseable reply`);
    else if (refused(reply)) failures.push(`live ${wire}: a declared body field is refused as undeclared: ${reply.error}`);
    else console.log(`live ${wire}: ${Object.keys(body).length} declared field(s) sent, no undeclared-key refusal (dispatch ${reply.dispatch_id})`);
  }
  console.log(`live: ${probed} query verb(s) with declared body fields probed`);
}

for (const f of failures) console.log(`[FAIL] ${f}`);
console.log(`checked ${fields} body field(s) across ${verbs} verb(s) with a declared body`);
if (failures.length) {
  console.log(`RESULT: FAIL (${failures.length} contract mismatch(es))`);
  process.exit(1);
}
console.log('RESULT: PASS');
