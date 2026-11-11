#!/usr/bin/env node
import { spawn } from './lib/group.mjs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const CHECK = 'check-cancel-record';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = resolve(process.argv[2] ?? 'build/release/native/components/host/gm');
const started = Date.now();
const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
const sandbox = mkdtempSync(join(tmpdir(), 'gm-cancel-record-'));
const workspace = join(sandbox, 'ws');
const runDir = join(workspace, 'runs', 'cancel');
mkdirSync(workspace);
const quiet = join(sandbox, 'quiet.json');
writeFileSync(quiet, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
const relay = spawn(binary, [...(['serve']), '--workspace', workspace, '--run-dir', runDir, '--mcp-config', quiet], { detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HOME: sandbox } });
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
const events = (kind) => {
  if (!existsSync(join(runDir, 'log.jsonl'))) return [];
  return readFileSync(join(runDir, 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)).filter((event) => event.kind === kind);
};

try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CHECK, version: '1' } });
  relay.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  await rpc('tools/call', { name: 'next_context', arguments: {} });
  const waitId = send('tools/call', { name: 'next_context', arguments: { waitMs: 30000 } });
  await new Promise((done) => setTimeout(done, 500));
  relay.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: waitId, reason: 'client gave up' } })}\n`);
  await new Promise((done) => setTimeout(done, 500));
  relay.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 987654, reason: 'stale' } })}\n`);
  await new Promise((done) => setTimeout(done, 500));
  const cancels = events("cancel");
  const matched = cancels.find((event) => event.requestId === waitId);
  const unmatched = cancels.find((event) => event.requestId === 987654);
  expect(cancels.length === 2, `expected 2 cancel events, found ${cancels.length}`);
  expect(matched?.by?.name === CHECK && matched?.by?.version === '1', `the cancel event must name the client that cancelled: ${JSON.stringify(matched)}`);
  expect(matched?.why === 'client gave up', `the cancel event must carry the client's reason: ${JSON.stringify(matched)}`);
  expect(matched?.outcome === 'ended the next_context wait; no reply is sent',`the matched cancel must say what gm did: ${JSON.stringify(matched)}`);
  expect(unmatched?.outcome === 'no call in flight with that id' && unmatched?.why === 'stale', `the unmatched cancel must say so: ${JSON.stringify(unmatched)}`);
  expect(events('cancel-ignored').length === 0, 'the cancel-ignored event is replaced by cancel');
  console.log(`${CHECK}: matched outcome "${matched?.outcome}" by ${matched?.by?.name} why "${matched?.why}"; unmatched outcome "${unmatched?.outcome}"`);
} finally {
  try {
    process.kill(-relay.pid, 'SIGKILL');
  } catch {}
  relay.stdout.destroy();
  relay.stderr.destroy();
  relay.stdin.destroy();
  rmSync(sandbox, { recursive: true, force: true });
}

const wall = ((Date.now() - started) / 1000).toFixed(2);
if (failures.length > 0) {
  console.error(`${CHECK}: ${failures.length} failure(s) (wall ${wall} s)\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`${CHECK}: ok (each cancel records who cancelled, why, and what gm did; wall ${wall} s)`);
}
