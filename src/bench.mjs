#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEvents } from './log.mjs';

const CLI = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const TRIALS = 3;
const SLEEP_2S = 'node -e "setTimeout(() => {}, 2000)"';
const SLEEP_3S = 'node -e "setTimeout(() => {}, 3000)"';

const PARALLEL_ARMS = [
  { name: 'parallel on', flags: [] },
  { name: 'parallel off', flags: ['--serial'] },
];
const ARMS = [
  ...PARALLEL_ARMS,
  { name: 'background on', flags: [] },
  { name: 'background off', flags: ['--no-background'] },
];

const TASKS = [
  {
    name: 'writes',
    task: 'Write two files in one reply, read one back, and finish with a witness.',
    replies: [
      [
        { tool: 'write_file', args: { path: 'a.txt', content: 'alpha\n' } },
        { tool: 'write_file', args: { path: 'b.txt', content: 'beta\n' } },
      ],
      { tool: 'read_file', args: { path: 'a.txt' } },
      { tool: 'finish', args: { witness: 'a.txt and b.txt were written in one reply; read_file a.txt returned alpha.' } },
    ],
  },
  {
    name: 'background',
    task: 'Start a 3 s background job, run a 2 s command while it runs, poll the job, and finish.',
    replies: [
      { tool: 'run_shell', args: { command: SLEEP_3S, background: true, job: 'slow' } },
      { tool: 'run_shell', args: { command: SLEEP_2S } },
      { tool: 'job_status', args: { job: 'slow', waitMs: 10000 } },
      { tool: 'finish', args: { witness: 'job slow was polled after a 2 s command; job_status reported its state.' } },
    ],
  },
  {
    name: 'log',
    task: 'Write one file, count the result events with query_log, and finish.',
    replies: [
      { tool: 'write_file', args: { path: 'log.txt', content: 'one\n' } },
      { tool: 'query_log', args: { js: "events.filter((e) => e.kind === 'result').length" } },
      { tool: 'finish', args: { witness: 'write_file log.txt returned ok; query_log counted the result events.' } },
    ],
  },
  {
    name: 'slow-writes',
    task: 'Write four independent files in one reply, then finish with a witness.',
    replies: [
      [
        { tool: 'write_file', args: { path: 'a.txt', content: 'alpha\n' } },
        { tool: 'write_file', args: { path: 'b.txt', content: 'beta\n' } },
        { tool: 'write_file', args: { path: 'c.txt', content: 'gamma\n' } },
        { tool: 'write_file', args: { path: 'd.txt', content: 'delta\n' } },
      ],
      { tool: 'finish', args: { witness: 'a.txt, b.txt, c.txt and d.txt were written in one reply.' } },
    ],
    arms: PARALLEL_ARMS,
  },
];

function main(argv) {
  const { latencyMs, only } = parseOptions(argv);
  const tasks = only === undefined ? TASKS : TASKS.filter((task) => task.name === only);
  if (tasks.length === 0) throw new Error(`no bench task named ${only}`);
  const root = mkdtempSync(join(tmpdir(), 'gmnew-bench-'));
  const results = [];
  try {
    for (const task of tasks) {
      const script = join(root, `${task.name}.json`);
      writeFileSync(script, `${JSON.stringify(task.replies)}\n`);
      for (const arm of armsOf(task)) {
        for (let trial = 1; trial <= TRIALS; trial += 1) {
          const workspace = join(root, `ws-${task.name}-${arm.name.replaceAll(' ', '-')}-${trial}`);
          mkdirSync(workspace);
          const run = runOnce(task, script, workspace, arm.flags, latencyMs);
          results.push({ arm: arm.name, task: task.name, ...run });
          console.log(`${arm.name} | ${task.name} | trial ${trial} | run ${run.id} | ${run.status} | wall ${run.wallMs} ms | idleMs ${run.idleMs}`);
        }
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  printTable(results, tasks, latencyMs);
  process.exitCode = results.every((result) => result.status === 'finished') ? 0 : 1;
}

function runOnce(task, script, workspace, flags, latencyMs) {
  const child = spawnSync(
    process.execPath,
    [CLI, 'run', '--task', task.task, '--workspace', workspace, '--model', 'scripted', '--script', script, '--latency-ms', String(latencyMs), ...flags],
    { encoding: 'utf8', timeout: 120000 },
  );
  const match = /^run (\S+): (\S+) after/m.exec(child.stdout);
  if (!match) throw new Error(`run did not start for ${task.name}: ${child.stderr}`);
  const [, id, status] = match;
  const events = readEvents(join(workspace, 'runs', id, 'log.jsonl'));
  const start = events.find((event) => event.kind === 'start');
  const summary = events.find((event) => event.kind === 'summary');
  if (!summary) throw new Error(`run ${id} has no summary event`);
  return { id, status, wallMs: round(events.at(-1).mono - start.mono), idleMs: summary.idleMs };
}

function printTable(results, tasks, latencyMs) {
  const label = latencyMs > 0 ? `simulated latency ${latencyMs} ms` : 'no simulated latency (0 ms)';
  console.log('');
  console.log(`${label}: median wall time per arm, with min to max`);
  console.log('arm              task        trials  status              wall ms: median (min to max)    idleMs: median (min to max)');
  for (const task of tasks) {
    for (const arm of armsOf(task)) {
      const rows = results.filter((row) => row.arm === arm.name && row.task === task.name);
      const finished = rows.filter((row) => row.status === 'finished').length;
      const wall = spread(rows.map((row) => row.wallMs));
      const idle = spread(rows.map((row) => row.idleMs));
      console.log(
        `${arm.name.padEnd(16)} ${task.name.padEnd(11)} ${String(rows.length).padEnd(7)} ${`${finished}/${rows.length} finished`.padEnd(19)} ${wall.padEnd(31)} ${idle}`,
      );
    }
  }
}

function armsOf(task) {
  return task.arms ?? ARMS;
}

function parseOptions(argv) {
  const options = { latencyMs: 0, only: undefined };
  for (let i = 0; i < argv.length; i += 2) {
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${argv[i]} needs a value`);
    if (argv[i] === '--latency-ms') {
      if (!/^\d+$/.test(value)) throw new Error('--latency-ms takes a whole number of milliseconds, 0 or more');
      options.latencyMs = Number(value);
    } else if (argv[i] === '--task') {
      options.only = value;
    } else {
      throw new Error(`unknown flag: ${argv[i]}`);
    }
  }
  return options;
}

function spread(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return `${round(median)} (${round(sorted[0])} to ${round(sorted.at(-1))})`;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

main(process.argv.slice(2));
