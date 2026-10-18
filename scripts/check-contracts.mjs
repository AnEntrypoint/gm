#!/usr/bin/env node
// Usage: node scripts/check-contracts.mjs [contracts.json]
// Each contract names a provider file that emits JSON field paths and a consumer file that reads them.
// Every path segment must appear as a quoted literal in the provider and as a whole word in the consumer.
// Exit 1 when any segment is missing from either side.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const specPath = resolve(process.argv[2] ?? resolve(root, 'scripts/contracts/consumer-fields.json'));
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const failures = [];
let checked = 0;

for (const contract of spec.contracts) {
  const provider = readFileSync(resolve(root, contract.provider), 'utf8');
  const consumer = readFileSync(resolve(root, contract.consumer), 'utf8');
  for (const path of contract.fields) {
    for (const seg of path.split('.').map((s) => s.replace(/\[\d+\]$/, ''))) {
      checked++;
      if (!provider.includes(`"${seg}"`)) failures.push(`${contract.provider}: no "${seg}" literal (provider of ${path})`);
      if (!new RegExp(`\\b${seg}\\b`).test(consumer)) failures.push(`${contract.consumer}: no ${seg} reference (consumer of ${path})`);
    }
  }
}

for (const line of failures) console.log(`FAIL ${line}`);
console.log(`contracts: ${spec.contracts.length} providers checked, ${checked} segments, ${failures.length} failures`);
console.log(failures.length === 0 ? 'RESULT: PASS' : 'RESULT: FAIL');
process.exit(failures.length === 0 ? 0 : 1);
