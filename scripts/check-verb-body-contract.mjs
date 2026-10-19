import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gmMcpDir = path.join(root, 'gm-mcp');
const gmMcpSrc = path.join(gmMcpDir, 'src');
if (!fs.existsSync(path.join(gmMcpDir, 'node_modules', 'zod'))) {
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['ci', '--prefix', gmMcpDir, '--ignore-scripts', '--no-audit', '--no-fund'],
    { stdio: 'inherit' });
}
const { VERB_TABLE } = await import(pathToFileURL(path.join(gmMcpSrc, 'verb-table.js')).href);
const { verbBodySchema } = await import(pathToFileURL(path.join(gmMcpSrc, 'verb-bodies.js')).href);
const docs = fs.readFileSync(path.join(root, 'skills', 'gm', 'docs', 'verbs.md'), 'utf8');

const BODY_TYPES = new Set(['string', 'number', 'boolean', 'integer', 'object', 'array', 'any']);
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
  }
  for (const name of schema.required) {
    if (!(name in schema.fields)) failures.push(`${row.canonical}: required field "${name}" is not in its body schema`);
  }
}

const { GUEST_ACCEPTED_FIELDS, GUEST_ENVELOPE_FIELDS } = await import(pathToFileURL(path.join(gmMcpSrc, 'guest-bodies.js')).href);
const { DISPATCH_BODY_FIELDS } = await import(pathToFileURL(path.join(gmMcpSrc, 'verb-bodies.js')).href);
const { runnerVerb } = await import(pathToFileURL(path.join(gmMcpSrc, 'verb-table.js')).href);
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

for (const f of failures) console.log(`[FAIL] ${f}`);
console.log(`checked ${fields} body field(s) across ${verbs} verb(s) with a declared body`);
if (failures.length) {
  console.log(`RESULT: FAIL (${failures.length} contract mismatch(es))`);
  process.exit(1);
}
console.log('RESULT: PASS');
