#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import readline from 'node:readline';

const CHECK = 'embedded-runtime-check';
const target = process.argv[2] ?? null;
if (target === null || !existsSync(resolve(target))) {
  console.error(`${CHECK}: usage: node tools/check-embedded-runtime.mjs <path-to-native-binary>`);
  process.exit(2);
}
const REPLY_MS = 120000;
const TIMER_MS = 300;
const FRESH_RUNTIMES = 20;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
const short = (value) => JSON.stringify(value ?? null).slice(0, 300);

const scratch = mkdtempSync(join(tmpdir(), 'gm-embedded-runtime-'));
const measured = {};
try {
  const workspace = mkdtempSync(join(scratch, 'ws-'));
  const quiet = join(scratch, 'quiet-mcp.json');
  writeFileSync(quiet, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
  writeFileSync(join(workspace, 'helper.mjs'), "export const doubled = (n) => n * 2;\n");
  const child = spawn(resolve(target), ['serve', '--workspace', workspace, '--run-dir', join(workspace, 'run'), '--mcp-config', quiet], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.on('error', () => {});
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + String(chunk)).slice(-2000);
  });
  const pending = new Map();
  const strayLines = [];
  child.once('exit', () => {
    for (const done of pending.values()) done(null);
    pending.clear();
  });
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      strayLines.push(line.slice(0, 200));
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
  const code = async (body) => {
    const reply = (await rpc('tools/call', { name: 'run_code', arguments: { body } }))?.result?.structuredContent ?? {};
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
    await rpc('tools/call', { name: 'next_context', arguments: {} });

    const globals = await code("return { timer: typeof setTimeout, url: typeof URL, encoder: typeof TextEncoder, hostApi: typeof tjs, alert: typeof alert };");
    if (globals.value?.timer !== 'function') {
      console.log(`${CHECK}: skipped (${target}: this build has no embedded txiki runtime, setTimeout is ${globals.value?.timer}; it is built where GMNEW_TXIKI is ON)`);
      process.exitCode = 0;
    } else {
      expect(globals.value.url === 'function' && globals.value.encoder === 'function', `the web globals of the embedded runtime are missing: ${short(globals.value)}`);
      expect(globals.value.hostApi === 'undefined' && globals.value.alert === 'undefined', `the embedded runtime's own host API is visible to a body: ${short(globals.value)}`);

      const timed = await code(`const began = Date.now(); const value = await new Promise((done) => setTimeout(() => done('fired'), ${TIMER_MS})); return { value, waited: Date.now() - began };`);
      measured.timerWaitedMs = timed.value?.waited ?? null;
      expect(timed.value?.value === 'fired' && timed.value?.waited >= TIMER_MS - 20, `a body awaiting a ${TIMER_MS} ms timer did not get its value after the wait: ${short(timed.reply)}`);

      const parsed = await code("const url = new URL('https://example.org:8443/a/b?x=1#frag'); return { host: url.host, path: url.pathname, x: url.searchParams.get('x'), bytes: new TextEncoder().encode('gm').length };");
      expect(parsed.value?.host === 'example.org:8443' && parsed.value?.path === '/a/b' && parsed.value?.x === '1' && parsed.value?.bytes === 2, `URL and TextEncoder do not work in a body: ${short(parsed.reply)}`);

      const logged = await code("console.log('not on the protocol stream'); console.error('nor this'); return 'quiet';");
      expect(logged.value === 'quiet' && strayLines.length === 0, `console output reached the protocol stream: ${short(strayLines)}`);

      const imported = await code("const helper = await import('./helper.mjs'); return helper.doubled(21);");
      expect(imported.value === 42, `a body's relative import did not load through the module loader: ${short(imported.reply)}`);

      const verbs = await code("const [file, rows] = await Promise.all([gm.read_file({ path: 'helper.mjs' }), gm.prd_list({})]); return { file: file.output, rowsOk: rows.ok };");
      expect(String(verbs.value?.file).includes('doubled') && verbs.value?.rowsOk === true, `a native verb and a leaf verb did not both answer: ${short(verbs.reply)}`);

      const pendingForever = await code("return await new Promise(() => {});");
      expect(pendingForever.reply.ok === false && String(pendingForever.reply.error).length > 0, `a promise that can never settle, with no timer alive, did not end with an error: ${short(pendingForever.reply)}`);

      const startedAt = Date.now();
      for (let round = 0; round < FRESH_RUNTIMES; round += 1) await code('return 1;');
      measured.msPerBody = Math.round((Date.now() - startedAt) / FRESH_RUNTIMES);

      if (failures.length) {
        console.error(`${CHECK}: ${failures.length} failure(s) on ${target}\n- ${failures.join('\n- ')}\n${CHECK}: measured ${JSON.stringify(measured)}; stderr ${stderr.trim().slice(-400) || '(empty)'}`);
        process.exitCode = 1;
      } else {
        console.log(`${CHECK}: ok (${target}: a body awaited a ${TIMER_MS} ms timer for ${measured.timerWaitedMs} ms; URL and TextEncoder work; the runtime's own host API is hidden; console output stays off the protocol stream; a relative import loads; native and leaf verbs answer; a never-settling promise ends with an error; a trivial body takes ${measured.msPerBody} ms with a fresh runtime each time)`);
      }
    }
  } finally {
    const gone = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit');
    child.kill();
    await Promise.race([gone, sleep(5000)]);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
process.exit(process.exitCode ?? 0);
