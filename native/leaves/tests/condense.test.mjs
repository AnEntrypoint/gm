import { test } from 'node:test';
import assert from 'node:assert/strict';
import { condenseOutput } from '../../../src/condense.mjs';

test('leaves small output alone', () => {
  assert.equal(condenseOutput('short\ntext\n'), null);
});

test('keeps signals and the result, drops progress noise', () => {
  const noisy = Array.from({ length: 400 }, () => 'progress line').join('\n') + '\nERROR marker\nRESULT ok\n';
  const c = condenseOutput(noisy);
  assert.ok(c);
  assert.equal(c.compressed, true);
  assert.ok(c.output.includes('ERROR marker'));
  assert.ok(c.output.includes('RESULT ok'));
  assert.ok(c.output.includes('raw:true'));
  assert.ok(c.droppedLines > 300);
  assert.ok(c.output.length < noisy.length / 4);
  assert.equal(c.originalChars, noisy.length);
});
