#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FRAGMENTS = ['its return value is lost; ', ' verb calls completed before the stop, each in query_log as a code-call after seq '];
const TREES = [
  ['native', join(root, 'native', 'components', 'mcp', 'server.cpp')],
];
const failures = [];
for (const [label, path] of TREES) {
  const text = readFileSync(path, 'utf8');
  for (const fragment of FRAGMENTS) {
    if (!text.includes(fragment)) failures.push(`${label} (${path}) lacks ${JSON.stringify(fragment)}`);
  }
}
if (failures.length > 0) {
  console.error(`lost-wording-check: failed: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('lost-wording-check: passed: the body-stopped message names its return value as lost, with a space after the semicolon and the code-call count, on both trees');
