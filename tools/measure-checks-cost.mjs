#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ?? null;
const binary = target === null ? null : resolve(target);
if (binary === null || (!existsSync(binary))) {
  console.error('measure-checks-cost: usage: node tools/measure-checks-cost.mjs <path-to-native-binary | node> [commands]');
  process.exit(2);
}
const lead = ['serve'];
const COMMANDS = Number(process.argv[3] ?? 2000);
const SAMPLES = 5;
const REPLY_MS = 600000;

const scratch = mkdtempSync(join(tmpdir(), 'gm-measure-checks-'));
const workspace = mkdtempSync(join(scratch, 'ws-'));
writeFileSync(join(workspace, 'README.md'), 'x\n');
const quiet = join(scratch, 'quiet-mcp.json');
writeFileSync(quiet, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
const child = spawn(binary, [...lead, '--workspace', workspace, '--run-dir', join(workspace, 'run'), '--mcp-config', quiet], { stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.on('error', () => {});
const pending = new Map();
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
const tool = async (name, args) => (await rpc('tools/call', { name, arguments: args }))?.result ?? {};
try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'measure-checks-cost', version: '1' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  await tool('next_context', {});
  const fill = await tool('run_code', { body: `for (let i = 0; i < ${COMMANDS}; i += 1) await gm.run_shell({ command: 'echo n' + (i % 40) }); return 'filled';` });
  const ok = fill.structuredContent?.ok === true;
  const times = [];
  let bytes = 0;
  for (let i = 0; i < SAMPLES; i += 1) {
    const at = Date.now();
    const reply = await tool('next_context', { full: true });
    times.push(Date.now() - at);
    bytes = JSON.stringify(reply).length;
  }
  times.sort((a, b) => a - b);
  console.log(`measure-checks-cost: ${target} filled=${ok} commands=${COMMANDS} next_context full median ${times[Math.floor(SAMPLES / 2)]} ms (samples ${times.join(',')}), reply ${bytes} bytes`);
} finally {
  child.kill();
  rmSync(scratch, { recursive: true, force: true });
}
