import assert from 'node:assert/strict';
import test from 'node:test';
import { feedOf } from '../../../src/compact.mjs';

const registry = { tools: {}, kinds: {} };

test('compactChildren shrinks a child-heavy feed and keeps pending events', () => {
  const events = [];
  let seq = 1;
  const add = (fields) => events.push({ seq: seq++, t: '2026-11-05T00:00:00Z', ...fields });
  add({ kind: 'start', mode: 'code' });
  add({ kind: 'action', tool: 'next_context', args: {} });
  add({ kind: 'result', tool: 'next_context', ok: true, total: 3, actionSeq: 2 });
  for (let i = 0; i < 60; i += 1) {
    add({ kind: 'action', tool: 'run_code', args: { body: 'x' } });
    add({ kind: 'generation', generation: 1 });
    add({ kind: 'code-call', tool: 'read_file', ok: true, args: { path: 'a' }, output: 'x' });
    add({ kind: 'code-call', tool: 'grep', ok: true, args: { pattern: 'a' }, output: 'y' });
    add({ kind: 'result', tool: 'run_code', ok: true, output: 'z' });
    if (i % 10 === 9) {
      add({ kind: 'action', tool: 'child_context', args: {} });
      add({ kind: 'result', tool: 'child_context', ok: true, role: 'child' });
    }
  }
  add({ kind: 'row-added', row: 'prd-x', title: 'ship it' });
  const plain = feedOf(events, registry, { shown: 0 });
  const compact = feedOf(events, registry, { shown: 0, compactChildren: true });
  assert.deepEqual(plain, feedOf(events, registry, { shown: 0, compactChildren: false }));
  assert.ok(compact.records < plain.records);
  assert.ok(JSON.stringify(compact.events).length < JSON.stringify(plain.events).length);
  const summaries = compact.events.filter((event) => event.kind === 'child-range');
  assert.ok(summaries.length > 0);
  assert.equal(summaries[0].seqs.length, 2);
  assert.ok(Object.keys(summaries[0].counts).length > 0);
  assert.match(summaries[0].query.note, /gm\.query_log/);
  const pending = compact.events.find((event) => event.kind === 'row-added');
  assert.equal(pending?.row, 'prd-x');
  assert.ok(pending?.t !== undefined);
});
