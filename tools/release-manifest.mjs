import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    version: { type: 'string' },
    commit: { type: 'string' },
    repo: { type: 'string' },
    previous: { type: 'string' },
    present: { type: 'string' },
    summary: { type: 'string' },
  },
});

const expected = ['x64-linux', 'arm64-linux', 'x64-macos', 'arm64-macos', 'x64-windows', 'arm64-windows'];
const previous = values.previous && existsSync(values.previous) ? JSON.parse(readFileSync(values.previous, 'utf8')) : null;
const present = values.present && existsSync(values.present)
  ? new Set(readFileSync(values.present, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean))
  : new Set();

const archives = readdirSync(values.dir)
  .filter((file) => /^gmnew-.+\.(tar\.gz|zip)$/.test(file))
  .sort();

const assets = {};
const sums = [];
const rows = [];
for (const file of archives) {
  const bytes = readFileSync(join(values.dir, file));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const target = file.match(/(x64|arm64)-(linux|macos|windows)/)[0];
  assets[target] = { file, sha256, size: bytes.length, version: values.version };
  sums.push(`${sha256}  ${file}`);
  rows.push(`| ${target} | built this push | ${file} |`);
}

for (const target of expected) {
  if (target in assets) continue;
  const old = previous?.assets?.[target];
  if (old && present.has(old.file)) {
    const version = old.version ?? previous.version;
    assets[target] = { ...old, version };
    sums.push(`${old.sha256}  ${old.file}`);
    rows.push(`| ${target} | failed this push; stays on ${version} | ${old.file} |`);
    console.log(`::warning::${target} did not build in this push; its manifest entry keeps ${version}`);
  } else {
    rows.push(`| ${target} | failed this push; no earlier build on the release | none |`);
    console.log(`::error::${target} did not build and has no earlier build on the release`);
  }
}

if (Object.keys(assets).length === 0) throw new Error('no target built in this push');

const manifest = {
  version: values.version,
  commit: values.commit,
  built: new Date().toISOString(),
  repo: values.repo,
  assets,
};
writeFileSync(join(values.dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(values.dir, 'SHA256SUMS'), `${sums.join('\n')}\n`);

const table = [
  `### Targets in ${values.version} (${values.commit})`,
  '',
  '| target | status | archive |',
  '| --- | --- | --- |',
  ...rows,
  '',
];
console.log(table.join('\n'));
if (values.summary) appendFileSync(values.summary, `${table.join('\n')}\n`);
