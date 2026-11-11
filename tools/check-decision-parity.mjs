#!/usr/bin/env node
import { spawn } from './lib/group.mjs';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = 'decision-parity-check';
const target = process.argv[2] ?? null;
if (target === null || (!existsSync(resolve(target)))) {
  console.error(`${CHECK}: usage: node tools/check-decision-parity.mjs <node|path-to-native-binary>`);
  process.exit(2);
}
const REPLY_MS = 240000;
const MAX_STEPS = 2;
const LIFETIME_MS = 3600000;

const failures = [];
const expect = (ok, text) => {
  if (!ok) failures.push(text);
};
const parse = (reply) => JSON.parse(reply?.result?.content?.[0]?.text ?? 'null') ?? {};

const session = (lifetime) => {
  const workspace = mkdtempSync(join(tmpdir(), 'gm-decision-'));
  const args = ['--workspace', workspace, '--max-steps', String(MAX_STEPS)];
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
  const body = async (code, timeoutMs = 150000) => parse(await toolReply('run_code', { body: code, timeoutMs }));
  const close = () => {
    child.kill();
    rmSync(workspace, { recursive: true, force: true });
  };
  return { rpc, toolReply, body, close };
};

const start = async (s) => {
  await s.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gm-decision-check', version: '1' } });
  await s.toolReply('next_context', {});
};

const results = {};

{
  const s = session();
  try {
    await start(s);
    await s.rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
    const started = await s.body("return await gm.job_start({ job: 'lifetime-probe', command: 'sleep 2', timeoutMs: 7200000 });");
    const status = await s.body("return await gm.job_status({ job: 'lifetime-probe', waitMs: 0 });");
    results.shellLifetime = status.output?.timeoutMs ?? null;
    expect(results.shellLifetime === LIFETIME_MS, `job_start timeoutMs 7200000 reported ${results.shellLifetime}, not the job lifetime ${LIFETIME_MS}`);
  } finally {
    s.close();
  }
}

{
  const s = session();
  try {
    await start(s);
    await s.rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
    const exec = await s.body("return await gm.playwriter_execute({ code: '1 + 1' });", 240000);
    results.wrap = JSON.stringify(exec.output ?? exec).slice(0, 200);
    expect(/\b2\b/.test(results.wrap), `playwriter_execute of 1 + 1 did not return 2: ${results.wrap}`);
  } finally {
    s.close();
  }
}

{
  const s = session();
  try {
    await start(s);
    await s.rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
    const row = await s.body("return await gm.unknown_add({ title: 'decision probe', body: 'probe for the finish step limit' });");
    const id = typeof row.output?.output === 'string' ? row.output.output : null;
    expect(typeof id === 'string', `unknown_add did not return an id: ${JSON.stringify(row).slice(0, 200)}`);
    await s.toolReply('next_context', {});
    const refused = parse(await s.toolReply('finish', { witness: 'decision probe: step limit with one open row' }));
    results.finishRefused = refused.error ?? null;
    expect(refused.finished !== true && String(refused.error ?? '').includes('row(s) open'), `finish at the step limit without openRows was not refused for the open row: ${JSON.stringify(refused).slice(0, 240)}`);
    const accepted = parse(await s.toolReply('finish', { witness: 'decision probe: step limit with one open row', openRows: [{ id, reason: 'probe closes the run at the step limit' }] }));
    results.finishAccepted = accepted.finished === true;
    expect(accepted.finished === true, `finish with openRows at the step limit was not accepted: ${JSON.stringify(accepted).slice(0, 240)}`);
  } finally {
    s.close();
  }
}

if (failures.length > 0) {
  console.log(`${CHECK}: failed: ${failures.join(' | ')}`);
  process.exitCode = 1;
} else {
  console.log(`${CHECK}: ok (${target}: job_start timeoutMs 7200000 reported ${results.shellLifetime} ms; playwriter_execute of 1 + 1 returned 2; at max-steps ${MAX_STEPS} finish without openRows was refused with row(s) open, and with openRows it finished)`);
}
