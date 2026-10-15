// Copies the served phase prose from skills/gm/prose into gm-config/prose.
// skills/gm/prose is the source. gm-config/prose is generated: edit the skill, then run this.
import { copyFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'skills', 'gm', 'prose');
const dst = join(root, 'gm-config', 'prose');

let copied = 0;
for (const name of readdirSync(src)) {
  if (!name.endsWith('.md')) continue;
  copyFileSync(join(src, name), join(dst, name));
  copied += 1;
}
console.log(`copied ${copied} file(s) from skills/gm/prose to gm-config/prose`);
