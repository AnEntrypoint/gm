#!/usr/bin/env node
// Live comparison runner. Each trial is one interactive Claude Code session, driven through ccbridge in its own
// tmux session and temp project. The arm supplies its MCP server and its prompt. Metrics come from the session
// transcript through tools/transcript.mjs, and the checker in tasks/<task>/ grades the workspace.
//
// usage: node tools/live.mjs --arm A --tasks t1,t2,t3 --trials 3 [--concurrency 3] [--port 8810]
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs';
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
const QUIET_MS = 20000; // frames must be quiet this long before the turn is read as finished
const SUBMIT_CHECK_MS = 8000; // if the prompt is not in the transcript by then, a slash command is stuck in the input
const SUBMIT_ABORT_MS = 150000; // a prompt that never reaches the transcript ends the trial, with the pane kept for diagnosis
const MCP_SETTLE_MS = 15000; // MCP servers connect after the input box appears; a slash command sent before that is unknown
const RESEND_MS = 15000; // wait before resending a slash command that Claude did not know
const MAX_SENDS = 4;
const STAGGER_MS = 8000; // gap between trial starts, so sessions do not all start in the same second
const TRUST_RETRY_MS = 3000; // while the trust dialog stays on screen, Down and Enter are sent again this often
const MAX_ATTEMPTS = 2; // a trial whose session dies or never becomes ready is tried once more
const RETRY_GAP_MS = 10000;
// The cap across both arms: at most this many Claude Code sessions run at a time. The gm agent lowered it from 3 to 1
// on 2026-11-01, because the machine was saturated. It rises back only once the runner's concurrency cap is committed
// and the 1-minute load average is under 6 (see DESIGN.md).
const MAX_CONCURRENCY = 1;
const LOCK = join(ROOT, 'runs', 'live', '.lock');
// gm-created state that the gm runner leaves in the workspace; removed after every trial.
const GM_STATE = ['.gm', '.agentplug'];

// Arm A is gm-new: its MCP server and its skill, copied into the project. Arm B is gm: its MCP server, and its skill is
// the served prompt /mcp__gm__gm, so nothing is copied. Both arms get the same task text.
const ARMS = {
  A: {
    label: 'gm-new',
    command: '/gm-new',
    skill: { name: 'gm-new', file: join(ROOT, 'skills', 'gm-new', 'SKILL.md') },
    server: (project) => ({
      command: 'node',
      args: [join(ROOT, 'src', 'mcp.mjs'), '--workspace', join(project, 'ws'), '--run-dir', join(project, 'run'), '--task', join(project, 'task.md')],
    }),
  },
  B: {
    label: 'gm',
    command: '/mcp__gm__gm',
    skill: null,
    server: () => ({ command: 'node', args: ['/config/.gm-tools/gm-mcp-server.mjs'] }),
  },
};

const args = parseArgs(process.argv.slice(2));

