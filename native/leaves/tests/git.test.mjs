import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { cleanup, realHost, tempDir } from './helpers.mjs';

const load = async () => (await import(`../git.mjs?${Math.random()}`)).verbs;
const verb = (verbs, name) => verbs.find((v) => v.name === name);

test('git verbs on a fresh repository', async () => {
  const dir = tempDir();
  globalThis.host = realHost(dir);
  try {
    const verbs = await load();
    assert.equal(verbs.length, 13);
    host.run({ argv: ['git', 'init', '-b', 'main'], cwd: dir });
    writeFileSync(join(dir, 'a.txt'), 'hello\n');
    assert.match(verb(verbs, 'git_status').call({}).output, /\?\? a\.txt/);
    assert.equal(verb(verbs, 'git_add').call({ paths: ['.'] }).ok, false);
    assert.equal(verb(verbs, 'git_add').call({ paths: ['../x'] }).ok, false);
    assert.equal(verb(verbs, 'git_add').call({ paths: ['a.txt'] }).ok, true);
    const commit = verb(verbs, 'git_commit').call({ message: 'first', paths: ['a.txt'] });
    assert.equal(commit.ok, true, JSON.stringify(commit));
    assert.match(verb(verbs, 'git_log').call({}).output, /first/);
    assert.match(verb(verbs, 'git_show').call({}).output, /a\.txt/);
    assert.match(verb(verbs, 'git_branch').call({}).output, /\* main/);
    writeFileSync(join(dir, 'a.txt'), 'changed\n');
    assert.match(verb(verbs, 'git_diff').call({ paths: ['a.txt'] }).output, /\+changed/);
    assert.equal(verb(verbs, 'git_checkout').call({ ref: '-x' }).ok, false);
    assert.equal(verb(verbs, 'git_log').call({ count: 0 }).error, 'count must be an integer from 1 to 200');
    assert.equal(verb(verbs, 'git_rm').call({ paths: ['a.txt'] }).ok, false);
    assert.match(verb(verbs, 'git_status').call({ cwd: tmpOutside() }).error, /not inside a git repository|no such directory/);
    assert.equal(verb(verbs, 'git_push').call({}).ok, false);
  } finally {
    cleanup(dir);
  }
});

const tmpOutside = () => '/';

test('transient failures are retried with log events, permanent ones are not', async () => {
  const replies = [
    { started: true, exitCode: 128, out: '', err: 'fatal: unable to access: Connection reset by peer' },
    { started: true, exitCode: 128, out: '', err: 'fatal: the remote end hung up unexpectedly' },
    { started: true, exitCode: 0, out: 'done', err: '' },
  ];
  const events = [];
  globalThis.host = { workspace: '/w', runDir: '/r', run: () => replies.shift(), logAppend: ({ kind, fields }) => events.push([kind, fields]), sleep: () => {}, stat_file: () => ({ ok: true, isDirectory: true }) };
  const verbs = await load();
  const result = verb(verbs, 'git_fetch').call({});
  assert.deepEqual([result.ok, result.attempts], [true, 3]);
  assert.deepEqual(events.map(([, f]) => f.errorType), ['ECONNRESET', 'hung-up']);
  const permanent = [{ started: true, exitCode: 128, out: '', err: 'fatal: not a repository' }];
  globalThis.host.run = () => permanent[0];
  const second = verb(verbs, 'git_pull').call({});
  assert.deepEqual([second.ok, second.attempts], [false, 1]);
});

test('ci_status reads origin host and pages', async () => {
  const seen = [];
  globalThis.host = {
    workspace: '/w', runDir: '/r', logAppend() {}, sleep() {},
    run({ argv }) {
      seen.push(argv.join(' '));
      if (argv.includes('rev-parse')) return { started: true, exitCode: 0, out: 'abc1234\n', err: '' };
      if (argv.includes('get-url')) return { started: true, exitCode: 0, out: 'git@ghe.example.com:own/repo.git\n', err: '' };
      return { started: true, exitCode: 0, out: JSON.stringify([{ workflow_runs: [{ name: 'ci', status: 'completed', conclusion: 'success', html_url: 'u' }] }]), err: '' };
    },
  };
  const verbs = await load();
  const result = verb(verbs, 'ci_status').call({});
  assert.equal(result.output, 'own/repo abc1234\nci completed success u');
  assert.ok(seen.some((s) => s.includes('--hostname ghe.example.com --paginate --slurp')));
});
