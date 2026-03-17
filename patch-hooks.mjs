import fs from 'fs';
import path from 'path';

const src = fs.readFileSync('C:/dev/plugforge/plugforge-starter/hooks/pre-tool-use-hook.js', 'utf-8');

const base = 'C:/Users/user/.claude/plugins/cache/gm-cc/gm';
const dirs = fs.readdirSync(base);

for (const d of dirs) {
  const p = path.join(base, d, 'hooks', 'pre-tool-use-hook.js');
  if (fs.existsSync(p)) {
    fs.writeFileSync(p, src, 'utf-8');
    console.log('updated:', d);
  }
}
