import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { PENDING_KINDS } from '../../../src/pending.mjs';
import { cleanup, realHost, tempDir } from './helpers.mjs';

test('add, list, resolve and delete rows', async () => {
  const dir = tempDir();
  globalThis.host = realHost(dir);
  try {
    const { verbs } = await import('../rows.mjs');
    const call = (name, args) => verbs.find((v) => v.name === name).call(args);
    assert.equal(verbs.length, 9);
    assert.equal(call('prd_list', {}).output, '(none)');
    const id = call('prd_add', { title: ' ship it ', body: 'b' }).output;
    assert.match(id, /^prd-[a-z0-9]+$/);
    assert.equal(call('prd_list', {}).output, `${id} open ship it`);
    assert.equal(call('unknown_list', {}).output, '(none)');
    const question = call('unknown_add', { title: 'which colour?' }).output;
    assert.deepEqual(
      host.calls.filter((entry) => entry[0] === 'row-added').map((entry) => entry[1]),
      [
        { row: id, rowKind: 'prd', title: 'ship it' },
        { row: question, rowKind: 'unknown', title: 'which colour?' },
      ],
    );
    assert.equal(PENDING_KINDS.has('row-added'), true);
    host.run({ argv: ['git', 'init', '-b', 'main'], cwd: dir });
    writeFileSync(join(dir, 'f'), 'x');
    host.run({ argv: ['git', 'add', 'f'], cwd: dir });
    host.run({ argv: ['git', 'commit', '-m', 'm'], cwd: dir });
    const sha = host.run({ argv: ['git', 'rev-parse', '--short', 'HEAD'], cwd: dir }).out.trim();
    assert.match(call('prd_resolve', { id, event: 9, commit: sha }).error, /not in this run's log/);
    writeFileSync(join(dir, 'log.jsonl'), '{"seq":1,"kind":"x"}\n');
    assert.equal(call('prd_resolve', { id, event: 1, commit: 'abcdef0' }).error, 'no commit abcdef0 in this repository');
    assert.equal(call('prd_resolve', { id, event: 1, commit: sha }).output, `${id} resolved by event 1 at commit ${sha}`);
    const file = readFileSync(join(dir, 'work/rows', `${id}.yml`), 'utf8');
    assert.match(file, /^witnessEvent: 1$/m);
    assert.equal(call('prd_delete', { id }).ok, false);
    const other = call('prd_add', { title: 'drop' }).output;
    assert.equal(call('prd_delete', { id: other }).output, `${other} deleted`);
    assert.equal(call('prd_list', { status: 'open' }).output, '(none)');
    assert.equal(existsSync(join(dir, 'work/rows', `${other}.yml`)), false);
    assert.equal(call('prd_delete', { id: other }).error, `no row ${other}`);
    assert.equal(call('prd_list', { status: 'all' }).output, `${id} resolved ship it`);
    assert.equal(call('prd_list', { status: 'bad' }).ok, false);
  } finally {
    cleanup(dir);
  }
});

test('delete open and parked PRD rows outside a git repository', async () => {
  const dir = tempDir();
  globalThis.host = realHost(dir);
  try {
    const { verbs } = await import('../rows.mjs');
    const call = (name, args) => verbs.find((v) => v.name === name).call(args);
    assert.equal(existsSync(join(dir, '.git')), false);
    const open = call('prd_add', { title: 'open drop' }).output;
    assert.equal(call('prd_delete', { id: open }).output, `${open} deleted`);
    assert.equal(existsSync(join(dir, 'work/rows', `${open}.yml`)), false);
    const parked = call('prd_add', { title: 'parked drop' }).output;
    assert.equal(call('prd_park', { id: parked, reason: 'not needed' }).output, `${parked} parked: not needed`);
    assert.equal(call('prd_list', { status: 'parked' }).output, `${parked} parked parked drop (parked: not needed)`);
    assert.equal(call('prd_delete', { id: parked }).output, `${parked} deleted`);
    assert.equal(existsSync(join(dir, 'work/rows', `${parked}.yml`)), false);
    const reopened = call('prd_add', { title: 'reopen drop' }).output;
    assert.equal(call('prd_park', { id: reopened, reason: 'wait' }).output, `${reopened} parked: wait`);
    assert.equal(call('prd_reopen', { id: reopened }).output, `${reopened} reopened`);
    assert.equal(call('prd_delete', { id: reopened }).output, `${reopened} deleted`);
    const question = call('unknown_add', { title: 'which colour?' }).output;
    assert.equal(call('prd_delete', { id: question }).error, `row ${question} is not a work item`);
    assert.equal(call('unknown_list', { status: 'open' }).output, `${question} open which colour?`);
    assert.equal(call('prd_list', { status: 'all' }).output, '(none)');
  } finally {
    cleanup(dir);
  }
});
