// Pass when build.log holds finished and status.txt holds working.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const workspace = process.argv[2];
const read = (name) => {
  try {
    return readFileSync(join(workspace, name), 'utf8');
  } catch (err) {
    return `missing ${name}: ${err.code ?? err.message}`;
  }
};
const log = read('build.log').trim();
const status = read('status.txt').trim();
const pass = log === 'finished' && status.includes('working');
console.log(JSON.stringify({ pass, detail: `build.log "${log}", status.txt "${status}"` }));
process.exit(pass ? 0 : 1);
