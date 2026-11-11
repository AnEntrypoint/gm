#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = 'no-resource-client-check';
const target = process.argv[2] ?? null;
if (target === null || (!existsSync(resolve(target)))) {
  console.error(`${CHECK}: usage: node tools/check-no-resource-client.mjs <node|path-to-native-binary>`);
  process.exit(2);
}
const REPLY_MS = 120000;
const RESTART_MS = 60000;
const REFUSAL_OVERHEAD_BYTES = 2000;
const TOOL_ONLY_METHODS = new Set(['initialize', 'tools/list', 'tools/call']);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const openToolOnlyClient = (command, args) => {
  const lead = ['serve'];
  const child = spawn(command, [...lead, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stdin.on('error', () => {});
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + String(chunk)).slice(-2000);
  });
  let exited = false;
  const pending = new Map();
  child.once('exit', () => {
    exited = true;
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
  const sent = [];
  const rpc = (method, params) =>
    new Promise((done) => {
      if (!TOOL_ONLY_METHODS.has(method)) throw new Error(`${method} is not a method a tool-only client sends`);
      if (exited) {
        done(null);
        return;
      }
      sent.push(method);
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
  const tool = async (name, args) => (await toolReply(name, args))?.result?.structuredContent ?? {};
  const close = async () => {
    const gone = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit');
    child.kill();
    await Promise.race([gone, sleep(5000)]);
  };
  return { rpc, tool, toolReply, close, sent, initialized: () => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`), stderr: () => stderr.trim() || '(empty)' };
};

const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
const short = (value) => JSON.stringify(value ?? null).slice(0, 300);

const refusalSize = { bytes: 0, skill: 0 };
const scratch = mkdtempSync(join(tmpdir(), 'gm-no-resource-client-'));
try {
  const workspace = mkdtempSync(join(scratch, 'ws-'));
  const quiet = join(scratch, 'quiet-mcp.json');
  writeFileSync(quiet, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
  writeFileSync(join(workspace, 'sample.txt'), 'tool-only client\n');
  const runDir = join(workspace, 'run');
  const engine = join(mkdtempSync(join(scratch, 'bin-')), basename(resolve(target)));
  copyFileSync(resolve(target), engine);
  for (const sub of ['leaves', 'skills', 'defaults']) cpSync(join(dirname(resolve(target)), sub), join(dirname(engine), sub), { recursive: true });
  chmodSync(engine, 0o755);
  const restartCount = () =>
    readFileSync(join(runDir, 'log.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line.includes('"kind":"restart"')).length;
  const restartWorker = () => {
    const future = new Date(Date.now() + 60000);
    utimesSync(engine, future, future);
  };
  const client = openToolOnlyClient(engine, ['--workspace', workspace, '--run-dir', runDir, '--mcp-config', quiet]);
  try {
    const init = await client.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CHECK, version: '1' } });
    expect(init?.result !== undefined, `no initialize result (stderr ${client.stderr()})`);
    client.initialized();
    const listed = (await client.rpc('tools/list', {}))?.result?.tools?.map((entry) => entry.name) ?? [];
    expect(listed.includes('run_code') && listed.includes('next_context'), `tools/list lacks run_code or next_context: ${short(listed)}`);

    const refusal = await client.toolReply('run_code', { body: "return (await gm.read_file({ path: 'sample.txt', fresh: true })).output;" });
    const gated = refusal?.result?.structuredContent ?? {};
    const blocks = refusal?.result?.content ?? [];
    const disk = readFileSync(join(root, 'skills', 'gm', 'SKILL.md'), 'utf8');
    const refusalBytes = Buffer.byteLength(JSON.stringify(refusal ?? null));
    const skillBytes = Buffer.byteLength(JSON.stringify(disk));
    const marker = disk.split('\n').find((line) => line.startsWith('description:'));
    Object.assign(refusalSize, { bytes: refusalBytes, skill: skillBytes });
    expect(gated.ok === false && String(gated.error).startsWith('run_code refused:'), `the first run_code was not refused: ${short(gated)}`);
    const carried = JSON.parse(blocks[0]?.text ?? 'null');
    const delivered = carried?.skill ?? blocks[1]?.text;
    expect(delivered === disk && blocks.length <= 2, `the refusal's reply JSON does not carry the served skill text in its skill field (${blocks.length} blocks, disk ${disk.length} chars)`);
    expect(JSON.stringify(refusal ?? null).split(JSON.stringify(marker).slice(1, -1)).length - 1 === 1, 'the refusal does not hold the skill text exactly once');
    expect(refusalBytes <= skillBytes + REFUSAL_OVERHEAD_BYTES, `the refusal is ${refusalBytes} bytes; one copy of the skill is ${skillBytes} bytes`);
    expect(gated.rulesNotice === undefined, `the refusal carries a rules notice: ${short(gated.rulesNotice)}`);

    const early = await client.tool('run_code', { body: "return (await gm.read_file({ path: 'sample.txt', fresh: true })).output;" });
    expect(early.ok === true && short(early).includes('tool-only client'), `the second run_code did not run its body: ${short(early)}`);
    expect(String(early.rulesNotice ?? '').includes('rule 2'), `run_code before next_context has no rule 2 notice: ${short(early.rulesNotice)}`);

    const first = await client.tool('next_context', {});
    expect(first.ok === true && first.step === 1, `next_context did not open step 1: ${short({ ok: first.ok, step: first.step, error: first.error })}`);
    expect(String(first.rulesPending ?? '').includes('rule 2'), `the first next_context does not report rule 2 once: ${short(first.rulesPending)}`);

    const after = await client.tool('run_code', { body: "return (await gm.read_file({ path: 'sample.txt', fresh: true })).output;" });
    expect(after.ok === true && short(after).includes('tool-only client'), `run_code after next_context did not run: ${short(after)}`);
    expect(after.rulesNotice === undefined, `the rule 2 notice is still on run_code after a correct next_context: ${short(after.rulesNotice)}`);

    const viaVerb = await client.tool('run_code', { body: "return (await gm.read_file({ path: 'skill://gm/SKILL.md' })).output.length;" });
    expect(viaVerb.ok === true, `gm.read_file of the skill uri failed in a body: ${short(viaVerb)}`);

    const second = await client.tool('next_context', {});
    expect(second.ok === true && second.unchanged === true, `the second next_context, with nothing new, is not the unchanged reply: ${short({ ok: second.ok, unchanged: second.unchanged, step: second.step })}`);
    expect(second.rulesPending === undefined, `the second next_context still has rulesPending: ${short(second.rulesPending)}`);

    const restartsBefore = restartCount();
    if (process.platform !== 'win32') restartWorker();
    const restartDeadline = Date.now() + RESTART_MS;
    while (process.platform !== 'win32' && restartCount() === restartsBefore && Date.now() < restartDeadline) await sleep(100);
    expect(process.platform === 'win32' || restartCount() > restartsBefore, `no restart event in the run log within ${RESTART_MS} ms of the trigger`);
    const afterRestart = await client.tool('run_code', { body: "return (await gm.read_file({ path: 'sample.txt', fresh: true })).output;" });
    expect(afterRestart.ok === true && short(afterRestart).includes('tool-only client'), `run_code after a worker restart did not run for the tool-only client: ${short(afterRestart)}`);

    const finished = await client.tool('finish', { witness: 'run_code returned "tool-only client" from sample.txt with no resources/read on the connection' });
    expect(finished.ok === true && finished.finished === true, `finish was refused: ${short(finished)}`);
    expect(client.sent.every((method) => TOOL_ONLY_METHODS.has(method)), `the client sent a method outside initialize, tools/list and tools/call: ${short(client.sent)}`);
  } finally {
    await client.close();
  }

  if (failures.length) {
    console.error(`${CHECK}: ${failures.length} failure(s) on ${target}\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log(`${CHECK}: ok (${target}: with only initialize, tools/list and tools/call, the first run_code is refused once with one copy of the skill text (${refusalSize.bytes} bytes for a ${refusalSize.skill}-byte skill), the next run_code runs, the rule 2 notice is reported by the next next_context and is gone after it, run_code runs after a worker restart, and finish ends the run)`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
process.exit(process.exitCode ?? 0);
