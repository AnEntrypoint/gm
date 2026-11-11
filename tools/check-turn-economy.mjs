#!/usr/bin/env node
import { spawn } from './lib/group.mjs';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = 'turn-economy-check';
const target = process.argv[2] ?? null;
if (target === null || (!existsSync(resolve(target)))) {
  console.error(`${CHECK}: usage: node tools/check-turn-economy.mjs <node|path-to-native-binary>`);
  process.exit(2);
}
const CLOCK = process.argv.includes('--real-clock') ? 1 : 1 / 60;
process.env.GMNEW_TEST_CLOCK = '1';
process.env.GM_CLOCK_SCALE = String(CLOCK);
const scaled = (ms) => Math.max(1, Math.round(ms * CLOCK));
const REPLY_MS = 180000;
const OLD_WAIT_CAP_MS = scaled(30000);
const SLOW_JOB_MS = scaled(45000);
const UNCHANGED_REPLY_BYTES = 1200;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
const short = (value) => JSON.stringify(value ?? null).slice(0, 300);

const scratch = mkdtempSync(join(tmpdir(), 'gm-turn-economy-'));
const measured = {};
try {
  const workspace = mkdtempSync(join(scratch, 'ws-'));
  const quiet = join(scratch, 'quiet-mcp.json');
  writeFileSync(quiet, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
  writeFileSync(join(workspace, 'a.txt'), 'alpha\n');
  writeFileSync(join(workspace, 'b.txt'), 'beta\n');
  const lead = ['serve'];
  const child = spawn(resolve(target), [...lead, '--workspace', workspace, '--run-dir', join(workspace, 'run'), '--mcp-config', quiet], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.on('error', () => {});
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + String(chunk)).slice(-2000);
  });
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
  const toolReply = (name, args) => rpc('tools/call', { name, arguments: args });
  const tool = async (name, args) => (await toolReply(name, args))?.result?.structuredContent ?? {};
  const code = async (body, timeoutMs) => {
    const reply = await tool('run_code', timeoutMs === undefined ? { body } : { body, timeoutMs });
    let value = null;
    try {
      value = JSON.parse(reply.output);
    } catch {
      value = reply.output ?? null;
    }
    return { reply, value };
  };
  try {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CHECK, version: '1' } });
    expect(init?.result !== undefined, `no initialize result (stderr ${stderr.trim() || '(empty)'})`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });

    const first = await tool('next_context', {});
    expect(first.ok === true && first.step === 1 && typeof first.rules === 'string' && first.rules.includes('not before every step'), `the first next_context is not a full step 1 with the new rule 2: ${short({ ok: first.ok, step: first.step, rules: first.rules?.slice(0, 200) })}`);

    const repeatReply = await toolReply('next_context', {});
    const repeat = repeatReply?.result?.structuredContent ?? {};
    measured.fullReplyBytes = Buffer.byteLength(JSON.stringify(first));
    measured.unchangedReplyBytes = Buffer.byteLength(JSON.stringify(repeat));
    expect(repeat.ok === true && repeat.unchanged === true && repeat.rules === undefined && repeat.task === undefined, `a second next_context with nothing new is not the short unchanged reply: ${short(repeat)}`);
    expect(repeat.stepsLeft === first.stepsLeft, `the unchanged reply used a step: stepsLeft ${repeat.stepsLeft}, was ${first.stepsLeft}`);
    expect(measured.unchangedReplyBytes <= UNCHANGED_REPLY_BYTES, `the unchanged reply is ${measured.unchangedReplyBytes} bytes; the limit is ${UNCHANGED_REPLY_BYTES}`);

    const batch = await code("const [a, b] = await Promise.all([gm.read_file({ path: 'a.txt' }), gm.read_file({ path: 'b.txt' })]); return { a: a.output, b: b.output };");
    expect(batch.value?.a === 'alpha\n' && batch.value?.b === 'beta\n', `a two-verb body did not return both files: ${short(batch.reply)}`);
    expect(batch.reply.batchNotice === undefined && batch.reply.pendingEvents === undefined, `a two-verb body with nothing pending carries a notice: ${short({ batchNotice: batch.reply.batchNotice, pendingEvents: batch.reply.pendingEvents })}`);

    const afterOwnCall = await tool('next_context', {});
    expect(afterOwnCall.unchanged === true, `next_context after only the caller's own run_code is not unchanged: ${short({ unchanged: afterOwnCall.unchanged, step: afterOwnCall.step })}`);

    const forced = await tool('next_context', { full: true });
    expect(forced.ok === true && forced.step === 2 && typeof forced.rules === 'string', `next_context with full: true is not a full step 2: ${short({ ok: forced.ok, step: forced.step, unchanged: forced.unchanged })}`);

    const singles = [];
    for (let round = 0; round < 3; round += 1) singles.push((await code("return (await gm.read_file({ path: 'a.txt' })).output;")).reply);
    expect(singles[0].batchNotice === undefined && singles[1].batchNotice === undefined, 'a batch notice came before the third single-verb body');
    expect(typeof singles[2].batchNotice === 'string' && singles[2].batchNotice.includes('one body'), `the third single-verb body in a row has no batch notice: ${short(singles[2])}`);

    const startedAt = Date.now();
    const jobs = await code(
      `const [slow, short, gone] = await Promise.all([
        (async () => { await gm.job_start({ job: 'slow', command: 'sleep ${SLOW_JOB_MS / 1000}; echo slow', timeoutMs: 120000 }); const began = Date.now(); const ended = await gm.job_status({ job: 'slow', waitMs: 120000, tail: 5 }); return { state: ended.state, exitCode: ended.exitCode, output: ended.output, durMs: ended.durMs, waitedMs: Date.now() - began }; })(),
        (async () => { await gm.job_start({ job: 'short', command: 'sleep 30', timeoutMs: 500 }); const ended = await gm.job_status({ job: 'short', waitMs: 20000, tail: 200 }); return { state: ended.state, reason: ended.reason, statement: ended.statement }; })(),
        (async () => { await gm.job_start({ job: 'quick', command: 'sleep ${scaled(2000) / 1000}' }); const pid = (await gm.job_status({ job: 'quick' })).pid; const waited = await gm.job_status({ pid, waitMs: 20000 }); return { pid, state: waited.state, waitedMs: waited.waitedMs, exitCode: waited.exitCode }; })(),
      ]);
      return { slow, short, gone };`,
      150000,
    );
    measured.jobsBodyWallMs = Date.now() - startedAt;
    const { slow, short: stopped, gone } = jobs.value ?? {};
    measured.slowWaitedMs = slow?.waitedMs ?? null;
    expect(slow?.state === 'exited' && slow?.exitCode === 0 && String(slow?.output).trim() === 'slow', `one job_status call did not return the slow job's exit and its 5-character tail: ${short(slow)}`);
    expect(typeof slow?.waitedMs === 'number' && slow.waitedMs > OLD_WAIT_CAP_MS, `the wait returned after ${slow?.waitedMs} ms, not past the old ${OLD_WAIT_CAP_MS} ms cap`);
    expect(typeof slow?.durMs === 'number' && slow.durMs >= SLOW_JOB_MS, `the ended job has no wall time: durMs ${slow?.durMs}`);
    expect(stopped?.state === 'killed' && stopped?.reason === 'timeout' && String(stopped?.statement).includes('pass timeoutMs'), `a job stopped at its limit does not say how to raise it: ${short(stopped)}`);
    expect(process.platform === 'win32' || (gone?.state === 'gone' && gone?.exitCode === null && typeof gone?.waitedMs === 'number' && gone.waitedMs < 15000), `job_status with a pid did not wait for the process to end: ${short(gone)}`);
    expect(jobs.reply.pendingEvents === true, `a run_code reply with job events queued has no pendingEvents: ${short({ pendingEvents: jobs.reply.pendingEvents })}`);

    const afterJobs = await tool('next_context', {});
    expect(afterJobs.ok === true && afterJobs.unchanged === undefined && typeof afterJobs.rules === 'string' && short(afterJobs.pending ?? afterJobs).length > 0 && afterJobs.step === 3, `next_context with job events pending is not a full step: ${short({ unchanged: afterJobs.unchanged, step: afterJobs.step })}`);
    const settled = await tool('next_context', {});
    expect(settled.unchanged === true, `next_context after the events were delivered is not unchanged: ${short({ unchanged: settled.unchanged, step: settled.step })}`);
  } finally {
    const gone = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit');
    child.kill();
    await Promise.race([gone, sleep(5000)]);
  }

  if (failures.length) {
    console.error(`${CHECK}: ${failures.length} failure(s) on ${target}\n- ${failures.join('\n- ')}\n${CHECK}: measured ${JSON.stringify(measured)}`);
    process.exitCode = 1;
  } else {
    console.log(`${CHECK}: ok (${target}: a next_context with nothing new answers unchanged in ${measured.unchangedReplyBytes} bytes against ${measured.fullReplyBytes} for a full reply and takes no step; full: true and pending events give a full step; the third single-verb body carries batchNotice; one job_status call waited ${measured.slowWaitedMs} ms for a job and returned its exit code, tail and wall time; a job stopped at its limit says to pass timeoutMs; a pid wait returned when the process ended; a reply with events queued carries pendingEvents; the job body took ${measured.jobsBodyWallMs} ms)`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
process.exit(process.exitCode ?? 0);
