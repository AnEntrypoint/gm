import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createTools } from '../../../src/tools.mjs';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const read = (rel) => readFileSync(join(root, rel), 'utf8');

async function withTools(fn) {
  const workspace = mkdtempSync(join(tmpdir(), 'gm-shrink-'));
  const log = { now: () => 0, append() {}, count: () => 0, tail: () => [], window: () => ({ last: 0 }), at: () => null };
  const tools = createTools({ workspace, runDir: workspace, log, background: false });
  try {
    return await fn(tools, workspace);
  } finally {
    await tools.close();
    rmSync(workspace, { recursive: true, force: true });
  }
}

test('write_file warns on a substantial shrink and still writes', async () => {
  await withTools(async (tools, ws) => {
    const path = join(ws, 'big.txt');
    writeFileSync(path, 'A'.repeat(1000));
    const r = await tools.run('write_file', { path, content: 'A'.repeat(100) });
    assert.equal(r.ok, true);
    assert.equal(r.shrunkByBytes, 900);
    assert.equal(r.shrinkRatio, 0.1);
    assert.equal(typeof r.shrinkWarning, 'string');
    assert.match(r.shrinkWarning, /truncated:true/);
    assert.equal(readFileSync(path, 'utf8'), 'A'.repeat(100));
  });
});

test('write_file keeps the default success shape for a normal rewrite and a trim over half', async () => {
  await withTools(async (tools, ws) => {
    const path = join(ws, 'same.txt');
    writeFileSync(path, 'A'.repeat(1000));
    const full = await tools.run('write_file', { path, content: 'A'.repeat(1000) });
    assert.deepEqual(Object.keys(full).sort(), ['ok', 'output']);
    const trim = await tools.run('write_file', { path, content: 'A'.repeat(700) });
    assert.deepEqual(Object.keys(trim).sort(), ['ok', 'output']);
  });
});

test('write_file keeps the default success shape for a new file', async () => {
  await withTools(async (tools, ws) => {
    const r = await tools.run('write_file', { path: join(ws, 'fresh.txt'), content: 'hello' });
    assert.equal(r.ok, true);
    assert.deepEqual(Object.keys(r).sort(), ['ok', 'output']);
  });
});

test('both served write_file descriptions and the skill name the shrink warning', () => {
  const mcp = read('src/mcp.mjs');
  const verbsCpp = read('native/components/verbs/verbs.cpp');
  const prompt = read('src/prompt.mjs');
  const skill = read('skills/gm/SKILL.md');
  const clause = 'less than half its prior byte size';
  assert.ok(mcp.includes('shrinkWarning') && mcp.includes(clause), 'Node served description names warning and threshold');
  assert.ok(verbsCpp.includes('shrinkWarning') && verbsCpp.includes(clause), 'native served description names warning and threshold');
  assert.ok(prompt.includes('shrinkWarning'), 'Node prompt description names the warning');
  assert.ok(skill.includes('shrinkWarning') && skill.includes('truncated:true'), 'skill names the warning and truncated:true');
});
