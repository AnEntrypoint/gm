#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ?? null;
const onNode = target === 'node';
const binary = onNode ? process.execPath : target === null ? null : resolve(target);
const lead = onNode ? [join(root, 'src', 'mcp.mjs')] : ['serve'];
if (binary === null || (!onNode && !existsSync(binary))) {
  console.log('job-bounds-check: skipped (no binary given)');
  process.exit(0);
}

const LIFETIME_MS = 5000;
const WATCHDOG_MS = 240000;
const watchdog = setTimeout(() => {
  console.error(`job-bounds-check: failed: no completion within ${WATCHDOG_MS} ms`);
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

const workspace = mkdtempSync(join(tmpdir(), 'gm-job-bounds-'));
const configDir = mkdtempSync(join(tmpdir(), 'gm-job-bounds-config-'));
const mcpConfig = join(configDir, 'no-default-mcp.json');
writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));

const child = spawn(binary, [...lead, '--workspace', workspace, '--mcp-config', mcpConfig, '--job-lifetime-ms', String(LIFETIME_MS)], { stdio: ['pipe', 'pipe', 'pipe'] });
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
const runCode = async (body) => {
  const reply = await rpc('tools/call', { name: 'run_code', arguments: { format: 'esm', timeoutMs: 120000, body } });
  return unwrap(JSON.parse(reply.result.content[0].text).output);
};
const job = (name, command, timeoutMs) => `
  const t0 = Date.now();
  await gm.job_start({ job: ${JSON.stringify(name)}, command: ${JSON.stringify(command)}, timeoutMs: ${timeoutMs} });
  const status = await gm.job_status({ job: ${JSON.stringify(name)}, waitMs: 60000 });
  return { elapsed: Date.now() - t0, status };
`;
const sleepCommand = (ms) => `node -e "setTimeout(() => {}, ${ms})"`;

const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};

try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gm-job-bounds-check', version: '1' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  await rpc('tools/call', { name: 'next_context', arguments: {} });

  const [byTimeout, byLifetime, exited] = await Promise.all([
    runCode(job('bound-timeout', sleepCommand(30000), 2000)),
    runCode(job('bound-lifetime', sleepCommand(30000), 7200000)),
    runCode(job('bound-exit', sleepCommand(1000), 3000)),
  ]);

  const t = byTimeout.status;
  expect(t?.state === 'killed' && t?.reason === 'timeout', `timeout bound: a 2000 ms job with a 5000 ms lifetime ended ${JSON.stringify(t).slice(0, 200)}`);
  expect(byTimeout.elapsed >= 1900 && byTimeout.elapsed < 6000, `timeout bound: the job ended after ${byTimeout.elapsed} ms, expected about 2000`);

  const l = byLifetime.status;
  expect(l?.state === 'killed' && l?.reason === 'lifetime', `lifetime bound: a 7200000 ms job ended ${JSON.stringify(l).slice(0, 200)}`);
  expect(String(l?.statement ?? '').includes(`the job lifetime of ${LIFETIME_MS} ms`), `lifetime bound: the statement is ${JSON.stringify(l?.statement)}`);
  expect(byLifetime.elapsed >= LIFETIME_MS - 200 && byLifetime.elapsed < 9000, `lifetime bound: the job ended after ${byLifetime.elapsed} ms, expected about ${LIFETIME_MS}`);

  const e = exited.status;
  expect(e?.state === 'exited' && e?.exitCode === 0, `natural exit: a 1000 ms job with a 3000 ms timeout ended ${JSON.stringify(e).slice(0, 200)}`);
  expect(exited.elapsed < 4000, `natural exit: the job took ${exited.elapsed} ms`);

  if (failures.length) {
    console.error(`job-bounds-check: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log(`job-bounds-check: ok (a 2000 ms job timeout ended as timeout in ${byTimeout.elapsed} ms; a 7200000 ms job timeout ended as lifetime at ${byLifetime.elapsed} ms under a ${LIFETIME_MS} ms lifetime; a 1000 ms job exited 0 in ${exited.elapsed} ms)`);
  }
} finally {
  const exitedChild = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit');
  child.kill();
  await Promise.race([exitedChild, new Promise((done) => setTimeout(done, 5000))]);
  await removeTree(workspace);
  await removeTree(configDir);
}
process.exit(process.exitCode ?? 0);
