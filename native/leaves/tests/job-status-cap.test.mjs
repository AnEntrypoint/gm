import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const server = read('native/components/mcp/server.cpp');
const job = read('native/components/verbs/job.cpp');
const verbsCpp = read('native/components/verbs/verbs.cpp');
const tools = read('src/tools.mjs');
const mcp = read('src/mcp.mjs');
const skill = read('skills/gm/SKILL.md');

test('job_status waitMs is capped at 30000 ms in both trees', () => {
  assert.ok(server.includes('kMaxJobWaitMs = 30000'), 'native server caps job_status at 30000 ms');
  assert.ok(server.includes('kMaxJobWaitMs)'), 'native server clamps waitMs to the cap');
  assert.ok(job.includes('max_wait_ms = 30000'), 'native verbs cap job_status at 30000 ms');
  assert.ok(tools.includes('const MAX_WAIT_MS = 30000;'), 'Node tools cap job_status at 30000 ms');
  assert.ok(tools.includes('MAX_WAIT_MS)'), 'Node tools clamp waitMs to the cap');
});

test('next_context waitMs is a distinct, larger cap', () => {
  assert.ok(mcp.includes('const MAX_WAIT_MS = 300000;'), 'Node next_context caps at 300000 ms');
  assert.ok(server.includes('kMaxWaitMs = 100000'), 'native next_context caps at 100000 ms');
  assert.ok(!tools.includes('const MAX_WAIT_MS = 300000;'), '300000 is not the job_status cap');
});

test('both served job_status descriptions name the cap, the clamp and the re-arm', () => {
  const clause = 'capped at 30000 ms (30 s; a larger waitMs is clamped); re-arm gm.job_status({ job, waitMs: 30000 })';
  assert.ok(verbsCpp.includes(clause), 'native served description names the cap and re-arm');
  assert.ok(mcp.includes(clause), 'Node served description names the cap and re-arm');
});

test('the served skill states the cap, the clamp, the re-arm and the distinct next_context cap', () => {
  assert.ok(skill.includes('capped at 30000 ms (30 s), declared in both trees'), 'skill states the 30 s cap in both trees');
  assert.ok(skill.includes('is clamped, so re-arm'), 'skill states the clamp and re-arm');
  assert.ok(skill.includes('gm.job_status({ job, waitMs: 30000 })'), 'skill gives the exact re-arm call');
  assert.ok(skill.includes('until the job exits'), 'skill re-arms until the job exits');
  assert.ok(skill.includes('at most 300000 ms'), 'skill distinguishes the next_context 300000 ms cap');
});