async function main() {
  const arm = ARMS[args.arm];
  if (!arm) throw new Error(`arm ${args.arm} is not configured`);
  const concurrency = Number(args.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
    throw new Error(`--concurrency must be 1 to ${MAX_CONCURRENCY}, the cap across both arms`);
  }
  const jobs = [];
  for (const task of args.tasks.split(',')) {
    for (let trial = 1; trial <= Number(args.trials); trial += 1) {
      jobs.push({ task, trial, id: `${args.arm}-${task}-${trial}-${Math.random().toString(16).slice(2, 8)}` });
    }
  }

  mkdirSync(RESULTS, { recursive: true });
  if (args.resume === 'true') {
    const done = validTrials(args.arm);
    for (let i = jobs.length - 1; i >= 0; i -= 1) if (done.has(`${jobs[i].task}-${jobs[i].trial}`)) jobs.splice(i, 1);
    console.log(`resume: ${done.size} valid trials kept, ${jobs.length} to run`);
  }
  takeLock();
  let server = null;
  const results = [];
  try {
    ensureShim();
    server = await ensureServer(Number(args.port));
    // Trials start STAGGER_MS apart, so sessions do not all start in the same second. A failed trial is recorded, and the batch goes on.
    let lastStart = 0;
    await pool(jobs, concurrency, async (job) => {
      const wait = lastStart + STAGGER_MS - Date.now();
      lastStart = Math.max(Date.now(), lastStart + STAGGER_MS);
      if (wait > 0) await sleep(wait);
      // A session that dies or never becomes ready gets one more attempt, since the machine is shared and that failure is transient.
      let result;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          result = await runTrial(args.arm, arm, job.task, job.trial, job.id, Number(args.port));
          break;
        } catch (err) {
          result = { id: job.id, arm: args.arm, task: job.task, trial: job.trial, attempts: attempt, error: err.message, metrics: { ok: false, error: err.message }, checker: { pass: false, detail: 'trial did not run' } };
          mkdirSync(join(RESULTS, job.id), { recursive: true });
          writeFileSync(join(RESULTS, job.id, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
          if (attempt < MAX_ATTEMPTS) await sleep(RETRY_GAP_MS);
        }
      }
      results.push(result);
      if (result.error) console.log(`${result.id}: failed: ${result.error}`);
      else console.log(`${result.id}: checker ${result.checker.pass ? 'pass' : 'fail'}, wall ${result.metrics?.wallMs} ms, idle ${result.metrics?.idleMs} ms`);
    });
  } finally {
    if (server) process.kill(server, 'SIGTERM');
    rmSync(LOCK, { force: true });
  }
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

// Starts ccbridge with setsid and nohup, unless one already listens, and returns the pid found by its command line.
// The wrapper pid is not used, because setsid can fork.
async function ensureServer(port) {
  if (await listening(port)) return null;
  spawn('setsid', ['nohup', 'python3', '-B', 'server.py', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: AIRC,
    env: { ...process.env, PATH: `${SHIM_DIR}:${process.env.PATH}` },
    stdio: 'ignore',
  }).unref();
  for (let i = 0; i < 100; i += 1) {
    if (await listening(port)) return serverPid(port);
    await sleep(100);
  }
  throw new Error(`ccbridge did not listen on ${port}`);
}

function serverPid(port) {
  const needle = `python3 -B server.py --host 127.0.0.1 --port ${port}`;
  for (const line of execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' }).split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (match && match[2].trim() === needle) return Number(match[1]);
  }
  throw new Error(`ccbridge is listening on ${port} but its pid was not found`);
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

async function runTrial(armKey, arm, task, trial, id, port) {
  const marker = `trial ${id}`;
  const session = `gmlive${id.replace(/[^A-Za-z0-9]/g, '')}`;
  const dir = join(RESULTS, id);
  mkdirSync(dir, { recursive: true });
  const project = mkdtempSync(join(tmpdir(), `gmlive-${id}-`));
  const workspace = join(project, 'ws');
  mkdirSync(workspace);
  for (const name of readdirSync(join(TASKS, task))) {
    if (name === 'checker.mjs' || name === 'task.md') continue;
    copyFileSync(join(TASKS, task, name), join(workspace, name));
  }
  copyFileSync(join(TASKS, task, 'task.md'), join(project, 'task.md'));
  writeFileSync(join(project, 'mcp.json'), `${JSON.stringify({ mcpServers: { [arm.label]: arm.server(project) } }, null, 2)}\n`);
  if (arm.skill) {
    mkdirSync(join(project, '.claude', 'skills', arm.skill.name), { recursive: true });
    copyFileSync(arm.skill.file, join(project, '.claude', 'skills', arm.skill.name, 'SKILL.md'));
  }
  const filesBefore = countFiles(workspace);

  const taskText = readFileSync(join(TASKS, task, 'task.md'), 'utf8').trim();
  const prompt = `${arm.command} ${taskText} The workspace is ${workspace}. (${marker})`;
  const framesFile = join(dir, 'frames.txt');
  writeFileSync(framesFile, '');
  const outcome = await converse({ port, session, project, marker, prompt, framesFile, dir, command: arm.command });

  const transcript = findTranscript(project, marker);
  const metrics = transcript ? parseTurn(readTranscript(transcript), marker) : { ok: false, error: 'transcript not found' };
  const checker = grade(task, workspace);
  const filesAfterRun = countFiles(workspace);
  const removed = GM_STATE.filter((name) => existsSync(join(workspace, name)));
  for (const name of removed) rmSync(join(workspace, name), { recursive: true, force: true });

  if (transcript) copyFileSync(transcript, join(dir, 'transcript.jsonl'));
  if (existsSync(join(project, 'run'))) cpSync(join(project, 'run'), join(dir, 'mcp-run'), { recursive: true });
  const result = {
    id,
    arm: armKey,
    task,
    trial,
    marker,
    session,
    outcome,
    metrics,
    checker,
    workspaceFiles: { before: filesBefore, afterRun: filesAfterRun, afterCleanup: countFiles(workspace), removed },
  };
  writeFileSync(join(dir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  rmSync(project, { recursive: true, force: true });
  return result;
}

// Opens the session and logs every frame to a file as it arrives. Answers the trust prompt for this project only,
// sends the prompt, and presses Enter once if the prompt stays in the input box. The turn counts as finished only
// when the transcript holds its end_turn and the frames have gone quiet, since the reply can come after the first e:.
async function converse({ port, session, project, marker, prompt, framesFile, dir, command }) {
  const url = `ws://127.0.0.1:${port}/ws?session=${session}&harness=claude&cwd=${encodeURIComponent(project)}&mode=tagged&kinds=text,tool,result`;
  const ws = new WebSocket(url);
  let closed = false;
  let lastFrameAt = Date.now();
  let frameCount = 0;
  ws.onmessage = (event) => {
    const frame = String(event.data);
    frameCount += 1;
    lastFrameAt = Date.now();
    appendFileSync(framesFile, `${frame}\n`);
    if (frame === '') closed = true;
  };
  ws.onclose = () => {
    closed = true;
  };
  await new Promise((done, fail) => {
    ws.onopen = done;
    ws.onerror = () => fail(new Error('websocket error'));
    setTimeout(() => fail(new Error('websocket did not open')), 30000);
  });

  await waitForReady(session, dir);
  // MCP servers connect after the input box appears. A slash command sent before that is "Unknown command", so resend it.
  await sleep(MCP_SETTLE_MS);
  writeFileSync(join(dir, 'pane-ready.txt'), tmux(['capture-pane', '-p', '-t', `ccb-${session}`], true));
  const sentAt = Date.now();
  let lastSendAt = sentAt;
  let sends = 0;
  const send = () => {
    ws.send(prompt);
    sends += 1;
    lastSendAt = Date.now();
  };
  send();
  let enterPressed = false;
  let finished = false;
  let abort = null;
  while (Date.now() - sentAt < TURN_TIMEOUT_MS) {
    await sleep(2000);
    const pane = tmux(['capture-pane', '-p', '-t', `ccb-${session}`], true);
    writeFileSync(join(dir, 'pane.txt'), pane);
    const file = findTranscript(project, marker);
    const records = file === null ? [] : readTranscript(file);
    if (unknownCommandSince(records, command, lastSendAt)) {
      if (sends >= MAX_SENDS) {
        abort = `${command} stayed unknown after ${sends} sends`;
        break;
      }
      await sleep(RESEND_MS);
      send();
      continue;
    }
    const prompted = hasPrompt(records, marker);
    if (!prompted && !enterPressed && Date.now() - lastSendAt > SUBMIT_CHECK_MS && inInputLine(pane, marker)) {
      tmux(['send-keys', '-t', `ccb-${session}`, 'Enter'], true);
      enterPressed = true;
    }
    if (!prompted && Date.now() - lastSendAt > SUBMIT_ABORT_MS) {
      abort = 'the prompt never reached the session transcript';
      break;
    }
    const turnDone = prompted && parseTurn(records, marker).ok === true;
    if (turnDone && Date.now() - lastFrameAt > QUIET_MS) {
      finished = true;
      break;
    }
    if (closed) break;
  }
  if (!closed) {
    ws.send('/exit');
    await sleep(3000);
    if (tmux(['capture-pane', '-p', '-t', `ccb-${session}`], true).includes('shift+tab to cycle')) {
      tmux(['send-keys', '-t', `ccb-${session}`, 'Enter'], true);
    }
  }
  ws.close();
  tmux(['kill-session', '-t', `ccb-${session}`], true);
  return { finished, abort, sends, frames: frameCount, sentAt, endedAt: Date.now(), closedEarly: closed };
}

// Waits for the session pane to show the input prompt, and answers the trust prompt once if it is shown.
async function waitForReady(session, dir) {
  const target = `ccb-${session}`;
  let lastTrustKeys = 0;
  for (let i = 0; i < 600; i += 1) {
    const pane = tmux(['capture-pane', '-p', '-t', target], true);
    writeFileSync(join(dir, 'pane-wait.txt'), pane);
    if (pane.includes('Yes, I trust this folder')) {
      // The keys can land before the dialog takes input, so they are sent again while the dialog stays on screen.
      if (Date.now() - lastTrustKeys > TRUST_RETRY_MS) {
        tmux(['send-keys', '-t', target, 'Down'], true);
        tmux(['send-keys', '-t', target, 'Enter'], true);
        lastTrustKeys = Date.now();
      }
    } else if (pane.includes('shift+tab to cycle')) {
      return;
    }
    await sleep(500);
  }
  throw new Error(`session ${session} never became ready; the last pane is in ${dir}/pane-wait.txt`);
}

// True when the trial's prompt sits on the input line, so it was typed but not submitted.
function inInputLine(pane, marker) {
  return pane.split('\n').some((line) => line.includes('\u276f') && line.includes(marker));
}

// True when Claude answered "Unknown command" for the slash command, at or after the last send.
function unknownCommandSince(records, command, since) {
  return records.some(
    (r) => r.type === 'system' && typeof r.content === 'string' && r.content.startsWith(`Unknown command: ${command}`) && Date.parse(r.timestamp) >= since - 2000,
  );
}

// True when a user record carries the trial's marker, which means Claude took the prompt.
function hasPrompt(records, marker) {
  return records.some(
    (r) =>
      r.type === 'user' &&
      typeof r.timestamp === 'string' &&
      JSON.stringify(r.message?.content ?? '').includes(marker) &&
      !(Array.isArray(r.message?.content) && r.message.content.some((b) => b.type === 'tool_result')),
  );
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

// Number of files under a directory, counting nested files. Symlinks are counted as files.
function countFiles(dir) {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) count += countFiles(join(dir, entry.name));
    else count += 1;
  }
  return count;
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

// Keys (task-trial) of this arm's trials that ran and got metrics, so a resumed batch does not run them again.
function validTrials(arm) {
  const done = new Set();
  for (const name of readdirSync(RESULTS)) {
    const file = join(RESULTS, name, 'result.json');
    if (!name.startsWith(`${arm}-`) || !existsSync(file)) continue;
    const result = JSON.parse(readFileSync(file, 'utf8'));
    if (!result.error && result.metrics?.ok === true) done.add(`${result.task}-${result.trial}`);
  }
  return done;
}

function parseArgs(argv) {
  const out = { arm: 'A', tasks: 't1,t2,t3', trials: '3', concurrency: '1', port: '8810', resume: 'false' };
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
