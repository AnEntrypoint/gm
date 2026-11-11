#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = 'run-code-lifetime-check';
const target = process.argv[2] ?? null;
if (target === null || (!existsSync(resolve(target)))) {
  console.error(`${CHECK}: usage: node tools/check-run-code-lifetime.mjs <node|path-to-native-binary>`);
  process.exit(2);
}
const LIFETIME_MS = 4000;
const SPIN_MS = 9000;
const HOST_MS = 6000;
const REPLY_MS = 120000;

const failures = [];
const expect = (ok, text) => {
  if (!ok) failures.push(text);
};
const parse = (reply) => JSON.parse(reply?.result?.content?.[0]?.text ?? 'null') ?? {};

const workspace = mkdtempSync(join(tmpdir(), 'gm-lifetime-'));
const args = ['--workspace', workspace, '--job-lifetime-ms', String(LIFETIME_MS)];
const child = spawn(resolve(target), ['serve', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.on('error', () => {});
child.stderr.on('data', () => {});
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
const toolReply = (name, args) => rpc('tools/call', { name, arguments: args });

const waitJob = async (job) => {
  let status = {};
  for (let attempt = 0; attempt < 10; attempt += 1) {
    status = parse(await toolReply('run_code', { body: `return await gm.job_status({ job: '${job}', waitMs: 100000 });`, timeoutMs: 150000 })).output ?? {};
    if (status.state !== 'running' && status.state !== 'queued') break;
  }
  return status;
};

let spinWall = 0;
let hostWall = 0;
try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gm-lifetime-check', version: '1' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  await toolReply('next_context', {});

  const spinStart = Date.now();
  const spin = parse(await toolReply('run_code', { body: `const end = Date.now() + ${SPIN_MS}; while (Date.now() < end) {} return 'spun';`, timeoutMs: 1000 }));
  expect(typeof spin.background === 'string', `the spin body did not move to background: ${JSON.stringify(spin).slice(0, 200)}`);
  const spinStatus = typeof spin.background === 'string' ? await waitJob(spin.background) : {};
  spinWall = Date.now() - spinStart;
  expect(spinStatus.state === 'killed' && JSON.stringify(spinStatus).includes('lifetime'), `the spin body ended ${JSON.stringify(spinStatus).slice(0, 240)}`);
  expect(spinWall >= LIFETIME_MS - 500 && spinWall < SPIN_MS, `the spin body was killed after ${spinWall} ms, not near ${LIFETIME_MS} ms`);

  const hostStart = Date.now();
  const host = parse(await toolReply('run_code', { body: `return await gm.run_shell({ command: 'sleep ${HOST_MS / 1000}; echo done', timeoutMs: 30000 });`, timeoutMs: 1000 }));
  expect(typeof host.background === 'string', `the host-call body did not move to background: ${JSON.stringify(host).slice(0, 200)}`);
  const hostStatus = typeof host.background === 'string' ? await waitJob(host.background) : {};
  hostWall = Date.now() - hostStart;
  expect(hostStatus.state === 'exited' && JSON.stringify(hostStatus).includes('done'), `the host-call body ended ${JSON.stringify(hostStatus).slice(0, 240)}`);
  expect(hostWall >= HOST_MS, `the host-call body finished in ${hostWall} ms, before its ${HOST_MS} ms host call`);
} finally {
  child.kill();
  rmSync(workspace, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.log(`${CHECK}: failed: ${failures.join(' | ')}`);
  process.exitCode = 1;
} else {
  console.log(`${CHECK}: ok (${target}: a spin body with a ${LIFETIME_MS} ms job lifetime was killed with reason lifetime after ${spinWall} ms of wall time; a ${HOST_MS} ms run_shell host call did not count against the lifetime and returned done after ${hostWall} ms)`);
}
