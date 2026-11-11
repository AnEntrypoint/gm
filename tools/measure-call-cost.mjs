#!/usr/bin/env node
import { spawn } from './lib/group.mjs';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ?? null;
const binary = target === null ? null : resolve(target);
if (binary === null || (!existsSync(binary))) {
  console.error('measure-call-cost: usage: node tools/measure-call-cost.mjs <native binary | node> [calls]');
  process.exit(2);
}
const lead = ['serve'];
const CALLS = Number(process.argv[3] ?? 40);
const scratch = mkdtempSync(join(tmpdir(), 'gm-measure-call-'));
const workspace = mkdtempSync(join(scratch, 'ws-'));
writeFileSync(join(workspace, 'README.md'), 'x\n');
const quiet = join(scratch, 'quiet-mcp.json');
writeFileSync(quiet, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
const child = spawn(binary, [...lead, '--workspace', workspace, '--run-dir', join(workspace, 'run'), '--mcp-config', quiet], { stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.on('error', () => {});
const pending = new Map();
readline.createInterface({ input: child.stdout }).on('line', (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
let nextId = 1;
const rpc = (method, params) => new Promise((done) => {
  const id = nextId++;
  pending.set(id, done);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
});
const timed = async (name, args) => {
  const at = performance.now();
  const reply = await rpc('tools/call', { name, arguments: args });
  return { ms: performance.now() - at, bytes: JSON.stringify(reply).length };
};
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const summarize = (label, rows) => `${label}: median ${median(rows.map((r) => r.ms)).toFixed(1)} ms, reply ${median(rows.map((r) => r.bytes))} bytes`;
try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'measure-call-cost', version: '1' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  await timed('next_context', {});
  const first = await timed('next_context', { full: true });
  const runs = [];
  for (let i = 0; i < CALLS; i += 1) runs.push(await timed('run_code', { body: 'return 1;' }));
  const idle = [];
  for (let i = 0; i < CALLS; i += 1) idle.push(await timed('next_context', {}));
  const full = [];
  for (let i = 0; i < CALLS; i += 1) full.push(await timed('next_context', { full: true }));
  console.log(`measure-call-cost: ${target} calls=${CALLS}`);
  console.log(`  first full next_context: ${first.ms.toFixed(1)} ms, ${first.bytes} bytes`);
  console.log(`  ${summarize('trivial run_code', runs)}`);
  console.log(`  ${summarize('next_context, nothing new', idle)}`);
  console.log(`  ${summarize('next_context full', full)}`);
  const fullReply = await rpc('tools/call', { name: 'next_context', arguments: { full: true } });
  const body = JSON.parse(fullReply.result.content[0].text);
  for (const [key, value] of Object.entries(body)) console.log(`    ${key}: ${JSON.stringify(value).length} bytes`);
  const looped = spawn('sleep', ['60']);
  const loopAt = performance.now();
  const looping = await timed('run_code', { body: `let n = 0; for (;;) { n += 1; const r = await gm.job_status({ pid: ${looped.pid}, waitMs: 100000 }); if (r.state !== 'running') return { calls: n, state: r.state }; }` });
  console.log(`  looped pid wait over sleep 60: one run_code reply after ${((performance.now() - loopAt) / 1000).toFixed(2)} s, ${looping.bytes} bytes`);
  const waits = [];
  for (let i = 0; i < 3; i += 1) {
    const sleeper = spawn('sleep', ['2']);
    const at = performance.now();
    const reply = await timed('run_code', { body: `return await gm.job_status({ pid: ${sleeper.pid}, waitMs: 30000 });` });
    const output = JSON.stringify(await rpc('tools/call', { name: 'next_context', arguments: { full: false } }).catch(() => null)).length;
    waits.push({ ms: performance.now() - at, bytes: reply.bytes, output });
    sleeper.kill();
  }
  console.log(`  ${summarize('run_code job_status pid wait (sleep 2 s)', waits)}`);
} finally {
  child.kill();
  rmSync(scratch, { recursive: true, force: true });
}
