#!/usr/bin/env node
import { withoutPlaywriter } from './lib/no-playwriter.mjs';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { once } from 'node:events';

const exited = (child) => (child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit'));

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.argv[2] ? resolve(process.argv[2]) : null;
const WATCHDOG_MS = 180000;
const watchdog = setTimeout(() => {
  console.error(`console-check: failed: no completion within ${WATCHDOG_MS} ms`);
  process.exit(1);
}, WATCHDOG_MS);
watchdog.unref();

const LINES = 200;
const BYTES = 8192;
const LINE_BYTES = 512;
const failures = [];

const FLOOD = "for (let i = 0; i < 300; i += 1) console.log('line ' + String(i).padStart(3, '0') + ' ' + 'x'.repeat(100)); console.error('an error line'); return 1;";
const FORMAT = "console.log({ a: 1 }, 'x', 2, true); console.warn('\u20ac'.repeat(200)); return 1;";
const QUERY = "return await gm.query_log({ kind: 'body-console' });";

function session(label, command, args) {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.resume();
  const pending = new Map();
  let nextId = 1;
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      failures.push(`${label}: a non-JSON line on stdout: ${line.slice(0, 120)}`);
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
  const run = async (body) => {
    const reply = await rpc('tools/call', { name: 'run_code', arguments: { body } });
    const text = reply.result?.content?.[0]?.text ?? 'null';
    const parsed = JSON.parse(text);
    if (parsed.ok !== true) throw new Error(`run_code refused: ${parsed.error ?? text.slice(0, 200)}`);
    return parsed;
  };
  const start = async () => {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'console-check', version: '1' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    await rpc('tools/call', { name: 'next_context', arguments: { task: 'console check' } });
  };
  const stop = async () => {
    child.kill();
    await exited(child);
  };
  return { start, run, stop };
}

async function check(label, command, argsOf) {
  const workspace = withoutPlaywriter(mkdtempSync(join(tmpdir(), 'gm-console-check-')));
  writeFileSync(join(workspace, 'a.txt'), 'probe\n');
  const s = session(label, command, argsOf(workspace));
  try {
    await s.start();
    const flood = await s.run(FLOOD);
    if (flood.output !== '1') failures.push(`${label}: a body that logs returned ${flood.output}, not 1`);
    const format = await s.run(FORMAT);
    if (format.output !== '1') failures.push(`${label}: a body with objects and a long line returned ${format.output}, not 1`);
    const events = JSON.parse((await s.run(QUERY)).output.output);
    if (events.length !== 2) failures.push(`${label}: ${events.length} body-console events, expected one per logging body`);
    const [first, second] = events;
    if (first) {
      const total = first.lines.length + first.dropped;
      if (first.lines.length > LINES) failures.push(`${label}: ${first.lines.length} lines kept, over the ${LINES} cap`);
      if (first.bytes > BYTES) failures.push(`${label}: ${first.bytes} bytes kept, over the ${BYTES} cap`);
      if (first.dropped <= 0) failures.push(`${label}: no dropped count for a body over the cap`);
      if (total !== 301) failures.push(`${label}: ${total} lines counted, expected 301 (300 logs and one error)`);
      if (first.lines[0] !== `line 000 ${'x'.repeat(100)}`) failures.push(`${label}: the first kept line is not the first log`);
      console.log(JSON.stringify({ label, body: 'flood', lines: first.lines.length, dropped: first.dropped, bytes: first.bytes }));
    }
    if (second) {
      if (second.lines[0] !== '{"a":1} x 2 true') failures.push(`${label}: objects and primitives format as ${JSON.stringify(second.lines[0])}`);
      const euro = second.lines[1] ?? '';
      if (Buffer.byteLength(euro) > LINE_BYTES) failures.push(`${label}: a long line is ${Buffer.byteLength(euro)} bytes, over the ${LINE_BYTES} cap`);
      if (Buffer.byteLength(euro) !== 510) failures.push(`${label}: a 600-byte line of three-byte characters is ${Buffer.byteLength(euro)} bytes, expected 510 on a character boundary`);
      if (!/^\u20ac+$/u.test(euro)) failures.push(`${label}: the cut long line is not whole euro signs`);
      console.log(JSON.stringify({ label, body: 'format', lines: second.lines.length, firstLine: second.lines[0], cutBytes: Buffer.byteLength(euro) }));
    }
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
  } finally {
    await s.stop();
    rmSync(workspace, { recursive: true, force: true });
  }
}

await check('node', process.execPath, (workspace) => [join(root, 'src', 'mcp.mjs'), '--workspace', workspace]);
if (binary === null || !existsSync(binary)) {
  console.log('native console: skipped (no binary given)');
} else {
  await check('native', binary, (workspace) => ['serve', '--workspace', workspace]);
}

if (failures.length > 0) {
  console.error(`console-check: failed: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('console-check: passed: a body with 300 logs keeps 200 lines or 8 KiB with a dropped count, formats objects, cuts a long line on a character boundary, keeps the reply and stdout intact, on both trees');
