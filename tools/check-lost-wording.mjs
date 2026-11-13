#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FRAGMENTS = ['its return value is lost; ', ' verb calls completed before the stop, each in query_log as a code-call after seq '];
const GATE_FRAGMENTS = [
  'read skill://gm/SKILL.md first with resources/read, ReadMcpResourceTool (server gm) or the gm prompt',
  'but that file read does not clear this gate',
];
const GATE_FORBIDDEN = ['your file tool on '];
const TREES = [
  ['native', join(root, 'native', 'components', 'mcp', 'server.cpp')],
];
const failures = [];
for (const [label, path] of TREES) {
  const text = readFileSync(path, 'utf8');
  for (const fragment of FRAGMENTS) {
    if (!text.includes(fragment)) failures.push(`${label} (${path}) lacks ${JSON.stringify(fragment)}`);
  }
  for (const fragment of GATE_FRAGMENTS) {
    if (!text.includes(fragment)) failures.push(`${label} (${path}) lacks skill-gate wording ${JSON.stringify(fragment)}`);
  }
  for (const fragment of GATE_FORBIDDEN) {
    if (text.includes(fragment)) failures.push(`${label} (${path}) still offers ${JSON.stringify(fragment)} as a skill-read route`);
  }
}
const gateCheck = readFileSync(join(root, 'native', 'components', 'tool', 'checks', 'no_resource_client.cpp'), 'utf8');
if (!gateCheck.includes('does not clear this gate')) failures.push('check-no-resource-client does not pin the host-file-read warning');
if (failures.length > 0) {
  console.error(`lost-wording-check: failed: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('lost-wording-check: passed: the body-stopped message names its return value as lost, with a space after the semicolon and the code-call count, and the skill-gate refusal names only the reads that clear the gate and warns that a host file read does not, pinned by check-no-resource-client');
