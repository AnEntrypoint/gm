#!/usr/bin/env node
import { spawn } from './lib/group.mjs';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import readline from 'node:readline';

const CHECK = 'check-feed-reference';
const binary = resolve(process.argv[2] ?? 'build/release/native/components/host/gm');
const started = Date.now();
const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
const sandbox = mkdtempSync(join(tmpdir(), 'gm-feed-reference-'));
const workspace = join(sandbox, 'ws');
mkdirSync(workspace);
const quiet = join(sandbox, 'quiet.json');
writeFileSync(quiet, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
const relay = spawn(binary, ['serve', '--workspace', workspace, '--run-dir', join(workspace, 'runs', 'feed'), '--mcp-config', quiet], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HOME: sandbox } });
relay.stdin.on('error', () => {});
const waiting = new Map();
let nextId = 1;
readline.createInterface({ input: relay.stdout }).on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id !== undefined && waiting.has(message.id)) {
    waiting.get(message.id)(message);
    waiting.delete(message.id);
  }
});
const rpc = (method, params, ms = 60000) =>
  new Promise((done) => {
    const id = nextId++;
    const timer = setTimeout(() => done(null), ms);
    waiting.set(id, (m) => {
      clearTimeout(timer);
      done(m);
    });
    relay.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
const callText = async (name, args) => (await rpc('tools/call', { name, arguments: args }))?.result?.content?.[0]?.text ?? '';
const runBody = async (body) => {
  const text = await callText('run_code', { body });
  try {
    return JSON.parse(text).output;
  } catch {
    return text;
  }
};
const MARK = (n) => `MARK${n}-${'x'.repeat(9000)}`;

try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CHECK, version: '1' } });
  relay.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  await callText('next_context', {});
  for (const n of [1, 2, 3]) await runBody(`return ${JSON.stringify(MARK(n))};`);
  await runBody(`return await gm.job_start({ job: 'feed-job', command: 'sleep 30', timeoutMs: 60000 });`);
  await runBody(`return await gm.job_stop({ job: 'feed-job' });`);
  const reply = await callText('next_context', {});
  const measured = reply.length;
  const tokens = Math.round(measured / 4);
  expect(!reply.includes('MARK1-') && !reply.includes('MARK2-') && !reply.includes('MARK3-'), 'the next_context reply replays the earlier run_code outputs; they must be sent as references');
  expect(reply.includes('"job"') || reply.includes('feed-job'), `the pending job event must still reach the reply in full: ${reply.slice(0, 300)}`);
  expect(measured < 8000, `the next_context reply after a pending event is ${measured} characters (about ${tokens} tokens), expected under 8000`);
  console.log(`${CHECK}: next_context after a pending job event: ${measured} characters, about ${tokens} tokens`);
} finally {
  relay.kill('SIGKILL');
  rmSync(sandbox, { recursive: true, force: true });
}

const wall = ((Date.now() - started) / 1000).toFixed(2);
if (failures.length > 0) {
  console.error(`${CHECK}: ${failures.length} failure(s) (wall ${wall} s)\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`${CHECK}: ok (the earlier run_code bodies and outputs are references, and the pending job event is in full; wall ${wall} s)`);
}
