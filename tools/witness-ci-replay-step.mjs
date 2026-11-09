#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = resolve(process.argv[2] ?? join(root, '.github', 'workflows', 'release.yml'));
const lines = readFileSync(workflow, 'utf8').split('\n');
const start = lines.findIndex((line) => line === '      - name: Replay witness');
const required = [
    'npm ci --ignore-scripts',
    'node tools/witness-next-context-replay.mjs node',
    'node tools/witness-next-context-replay.mjs build/${{ matrix.preset }}/native/components/host/gm',
];

if (start < 0) {
    console.error(`ci-replay-step: no "Replay witness" step in ${workflow}`);
    process.exit(1);
}

let end = start + 1;
while (end < lines.length && !/^(      - |  \S|\S)/.test(lines[end])) end += 1;
const block = lines.slice(start, end).join('\n');
const missing = required.filter((text) => !block.includes(text));

if (missing.length > 0) {
    console.error(`ci-replay-step: the Replay witness step in ${workflow} lacks: ${missing.join('; ')}`);
    process.exit(1);
}

console.log(JSON.stringify({ workflow, step: 'Replay witness', lines: end - start, commands: required.length, ok: true }));
