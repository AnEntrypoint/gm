#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, extname, sep } from 'node:path';

const RUST_TEST_ATTRIBUTE = `#${'[test]'}`;
const JS_TEST_CALL = /^\s*(describe|it|test)\s*\(/;
const JS_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'build', 'runs', '.playwriter', '.gm', '.agentplug', '.agentplug-kv', 'third_party', 'vendor']);
const EXEMPT_FILES = new Set([
    '.github/workflows/node-pins.yml',
    'native/components/mcp/tests/mcp_test.cpp',
    'native/components/verbs/tests/verbs_test.cpp',
    'native/leaves/tests/job-status-cap.test.mjs',
    'native/leaves/tests/write-file-shrink.test.mjs',
]);
const root = resolve(process.argv[2] ?? '.');

const hits = [];

function visit(dir) {
    for (const name of readdirSync(dir).sort()) {
        const full = join(dir, name);
        const stat = statSync(full);
        if (stat.isDirectory()) {
            if (!SKIP_DIRS.has(name)) visit(full);
            continue;
        }
        if (!stat.isFile()) continue;
        const file = relative(root, full).split(sep).join('/');
        if (EXEMPT_FILES.has(file)) continue;
        if (/\.test\./.test(name)) hits.push(`${file}: test file name`);
        let text;
        try {
            text = readFileSync(full, 'utf8');
        } catch {
            continue;
        }
        text.split('\n').forEach((line, index) => {
            if (line.includes(RUST_TEST_ATTRIBUTE)) hits.push(`${file}:${index + 1}: ${RUST_TEST_ATTRIBUTE}`);
            if (JS_EXTENSIONS.has(extname(name)) && JS_TEST_CALL.test(line)) hits.push(`${file}:${index + 1}: test call`);
        });
    }
}

visit(root);

for (const hit of hits) console.log(hit);
console.log(hits.length === 0 ? 'scan-unit-tests: no unit tests found' : `scan-unit-tests: ${hits.length} hit(s)`);
process.exit(hits.length === 0 ? 0 : 1);
