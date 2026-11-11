#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ?? null;
const CLOCK = process.argv.includes('--real-clock') ? 1 : 1 / 60;
process.env.GMNEW_TEST_CLOCK = '1';
process.env.GM_CLOCK_SCALE = String(CLOCK);
const scaled = (ms) => Math.max(1, Math.round(ms * CLOCK));
const FETCH_MS = Math.max(300, scaled(3000));
const onNode = target === 'node';
const binary = onNode ? process.execPath : target === null ? null : resolve(target);
const lead = onNode ? [join(root, 'src', 'mcp.mjs')] : ['serve'];
if (binary === null || (!onNode && !existsSync(binary))) {
  console.log('run-code-budget-check: skipped (no binary given)');
  process.exit(0);
}

const WATCHDOG_MS = 540000;
const watchdog = setTimeout(() => {
  console.error(`run-code-budget-check: failed: no completion within ${WATCHDOG_MS} ms`);
  process.exit(1);
}, WATCHDOG_MS);
watchdog.unref();

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

const HOLD_MS = scaled(50000);
const SLOW_LINE = `${'a'.repeat(31)}b`;
const slow = http.createServer((req, res) => (req.url === '/fast' ? res.end(`${SLOW_LINE}\n`) : setTimeout(() => res.end(`${SLOW_LINE}\n`), HOLD_MS)));
await new Promise((done) => slow.listen(0, '127.0.0.1', done));
const port = slow.address().port;

const workspace = mkdtempSync(join(tmpdir(), 'gm-budget-check-'));
const configDir = mkdtempSync(join(tmpdir(), 'gm-budget-config-'));
const mcpConfig = join(configDir, 'no-default-mcp.json');
writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));

const child = spawn(binary, [...lead, '--workspace', workspace, '--mcp-config', mcpConfig], { stdio: ['pipe', 'pipe', 'pipe'] });
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
const runCode = async (args) => {
  const started = Date.now();
  const reply = await rpc('tools/call', { name: 'run_code', arguments: args });
  if (!reply.result) throw new Error(`run_code had no result: ${JSON.stringify(reply).slice(0, 400)}`);
  return { elapsed: Date.now() - started, reply: JSON.parse(reply.result.content[0].text) };
};

const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};

try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gm-budget-check', version: '1' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  await rpc('tools/call', { name: 'next_context', arguments: {} });

  const [spin, leaf, matched, timedOutCall] = await Promise.all([
    runCode({
      format: 'esm',
      timeoutMs: scaled(100000),
      body: `const end = Date.now() + ${scaled(65000)}; let n = 0; while (Date.now() < end) { n += 1; } return { spun: n > 0 };`,
    }),
    runCode({
      format: 'esm',
      timeoutMs: scaled(400000),
      body: `return await gm.fetch({ url: 'http://127.0.0.1:${port}/', timeoutMs: ${scaled(60000)} });`,
    }),
    runCode({
      format: 'esm',
      timeoutMs: 100000,
      body: `return await gm.fetch({ url: 'http://127.0.0.1:${port}/fast', match: '(a+)+$', timeoutMs: ${FETCH_MS} });`,
    }),
    runCode({
      format: 'esm',
      timeoutMs: 100000,
      body: `return await gm.fetch({ url: 'http://127.0.0.1:${port}/', timeoutMs: ${FETCH_MS} });`,
    }),
  ]);

  const spinBody = unwrap(spin.reply.output ?? spin.reply);
  expect(spin.reply.ok === true && spin.reply.background === undefined, `js budget: a ${scaled(100000)} ms timeoutMs body moved to background or failed: ${JSON.stringify(spin.reply).slice(0, 200)}`);
  expect(spin.elapsed >= scaled(64000), `js budget: the ${scaled(65000)} ms body returned after ${spin.elapsed} ms`);
  expect(spinBody?.spun === true, `js budget: the body returned ${JSON.stringify(spinBody).slice(0, 200)}`);

  const leafValue = unwrap(leaf.reply.output ?? leaf.reply);
  const leafBody = JSON.stringify(leaf.reply);
  expect(!new RegExp(`passed its deadline of (${scaled(120000)}|${scaled(60000)}) ms`).test(leafBody), `leaf deadline: the old fixed limit cut the fetch leaf after ${leaf.elapsed} ms: ${leafBody.slice(0, 200)}`);
  expect(leaf.elapsed >= HOLD_MS, `leaf deadline: the server held the fetch for ${HOLD_MS} ms but the leaf returned after ${leaf.elapsed} ms`);
  expect(leaf.reply.background === undefined && leafValue?.status === 200, `leaf deadline: expected status 200 in the foreground reply after ${leaf.elapsed} ms, got ${leafBody.slice(0, 200)}`);

  const matchValue = unwrap(matched.reply.output ?? matched.reply);
  expect(matched.elapsed < 20000, `match bound: a ${FETCH_MS} ms fetch with a catastrophic match returned after ${matched.elapsed} ms`);
  expect(matchValue?.code === 'ETIMEDOUT' && matchValue?.error === `timed out after ${FETCH_MS} ms` && matchValue?.attempts === 1, `match bound: expected a ${FETCH_MS} ms timeout in one attempt, got ${JSON.stringify(matchValue).slice(0, 200)}`);

  const timeoutValue = unwrap(timedOutCall.reply.output ?? timedOutCall.reply);
  expect(timedOutCall.elapsed < 15000, `whole call: a ${FETCH_MS} ms fetch that times out returned after ${timedOutCall.elapsed} ms`);
  expect(timeoutValue?.code === 'ETIMEDOUT' && timeoutValue?.attempts === 1, `whole call: expected a timeout in one attempt, got ${JSON.stringify(timeoutValue).slice(0, 200)}`);

  if (failures.length) {
    console.error(`run-code-budget-check: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log(`run-code-budget-check: ok (a ${scaled(65000)} ms JavaScript body with timeoutMs ${scaled(100000)} returned in ${spin.elapsed} ms; a fetch leaf held by the server for ${HOLD_MS} ms ended in ${leaf.elapsed} ms with no old fixed limit; a ${FETCH_MS} ms fetch with a catastrophic match timed out in ${matched.elapsed} ms in one attempt; a ${FETCH_MS} ms fetch that timed out ended in ${timedOutCall.elapsed} ms in one attempt)`);
  }
} finally {
  const exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit');
  child.kill();
  await Promise.race([exited, new Promise((done) => setTimeout(done, 5000))]);
  slow.close();
  await removeTree(workspace);
  await removeTree(configDir);
}
process.exit(process.exitCode ?? 0);
