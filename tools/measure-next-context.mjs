#!/usr/bin/env node
import { spawn } from './lib/group.mjs';
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
const BASELINE_CHANGED_MEAN = 4300;
const NORMAL_REDUCTION = 0.5;
const CHANGED_TARGET = 3760;
const CHANGED_RUNS = 5;
const REPLY_MS = 120000;

const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
const started = Date.now();
const scratch = mkdtempSync(join(tmpdir(), 'gm-next-context-size-'));

async function series(mode) {
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
    const reply = await rpc('tools/call', { name: 'next_context', arguments: mode === 'full' ? { full: true } : {} });
    sizes.push(JSON.stringify(reply?.result ?? reply).length);
    bodies.push(reply?.result?.structuredContent ?? {});
  };
  let contextSeq = null;
  try {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CHECK, version: '1' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
    await nextContext();
    for (let step = 2; step <= STEPS; step += 1) {
      const changed = mode === 'changed' && step % 4 === 2;
      const body = changed
        ? `await gm.job_start({ job: "j${step}", command: "echo ${step}", timeoutMs: 20000 }); await gm.job_status({ job: "j${step}", waitMs: 3000 }); return ${step};`
        : `return ${step};`;
      await rpc('tools/call', { name: 'run_code', arguments: { body } });
      await nextContext();
    }
    if (mode === 'changed') {
      const found = await rpc('tools/call', { name: 'run_code', arguments: { body: "const e = await gm.query_log({ kind: 'context-reply', last: 1 }); return e;" } });
      contextSeq = found?.result?.structuredContent?.output ?? null;
    }
  } finally {
    child.kill();
  }
  const mean = Math.round(sizes.reduce((sum, size) => sum + size, 0) / sizes.length);
  return { sizes, mean, bodies, contextSeq };
}

try {
  const normal = await series('normal');
  const changedRuns = [];
  for (let run = 0; run < CHANGED_RUNS; run += 1) changedRuns.push(await series('changed'));
  const changed = { ...changedRuns[0], mean: Math.round(changedRuns.reduce((sum, result) => sum + result.mean, 0) / CHANGED_RUNS), runMeans: changedRuns.map((result) => result.mean) };
  const full = await series('full');
  expect(normal.bodies[0].rules !== undefined && normal.bodies[0].task !== undefined, 'the first next_context reply lost rules or task');
  expect(normal.bodies.slice(1).every((body) => body.unchanged === true || typeof body.rules === 'string'), 'a later reply is neither unchanged nor a full step with rules');
  expect(normal.bodies.slice(1).every((body) => body.unchanged !== true || (body.ok === true && typeof body.run === 'string' && typeof body.steps === 'number' && typeof body.stepsLeft === 'number')), 'an unchanged reply lost run, steps or stepsLeft');
  expect(normal.mean <= BASELINE_NORMAL_MEAN * NORMAL_REDUCTION, `the normal 20-step mean is ${normal.mean} bytes; the target is at most ${Math.floor(BASELINE_NORMAL_MEAN * NORMAL_REDUCTION)} (baseline ${BASELINE_NORMAL_MEAN})`);
  const changedSteps = changed.bodies.slice(1).filter((body) => body.unchanged !== true);
  expect(changedSteps.length >= 5, `the changed series has ${changedSteps.length} changed steps; expected 5`);
  expect(changedSteps.every((body) => typeof body.rules === 'string' && typeof body.run === 'string'), 'a changed step lost rules or run');
  expect(changed.mean <= CHANGED_TARGET, `the changed 20-step mean over ${CHANGED_RUNS} runs is ${changed.mean} bytes (runs ${changed.runMeans.join(',')}); the target is at most ${CHANGED_TARGET} (baseline ${BASELINE_CHANGED_MEAN}; the rules text on changed steps and the MCP content duplicate are kept)`);
  expect(typeof changed.contextSeq === 'object' && changed.contextSeq !== null, 'query_log did not return the context-reply event');
  const wall = ((Date.now() - started) / 1000).toFixed(2);
  if (failures.length > 0) {
    console.error(`${CHECK}: ${failures.length} failure(s) on ${target} (wall ${wall} s)\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log(`${CHECK}: ok (${target}: normal 20-step mean ${normal.mean} bytes, baseline ${BASELINE_NORMAL_MEAN}; changed 20-step mean over ${CHANGED_RUNS} runs ${changed.mean} bytes (runs ${changed.runMeans.join(',')}), baseline ${BASELINE_CHANGED_MEAN}, ${Math.round((1 - changed.mean / BASELINE_CHANGED_MEAN) * 100)}% smaller; full-reply 20-step mean ${full.mean} bytes; wall ${wall} s)`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
