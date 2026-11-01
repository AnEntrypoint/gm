#!/usr/bin/env node
// Live comparison runner. Each trial is one interactive Claude Code session, driven through ccbridge in its own
// tmux session and temp project. The arm supplies the MCP server and the skill. Metrics come from the session
// transcript through tools/transcript.mjs, and the checker in tasks/<task>/ grades the workspace.
//
// usage: node tools/live.mjs --arm A --tasks t1,t2,t3 --trials 3 [--concurrency 3] [--port 8810]
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { createConnection } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTurn, readTranscript } from './transcript.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TASKS = join(ROOT, 'tasks');
const RESULTS = join(ROOT, 'runs', 'live');
const AIRC = '/workspace/airc';
const CLAUDE = '/data/cache/node/current/bin/claude';
const SHIM_DIR = join(tmpdir(), 'gmlive-bin');
const PROJECTS = join(homedir(), '.claude', 'projects');
const TURN_TIMEOUT_MS = 30 * 60 * 1000;
// The owner's cap across both arms: at most this many Claude Code sessions run at a time (OAuth rate limits are unknown).
const MAX_CONCURRENCY = 3;
const LOCK = join(ROOT, 'runs', 'live', '.lock');

// Arm A is gm-new: its MCP server and its skill. Arm B (gm) is set up by the gm agent's procedure, and is refused until then.
const ARMS = {
  A: {
    label: 'gm-new',
    skill: 'gm-new',
    skillFile: join(ROOT, 'skills', 'gm-new', 'SKILL.md'),
    server: (project) => ({
      command: 'node',
      args: [join(ROOT, 'src', 'mcp.mjs'), '--workspace', join(project, 'ws'), '--run-dir', join(project, 'run'), '--task', join(project, 'task.md')],
    }),
  },
  B: null,
};

const args = parseArgs(process.argv.slice(2));

async function main() {
  const arm = ARMS[args.arm];
  if (!arm) throw new Error(`arm ${args.arm} is not configured (arm A is gm-new; arm B waits for the gm procedure)`);
  const concurrency = Number(args.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
    throw new Error(`--concurrency must be 1 to ${MAX_CONCURRENCY}, the cap across both arms`);
  }
  const tasks = args.tasks.split(',');
  const jobs = [];
  for (const task of tasks) for (let trial = 1; trial <= Number(args.trials); trial += 1) jobs.push({ task, trial });

  mkdirSync(RESULTS, { recursive: true });
  takeLock();
  ensureShim();
  const server = await ensureServer(Number(args.port));
  const results = [];
  try {
    await pool(jobs, concurrency, async (job) => {
      const result = await runTrial(args.arm, arm, job.task, job.trial, Number(args.port));
      results.push(result);
      console.log(`${result.id}: checker ${result.checker.pass ? 'pass' : 'fail'}, wall ${result.metrics?.wallMs} ms, idle ${result.metrics?.idleMs} ms`);
    });
  } finally {
    if (server) server.kill('SIGTERM');
    rmSync(LOCK, { force: true });
  }
  mkdirSync(RESULTS, { recursive: true });
  const summary = summarize(results);
  writeFileSync(join(RESULTS, `summary-${args.arm}.json`), `${JSON.stringify({ arm: args.arm, results, summary }, null, 2)}\n`);
  printSummary(args.arm, summary);
}

// One batch at a time across both arms. The lock holds the pid of the running batch, and a stale lock is replaced.
function takeLock() {
  if (existsSync(LOCK)) {
    const pid = Number(readFileSync(LOCK, 'utf8'));
    if (alive(pid)) throw new Error(`another live batch is running (pid ${pid}); the cap is one batch at a time`);
  }
  writeFileSync(LOCK, `${process.pid}\n`);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// A single shared shim: it passes this session's own mcp.json, found from the session's working directory.
function ensureShim() {
  mkdirSync(SHIM_DIR, { recursive: true });
  const shim = join(SHIM_DIR, 'claude');
  writeFileSync(shim, `#!/bin/sh\nexec ${CLAUDE} --mcp-config "$PWD/mcp.json" --strict-mcp-config "$@"\n`);
  chmodSync(shim, 0o755);
}

// Starts ccbridge on the port unless one is already listening, and returns the child it started.
async function ensureServer(port) {
  if (await listening(port)) return null;
  const child = spawn('python3', ['-B', 'server.py', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: AIRC,
    env: { ...process.env, PATH: `${SHIM_DIR}:${process.env.PATH}` },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i += 1) {
    if (await listening(port)) return child;
    await sleep(100);
  }
  child.kill('SIGTERM');
  throw new Error(`ccbridge did not listen on ${port}`);
}

function listening(port) {
  return new Promise((done) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => {
      socket.end();
      done(true);
    });
    socket.on('error', () => done(false));
  });
}

