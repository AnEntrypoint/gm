#!/usr/bin/env node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { spawn } from './lib/group.mjs';

const CHECK = 'check-job-status-cancel';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(process.argv[2] ?? join(root, 'build', 'release', 'native', 'components', 'host', 'gm'));
const started = Date.now();
const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
const sandbox = mkdtempSync(join(tmpdir(), 'gm-job-status-cancel-'));
const workspace = join(sandbox, 'ws');
const runDir = join(workspace, 'runs', 'jsc');
mkdirSync(workspace);
const quiet = join(sandbox, 'quiet.json');
writeFileSync(quiet, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
const relay = spawn(target, ['serve', '--workspace', workspace, '--run-dir', runDir, '--mcp-config', quiet], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HOME: sandbox } });
relay.stdin.on('error', () => {});
relay.stderr.resume();
const waiting = new Map();
const replies = [];
let nextId = 1;
readline.createInterface({ input: relay.stdout }).on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === undefined) return;
  replies.push(message);
  if (waiting.has(message.id)) {
    waiting.get(message.id)(message);
    waiting.delete(message.id);
  }
});
const send = (method, params) => {
  const id = nextId++;
  relay.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return id;
};
const rpc = (method, params, ms = 60000) =>
  new Promise((done) => {
    const id = send(method, params);
    const timer = setTimeout(() => done(null), ms);
    waiting.set(id, (m) => {
      clearTimeout(timer);
      done(m);
    });
  });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const events = (kind) => {
  const file = join(runDir, 'log.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)).filter((event) => event.kind === kind);
};
const bodyValue = (reply) => JSON.parse(reply?.result?.content?.[0]?.text ?? 'null') ?? {};
const code = (body) => ({ name: 'run_code', arguments: { body } });

try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CHECK, version: '1' } });
  relay.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  await rpc('tools/call', { name: 'next_context', arguments: {} });
  const start = await rpc('tools/call', code("return await gm.job_start({ job: 'jsc-job', command: 'sleep 3; echo done', timeoutMs: 60000 });"));
  expect(start?.result !== undefined, `job_start did not answer: ${JSON.stringify(start)}`);
  const waitId = send('tools/call', code("return await gm.job_status({ job: 'jsc-job', waitMs: 30000 });"));
  await sleep(500);
  const cancelledAt = Date.now();
  relay.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: waitId, reason: 'client gave up on the job' } })}\n`);
  await sleep(1500);
  const late = replies.find((message) => message.id === waitId);
  expect(late === undefined, `the cancelled run_code still answered: ${JSON.stringify(late ?? null).slice(0, 200)}`);
  const cancel = events('cancel').find((event) => event.requestId === waitId);
  expect(cancel?.by?.name === CHECK && cancel?.why === 'client gave up on the job', `the cancel event must name the client and its reason: ${JSON.stringify(cancel)}`);
  expect(cancel?.outcome === 'stopped the call in flight', `the cancel event must say what gm did: ${JSON.stringify(cancel)}`);
  const status = bodyValue(await rpc('tools/call', code("return await gm.job_status({ job: 'jsc-job', waitMs: 20000 });"))).output ?? {};
  const waited = Date.now() - cancelledAt;
  expect(status.state === 'exited', `the job did not keep running to its end after the cancel: state ${status.state}`);
  expect(String(status.output ?? '').includes('done'), `the job output is missing after the cancel: ${JSON.stringify(status).slice(0, 200)}`);
  console.log(`${CHECK}: cancel at +500 ms, the wait got no reply, the job answered by id ${waited} ms after the cancel with state ${status.state}`);
} finally {
  relay.kill('SIGKILL');
  rmSync(sandbox, { recursive: true, force: true });
}

const wall = ((Date.now() - started) / 1000).toFixed(2);
if (failures.length > 0) {
  console.error(`${CHECK}: ${failures.length} failure(s) (wall ${wall} s)\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`${CHECK}: ok (a cancelled job_status wait inside run_code got no reply, its cancel named the client, and the job ran on and answered by id; wall ${wall} s)`);
}
