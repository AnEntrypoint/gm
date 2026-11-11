#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import readline from 'node:readline';

const CHECK = 'check-cancel-wait';
const binary = resolve(process.argv[2] ?? 'build/release/native/components/host/gm');
const started = Date.now();
const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
const sandbox = mkdtempSync(join(tmpdir(), 'gm-cancel-wait-'));
const workspace = join(sandbox, 'ws');
mkdirSync(workspace);
const quiet = join(sandbox, 'quiet.json');
writeFileSync(quiet, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
const relay = spawn(binary, ['serve', '--workspace', workspace, '--run-dir', join(workspace, 'runs', 'cw'), '--mcp-config', quiet], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HOME: sandbox } });
relay.stdin.on('error', () => {});
relay.stderr.resume();
const replies = new Map();
const seen = [];
let nextId = 1;
readline.createInterface({ input: relay.stdout }).on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id !== undefined) {
    seen.push({ id: message.id, at: Date.now() });
    replies.set(message.id, { message, at: Date.now() });
  }
});
const send = (method, params) => {
  const id = nextId++;
  relay.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return id;
};
const until = async (test, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test()) return true;
    await new Promise((done) => setTimeout(done, 25));
  }
  return test();
};
const eventsOf = (message) => {
  const text = message?.result?.content?.[0]?.text ?? '{}';
  try {
    return JSON.parse(text).events ?? [];
  } catch {
    return [];
  }
};
const jobEvents = (message) => {
  let parsed = {};
  try {
    parsed = JSON.parse(message?.result?.content?.[0]?.text ?? "{}");
  } catch {
    return [];
  }
  return (parsed.pending ?? []).filter((entry) => entry.kind === "job" && entry.job === "cw-job");
};

try {
  const init = send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CHECK, version: '1' } });
  await until(() => replies.has(init), 20000);
  relay.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const skill = send('resources/read', { uri: 'skill://gm/SKILL.md' });
  await until(() => replies.has(skill), 20000);
  const first = send('tools/call', { name: 'next_context', arguments: {} });
  await until(() => replies.has(first), 20000);
  const job = send('tools/call', { name: 'run_code', arguments: { body: "return await gm.job_start({ job: 'cw-job', command: 'sleep 2; echo done', timeoutMs: 60000 });" } });
  await until(() => replies.has(job), 20000);
  const waitStart = Date.now();
  const waitId = send('tools/call', { name: 'next_context', arguments: { waitMs: 30000 } });
  await new Promise((done) => setTimeout(done, 500));
  const cancelAt = Date.now();
  relay.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: waitId, reason: 'witness gave up' } })}\n`);
  const next = send('tools/call', { name: 'next_context', arguments: { waitMs: 10000 } });
  const answered = await until(() => replies.has(next), 20000);
  expect(answered, 'the next next_context was not answered');
  const nextAt = replies.get(next)?.at ?? Date.now();
  expect(nextAt - cancelAt < 5000, `the next call waited ${nextAt - cancelAt} ms after the cancel; expected it answered when the job event came`);
  await new Promise((done) => setTimeout(done, 1500));
  expect(!replies.has(waitId), 'the cancelled wait was answered; the protocol says no reply');
  const body = replies.get(next)?.message;
  const notice = JSON.parse(body?.result?.content?.[0]?.text ?? '{}').previousWaitCancelled;
  expect(notice?.requestId === waitId, `the next reply does not name the cancelled wait: ${JSON.stringify(notice)}`);
  expect(notice?.by?.name === CHECK && notice?.why === 'witness gave up', `the notice does not say who and why: ${JSON.stringify(notice)}`);
  expect(jobEvents(body).length === 1, `the job event was not delivered exactly once by the next next_context: ${jobEvents(body).length}`);
  const after = send('tools/call', { name: 'next_context', arguments: {} });
  await until(() => replies.has(after), 20000);
  const again = replies.get(after)?.message;
  expect(jobEvents(again).length === 0, 'the job event was delivered a second time');
  expect(!JSON.parse(again?.result?.content?.[0]?.text ?? '{}').previousWaitCancelled, 'the cancelled-wait notice repeated on a later reply');
  const logFile = join(workspace, 'runs', 'cw', 'log.jsonl');
  const { readFileSync } = await import('node:fs');
  const cancels = readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)).filter((event) => event.kind === 'cancel');
  expect(cancels.some((event) => event.requestId === waitId && event.outcome === 'ended the next_context wait; no reply is sent'), `the run log has no cancel for the wait: ${JSON.stringify(cancels)}`);
  console.log(`${CHECK}: cancel at +${cancelAt - waitStart} ms of a 30000 ms wait; the next next_context answered ${nextAt - cancelAt} ms after the cancel with the job event (once) and previousWaitCancelled naming ${notice?.by?.name}`);
} finally {
  relay.stdout.destroy();
  relay.stderr.destroy();
  relay.stdin.destroy();
  relay.kill('SIGKILL');
  rmSync(sandbox, { recursive: true, force: true });
}
const wall = ((Date.now() - started) / 1000).toFixed(2);
if (failures.length > 0) {
  console.error(`${CHECK}: ${failures.length} failure(s) (wall ${wall} s)\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`${CHECK}: ok (wall ${wall} s)`);
}
process.exit(process.exitCode ?? 0);
