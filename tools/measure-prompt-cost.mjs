#!/usr/bin/env node
import { spawn } from './lib/group.mjs';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = resolve(process.argv[2] ?? join(root, 'build', 'release', 'native', 'components', 'host', 'gm'));
const approxTokens = (text) => Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
const row = (label, text) => console.log(`${label}: ${Buffer.byteLength(text, 'utf8')} bytes, about ${approxTokens(text)} tokens`);

const scratch = mkdtempSync(join(tmpdir(), 'gm-prompt-cost-'));
const workspace = join(scratch, 'ws');
mkdirSync(workspace);
const quiet = join(scratch, 'quiet-mcp.json');
writeFileSync(quiet, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
const child = spawn(binary, ['serve', '--workspace', workspace, '--run-dir', join(workspace, 'run'), '--mcp-config', quiet], { stdio: ['pipe', 'pipe', 'pipe'] });
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
    pending.set(id, done);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'measure-prompt-cost', version: '1' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const list = await rpc('tools/list', {});
  for (const tool of list.result.tools) {
    row(`tool description ${tool.name}`, tool.description);
    row(`tool schema ${tool.name}`, JSON.stringify(tool.inputSchema));
  }
  row('tools/list total', JSON.stringify(list.result.tools));
  const skill = readFileSync(join(root, 'skills', 'gm', 'SKILL.md'), 'utf8');
  row('skills/gm/SKILL.md', skill);
  const first = await rpc('tools/call', { name: 'next_context', arguments: {} });
  const firstText = first.result.content[0].text;
  row('next_context first (full) reply', firstText);
  const repeat = await rpc('tools/call', { name: 'next_context', arguments: {} });
  row('next_context repeat (unchanged) reply', repeat.result.content[0].text);
} finally {
  child.kill('SIGKILL');
  rmSync(scratch, { recursive: true, force: true });
}
