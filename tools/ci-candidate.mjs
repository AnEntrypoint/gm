#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const [sha, candidate, timeoutArg = '120'] = process.argv.slice(2);
if (!sha || !candidate) {
  console.error('usage: tools/ci-candidate.mjs <sha> <candidate-ref> [timeout-minutes]');
  process.exit(2);
}
const REQUIRED = ['release', 'arm-diagnose'];
const deadline = Date.now() + Number(timeoutArg) * 60000;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const gh = (args) => spawnSync('gh', args, { encoding: 'utf8', timeout: 120000 });

const runsOnSha = () => {
  const reply = gh(['run', 'list', '--branch', candidate, '--limit', '20', '--json', 'databaseId,name,status,conclusion,headSha']);
  if (reply.status !== 0) return null;
  return JSON.parse(reply.stdout).filter((run) => run.headSha === sha);
};

const badJobs = (id) => {
  const reply = gh(['run', 'view', String(id), '--json', 'jobs', '--jq', '.jobs[] | select(.conclusion != "success" and .conclusion != "skipped") | "\\(.name) \\(.conclusion)"']);
  return reply.status === 0 ? reply.stdout.trim() : '(could not read the jobs)';
};

for (;;) {
  const current = runsOnSha();
  if (current !== null) {
    const byName = Object.fromEntries(REQUIRED.map((name) => [name, current.find((run) => run.name === name)]));
    console.log(`ci-candidate: ${candidate} ${REQUIRED.map((name) => `${name}=${byName[name]?.status ?? 'not started'}`).join(' ')}`);
    if (REQUIRED.every((name) => byName[name] && byName[name].status === 'completed')) {
      const red = REQUIRED.filter((name) => byName[name].conclusion !== 'success');
      if (red.length === 0) {
        console.log(`ci-candidate: green on ${sha}: ${REQUIRED.map((name) => `${name} run ${byName[name].databaseId} success`).join(', ')}`);
        process.exit(0);
      }
      for (const name of red) console.log(`ci-candidate: ${name} run ${byName[name].databaseId} ${byName[name].conclusion}; jobs not green:\n${badJobs(byName[name].databaseId)}`);
      console.log(`ci-candidate: red on ${sha}: ${red.join(', ')}`);
      process.exit(1);
    }
  }
  if (Date.now() > deadline) {
    console.log(`ci-candidate: timed out after ${timeoutArg} minutes; no verdict for ${sha}`);
    process.exit(2);
  }
  await sleep(60000);
}
