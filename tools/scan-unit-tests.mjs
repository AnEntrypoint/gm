#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RUST_TEST_ATTRIBUTE = `#${'[test]'}`;
const root = resolve(process.argv[2] ?? '.');
const listed = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
if (listed.status !== 0) {
    console.error(`scan-unit-tests: git ls-files failed in ${root}`);
    process.exit(2);
}

const hits = [];
for (const file of listed.stdout.split('\0').filter(Boolean)) {
    if (/\.test\./.test(file)) hits.push(`${file}: test file name`);
    let text;
    try {
        text = readFileSync(resolve(root, file), 'utf8');
    } catch {
        continue;
    }
    text.split('\n').forEach((line, index) => {
        if (line.includes(RUST_TEST_ATTRIBUTE)) hits.push(`${file}:${index + 1}: ${RUST_TEST_ATTRIBUTE}`);
    });
}

for (const hit of hits) console.log(hit);
console.log(hits.length === 0 ? 'scan-unit-tests: no unit tests found' : `scan-unit-tests: ${hits.length} hit(s)`);
process.exit(hits.length === 0 ? 0 : 1);
