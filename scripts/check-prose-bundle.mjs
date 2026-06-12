import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const bundleDir = path.join(root, 'gm-plugkit', 'instructions');

const KEYS = [
  'entry', 'plan', 'execute', 'emit', 'verify', 'update_docs', 'browser',
  'gates/long-gap-no-instruction',
  'residual/prd-open', 'residual/browser-open', 'residual/tasks-running',
  'residual/dirty-tree', 'residual/imperative',
];

const missing = [];
const empty = [];
for (const key of KEYS) {
  const fp = path.join(bundleDir, `${key}.md`);
  if (!fs.existsSync(fp)) { missing.push(key); continue; }
  if (fs.readFileSync(fp, 'utf8').trim() === '') empty.push(key);
}

if (missing.length || empty.length) {
  if (missing.length) console.error(`prose bundle missing entries: ${missing.join(', ')}`);
  if (empty.length) console.error(`prose bundle empty entries: ${empty.join(', ')}`);
  process.exit(1);
}
console.log(`prose bundle complete: ${KEYS.length} keys present and non-empty`);
