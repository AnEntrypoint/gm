#!/usr/bin/env node
import { spawn } from './lib/group.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = resolve(process.argv[2] ?? join(root, 'build', 'release', 'native', 'components', 'host', 'gm'));
const EXPECTED_TOOLS = ['next_context', 'finish', 'run_code'];
const WATCHDOG_MS = 60000;
const workspace = mkdtempSync(join(tmpdir(), 'gm-reconnect-'));
const failures = [];

function connect() {
  const child = spawn(binary, ['serve', '--workspace', workspace], { stdio: ['pipe', 'pipe', 'pipe'] });
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
    return new Promise((resolveReply) => pending.set(id, resolveReply));
  };
  return { child, rpc };
}

async function session(label) {
  const { child, rpc } = connect();
  try {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'reconnect-check', version: '1' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
    const list = await rpc('tools/list', {});
    const tools = list.result?.tools?.map((tool) => tool.name) ?? [];
    for (const name of EXPECTED_TOOLS) {
      if (!tools.includes(name)) failures.push(`${label}: tools/list lacks ${name}`);
    }
    const step = await rpc('tools/call', { name: 'next_context', arguments: { task: 'reconnect check' } });
    const context = JSON.parse(step.result?.content?.[0]?.text ?? 'null');
    if (!context?.run) failures.push(`${label}: next_context returned no run`);
    if (!init.result?.serverInfo?.name) failures.push(`${label}: initialize returned no serverInfo`);
    console.log(JSON.stringify({ label, serverName: init.result?.serverInfo?.name ?? null, tools, run: context?.run ?? null }));
  } finally {
    child.kill();
  }
}

const watchdog = setTimeout(() => {
  failures.push(`watchdog: no completion within ${WATCHDOG_MS} ms`);
  finish();
}, WATCHDOG_MS);
watchdog.unref();

function finish() {
  rmSync(workspace, { recursive: true, force: true });
  if (failures.length > 0) {
    console.log(`reconnect-check: failed: ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log('reconnect-check: passed: the connection dropped, reconnected, and tools/list and next_context answered on both');
  process.exit(0);
}

await session('connection 1');
await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
await session('connection 2 (after drop)');
finish();
