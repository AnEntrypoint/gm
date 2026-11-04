#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { runLoop } from './loop.mjs';
import { createModel } from './models.mjs';
import { readEvents, runQuery } from './log.mjs';
import { clearPending, takePending } from './pending.mjs';
import { buildPrompt, DEFAULT_RULES, DEFAULT_WITNESS } from './prompt.mjs';
import { createTools } from './tools.mjs';
import { createRun, isDirectory, loadTask, newRunId, RUNS } from './run.mjs';
import { registrationStatus } from './registration.mjs';
import { writeSummary } from './summary.mjs';

const USAGE = `usage:
  gmnew run --task <file-or-text> --workspace <dir> [--model scripted] [--max-steps N]
            [--script <replies.json>] [--faults 429,429] [--serial] [--no-background]
            [--latency-ms N] [--overlap]
  gmnew query (--run <id> | --dir <run dir>) --js "<filter>"
  gmnew events (--run <id> | --dir <run dir>) (--read-clear | --wait [--timeout-ms N])
  gmnew replay (--run <id> | --dir <run dir>) [--workspace <dir>] [--max-steps N]
  gmnew doctor [--workspace <dir>]`;

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'run') return run(parseFlags(rest));
  if (command === 'query') return query(parseFlags(rest));
  if (command === 'events') return events(parseFlags(rest));
  if (command === 'replay') return replay(parseFlags(rest));
  if (command === 'doctor') return doctor(parseFlags(rest));
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
  const faults = flags.faults === undefined ? undefined : parseFaults(flags.faults);
  if (faults && modelName !== 'scripted') throw new Error('--faults works only with --model scripted');
  if (flags['latency-ms'] !== undefined && modelName !== 'scripted') throw new Error('--latency-ms works only with --model scripted');
  const latencyMs = flags['latency-ms'] === undefined ? 0 : parseLatency(flags['latency-ms']);
  const model = createModel(modelName, { script, faults, latencyMs });
  const serial = flags.serial === true;
  const background = flags['no-background'] !== true;
  const overlap = flags.overlap === true;

  const task = loadTask(flags.task).trim();
  if (task === '') throw new Error('--task is empty');
  const spec = { task, witness: DEFAULT_WITNESS };

  const id = newRunId();
  const runDir = join(workspace, 'runs', id);
  const options ={ serial, background, overlap, latencyMs, script: flags.script === undefined ? null : resolve(flags.script), faults: faults ?? null };
  const log = createRun({
    runDir,
    rules: DEFAULT_RULES,
    meta: { id, ...spec, workspace, model: modelName, maxSteps, ...options, createdAt: new Date().toISOString() },
  });
  const tools = createTools({ workspace, runDir, log, background });
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    process.once(signal, () => {
      tools.killAllNow();
      writeSummary(log);
      log.append('end', { status: 'interrupted', signal });
      process.exit(code);
    });
  }
  const result = await runLoop({ runDir, spec, model, tools, log, maxSteps, serial, latencyMs, overlap });

  console.log(`run ${id}: ${result.status} after ${result.steps} steps`);
  if (result.witness) console.log(`witness: ${result.witness}`);
  if (latencyMs > 0) console.log(`simulated latency ${latencyMs} ms: each scripted reply and action waited this long; those events carry simulatedMs`);
  console.log(`log: ${join(runDir, 'log.jsonl')}`);
  return result.status === 'finished' ? 0 : 1;
}

async function replay(flags) {
  const source = runDirOf(flags);
  const sourceId = basename(source);
  const meta = JSON.parse(readFileSync(join(source, 'task.json'), 'utf8'));
  const replies = readEvents(join(source, 'log.jsonl')).filter((event) => event.kind === 'reply').map((event) => event.text);
  if (replies.length === 0) throw new Error(`run ${flags.run} has no reply events to replay`);
  const workspace = resolve(flags.workspace ?? meta.workspace);
  if (!isDirectory(workspace)) throw new Error(`workspace is not a directory: ${workspace}`);
  const maxSteps = Number(flags['max-steps'] ?? meta.maxSteps ?? 50);
  const spec = { task: meta.task, witness: meta.witness ?? DEFAULT_WITNESS };
  const model = createModel('scripted', { script: replies });

  const id = newRunId();
  const runDir = join(workspace, 'runs', id);
  const log = createRun({ runDir, rules: DEFAULT_RULES, meta: { id, ...spec, workspace, model: 'scripted', maxSteps, replayOf: sourceId, createdAt: new Date().toISOString() } });
  const append = log.append;
  log.append = (kind, data, at) => append(kind, { replayOf: sourceId, ...data }, at);
  const tools = createTools({ workspace, runDir, log, background: true });
  const result = await runLoop({ runDir, spec, model, tools, log, maxSteps, serial: false, latencyMs: 0, overlap: false });

  console.log(`run ${id}: ${result.status} after ${result.steps} steps, replay of ${sourceId}`);
  if (result.witness) console.log(`witness: ${result.witness}`);
  console.log(`log: ${join(runDir, 'log.jsonl')}`);
  return result.status === 'finished' ? 0 : 1;
}