async function runTrial(armKey, arm, task, trial, port) {
  const id = `${armKey}-${task}-${trial}-${Math.random().toString(16).slice(2, 8)}`;
  const marker = `trial ${id}`;
  const session = `gmlive${id.replace(/[^A-Za-z0-9]/g, '')}`;
  const project = mkdtempSync(join(tmpdir(), `gmlive-${id}-`));
  const workspace = join(project, 'ws');
  mkdirSync(workspace);
  for (const name of readdirSync(join(TASKS, task))) {
    if (name === 'checker.mjs' || name === 'task.md') continue;
    copyFileSync(join(TASKS, task, name), join(workspace, name));
  }
  copyFileSync(join(TASKS, task, 'task.md'), join(project, 'task.md'));
  writeFileSync(join(project, 'mcp.json'), `${JSON.stringify({ mcpServers: { [arm.label]: arm.server(project) } }, null, 2)}\n`);
  mkdirSync(join(project, '.claude', 'skills', arm.skill), { recursive: true });
  copyFileSync(arm.skillFile, join(project, '.claude', 'skills', arm.skill, 'SKILL.md'));

  const taskText = readFileSync(join(TASKS, task, 'task.md'), 'utf8').trim();
  const prompt = `/${arm.skill} ${taskText} (${marker})`;
  const frames = [];
  const outcome = await converse({ port, session, project, prompt, frames });

  const transcript = findTranscript(project, marker);
  const metrics = transcript ? parseTurn(readTranscript(transcript), marker) : { ok: false, error: 'transcript not found' };
  const checker = grade(task, workspace);

  const dir = join(RESULTS, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'frames.txt'), frames.join('\n') + '\n');
  if (transcript) copyFileSync(transcript, join(dir, 'transcript.jsonl'));
  if (existsSync(join(project, 'run'))) cpSync(join(project, 'run'), join(dir, 'mcp-run'), { recursive: true });
  const result = { id, arm: armKey, task, trial, marker, session, outcome, metrics, checker };
  writeFileSync(join(dir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  rmSync(project, { recursive: true, force: true });
  return result;
}

// Opens the session, answers the trust prompt for this project only, sends the prompt, and waits for the turn end.
async function converse({ port, session, project, prompt, frames }) {
  const url = `ws://127.0.0.1:${port}/ws?session=${session}&harness=claude&cwd=${encodeURIComponent(project)}&mode=tagged&kinds=text,tool,result`;
  const ws = new WebSocket(url);
  let sawTurnEnd;
  let closed;
  const turnEnd = new Promise((done, fail) => {
    sawTurnEnd = done;
    closed = fail;
  });
  turnEnd.catch(() => {}); // an early close is reported when the turn is awaited, not as an unhandled rejection
  ws.onmessage = (event) => {
    const frame = String(event.data);
    frames.push(frame);
    if (frame === 'e:') sawTurnEnd();
    if (frame === '') closed(new Error('session ended before the turn ended'));
  };
  ws.onclose = () => closed(new Error('websocket closed'));
  ws.onerror = () => closed(new Error('websocket error'));
  await new Promise((done, fail) => {
    ws.onopen = done;
    setTimeout(() => fail(new Error('websocket did not open')), 30000);
  });

  await waitForReady(session);
  const started = Date.now();
  ws.send(prompt);
  let ended = true;
  const timeout = new Promise((_, fail) => setTimeout(() => fail(new Error('turn timed out')), TURN_TIMEOUT_MS));
  try {
    await Promise.race([turnEnd, timeout]);
  } catch (err) {
    ended = false;
    frames.push(`[${err.message}]`);
  }
  if (ended) {
    ws.send('/exit');
    await sleep(3000);
  }
  ws.close();
  tmux(['kill-session', '-t', `ccb-${session}`], true);
  return { ended, prompt_sent_ms: started, ended_ms: Date.now() };
}

// Waits for the session pane to show the input prompt, and answers the trust prompt once if it is shown.
async function waitForReady(session) {
  const target = `ccb-${session}`;
  let trusted = false;
  for (let i = 0; i < 600; i += 1) {
    const pane = tmux(['capture-pane', '-p', '-t', target], true);
    if (!trusted && pane.includes('Yes, I trust this folder')) {
      tmux(['send-keys', '-t', target, 'Down'], true);
      tmux(['send-keys', '-t', target, 'Enter'], true);
      trusted = true;
    } else if (pane.includes('shift+tab to cycle')) {
      return;
    }
    await sleep(200);
  }
  throw new Error(`session ${session} never became ready`);
}

function findTranscript(project, marker) {
  const dashed = project.replace(/[^A-Za-z0-9]/g, '-');
  const dir = join(PROJECTS, dashed);
  if (!existsSync(dir)) return null;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue;
    const file = join(dir, name);
    if (readFileSync(file, 'utf8').includes(marker)) return file;
  }
  return null;
}

