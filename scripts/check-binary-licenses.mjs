// Fails when a tracked binary or vendored font/wasm asset in the parent or any checked-out submodule
// has no entry in scripts/binary-license-inventory.json, or its license is outside that file's allowlist.
// Usage: node scripts/check-binary-licenses.mjs
// Prints one FAIL line per problem and RESULT: PASS or RESULT: FAIL.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';

const BINARY = /\.(wasm|ttf|otf|woff2?|eot|png|jpe?g|gif|ico|webp|bmp|zip|gz|tgz|tar|so|dll|dylib|exe|node|a|lib|pdf|mp3|mp4|wav|ogg|icns|bin)$/i;
const FONT_SVG = /\/fonts\/.*\.svg$/i;
const inventory = JSON.parse(readFileSync('scripts/binary-license-inventory.json', 'utf8'));
const allow = new Set(inventory.allow);

const lsFiles = (cwd) => execFileSync('git', ['-C', cwd, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0').filter(Boolean);
const submodules = readFileSync('.gitmodules', 'utf8').split('\n')
  .map((line) => line.match(/^\s*path = (.+)$/)?.[1]?.trim())
  .filter((path) => path && existsSync(path + '/.git'));

const tracked = [
  ...lsFiles('.').map((file) => file),
  ...submodules.flatMap((sub) => lsFiles(sub).map((file) => sub + '/' + file)),
];
const assets = tracked.filter((file) => BINARY.test(file) || FONT_SVG.test(file));

const failures = [];
for (const file of assets) {
  const entry = inventory.entries.find((candidate) => file.startsWith(candidate.prefix));
  if (!entry) { failures.push('unknown ' + file); continue; }
  const bad = entry.licenses.filter((license) => !allow.has(license));
  if (bad.length) failures.push('license ' + file + ' ' + bad.join(','));
}

for (const failure of failures) console.log('FAIL ' + failure);
console.log('assets checked: ' + assets.length + ' (submodules: ' + submodules.length + ')');
console.log(failures.length === 0 ? 'RESULT: PASS' : 'RESULT: FAIL');
process.exit(failures.length === 0 ? 0 : 1);
