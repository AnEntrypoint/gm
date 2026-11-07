#!/usr/bin/env node
import { resolve } from 'node:path';
import { scanUnitTests } from '../src/unit-tests.mjs';

const hits = scanUnitTests(resolve(process.argv[2] ?? '.'));
for (const hit of hits) console.log(hit);
console.log(hits.length === 0 ? 'scan-unit-tests: no unit tests found' : `scan-unit-tests: ${hits.length} hit(s)`);
process.exit(hits.length === 0 ? 0 : 1);
