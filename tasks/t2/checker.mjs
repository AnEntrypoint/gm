import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const workspace = process.argv[2];
const numbers = readFileSync(join(workspace, 'numbers.txt'), 'utf8').split('\n').filter((line) => line.trim() !== '').map(Number);
const expected = String(numbers.reduce((sum, value) => sum + value, 0));
let answer = '';
try {
  answer = readFileSync(join(workspace, 'answer.txt'), 'utf8').trim();
} catch (err) {
  console.log(JSON.stringify({ pass: false, detail: `answer.txt: ${err.code ?? err.message}` }));
  process.exit(1);
}
const hasProgram = existsSync(join(workspace, 'sum.mjs'));
const pass = answer === expected && hasProgram;
console.log(JSON.stringify({ pass, detail: `answer ${answer}, expected ${expected}, sum.mjs ${hasProgram ? 'present' : 'missing'}` }));
process.exit(pass ? 0 : 1);