async function events(flags) {
  if (flags['read-clear'] !== true && flags.wait !== true) throw new Error('events takes --read-clear, which prints the pending events once and clears them, or --wait');
  const dir = runDirOf(flags);
  const waiting = flags.wait === true;
  const timeout = waiting ? timeoutMs(flags) : 0;
  const signals = [];
  if (waiting) {
    for (const signal of Object.keys(SIGNAL_EXIT)) process.on(signal, () => signals.push(signal));
  }
  const started = performance.now();
  let taken = takePending(dir);
  while (taken.records.length === 0 && waiting && signals.length === 0 && performance.now() - started < timeout) {
    clearPending(taken.files);
    await sleep(POLL_MS);
    taken = takePending(dir);
  }
  if (taken.records.length > 0) {
    await writeOut(taken.records.map((record) => `${JSON.stringify(record)}\n`).join(''));
    clearPending(taken.files);
    return 0;
  }
  clearPending(taken.files);
  if (signals.length > 0) {
    await writeOut(`events: stopped by ${signals[0]} with no event pending\n`);
    return SIGNAL_EXIT[signals[0]];
  }
  if (waiting) await writeOut(`events: timed out after ${timeout} ms with no event pending\n`);
  return 0;
}

function runDirOf(flags) {
  if (flags.dir !== undefined) {
    const dir = resolve(flags.dir);
    if (!isDirectory(dir)) throw new Error(`no run directory ${dir}`);
    return dir;
  }
  if (!flags.run || !/^[A-Za-z0-9_-]+$/.test(flags.run)) throw new Error('--run <id> or --dir <run dir> is required');
  const dir = join(RUNS, flags.run);
  if (!isDirectory(dir)) throw new Error(`no run ${flags.run}`);
  return dir;
}

function timeoutMs(flags) {
  const ms = Number(flags['timeout-ms'] ?? 1800000);
  if (!Number.isInteger(ms) || ms < 1) throw new Error('--timeout-ms must be a positive integer');
  return ms;
}

const POLL_MS = 200;
const SIGNAL_EXIT = { SIGINT: 130, SIGTERM: 143 };
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function writeOut(text) {
  return new Promise((done, fail) => {
    process.stdout.write(text, (err) => (err ? fail(err) : done()));
  });
}

function query(flags) {
  if (flags.js === undefined) throw new Error('--js "<filter>" is required');
  const file = join(runDirOf(flags), 'log.jsonl');
  if (!existsSync(file)) throw new Error(`no log at ${file}`);
  const result = runQuery(readEvents(file), flags.js);
  if (!result.ok) throw new Error(`query failed: ${result.error}`);
  console.log(result.output);
}

function doctor(flags) {
  const workspace = resolve(flags.workspace ?? process.cwd());
  const nodeOk = Number(process.versions.node.split('.')[0]) >= 22;
  console.log(`node ${process.version}: ${nodeOk ? 'ok' : 'fail, Node 22 or newer is required'}`);
  const writable = probeWritable(workspace);
  console.log(`workspace ${workspace}: ${writable.ok ? 'writable' : `not writable (${writable.error})`}`);
  console.log(lastRunSummary());
  const registration = registrationStatus();
  console.log(registration.text);
  console.log('limits: the Node-below-22 failure path has no live run; run_shell is unconfined, so a shell command can hard-link a file from outside the workspace; the process-group kill is unverified on Windows');
  return nodeOk && writable.ok && registration.ok ? 0 : 1;
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
  const runs = [RUNS, join(RUNS, 'self')]
    .filter((dir) => isDirectory(dir))
    .flatMap((dir) => readdirSync(dir)
      .filter((name) => /^\d{4}(-\d{2}){5}-[0-9a-f]{6}$/.test(name) && existsSync(join(dir, name, 'log.jsonl')))
      .map((name) => ({ id: name, file: join(dir, name, 'log.jsonl') })))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (runs.length === 0) return 'last run: none';
  const { id, file } = runs.at(-1);
  const events = readEvents(file);
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

const BOOLEAN_FLAGS = new Set(['serial', 'no-background', 'overlap', 'read-clear', 'wait']);

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

function parseLatency(value) {
  if (!/^\d+$/.test(value)) throw new Error('--latency-ms takes a whole number of milliseconds, 0 or more');
  return Number(value);
}

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
