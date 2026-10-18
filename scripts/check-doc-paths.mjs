import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';


const root = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ROOTS = [
  'skills/', 'docs/', 'scripts/', 'bin/', 'site/', 'gm-config/', 'rs-plugkit/', 'gm-mcp/',
  'agentplug/', 'agentplug-libsql/', 'agentplug-treesitter/', 'agentplug-bert/', 'agentplug-crux/',
  'rs-codeinsight/', 'rs-search/', '.github/', 'install.sh', 'install.ps1',
  'package.json', 'README.md', 'AGENTS.md', 'SKILLS.md', 'CHANGELOG.md', 'CONTRIBUTING.md',
];

const NOT_REPOSITORY_PATH = [
  /[*<>{}]|\.\.\./,
  /^\.gm\//,
  /^~/,
  /\/\//,
  /^https?:/,
];

const submodulePaths = [...fs.readFileSync(path.join(root, '.gitmodules'), 'utf8').matchAll(/^\s*path = (.+)$/gm)]
  .map((m) => m[1].trim());
const uninitialized = new Set(
  submodulePaths.filter((p) => {
    const abs = path.join(root, p);
    return !fs.existsSync(abs) || fs.readdirSync(abs).length === 0;
  }),
);

const files = [];
const walk = (base, rel) => {
  const abs = path.join(base, rel);
  if (!fs.existsSync(abs)) return;
  if (fs.statSync(abs).isDirectory()) {
    for (const name of fs.readdirSync(abs)) walk(base, path.join(rel, name));
  } else if (/\.(html|md|yaml|yml)$/.test(rel) && !rel.endsWith('paper-review-wood.md')) {
    files.push({ base, rel });
  }
};
// CHANGELOG.md is not walked: its entries record files that have since been removed.
for (const rel of ['README.md', 'AGENTS.md', 'SKILLS.md', 'CONTRIBUTING.md', 'docs', 'site/content', 'skills', 'gm-config/prose']) walk(root, rel);
// Each initialised submodule's own docs are checked against that submodule's tree.
for (const sub of submodulePaths) {
  if (uninitialized.has(sub)) continue;
  for (const rel of ['README.md', 'AGENTS.md', 'docs']) walk(path.join(root, sub), rel);
}

const token = /<code>([^<]+)<\/code>|`([^`\n]+)`/g;
const exists = (base, p) => fs.existsSync(path.join(base, p)) || fs.existsSync(path.join(root, p));
const isUninitialized = (candidate) => [...uninitialized].some((p) => candidate === p || candidate.startsWith(`${p}/`));
const broken = [];
const skipped = [];
let checked = 0;
for (const { base, rel } of files) {
  const where = path.relative(root, path.join(base, rel));
  const lines = fs.readFileSync(path.join(base, rel), 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(token)) {
      const raw = (m[1] ?? m[2]).trim();
      const candidate = raw.replace(/[),.;:]+$/, '').replace(/:\d+$/, '');
      if (NOT_REPOSITORY_PATH.some((re) => re.test(candidate)) || !ROOTS.some((r) => candidate === r || candidate.startsWith(r))) continue;
      if (/\s/.test(candidate)) continue;
      // A skill names its own docs relative to its directory: skills/gm/docs/verbs.md is `docs/verbs.md` there.
      if (!exists(base, candidate) && fs.existsSync(path.join(base, path.dirname(rel), candidate))) continue;
      if ([path.join(base, candidate), path.join(root, candidate)].some((abs) => isUninitialized(path.relative(root, abs)))) {
        skipped.push(`${where}:${i + 1}: \`${candidate}\``);
        continue;
      }
      checked += 1;
      if (!exists(base, candidate.replace(/\/$/, ''))) {
        broken.push(`${where}:${i + 1}: \`${candidate}\` does not exist`);
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
if (skipped.length) {
  console.log(`RESULT: PASS with ${skipped.length} unchecked path(s); initialise the listed submodule(s) to check them`);
} else {
  console.log('RESULT: PASS');
}
