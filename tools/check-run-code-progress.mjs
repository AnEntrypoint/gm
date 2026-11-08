#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import readline from 'node:readline';

const removeTree = async (path) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error?.code !== 'ENOTEMPTY' || attempt === 50) throw error;
      await new Promise((done) => setTimeout(done, 100));
    }
  }
};

const binary = process.argv[2] ? resolve(process.argv[2]) : null;
if (binary === null || !existsSync(binary)) {
  console.log('run-code-progress-check: skipped (no binary given)');
  process.exit(0);
}

const WATCHDOG_MS = 90000;
const watchdog = setTimeout(() => {
  console.error(`run-code-progress-check: failed: no completion within ${WATCHDOG_MS} ms`);
  process.exit(1);
}, WATCHDOG_MS);
watchdog.unref();

const workspace = mkdtempSync(join(tmpdir(), 'gm-progress-check-'));
const configDir = mkdtempSync(join(tmpdir(), 'gm-progress-config-'));
const mcpConfig = join(configDir, 'no-default-mcp.json');
writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));

const child = spawn(binary, ['serve', '--workspace', workspace, '--mcp-config', mcpConfig], { stdio: ['pipe', 'pipe', 'pipe'] });
child.stderr.resume();
const pending = new Map();
const progress = [];
let nextId = 1;
readline.createInterface({ input: child.stdout }).on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.method === 'notifications/progress') {
    progress.push({ at: Date.now(), ...message.params });
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
  return new Promise((done) => pending.set(id, done));
};
const unwrap = (value) => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};
const runCode = async (args, meta) => {
  const started = Date.now();
  const reply = await rpc('tools/call', { name: 'run_code', arguments: args, ...(meta ? { _meta: meta } : {}) });
  return { elapsed: Date.now() - started, reply: JSON.parse(reply.result.content[0].text) };
};

const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};

try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gm-progress-check', version: '1' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  const ticks = await runCode(
    { format: 'esm', timeoutMs: 30000, body: "return await gm.run_shell({ command: 'sleep 7; echo ticked', timeoutMs: 20000 });" },
    { progressToken: 'tick-1' },
  );
  const tickBody = unwrap(ticks.reply.output);
  expect(ticks.reply.ok === true && ticks.reply.background === undefined, `foreground: expected a foreground reply, got ${JSON.stringify(ticks.reply).slice(0, 200)}`);
  expect(ticks.elapsed >= 6500, `foreground: returned after ${ticks.elapsed} ms, expected the 7 s body to run to its end`);
  expect(String(tickBody?.output ?? '').includes('ticked'), `foreground: output was ${JSON.stringify(tickBody).slice(0, 200)}`);
  const own = progress.filter((notice) => notice.progressToken === 'tick-1');
  expect(own.length >= 1, 'progress: no notifications/progress with progressToken tick-1 arrived during the 7 s body');
  expect(own.every((notice, index) => index === 0 || notice.progress > own[index - 1].progress), 'progress: progress values must increase');

  const short = await runCode({ format: 'esm', timeoutMs: 2000, body: "return await gm.run_shell({ command: 'sleep 4; echo late', timeoutMs: 10000 });" });
  expect(typeof short.reply.background === 'string' && short.reply.state === 'running', `budget: a 2000 ms timeoutMs call should move to background, got ${JSON.stringify(short.reply).slice(0, 200)}`);
  expect(short.elapsed < 3500, `budget: background reply took ${short.elapsed} ms, expected about 2 s`);

  const longer = await runCode({ format: 'esm', timeoutMs: 30000, body: "return await gm.run_shell({ command: 'sleep 4; echo inside', timeoutMs: 10000 });" });
  const longerBody = unwrap(longer.reply.output);
  expect(longer.reply.ok === true && longer.reply.background === undefined, `budget: a 30000 ms timeoutMs call moved to background: ${JSON.stringify(longer.reply).slice(0, 200)}`);
  expect(String(longerBody?.output ?? '').includes('inside'), `budget: a 30000 ms timeoutMs call returned ${JSON.stringify(longerBody).slice(0, 200)}`);

  if (failures.length) {
    console.error(`run-code-progress-check: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log(`run-code-progress-check: ok (7 s foreground body gave ${own.length} progress notice(s); a 2000 ms budget backgrounded in ${short.elapsed} ms; a 30000 ms budget returned foreground)`);
  }
} finally {
  const exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit');
  child.kill();
  await Promise.race([exited, new Promise((done) => setTimeout(done, 5000))]);
  await removeTree(workspace);
  await removeTree(configDir);
}
process.exit(process.exitCode ?? 0);
