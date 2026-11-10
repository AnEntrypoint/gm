#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { once } from 'node:events';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.argv[2] ? resolve(process.argv[2]) : null;
const failures = [];
const arms = [];
const exited = (child) => (child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit'));
const watchdog = setTimeout(() => {
  console.error('check-startup-attempts: failed: no completion within 120000 ms');
  process.exit(1);
}, 120000);
watchdog.unref();

const config = {
  mcpServers: {
    playwriter: { disabled: true },
    crashy: { command: 'sh', args: ['-c', 'echo boom-from-crashy >&2; exit 128'], startupTimeoutMs: 20000 },
    silent: { command: 'sh', args: ['-c', 'sleep 30'], startupTimeoutMs: 2000 },
  },
};

function fresh(name) {
  const dir = mkdtempSync(join(tmpdir(), `gm-startup-${name}-`));
  mkdirSync(join(dir, '.gm'));
  writeFileSync(join(dir, '.gm', 'mcp.json'), JSON.stringify(config));
  return dir;
}

function start(command, args) {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
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
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return new Promise((resolveReply) => pending.set(id, resolveReply));
  };
  return { child, rpc };
}

function eventsOf(reply) {
  const output = reply.result?.structuredContent?.output?.output;
  return typeof output === 'string' ? JSON.parse(output) : [];
}

async function arm(label, command, args) {
  const server = start(command, args);
  try {
    await server.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'startup-check', version: '1' } });
    server.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    await server.rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
    await server.rpc('tools/call', { name: 'next_context', arguments: { task: 'startup attempts check', owner: true } });
    const ran = await server.rpc('tools/call', { name: 'run_code', arguments: { body: 'return await gm.query_log({ kind: "mcp-server" });' } });
    const events = eventsOf(ran);
    const of = (server) => events.filter((event) => event.server === server);
    const crashy = of('crashy');
    const silent = of('silent');
    const expect = [
      ['crashy retried twice', crashy.filter((event) => event.state === 'retrying').length === 2],
      ['crashy exit code 128 in each attempt', crashy.filter((event) => event.reason === 'exited with code 128' || String(event.error).endsWith('exited with code 128')).length >= 3],
      ['crashy failed after 3 attempts', crashy.some((event) => event.state === 'failed' && String(event.error).startsWith('MCP server crashy did not start after 3 attempt(s)'))],
      ['crashy names its stderr tail', crashy.some((event) => event.state === 'failed' && String(event.error).includes('stderr: boom-from-crashy'))],
      ['crashy names its startup budget', crashy.some((event) => event.state === 'failed' && String(event.error).includes('Startup budget 20000 ms (startupTimeoutMs)'))],
      ['silent is not retried after a timeout', silent.some((event) => event.state === 'failed' && String(event.error).startsWith('MCP server silent did not start after 1 attempt(s): initialize timed out after 2000 ms'))],
      ['silent names its startup budget', silent.some((event) => event.state === 'failed' && String(event.error).includes('Startup budget 2000 ms (startupTimeoutMs)'))],
    ];
    for (const [what, ok] of expect) if (!ok) failures.push(`${label}: ${what}`);
    arms.push(label);
    if (expect.some(([, ok]) => !ok)) console.log(`${label} diagnostics: ${events.length} events; the run_code reply was ${JSON.stringify(ran).slice(0, 800)}`);
    console.log(`${label}: ${events.length} mcp-server events, ${failures.length === 0 ? 'all expectations hold' : 'see failures'}`);
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
  } finally {
    server.child.kill();
    await exited(server.child);
  }
}

const workspaces = [];
const nodeWorkspace = fresh('node');
workspaces.push(nodeWorkspace);
await arm('node', process.execPath, [join(root, 'src', 'mcp.mjs'), '--workspace', nodeWorkspace, '--run-dir', join(nodeWorkspace, 'node-run')]);
if (binary !== null && existsSync(binary)) {
  const nativeWorkspace = fresh('native');
  workspaces.push(nativeWorkspace);
  await arm('native', binary, ['serve', '--workspace', nativeWorkspace, '--run-dir', join(nativeWorkspace, 'native-run')]);
} else {
  console.log('native: skipped (no binary given)');
}
for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
clearTimeout(watchdog);
if (failures.length > 0) {
  console.error('check-startup-attempts: failed: ' + failures.join('; '));
  process.exit(1);
}
console.log(`check-startup-attempts: passed: a server that exits before it answers is retried and each attempt's exit code is named, and a timed-out server names its startup budget, in ${arms.join(' and ')}`);
