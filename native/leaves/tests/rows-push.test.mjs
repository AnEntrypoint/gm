import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { cleanup, realHost, tempDir } from './helpers.mjs';

const load = async () => (await import(`../rows.mjs?${Math.random()}`)).verbs;

function git(host, cwd, argv) {
  return host.run({ argv: ['git', ...argv], cwd });
}

function setup(host, dir) {
  const bare = join(dir, 'remote.git');
  git(host, dir, ['init', '--bare', '-q', '-b', 'main', bare]);
  git(host, dir, ['init', '-q', '-b', 'main']);
  writeFileSync(join(dir, 'seed.txt'), 'seed');
  git(host, dir, ['add', 'seed.txt']);
  git(host, dir, ['commit', '-q', '-m', 'seed']);
  git(host, dir, ['remote', 'add', 'origin', bare]);
  git(host, dir, ['push', '-q', 'origin', 'main:refs/heads/main']);
  return bare;
}

function remoteTip(host, dir) {
  const out = git(host, dir, ['ls-remote', 'origin', 'refs/heads/main']).out;
  return out.match(/^[0-9a-f]{40,64}/)[0];
}

function localHead(host, dir) {
  return git(host, dir, ['rev-parse', 'HEAD']).out.trim();
}

test('prd_resolve with push:true closes and pushes by full sha in one call', async () => {
  const dir = tempDir();
  globalThis.host = realHost(dir);
  try {
    const verbs = await load();
    const call = (name, args) => verbs.find((v) => v.name === name).call(args);
    setup(host, dir);
    const seed = localHead(host, dir);
    const id = call('prd_add', { title: 'push me' }).output;
    const result = call('prd_resolve', { id, witness: 'w', push: true });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.match(result.pushed, /^[0-9a-f]{40}$/);
    assert.equal(result.recovery, 'none');
    assert.equal(remoteTip(host, dir), result.pushed);
    assert.equal(localHead(host, dir), result.pushed);
    assert.notEqual(remoteTip(host, dir), seed);
  } finally {
    cleanup(dir);
  }
});

test('prd_resolve without push leaves the close commit local', async () => {
  const dir = tempDir();
  globalThis.host = realHost(dir);
  try {
    const verbs = await load();
    const call = (name, args) => verbs.find((v) => v.name === name).call(args);
    setup(host, dir);
    const seed = localHead(host, dir);
    const id = call('prd_add', { title: 'local only' }).output;
    const result = call('prd_resolve', { id, witness: 'w' });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.pushed, undefined);
    assert.equal(result.recovery, undefined);
    assert.notEqual(localHead(host, dir), seed);
    assert.equal(remoteTip(host, dir), seed);
  } finally {
    cleanup(dir);
  }
});

test('prd_resolve with push:true recovers a rejected push by fetch and rebase', async () => {
  const dir = tempDir();
  const peer = tempDir();
  globalThis.host = realHost(dir);
  try {
    const verbs = await load();
    const call = (name, args) => verbs.find((v) => v.name === name).call(args);
    const bare = setup(host, dir);
    const seed = localHead(host, dir);
    git(host, dir, ['clone', '-q', bare, peer]);
    writeFileSync(join(peer, 'peer.txt'), 'peer');
    git(host, peer, ['add', 'peer.txt']);
    git(host, peer, ['commit', '-q', '-m', 'peer']);
    git(host, peer, ['push', '-q', 'origin', 'HEAD:refs/heads/main']);
    const id = call('prd_add', { title: 'concurrent' }).output;
    const result = call('prd_resolve', { id, witness: 'w', push: true });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.recovery, 'fetch-rebase');
    assert.match(result.pushed, /^[0-9a-f]{40}$/);
    assert.notEqual(result.pushed, seed);
    assert.equal(remoteTip(host, dir), result.pushed);
    assert.equal(localHead(host, dir), result.pushed);
  } finally {
    cleanup(dir);
    cleanup(peer);
  }
});
