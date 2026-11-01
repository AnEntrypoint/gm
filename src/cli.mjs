#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLoop } from './loop.mjs';
import { createModel } from './models.mjs';
import { openLog, readEvents, runQuery } from './log.mjs';
import { DEFAULT_RULES, DEFAULT_WITNESS } from './prompt.mjs';
import { createTools } from './tools.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNS = join(ROOT, 'runs');
const USAGE = `usage:
  gmnew run --task <file-or-text> --workspace <dir> [--model scripted|anthropic] [--max-steps N]
            [--script <replies.json>] [--serial] [--no-background]
  gmnew query --run <id> --js "<filter>"`;

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'run') return run(parseFlags(rest));
  if (command === 'query') return query(parseFlags(rest));
  console.error(USAGE);
  return 2;
}

async function run(flags) {
  if (!flags.task) throw new Error('--task is required');
  if (!flags.workspace) throw new Error('--workspace is required');
  const workspace = resolve(flags.workspace);
  if (!isDirectory(workspace)) throw new Error(`workspace is not a directory: ${workspace}`);
  const maxSteps = Number(flags['max-steps'] ?? 50);
  if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new Error('--max-steps must be a positive integer');
  const modelName = flags.model ?? 'scripted';
  const script = flags.script === undefined ? undefined : loadScript(flags.script);
  if (script && modelName !== 'scripted') throw new Error('--script works only with --model scripted');
  const model = createModel(modelName, { script });
  const serial = flags.serial === true;
  const background = flags['no-background'] !== true;

  const task = loadTask(flags.task).trim();
  if (task === '') throw new Error('--task is empty');
  const spec = { task, witness: DEFAULT_WITNESS };

  const id = newRunId();
  const runDir = join(RUNS, id);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'rules.md'), DEFAULT_RULES);
  const options = { serial, background, script: flags.script === undefined ? null : resolve(flags.script) };
  writeFileSync(
    join(runDir, 'task.json'),
    `${JSON.stringify({ id, ...spec, workspace, model: modelName, maxSteps, ...options, createdAt: new Date().toISOString() }, null, 2)}\n`,
  );

  const log = openLog(join(runDir, 'log.jsonl'));
  const tools = createTools({ workspace, runDir, log, background });
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

const BOOLEAN_FLAGS = new Set(['serial', 'no-background']);

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

function loadTask(value) {
  const path = resolve(value);
  if (isFile(path)) return readFileSync(path, 'utf8');
  return value;
}

function newRunId() {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `${stamp}-${randomBytes(3).toString('hex')}`;
}

function isDirectory(path) {
  return existsSync(path) && statSync(path).isDirectory();
}

function isFile(path) {
  return existsSync(path) && statSync(path).isFile();
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
