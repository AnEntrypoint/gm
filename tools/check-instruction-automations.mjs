#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentsSizeCheck, stagedCommentsCheck, unitTestsCheck } from '../src/gate.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(join(tmpdir(), 'gm-instruction-automations-'));
const failures = [];
const expect = (label, condition) => {
  if (!condition) failures.push(label);
};
const git = (cwd, args) => execFileSync('git', args, { cwd, stdio: 'ignore' });
const fixture = (name, files) => {
  const dir = join(scratch, name);
  mkdirSync(dir, { recursive: true });
  for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
  return dir;
};

try {
  const real = agentsSizeCheck(root);
  expect(`agents-size passes the real AGENTS.md: ${real.detail}`, real.ok === true);
  expect('agents-size refuses 30 KB plus one byte', agentsSizeCheck(fixture('over', { 'AGENTS.md': 'x'.repeat(30 * 1024 + 1) })).ok === false);
  expect('agents-size accepts exactly 30 KB', agentsSizeCheck(fixture('exact', { 'AGENTS.md': 'x'.repeat(30 * 1024) })).ok === true);

  expect('unit-tests refuses a describe call', unitTestsCheck(fixture('describe', { 'a.mjs': 'describe("x", () => {});\n' })).ok === false);
  expect('unit-tests refuses a test file name', unitTestsCheck(fixture('name', { 'thing.test.mjs': 'export const x = 1;\n' })).ok === false);
  expect('unit-tests accepts plain modules', unitTestsCheck(fixture('plain', { 'a.mjs': 'export const x = 1;\n' })).ok === true);

  const repo = fixture('staged', {});
  git(repo, ['init', '-q']);
  writeFileSync(join(repo, 'a.mjs'), '// a note\nexport const a = 1;\n');
  git(repo, ['add', 'a.mjs']);
  expect('staged-comments refuses a staged line comment', stagedCommentsCheck(repo).ok === false);
  writeFileSync(join(repo, 'a.mjs'), '#!/usr/bin/env node\nexport const a = 1;\n');
  git(repo, ['add', 'a.mjs']);
  expect('staged-comments accepts a shebang and no comments', stagedCommentsCheck(repo).ok === true);

  const shipRoot = resolve(root, 'tools', 'ship.sh');
  const ship = (name, branch, identity, message) => {
    const dir = fixture(name, { 'f.txt': 'x\n' });
    git(dir, ['init', '-q', '-b', branch]);
    git(dir, ['config', 'user.name', identity]);
    git(dir, ['config', 'user.email', 'scratch@example.invalid']);
    const run = spawnSync('bash', [shipRoot, message, 'f.txt'], { cwd: dir, env: { ...process.env, SHIP_ROOT: dir, SHIP_PUSH: '0' }, encoding: 'utf8', timeout: 60000 });
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dir, encoding: 'utf8' }).trim();
    return { status: run.status, text: `${run.stdout}${run.stderr}`, staged };
  };
  const onTopic = ship('topic', 'topic', 'lanmower', 'subject');
  expect(`ship refuses a branch other than main: ${onTopic.text.trim()}`, onTopic.status !== 0 && onTopic.text.includes('refused: ship commits on main') && onTopic.staged === '');
  const otherName = ship('other-name', 'main', 'someone', 'subject');
  expect(`ship refuses a non-lanmower identity: ${otherName.text.trim()}`, otherName.status !== 0 && otherName.text.includes('must be lanmower') && otherName.staged === '');
  const trailer = ship('trailer', 'main', 'lanmower', 'subject\n\nbody\n\nCo-Authored-By: someone <someone@example.invalid>');
  expect(`ship refuses a commit trailer: ${trailer.text.trim()}`, trailer.status !== 0 && trailer.text.includes('carries a trailer') && trailer.staged === '');
  const midBody = ship('mid-body', 'main', 'lanmower', 'subject\n\nRow: closes/x.txt\n\nprose after a trailer-like line');
  expect(`ship refuses a trailer-like line that is not in the last paragraph: ${midBody.text.trim()}`, midBody.status !== 0 && midBody.text.includes('carries a trailer') && midBody.staged === '');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`check-instruction-automations: failed: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('check-instruction-automations: passed: AGENTS.md size limit, unit-test scan, staged comment lint, and ship branch, identity and trailer refusals');
