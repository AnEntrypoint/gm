#!/usr/bin/env node
import { removeTree, stopTree } from './lib/tree.mjs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
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
  console.log('stop-fetch-check: skipped (no binary given)');
  process.exit(0);
}

const HOLD_MS = 50000;
const CLOSE_MS = 5000;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let requestSeen = false;
let closedAt = null;
const server = createServer((req, res) => {
  requestSeen = true;
  req.socket.on('close', () => {
    closedAt ??= Date.now();
  });
  setTimeout(() => res.end('late'), HOLD_MS);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const { port } = server.address();

const workspace = mkdtempSync(join(tmpdir(), 'gm-stop-fetch-'));
const configDir = mkdtempSync(join(tmpdir(), 'gm-stop-fetch-config-'));
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
const call = async (name, args) => JSON.parse((await rpc('tools/call', { name, arguments: args })).result.content[0].text);

const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};

try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gm-stop-fetch-check', version: '1' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  await call('next_context', {});

  const started = await call('run_code', {
    format: 'esm',
    timeoutMs: 1000,
    body: `return await gm.fetch({ url: 'http://127.0.0.1:${port}/', timeoutMs: 60000 });`,
  });
  expect(started.background !== undefined, `stop fetch: the fetch body did not go to the background: ${JSON.stringify(started).slice(0, 200)}`);
  for (let i = 0; i < 100 && !requestSeen; i += 1) await sleep(100);
  expect(requestSeen, 'stop fetch: the server never received the fetch');

  const stopAt = Date.now();
  const finished = await call('finish', { witness: 'stop fetch check', stopBackground: true });
  expect(finished.ok === true && finished.finished === true, `stop fetch: finish did not end the run: ${JSON.stringify(finished).slice(0, 200)}`);
  for (let waited = 0; closedAt === null && waited < CLOSE_MS; waited += 100) await sleep(100);
  expect(closedAt !== null, `stop fetch: the stopped body's fetch kept its connection open for ${CLOSE_MS} ms after finish (the server answers at ${HOLD_MS} ms)`);
  const closeMs = closedAt === null ? null : closedAt - stopAt;

  if (failures.length) {
    console.error(`stop-fetch-check: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log(`stop-fetch-check: ok (a background fetch in a body closed its connection ${closeMs} ms after finish stopped the run; the server answers at ${HOLD_MS} ms)`);
  }
} finally {
  await stopTree(child);
  server.close();
  await removeTree(workspace);
  await removeTree(configDir);
}
process.exit(process.exitCode ?? 0);
