#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runLoop } from './loop.mjs';
import { anthropicRequestBody, createModel } from './models.mjs';
import { readEvents, runQuery } from './log.mjs';
import { buildPrompt, DEFAULT_RULES, DEFAULT_WITNESS } from './prompt.mjs';
import { createTools } from './tools.mjs';
import { createRun, isDirectory, loadTask, newRunId, RUNS } from './run.mjs';
import { writeSummary } from './summary.mjs';

const USAGE = `usage:
  gmnew run --task <file-or-text> --workspace <dir> [--model scripted|anthropic] [--max-steps N]
            [--script <replies.json>] [--faults 429,429] [--serial] [--no-background]
            [--dump-request]
  gmnew query --run <id> --js "<filter>"
  gmnew doctor [--workspace <dir>]`;

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'run') return run(parseFlags(rest));
  if (command === 'query') return query(parseFlags(rest));
  if (command === 'doctor') return doctor(parseFlags(rest));
  console.error(USAGE);
  return 2;
}

async function run(flags) {
  if (!flags.task) throw new Error('--task is required');
  if (flags['dump-request'] === true) return dumpRequest(loadTask(flags.task).trim());
  if (!flags.workspace) throw new Error('--workspace is required');
  const workspace = resolve(flags.workspace);
  if (!isDirectory(workspace)) throw new Error(`workspace is not a directory: ${workspace}`);
  const maxSteps = Number(flags['max-steps'] ?? 50);
  if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new Error('--max-steps must be a positive integer');
  const modelName = flags.model ?? 'scripted';
  const script = flags.script === undefined ? undefined : loadScript(flags.script);
  if (script && modelName !== 'scripted') throw new Error('--script works only with --model scripted');
  const faults = flags.faults === undefined ? undefined : parseFaults(flags.faults);
  if (faults && modelName !== 'scripted') throw new Error('--faults works only with --model scripted');
  const model = createModel(modelName, { script, faults });
  const serial = flags.serial === true;
  const background = flags['no-background'] !== true;

  const task = loadTask(flags.task).trim();
  if (task === '') throw new Error('--task is empty');
  const spec = { task, witness: DEFAULT_WITNESS };

  const id = newRunId();
  const runDir = join(RUNS, id);
  const options = { serial, background, script: flags.script === undefined ? null : resolve(flags.script), faults: faults ?? null };
  const log = createRun({
    runDir,
    rules: DEFAULT_RULES,
    meta: { id, ...spec, workspace, model: modelName, maxSteps, ...options, createdAt: new Date().toISOString() },
  });
  const tools = createTools({ workspace, runDir, log, background });
  // An interrupt kills every shell group at once and exits, so no new call starts while the process goes down.
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    process.once(signal, () => {
      tools.killAllNow();
      writeSummary(log);
      log.append('end', { status: 'interrupted', signal });
      process.exit(code);
    });
  }
  const result = await runLoop({ runDir, spec, model, tools, log, maxSteps, serial });

  console.log(`run ${id}: ${result.status} after ${result.steps} steps`);
  if (result.witness) console.log(`witness: ${result.witness}`);
  console.log(`log: ${join(runDir, 'log.jsonl')}`);
  return result.status === 'finished' ? 0 : 1;
}

function query(flags) {
  if (!flags.run || !/^[A-Za-z0-9_-]+$/.test(flags.run)) throw new Error('--run <id> is required');
  if (flags.js === undefined) throw new Error('--js "<filter>" is required');
  const file = join(RUNS, flags.run, 'log.jsonl');
  if (!existsSync(file)) throw new Error(`no log for run ${flags.run}`);
  const result = runQuery(readEvents(file), flags.js);
  if (!result.ok) throw new Error(`query failed: ${result.error}`);
  console.log(result.output);
}

function doctor(flags) {
  const workspace = resolve(flags.workspace ?? process.cwd());
  const nodeOk = Number(process.versions.node.split('.')[0]) >= 20;
  console.log(`node ${process.version}: ${nodeOk ? 'ok' : 'fail, Node 20 or newer is required'}`);
  console.log(`ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? 'set' : 'not set'}`);
  const writable = probeWritable(workspace);
  console.log(`workspace ${workspace}: ${writable.ok ? 'writable' : `not writable (${writable.error})`}`);
  console.log(lastRunSummary());
  console.log('limits: the Node-below-20 failure path has no live run; run_shell is unconfined, so a shell command can hard-link a file from outside the workspace; the process-group kill is unverified on Windows');
  return nodeOk && writable.ok ? 0 : 1;
}

function probeWritable(dir) {
  const probe = join(dir, `.gmnew-doctor-${randomBytes(4).toString('hex')}`);
  try {
    writeFileSync(probe, 'probe\n', { flag: 'wx' });
  } catch (err) {
    return { ok: false, error: err.code ?? err.message };
  }
  unlinkSync(probe);
  return { ok: true };
}

function lastRunSummary() {
  if (!isDirectory(RUNS)) return 'last run: none (no runs/ directory)';
  const ids = readdirSync(RUNS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (ids.length === 0) return 'last run: none';
  const id = ids.at(-1);
  const events = readEvents(join(RUNS, id, 'log.jsonl'));
  return `last run ${id}: ${events.length} events, outcome ${lastOutcome(events)}`;
}

function lastOutcome(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.kind === 'end') return event.status;
    if (event.kind === 'result' && event.tool === 'finish' && event.finished) return 'finished';
  }
  return 'none';
}

const BOOLEAN_FLAGS = new Set(['serial', 'no-background', 'dump-request']);

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i];
    if (!name?.startsWith('--')) throw new Error(`unexpected argument: ${name}`);
    const key = name.slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      flags[key] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`);
    flags[key] = value;
    i += 1;
  }
  return flags;
}

function loadScript(file) {
  const value = JSON.parse(readFileSync(resolve(file), 'utf8'));
  if (!Array.isArray(value)) throw new Error('--script must be a JSON array of replies');
  return value;
}

// Prints the anthropic request body for the first step, as the adapter would send it. Makes no network call.
function dumpRequest(task) {
  const { prompt, prefix } = buildPrompt({ rules: DEFAULT_RULES, spec: { task, witness: DEFAULT_WITNESS }, events: [], total: 0 });
  console.log(JSON.stringify(anthropicRequestBody(prompt, { prefix }), null, 2));
  return 0;
}

// --faults 429,429 makes the first model calls fail with those HTTP statuses.
function parseFaults(value) {
  const statuses = value.split(',').map((item) => Number(item));
  if (statuses.some((status) => !Number.isInteger(status) || status < 400 || status > 599)) {
    throw new Error('--faults takes comma-separated HTTP statuses from 400 to 599, for example 429,429');
  }
  return statuses;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code ?? 0;
  },
  (err) => {
    console.error(`gmnew: ${err.message}`);
    process.exitCode = 1;
  },
);
