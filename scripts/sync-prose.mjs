import { copyFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_OF_TRUTH_PROSE_DIR = join(root, 'skills', 'gm', 'prose');
const GENERATED_PROSE_DIR = join(root, 'gm-config', 'prose');

let copied = 0;
for (const name of readdirSync(SOURCE_OF_TRUTH_PROSE_DIR)) {
  if (!name.endsWith('.md')) continue;
  copyFileSync(join(SOURCE_OF_TRUTH_PROSE_DIR, name), join(GENERATED_PROSE_DIR, name));
  copied += 1;
}
console.log(`copied ${copied} file(s) from skills/gm/prose to gm-config/prose`);
