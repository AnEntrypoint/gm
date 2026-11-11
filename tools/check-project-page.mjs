#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import readline from 'node:readline';

const CHECK = 'project-page-check';
const target = process.argv[2] ?? null;
if (target === null || !existsSync(resolve(target))) {
  console.error(`${CHECK}: usage: node tools/check-project-page.mjs <path-to-native-binary>`);
  process.exit(2);
}
const REPLY_MS = 180000;
const MARKER = 'gm-project-page';
const OPEN = `(await page.goto('data:text/html,<title>${MARKER}</title>'), page.url())`;
const TITLE = 'page.title()';
const URL = 'page.url()';

const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
const started = Date.now();
const scratch = mkdtempSync(join(tmpdir(), 'gm-project-page-'));

function serve(workspace) {
  const child = spawn(resolve(target), ['serve', '--workspace', workspace, '--run-dir', join(workspace, 'run')], { stdio: ['pipe', 'pipe', 'pipe'] });
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
  const runCode = async (body) => (await rpc('tools/call', { name: 'run_code', arguments: { body } }))?.result?.structuredContent ?? {};
  const execute = async (expression) => {
    const reply = await runCode(`return await gm.playwriter_execute({ code: ${JSON.stringify(expression)} });`);
    const payload = reply?.output !== null && typeof reply?.output === 'object' ? reply.output.output : reply?.output;
    const output = typeof payload === 'string' ? payload : String(reply?.error ?? '');
    const returned = /\[return value\] (.*)/.exec(output);
    return { reply, text: returned === null ? output : returned[1] };
  };
  const start = async () => {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CHECK, version: '1' } });
    expect(init?.result !== undefined, `${workspace}: no initialize result`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
    await rpc('tools/call', { name: 'next_context', arguments: {} });
  };
  return { child, start, execute, runCode };
}

try {
  const wsA = mkdtempSync(join(scratch, 'a-'));
  const wsB = mkdtempSync(join(scratch, 'b-'));
  writeFileSync(join(wsA, 'README.md'), 'a\n');
  writeFileSync(join(wsB, 'README.md'), 'b\n');
  const a = serve(wsA);
  const b = serve(wsB);
  try {
    await a.start();
    const first = await a.execute(OPEN);
    expect(first.reply.ok === true && first.text.includes(MARKER), `the first run did not open the project page: ${first.text.slice(0, 300)}`);
    const second = await a.execute(TITLE);
    expect(second.reply.ok === true && second.text.includes(MARKER), `the second run_code did not find the project page: ${second.text.slice(0, 300)}`);
    await b.start();
    const other = await b.execute(URL);
    expect(other.reply.ok === true && !other.text.includes(MARKER), `the second project's session reused the first project's page: ${other.text.slice(0, 300)}`);
    await a.execute('(await page.close(), "closed")');
    const reopened = await a.execute('(await page.evaluate(() => 1))');
    expect(reopened.reply.ok === true && reopened.text === '1', `a closed project page was not reopened by the next run: ${reopened.text.slice(0, 300)}`);
  } finally {
    a.child.kill();
    b.child.kill();
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
const wall = ((Date.now() - started) / 1000).toFixed(2);
if (failures.length > 0) {
  console.error(`${CHECK}: ${failures.length} failure(s) on ${target} (wall ${wall} s)\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`${CHECK}: ok (${target}: the project page opened in one run_code is read back by a second run_code; a second project's session has its own page; wall ${wall} s)`);
}
