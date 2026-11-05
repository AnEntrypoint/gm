import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { keep: { type: 'string' } } });
const keep = Number(values.keep ?? '3');
if (!Number.isInteger(keep) || keep < 1) throw new Error('--keep must be a positive integer');

const names = readFileSync(0, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean);
const versioned = /^gmnew-(.+)-(x64|arm64)-(linux|macos|windows)\.(tar\.gz|zip)$/;
const runOf = (version) => Number(version.slice(version.lastIndexOf('-') + 1));

const versions = [...new Set(names.map((name) => name.match(versioned)?.[1]).filter(Boolean))]
  .sort((a, b) => runOf(b) - runOf(a));
const retained = new Set(versions.slice(0, keep));

for (const name of names) {
  if (!/^gmnew-.*\.(tar\.gz|zip)$/.test(name)) continue;
  const version = name.match(versioned)?.[1];
  if (version === undefined || !retained.has(version)) console.log(name);
}
