#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';

const CHECK = 'restart-skill-read-check';
const target = process.argv[2] ?? null;
const worker = target === null ? null : join(dirname(resolve(target)), process.platform === 'win32' ? 'gm-core.exe' : 'gm-core');
if (worker === null || !existsSync(worker)) {
  console.error(`${CHECK}: usage: node tools/check-restart-skill-read.mjs <path-to-native-binary> (gm-core is read from the same directory)`);
  process.exit(2);
}
const REPLY_MS = 120000;
const SKILL = 'skill://gm/SKILL.md';
const OTHER_HOST = "const child = require('node:child_process').spawn(process.argv[1], process.argv.slice(2), { stdio: 'inherit' }); child.on('exit', (code) => process.exit(code ?? 0));";

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const openWorker = (args, { throughOtherHost = false } = {}) => {
  const child = throughOtherHost ? spawn(process.execPath, ['-e', OTHER_HOST, worker, ...args], { stdio: ['pipe', 'pipe', 'pipe'] }) : spawn(worker, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stdin.on('error', () => {});
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + String(chunk)).slice(-2000);
  });
  let exited = false;
  const pending = new Map();
  child.once('exit', () => {
    exited = true;
    for (const done of pending.values()) done(null);
    pending.clear();
  });
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  let nextId = 1;
  const rpc = (method, params) =>
    new Promise((done) => {
      if (exited) {
        done(null);
        return;
      }
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        done(null);
      }, REPLY_MS);
      pending.set(id, (message) => {
        clearTimeout(timer);
        done(message);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  const connect = async () => {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CHECK, version: '1' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    return init?.result !== undefined;
  };
  const toolReply = (name, toolArgs) => rpc('tools/call', { name, arguments: toolArgs });
  const tool = async (name, toolArgs) => (await toolReply(name, toolArgs))?.result?.structuredContent ?? {};
  const close = async () => {
    const gone = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit');
    child.stdin.end();
    await Promise.race([gone, sleep(3000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await Promise.race([gone, sleep(5000)]);
  };
  return { rpc, connect, tool, toolReply, close, stderr: () => stderr.trim() || '(empty)' };
};

const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
const short = (value) => JSON.stringify(value ?? null).slice(0, 300);

const scratch = mkdtempSync(join(tmpdir(), 'gm-restart-skill-read-'));
try {
  const workspace = mkdtempSync(join(scratch, 'ws-'));
  const runDir = join(workspace, 'run');
  const quiet = join(scratch, 'quiet-mcp.json');
  writeFileSync(quiet, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
  const args = ['worker', '--mcp-config', quiet, '--workspace', workspace, '--run-dir', runDir, '--supervised', 'yes', '--owner', String(process.pid)];
  const restartEvents = () =>
    readFileSync(join(runDir, 'log.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line))
      .filter((event) => event.kind === 'restart');

  const first = openWorker(args);
  try {
    expect(await first.connect(), `the first worker did not answer initialize (stderr ${first.stderr()})`);
    const read = await first.rpc('resources/read', { uri: SKILL });
    expect(typeof read?.result?.contents?.[0]?.text === 'string', `the skill read failed: ${short(read)}`);
    const step = await first.tool('next_context', {});
    expect(step.ok === true, `next_context failed: ${short(step)}`);
    const ran = await first.tool('run_code', { body: 'return 1' });
    expect(ran.ok === true, `run_code after the skill read failed: ${short(ran)}`);
  } finally {
    await first.close();
  }

  const restarted = openWorker(args);
  try {
    expect(await restarted.connect(), `the restarted worker did not answer initialize (stderr ${restarted.stderr()})`);
    const ran = await restarted.tool('run_code', { body: 'return 2' });
    expect(ran.ok === true && ran.output === '2', `a worker restarted under the same host, with no replayed skill read, did not run run_code: ${short(ran)}`);
    const restarts = restartEvents();
    expect(restarts.length === 1 && restarts[0].skillRead === true, `the restart event does not carry skillRead true: ${short(restarts)}`);
  } finally {
    await restarted.close();
  }

  const underOtherHost = openWorker(args, { throughOtherHost: true });
  try {
    expect(await underOtherHost.connect(), `the worker under another host did not answer initialize (stderr ${underOtherHost.stderr()})`);
    const refusal = (await underOtherHost.toolReply('run_code', { body: 'return 3' }))?.result ?? {};
    const skillBlock = refusal.content?.[1]?.text;
    expect(refusal.structuredContent?.ok === false && typeof skillBlock === 'string' && skillBlock.length > 0, `a worker under another host process ran run_code without delivering the skill: ${short(refusal.structuredContent)}`);
    const restarts = restartEvents();
    expect(restarts.length === 2 && restarts[1].skillRead === false, `the second restart event does not carry skillRead false: ${short(restarts)}`);
    const ran = await underOtherHost.tool('run_code', { body: 'return 4' });
    expect(ran.ok === true && ran.output === '4', `run_code after the one refusal did not run: ${short(ran)}`);
  } finally {
    await underOtherHost.close();
  }

  if (failures.length) {
    console.error(`${CHECK}: ${failures.length} failure(s) on ${target}\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log(`${CHECK}: ok (${target}: a worker restarted under the same host process runs run_code with no replayed skill read and logs restart skillRead true; under another host process the first run_code is refused once with the skill text)`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
process.exit(process.exitCode ?? 0);
