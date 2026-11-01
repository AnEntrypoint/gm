import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const workspace = process.argv[2];
const expected = Array.from({ length: 10 }, (_, i) => String(i + 1));
let actual;
try {
  actual = readFileSync(join(workspace, 'report.txt'), 'utf8').split('\n').filter((line) => line !== '');
} catch (err) {
  console.log(JSON.stringify({ pass: false, detail: `report.txt: ${err.code ?? err.message}` }));
  process.exit(1);
}
const pass = JSON.stringify(actual) === JSON.stringify(expected);
console.log(JSON.stringify({ pass, detail: pass ? 'report.txt holds 1 to 10' : `report.txt holds ${actual.length} lines` }));
process.exit(pass ? 0 : 1);
