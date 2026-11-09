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
  console.log('shell-stdin-check: skipped (no binary given)');
  process.exit(0);
}

const WATCHDOG_MS = 90000;
const watchdog = setTimeout(() => {
  console.error(`shell-stdin-check: failed: no completion within ${WATCHDOG_MS} ms`);
  process.exit(1);
}, WATCHDOG_MS);
watchdog.unref();

const workspace = mkdtempSync(join(tmpdir(), 'gm-stdin-check-'));
const configDir = mkdtempSync(join(tmpdir(), 'gm-stdin-config-'));
const mcpConfig = join(configDir, 'no-default-mcp.json');
writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));

const child = spawn(binary, ['serve', '--workspace', workspace, '--mcp-config', mcpConfig], { stdio: ['pipe', 'pipe', 'pipe'] });
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

const BODY = `const cat = await gm.run_shell({ command: 'cat', timeoutMs: 10000 });
const read = await gm.run_shell({ command: "echo remote-line | sh -c 'read x; echo got:$x'", timeoutMs: 10000 });
const pipe = await gm.run_shell({ command: 'echo payload | cat', timeoutMs: 10000 });
await gm.job_start({ job: 'stdin-cat', command: 'cat', timeoutMs: 10000 });
await gm.job_start({ job: 'stdin-read', command: "echo remote-line | sh -c 'read x; echo got:$x'", timeoutMs: 10000 });
const jobCat = await gm.job_status({ job: 'stdin-cat', waitMs: 10000 });
const jobRead = await gm.job_status({ job: 'stdin-read', waitMs: 10000 });
return { cat, read: read.output, pipe: pipe.output, jobCat: { state: jobCat.state, exitCode: jobCat.exitCode, output: jobCat.output }, jobRead: { state: jobRead.state, exitCode: jobRead.exitCode, output: jobRead.output } };`;

const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};

try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gm-stdin-check', version: '1' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });

  const started = Date.now();
  const reply = await rpc('tools/call', { name: 'run_code', arguments: { format: 'esm', timeoutMs: 60000, body: BODY } });
  const elapsed = Date.now() - started;
  const result = unwrap(JSON.parse(reply.result.content[0].text).output);
  expect(result && typeof result === 'object', `run_code did not return the body value: ${JSON.stringify(result).slice(0, 200)}`);
  expect(result?.cat?.ok === true && result?.cat?.timedOut !== true, `cat with no input hung or failed: ${JSON.stringify(result?.cat).slice(0, 200)}`);
  expect(elapsed < 9000, `the three shell calls took ${elapsed} ms; a hang would hit the 10000 ms shell timeout`);
  expect(result?.read === 'got:remote-line\n', `a stdin-reading command returned ${JSON.stringify(result?.read)}, expected got:remote-line`);
  expect(result?.pipe === 'payload\n', `piped input returned ${JSON.stringify(result?.pipe)}, expected payload`);
  expect(result?.jobCat?.state === 'exited' && result?.jobCat?.exitCode === 0 && result?.jobCat?.output === '', `job cat with no input did not exit cleanly: ${JSON.stringify(result?.jobCat).slice(0, 200)}`);
  expect(result?.jobRead?.state === 'exited' && String(result?.jobRead?.output ?? '').replace(/\r/g, '').trim() === 'got:remote-line', `a job that reads stdin returned ${JSON.stringify(result?.jobRead).slice(0, 200)}`);

  if (failures.length) {
    console.error(`shell-stdin-check: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log(`shell-stdin-check: ok (cat with no input returned in under ${elapsed} ms; a stdin-reading command got its input and printed its output)`);
  }
} finally {
  const exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit');
  child.kill();
  await Promise.race([exited, new Promise((done) => setTimeout(done, 5000))]);
  await removeTree(workspace);
  await removeTree(configDir);
}
process.exit(process.exitCode ?? 0);
