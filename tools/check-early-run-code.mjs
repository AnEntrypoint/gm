#!/usr/bin/env node
import { removeTree, stopTree } from './lib/tree.mjs';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ?? null;
const onNode = target === 'node';
const binary = onNode ? process.execPath : target === null ? null : resolve(target);
const lead = onNode ? [join(root, 'src', 'mcp.mjs')] : ['serve'];
if (binary === null || (!onNode && !existsSync(binary))) {
  console.log('early-run-code-check: skipped (no binary given)');
  process.exit(0);
}

const REPLY_MS = 10000;

const workspace = mkdtempSync(join(tmpdir(), 'gm-early-run-code-'));
const configDir = mkdtempSync(join(tmpdir(), 'gm-early-run-code-config-'));
const mcpConfig = join(configDir, 'no-default-mcp.json');
writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));

const child = spawn(binary, [...lead, '--workspace', workspace, '--mcp-config', mcpConfig], { stdio: ['pipe', 'pipe', 'pipe'] });
child.stderr.resume();
const pending = new Map();
let nextId = 1;
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
const rpc = (method, params) => {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return new Promise((done) => pending.set(id, done));
};

const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};

try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gm-early-run-code-check', version: '1' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });

  const started = Date.now();
  const reply = await Promise.race([
    rpc('tools/call', { name: 'run_code', arguments: { format: 'esm', timeoutMs: 60000, body: 'return { early: 1 };' } }),
    new Promise((done) => setTimeout(() => done(null), REPLY_MS)),
  ]);
  const elapsed = Date.now() - started;
  expect(reply !== null, `early call: a run_code sent before the first next_context got no reply in ${REPLY_MS} ms`);
  if (reply !== null) {
    const body = JSON.parse(reply.result.content[0].text);
    const output = typeof body.output === 'string' ? JSON.parse(body.output) : body.output;
    expect(body.ok === true && output?.early === 1, `early call: the body did not run: ${JSON.stringify(body).slice(0, 200)}`);
    expect(String(body.rulesNotice ?? '').includes('before the first next_context'), `early call: the rules notice is missing: ${JSON.stringify(body).slice(0, 200)}`);
  }

  const finishStarted = Date.now();
  const finished = await Promise.race([
    rpc('tools/call', { name: 'finish', arguments: { witness: 'early finish check' } }),
    new Promise((done) => setTimeout(() => done(null), REPLY_MS)),
  ]);
  expect(finished !== null, `early finish: a finish sent before the first next_context got no reply in ${REPLY_MS} ms`);
  if (finished !== null) {
    const body = JSON.parse(finished.result.content[0].text);
    expect(body.ok === true && body.finished === true, `early finish: the run did not end: ${JSON.stringify(body).slice(0, 200)}`);
  }

  if (failures.length) {
    console.error(`early-run-code-check: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log(`early-run-code-check: ok (a run_code sent before the first next_context ran at once in ${elapsed} ms, with the rules notice; an early finish ended the run in ${Date.now() - finishStarted} ms)`);
  }
} finally {
  await stopTree(child);
  await removeTree(workspace);
  await removeTree(configDir);
}
process.exit(process.exitCode ?? 0);
