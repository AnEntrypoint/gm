import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    version: { type: 'string' },
    commit: { type: 'string' },
    repo: { type: 'string' },
  },
});

const expected = ['x64-linux', 'arm64-linux', 'x64-macos', 'arm64-macos'];

const archives = readdirSync(values.dir)
  .filter((file) => /^gmnew-.+\.(tar\.gz|zip)$/.test(file))
  .sort();

const assets = {};
const sums = [];
for (const file of archives) {
  const bytes = readFileSync(join(values.dir, file));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const target = file.match(/(x64|arm64)-(linux|macos|windows)/)[0];
  assets[target] = { file, sha256, size: bytes.length };
  sums.push(`${sha256}  ${file}`);
}

const missing = expected.filter((target) => !(target in assets));
if (missing.length > 0) throw new Error(`missing archives for: ${missing.join(', ')}`);

const manifest = {
  version: values.version,
  commit: values.commit,
  built: new Date().toISOString(),
  repo: values.repo,
  assets,
};
writeFileSync(join(values.dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(values.dir, 'SHA256SUMS'), `${sums.join('\n')}\n`);
