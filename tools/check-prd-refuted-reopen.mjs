#!/usr/bin/env node
import { spawn } from 'node:child_process';
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
  return JSON.parse(parsed.output);
}

async function arm(label, command, args, body, check) {
  const server = start(command, args);
  try {
    await server.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prd-check', version: '1' } });
    server.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
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
  if (result.refutedOk !== true) failures.push(label + ': refute verb refused');
  if (!result.refutedList.includes(result.id)) failures.push(label + ': refuted row not listed');
  if (result.reopenedOk !== true) failures.push(label + ': reopen verb refused');
  if (!result.openList.includes(result.id)) failures.push(label + ': reopened row not open');
  if (!result.file.includes('status: "open"')) failures.push(label + ': row status is not open');
  if (!result.file.includes('preserve this note')) failures.push(label + ': notes were dropped');
  if (!result.file.includes('needs-design')) failures.push(label + ': verdict was dropped');
  if (!result.file.includes('receipt')) failures.push(label + ': witness was dropped');
  if (!result.rowPresent) failures.push(label + ': row file was deleted');
}

const body = "const added = await gm.prd_add({ title: 'refute probe', body: 'status: refuted\\nverdict: needs-design\\nnotes: keep me' }); const id = String(added.output); const refuted = await gm.prd_refute({ id, reason: 'needs design', verdict: 'needs-design', notes: 'preserve this note', witness: 'receipt' }); const refutedList = await gm.prd_list({ status: 'refuted' }); const reopened = await gm.prd_reopen({ id, from: 'refuted', reason: 'design ready' }); const openList = await gm.prd_list({ status: 'open' }); const file = await gm.read_file({ path: 'work/rows/' + id + '.yml' }); const row = await gm.stat_file({ path: 'work/rows/' + id + '.yml' }); return { id, refutedOk: refuted.ok === true, refutedList: String(refutedList.output), reopenedOk: reopened.ok === true, openList: String(openList.output), file: String(file.output), rowPresent: row.ok !== false };";
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
  console.error('check-prd-refuted-reopen: failed: ' + failures.join('; '));
  process.exit(1);
}
console.log('check-prd-refuted-reopen: passed: fields preserved, row open, node and native parity');