import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bundleDir = join(here, '..', 'instructions');
const rsDir = process.env.RS_PLUGKIT_DIR
  ? join(process.env.RS_PLUGKIT_DIR, 'src', 'orchestrator', 'instructions')
  : join(here, '..', '..', '..', 'rs-plugkit', 'src', 'orchestrator', 'instructions');

const keys = ['entry', 'plan', 'execute', 'emit', 'verify', 'update_docs', 'browser'];

function rawString(md) {
  let pad = 1;
  while (md.includes('"' + '#'.repeat(pad))) pad++;
  const h = '#'.repeat(pad);
  return `r${h}"${md}"${h}`;
}

if (!existsSync(rsDir)) {
  console.error(`rs-plugkit consts dir not found: ${rsDir}\nset RS_PLUGKIT_DIR to the rs-plugkit checkout root`);
  process.exit(1);
}

let changed = 0;
for (const key of keys) {
  const mdPath = join(bundleDir, `${key}.md`);
  const rsPath = join(rsDir, `${key}.rs`);
  if (!existsSync(mdPath)) { console.error(`missing bundle: ${mdPath}`); process.exit(1); }
  const md = readFileSync(mdPath, 'utf8');
  const next = `pub const TEXT: &str = ${rawString(md)};\n`;
  const prev = existsSync(rsPath) ? readFileSync(rsPath, 'utf8') : '';
  if (prev !== next) { writeFileSync(rsPath, next); changed++; console.log(`synced ${key}.rs (${md.length} chars)`); }
  else console.log(`unchanged ${key}.rs`);
}
console.log(`done: ${changed}/${keys.length} consts rewritten`);