function grade(task, workspace) {
  try {
    const out = execFileSync('node', [join(TASKS, task, 'checker.mjs'), workspace], { encoding: 'utf8' });
    return JSON.parse(out);
  } catch (err) {
    const out = err.stdout?.toString().trim();
    if (out) return JSON.parse(out);
    return { pass: false, detail: `checker failed: ${err.message}` };
  }
}

function tmux(argv, quiet = false) {
  try {
    return execFileSync('tmux', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) {
    if (quiet) return '';
    throw err;
  }
}

function summarize(results) {
  const byTask = {};
  for (const result of results) {
    if (!result.metrics?.ok) continue;
    const bucket = (byTask[result.task] ??= []);
    bucket.push({ ...result.metrics, pass: result.checker.pass });
  }
  const out = {};
  for (const [task, rows] of Object.entries(byTask)) {
    out[task] = {
      trials: rows.length,
      passRate: rows.filter((row) => row.pass).length / rows.length,
      wallMs: stat(rows.map((row) => row.wallMs)),
      idleMs: stat(rows.map((row) => row.idleMs)),
      toolMs: stat(rows.map((row) => row.toolMs)),
      modelMs: stat(rows.map((row) => row.modelMs)),
      toolCalls: stat(rows.map((row) => row.toolCalls)),
      mcpToolCalls: stat(rows.map((row) => row.mcpToolCalls)),
    };
  }
  return out;
}

// Median and spread (min to max) of a list of numbers.
function stat(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { median, min: sorted[0], max: sorted[sorted.length - 1] };
}

function printSummary(arm, summary) {
  console.log(`arm ${arm}`);
  for (const [task, row] of Object.entries(summary)) {
    console.log(`${task}: trials ${row.trials}, pass ${(row.passRate * 100).toFixed(0)}%, wall median ${row.wallMs.median} ms (${row.wallMs.min} to ${row.wallMs.max}), idle median ${row.idleMs.median} ms, tool calls median ${row.toolCalls.median} (MCP ${row.mcpToolCalls.median})`);
  }
}

function parseArgs(argv) {
  const out = { arm: 'A', tasks: 't1,t2,t3', trials: '3', concurrency: '3', port: '8810' };
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i].replace(/^--/, '');
    if (!(name in out)) throw new Error(`unknown option --${name}`);
    out[name] = argv[i + 1];
  }
  return out;
}

async function pool(items, size, work) {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, size) }, async () => {
    while (queue.length > 0) await work(queue.shift());
  });
  await Promise.all(workers);
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

main().catch((err) => {
  console.error(`live: ${err.message}`);
  process.exitCode = 1;
});
