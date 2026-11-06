#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import readline from 'node:readline';
import { once } from 'node:events';

const exited = (child) => (child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit'));

const binary = process.argv[2] ? resolve(process.argv[2]) : null;
const WATCHDOG_MS = 120000;
const watchdog = setTimeout(() => {
  console.error(`inflight-check: failed: no completion within ${WATCHDOG_MS} ms`);
  process.exit(1);
}, WATCHDOG_MS);
watchdog.unref();

if (binary === null || !existsSync(binary)) {
  console.log('inflight-check: skipped (no binary given)');
  process.exit(0);
}

const CAP = 8;
const BODY_MS = 1500;
const workspace = mkdtempSync(join(tmpdir(), 'gm-inflight-check-'));
const failures = [];
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
const busy = `const t0 = Date.now(); while (Date.now() - t0 < ${BODY_MS}) {} return { start: t0, end: Date.now() };`;
const run = (body) => rpc('tools/call', { name: 'run_code', arguments: { body } });
const parsedOf = (reply) => JSON.parse(reply.result?.content?.[0]?.text ?? 'null');

try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'inflight-check', version: '1' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  await rpc('tools/call', { name: 'next_context', arguments: { task: 'inflight check' } });
  const replies = await Promise.all(Array.from({ length: CAP + 1 }, () => run(busy)));
  const bodies = replies.map((reply, index) => {
    const parsed = parsedOf(reply);
    if (parsed?.ok !== true) throw new Error(`call ${index} refused: ${parsed?.error ?? 'no reply'}`);
    return JSON.parse(parsed.output);
  });
  const ends = bodies.slice(0, CAP).map((body) => body.end);
  const ninth = bodies[CAP];
  const earliestEnd = Math.min(...ends);
  if (ninth.start < earliestEnd - 50) failures.push(`the ninth call started at ${ninth.start}, before any of the first ${CAP} calls ended (${earliestEnd}): the cap of ${CAP} is not enforced`);
  console.log(JSON.stringify({ cap: CAP, firstStarts: bodies.slice(0, CAP).map((body) => body.start - bodies[0].start), ninthWaitMs: ninth.start - Math.min(...bodies.slice(0, CAP).map((body) => body.start)) }));
} catch (error) {
  failures.push(error.message);
} finally {
  child.kill();
  await exited(child);
  rmSync(workspace, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`inflight-check: failed: ${failures.join('; ')}`);
  process.exit(1);
}
console.log(`inflight-check: passed: with ${CAP} calls in flight, a ninth call waits until one of them ends`);
