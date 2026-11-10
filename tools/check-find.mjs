import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openServer } from './lib/gm-stdio.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = resolve(process.argv[2] ?? 'build/release/native/components/host/gm');
if (!existsSync(binary)) {
  console.error('find-check: failed: no native binary at ' + binary);
  process.exit(1);
}

const FILES = ['a/b/c.mjs', 'a/b/d.txt', 'a/b/deep/e.mjs', 'a/x.mjs', 'a/x.txt', 'a/caf\u00e9.txt', 'a/.git/config', 'node_modules/pkg/index.js', 'top.js'];
const seed = () => {
  const dir = mkdtempSync(join(tmpdir(), 'gm-find-'));
  for (const file of FILES) {
    mkdirSync(join(dir, dirname(file)), { recursive: true });
    writeFileSync(join(dir, file), file + '\n');
  }
  symlinkSync(join(dir, 'a', 'b'), join(dir, 'a', 'linked'), 'dir');
  return dir;
};

const QUERIES = [
  { path: 'a' },
  { path: 'a', glob: '*.mjs' },
  { path: 'a', glob: 'b/*.mjs' },
  { path: '.', kind: 'dir' },
  { path: '.', kind: 'file', glob: '*.js' },
  { path: 'a', kind: 'file', glob: '*.txt' },
  { path: 'a', glob: 'linked*' },
  { path: 'a', glob: '*' },
  { path: '.', glob: 'caf*' },
  { path: 'a', glob: '*x*', kind: 'any', limit: 2, offset: 1 },
  { path: 'a', kind: 'bogus' },
  { path: 'a', glob: 5 },
  { path: 'missing' },
  { path: '../outside' },
];

const canonical = (value) => JSON.stringify(value, (key, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));
const valueOf = (reply) => reply.output;

async function answers(name, binaryPath, options) {
  const server = await openServer(binaryPath, { workspace: seed(), ...options });
  const out = [];
  try {
    for (const query of QUERIES) out.push(valueOf(await server.run('return await gm.find(' + JSON.stringify(query) + ');')));
  } finally {
    server.close();
  }
  return out;
}

const node = await answers('node', process.execPath, { lead: [join(root, 'src', 'mcp.mjs')] });
const native = await answers('native', binary, { lead: ['serve'], extraArgs: ['--build-dir', 'none'] });
const mismatches = [];
QUERIES.forEach((query, i) => {
  if (canonical(node[i]) !== canonical(native[i])) mismatches.push({ query, node: node[i], native: native[i] });
});
if (mismatches.length > 0) {
  console.log(JSON.stringify({ failed: true, mismatches }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, queries: QUERIES.length, identical: true, replies: QUERIES.map((query, i) => ({ query, reply: node[i] })) }, null, 2));
