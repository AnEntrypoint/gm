#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECK = 'push-timing-check';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const started = Date.now();
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 30000 }).trim();
const gitOk = (...args) => {
  try {
    execFileSync('git', ['-C', root, ...args], { stdio: 'ignore', timeout: 30000 });
    return true;
  } catch {
    return false;
  }
};

const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};

const ship = readFileSync(join(root, 'tools', 'ship.sh'), 'utf8').split('\n');
const lineOf = (pattern) => ship.findIndex((line) => pattern.test(line));
const gateAt = lineOf(/src\/gate\.mjs/);
const commitAt = lineOf(/^git commit /);
const pushAt = lineOf(/^\s*git push /);
expect(gateAt >= 0 && commitAt > gateAt, `ship.sh commits before the gate has run (gate line ${gateAt + 1}, commit line ${commitAt + 1})`);
expect(pushAt > commitAt, `ship.sh pushes before it commits (commit line ${commitAt + 1}, push line ${pushAt + 1})`);

const target = process.argv[2] ?? 'HEAD';
const sha = git('rev-parse', '--verify', `${target}^{commit}`);
const hasOrigin = gitOk('rev-parse', '--verify', 'origin/main');
expect(hasOrigin, 'origin/main has no local tracking ref, so a push cannot be confirmed');
const ancestor = hasOrigin && gitOk('merge-base', '--is-ancestor', sha, 'origin/main');
const originSha = hasOrigin ? git('rev-parse', 'origin/main') : '(none)';

const readBack = git('log', '-1', '--format=%H %an <%ae>', sha);
expect(readBack.includes('lanmower <'), `the commit author is not lanmower: ${readBack}`);
const pushedClaim = process.env.CLAIM_PUSHED === '1';
if (pushedClaim) expect(ancestor, `the commit is claimed as pushed, but ${sha} is not an ancestor of origin/main ${originSha}`);
if (!pushedClaim && ancestor) expect(false, `the commit is on origin/main, so the push timing must be read from origin, not claimed as local`);

const wall = ((Date.now() - started) / 1000).toFixed(2);
if (failures.length > 0) {
  console.error(`${CHECK}: ${failures.length} failure(s) (wall ${wall} s)\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`${CHECK}: ok (ship.sh order: gate line ${gateAt + 1} < commit line ${commitAt + 1} < push line ${pushAt + 1}; ${sha.slice(0, 12)} ${ancestor ? 'is' : 'is not'} an ancestor of origin/main ${originSha.slice(0, 12)}, the local tracking ref; claimed pushed: ${pushedClaim}; wall ${wall} s)`);
}
