#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import readline from 'node:readline';

const CHECK = 'next-context-size-check';
const target = process.argv[2] ?? null;
if (target === null || !existsSync(resolve(target))) {
  console.error(`${CHECK}: usage: node tools/measure-next-context.mjs <path-to-native-binary>`);
  process.exit(2);
}
const STEPS = 20;
const BASELINE_NORMAL_MEAN = 1168;
const BASELINE_FULL_MEAN = 7422;
const REDUCTION = 0.5;
const REPLY_MS = 120000;

const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
const started = Date.now();
const scratch = mkdtempSync(join(tmpdir(), 'gm-next-context-size-'));

async function series(full) {
  const workspace = mkdtempSync(join(scratch, 'ws-'));
  writeFileSync(join(workspace, 'README.md'), 'x\n');
  const quiet = join(workspace, 'quiet-mcp.json');
  writeFileSync(quiet, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
  const child = spawn(resolve(target), ['serve', '--workspace', workspace, '--run-dir', join(workspace, 'run'), '--mcp-config', quiet], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.on('error', () => {});
  const pending = new Map();
  child.once('exit', () => {
    for (const done of pending.values()) done(null);
    pending.clear();
  });
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
  const sizes = [];
  const bodies = [];
  const nextContext = async () => {
    const reply = await rpc('tools/call', { name: 'next_context', arguments: full ? { full: true } : {} });
    sizes.push(JSON.stringify(reply?.result ?? reply).length);
    bodies.push(reply?.result?.structuredContent ?? {});
  };
  try {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CHECK, version: '1' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
    await nextContext();
    for (let step = 2; step <= STEPS; step += 1) {
      await rpc('tools/call', { name: 'run_code', arguments: { body: `return ${step};` } });
      await nextContext();
    }
  } finally {
    child.kill();
  }
  const mean = Math.round(sizes.reduce((sum, size) => sum + size, 0) / sizes.length);
  return { sizes, mean, bodies };
}

try {
  const normal = await series(false);
  const full = await series(true);
  expect(normal.bodies[0].rules !== undefined && normal.bodies[0].task !== undefined, 'the first next_context reply lost rules or task');
  expect(normal.bodies.slice(1).every((body) => body.unchanged === true || typeof body.rules === 'string'), 'a later reply is neither unchanged nor a full step with rules');
  expect(normal.bodies.slice(1).every((body) => body.unchanged !== true || (body.ok === true && typeof body.run === 'string' && typeof body.steps === 'number' && typeof body.stepsLeft === 'number')), 'an unchanged reply lost run, steps or stepsLeft');
  expect(normal.mean <= BASELINE_NORMAL_MEAN * REDUCTION, `the normal 20-step mean is ${normal.mean} bytes; the target is at most ${Math.floor(BASELINE_NORMAL_MEAN * REDUCTION)} (baseline ${BASELINE_NORMAL_MEAN})`);
  const wall = ((Date.now() - started) / 1000).toFixed(2);
  if (failures.length > 0) {
    console.error(`${CHECK}: ${failures.length} failure(s) on ${target} (wall ${wall} s)\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log(`${CHECK}: ok (${target}: normal 20-step mean ${normal.mean} bytes, baseline ${BASELINE_NORMAL_MEAN}, ${Math.round((1 - normal.mean / BASELINE_NORMAL_MEAN) * 100)}% smaller; full-reply 20-step mean ${full.mean} bytes, baseline ${BASELINE_FULL_MEAN}; normal sizes ${normal.sizes.join(',')}; wall ${wall} s)`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
