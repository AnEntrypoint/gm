import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSearchVerbs } from '../../../src/search.mjs';

const MARKER = 'LONG_MARK_9f3a';
const STRADDLE = 'STRADDLE_MARK_7b2c';
const SECRET = 'SECRET_LONG_VALUE_7c1d';

test('grep matches and shows hits past the bounded match window', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gm-search-long-'));
  try {
    const line = `${'x'.repeat(1500)} ${MARKER} ${'y'.repeat(1600)}`;
    const boundary = `${'a'.repeat(1018)}${STRADDLE}${'z'.repeat(1600)}`;
    writeFileSync(join(dir, 'long.txt'), `${line}\n`);
    writeFileSync(join(dir, 'boundary.txt'), `${boundary}\n`);
    writeFileSync(join(dir, '.env'), `KEY=${'v'.repeat(1500)}${SECRET}\n`);
    const verbs = createSearchVerbs({ root: dir, confine: null });
    for (const mode of ['literal', 'word', 'regex']) {
      const pattern = mode === 'regex' ? 'LONG_MARK.*9f3a' : MARKER;
      const reply = await verbs.grep({ pattern, mode });
      assert.equal(reply.ok, true, `${mode} ok`);
      assert.ok(reply.output.includes('long.txt:1'), `${mode} finds the line`);
      assert.ok(reply.output.includes(MARKER), `${mode} shows the marker`);
      assert.ok(reply.output.includes('(1 matches; showing 0 to 1; no more)'), `${mode} counts one match`);
      assert.ok(reply.hint?.includes('bounded windows'), `${mode} names bounded windows`);
    }
    const straddle = await verbs.grep({ pattern: STRADDLE, mode: 'regex' });
    assert.ok(straddle.output.includes('boundary.txt:1') && straddle.output.includes(STRADDLE), 'a regex hit across a window boundary is found');
    const masked = await verbs.grep({ pattern: 'SECRET_LONG_VALUE' });
    assert.ok(masked.output.includes('<redacted>'), 'a long .env line is redacted');
    assert.ok(!masked.output.includes(SECRET), 'a long .env line never prints its value');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a catastrophic regex on a long line stays within the scan deadline', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gm-search-huge-'));
  try {
    writeFileSync(join(dir, 'huge.txt'), `install${'a'.repeat(999000)}\n`);
    const started = Date.now();
    const reply = await createSearchVerbs({ root: dir, confine: null }).grep({ pattern: 'install.*gm', mode: 'regex' });
    const elapsed = Date.now() - started;
    assert.equal(reply.ok, true);
    assert.ok(reply.output.includes('(0 matches; showing 0 to 0; no more)'), 'the long line reports no match');
    assert.ok(elapsed < 10000, `catastrophic regex took ${elapsed} ms`);
    assert.ok(reply.hint?.includes('bounded windows'), 'the bounded-window hint names the cap');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
