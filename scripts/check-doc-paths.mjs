import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// Usage: check-doc-paths.mjs [root]   (default: the gm checkout this script sits in).
// Every repository path that the site and docs name must resolve on disk. A path is a
// backtick or <code> token that starts with a top-level directory or file this repo ships.
// Exit 1 on any path that does not exist, and print RESULT: PASS otherwise.
// A bare file name with no directory (specify.md, state.md) is not a repository path and is
// not checked: it names a served stage, a runtime file or a prose key, never a location here.

const root = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ROOTS = [
  'skills/', 'docs/', 'scripts/', 'bin/', 'site/', 'gm-config/', 'rs-plugkit/', 'gm-mcp/',
  'agentplug/', 'agentplug-libsql/', 'agentplug-treesitter/', 'agentplug-bert/', 'agentplug-crux/',
  'rs-codeinsight/', 'rs-search/', 'vendor/', '.github/', 'install.sh', 'install.ps1',
  'package.json', 'README.md', 'AGENTS.md', 'SKILLS.md', 'CHANGELOG.md', 'CONTRIBUTING.md',
];

// Tokens that are not repository paths: globs, placeholders, runtime-state paths under a
// project's own .gm/ directory, and the install targets under a user's home directory.
const SKIP = /[*<>{}]|\.\.\.|^\.gm\/|^~|\/\/|^https?:/;

const files = [];
const walk = (rel) => {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return;
  if (fs.statSync(abs).isDirectory()) {
    for (const name of fs.readdirSync(abs)) walk(path.join(rel, name));
  } else if (/\.(html|md|yaml|yml)$/.test(rel) && !rel.endsWith('paper-review-wood.md')) {
    files.push(rel);
  }
};
for (const rel of ['README.md', 'docs', 'site/content']) walk(rel);

const token = /<code>([^<]+)<\/code>|`([^`\n]+)`/g;
// A submodule that is not checked out is an empty directory: its paths cannot be verified here,
// so they are counted as skipped instead of failing the check.
const submodulePaths = [...fs.readFileSync(path.join(root, '.gitmodules'), 'utf8').matchAll(/^\s*path = (.+)$/gm)]
  .map((m) => m[1].trim());
const uninitialized = new Set(
  submodulePaths.filter((p) => {
    const abs = path.join(root, p);
    return !fs.existsSync(abs) || fs.readdirSync(abs).length === 0;
  }),
);
const isUninitialized = (candidate) => [...uninitialized].some((p) => candidate === p || candidate.startsWith(`${p}/`));
const broken = [];
const skipped = [];
let checked = 0;
for (const rel of files) {
  const lines = fs.readFileSync(path.join(root, rel), 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(token)) {
      const raw = (m[1] ?? m[2]).trim();
      const candidate = raw.replace(/[),.;:]+$/, '').replace(/:\d+$/, '');
      if (SKIP.test(candidate) || !ROOTS.some((r) => candidate === r || candidate.startsWith(r))) continue;
      if (/\s/.test(candidate)) continue;
      if (isUninitialized(candidate)) {
        skipped.push(`${rel}:${i + 1}: \`${candidate}\``);
        continue;
      }
      checked += 1;
      if (!fs.existsSync(path.join(root, candidate.replace(/\/$/, '')))) {
        broken.push(`${rel}:${i + 1}: \`${candidate}\` does not exist`);
      }
    }
  });
}

for (const b of broken) console.log(`[FAIL] ${b}`);
console.log(`checked ${checked} repository path(s) named in ${files.length} file(s); skipped ${skipped.length} under uninitialised submodule(s): ${[...uninitialized].join(', ') || 'none'}`);
if (broken.length) {
  console.log(`RESULT: FAIL (${broken.length} path(s) do not resolve)`);
  process.exit(1);
}
console.log('RESULT: PASS');
