#!/usr/bin/env node
import { spawn } from './lib/group.mjs';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { once } from 'node:events';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.argv[2] ? resolve(process.argv[2]) : null;
const failures = [];
const exited = (child) => (child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit'));
const workspace = mkdtempSync(join(tmpdir(), 'gm-prd-check-'));
const configDir = mkdtempSync(join(tmpdir(), 'gm-prd-check-mcp-'));
const mcpConfig = join(configDir, 'no-default-mcp.json');
writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
const watchdog = setTimeout(() => { console.error('prd-check: failed: no completion within 120000 ms'); process.exit(1); }, 120000);
watchdog.unref();

function start(command, args) {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.resume();
  const pending = new Map();
  let nextId = 1;
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  const rpc = (method, params) => {
    const id = nextId++;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return new Promise((resolveReply) => pending.set(id, resolveReply));
  };
  return { child, rpc };
}

async function call(server, body) {
  const reply = await server.rpc('tools/call', { name: 'run_code', arguments: { body } });
  const text = reply.result?.content?.[0]?.text ?? 'null';
  const parsed = JSON.parse(text);
  if (parsed.ok !== true) throw new Error('run_code refused: ' + (parsed.error ?? text.slice(0, 200)));
  return typeof parsed.output === 'string' ? JSON.parse(parsed.output) : parsed.output;
}

async function arm(label, command, args, body, check) {
  const server = start(command, args);
  try {
    await server.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prd-check', version: '1' } });
    server.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    await server.rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
    await server.rpc('tools/call', { name: 'next_context', arguments: { task: 'prd check' } });
    const result = await call(server, body);
    check(label, result);
    console.log(label + ': ok');
  } catch (error) {
    failures.push(label + ': ' + error.message);
  } finally {
    server.child.kill();
    await exited(server.child);
  }
}
function check(label, result) {
  if (result.receiptOk !== true) failures.push(label + ': receipt verb refused');
  if (!result.file.includes('receipts')) failures.push(label + ': row has no receipts');
  if (!result.file.includes('delivered sha')) failures.push(label + ': row lost the witness');
  if (!result.file.includes('abcdef0')) failures.push(label + ': row lost the commit');
  if (!result.list.includes('[receipts:1]')) failures.push(label + ': prd_list omitted [receipts:1]');
  if (!result.list.includes('open')) failures.push(label + ': receipt changed the status');
  if (result.closePresent) failures.push(label + ': receipt wrote a close record');
}

const body = "const added = await gm.prd_add({ title: 'receipt probe' }); const id = String(added.output); const receipt = await gm.prd_receipt({ id, witness: 'delivered sha', commit: 'abcdef0' }); const file = await gm.read_file({ path: 'work/rows/' + id + '.yml' }); const list = await gm.prd_list({ status: 'all' }); const close = await gm.stat_file({ path: 'closes/' + id + '.txt' }); return { id, receiptOk: receipt.ok === true, file: String(file.output), list: String(list.output), closePresent: close.ok !== false };";
const nodeArgs = [join(root, 'src', 'mcp.mjs'), '--workspace', workspace, '--run-dir', join(workspace, 'node-run'), '--mcp-config', mcpConfig];
await arm('node', process.execPath, nodeArgs, body, check);
if (binary !== null && existsSync(binary)) {
  const nativeArgs = ['serve', '--workspace', workspace, '--run-dir', join(workspace, 'native-run'), '--mcp-config', mcpConfig];
  await arm('native', binary, nativeArgs, body, check);
} else {
  console.log('native: skipped (no binary given)');
}
rmSync(workspace, { recursive: true, force: true });
rmSync(configDir, { recursive: true, force: true });
clearTimeout(watchdog);
if (failures.length > 0) {
  console.error('check-prd-receipt: failed: ' + failures.join('; '));
  process.exit(1);
}
console.log('check-prd-receipt: passed: node and native kept the row open with one receipt and no close record');