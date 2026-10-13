import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = path.join(root, 'package.json');
const live = process.argv.includes('--live');

const failures = [];
const fail = (detail) => {
  failures.push(detail);
  console.log(`[FAIL] ${detail}`);
};

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const bin = pkg.bin || {};
const values = Object.values(bin);
const unscoped = String(pkg.name || '').replace(/^@[^/]+\//, '');

let resolved = null;
if (values.length > 0 && new Set(values).size === 1) {
  resolved = Object.keys(bin)[0];
} else if (bin[unscoped]) {
  resolved = unscoped;
}

if (!resolved) {
  fail(`package.json name "${pkg.name}" has no bin key "${unscoped}" and its ${values.length} bin values are not one file, so npx cannot pick an executable`);
} else {
  console.log(`[ok] npx resolves bin "${resolved}" for package "${pkg.name}"`);
  const target = path.join(root, bin[resolved]);
  if (!fs.existsSync(target)) fail(`bin "${resolved}" points at missing file ${path.relative(root, target)}`);
  else console.log(`[ok] bin "${resolved}" target exists: ${path.relative(root, target)}`);
  if (!String(fs.readFileSync(target, 'utf8')).startsWith('#!')) fail(`bin "${resolved}" target ${path.relative(root, target)} has no shebang line`);
}

if (live && failures.length === 0) {
  const run = spawnSync('npx', ['--yes', 'github:AnEntrypoint/gm', '--help'], { encoding: 'utf8' });
  const out = `${run.stdout || ''}${run.stderr || ''}`;
  if (run.status !== 0) fail(`npx --yes github:AnEntrypoint/gm --help exited ${run.status}: ${out.trim().split('\n')[0] || ''}`);
  else if (!out.includes('Usage: gm')) fail(`npx --yes github:AnEntrypoint/gm --help printed no gm usage line: ${out.trim().split('\n')[0] || ''}`);
  else console.log('[ok] npx --yes github:AnEntrypoint/gm --help printed the installer usage line');
}

if (failures.length > 0) {
  console.log(`RESULT: FAIL (${failures.length} failure(s))`);
  process.exit(1);
}
console.log(live ? 'RESULT: PASS (static + live npx route)' : 'RESULT: PASS (static only; add --live for the npx route)');
