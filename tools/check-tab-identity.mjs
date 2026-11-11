#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import readline from 'node:readline';

const CHECK = 'tab-identity-check';
const target = process.argv[2] ?? null;
if (target === null || !existsSync(resolve(target))) {
  console.error(`${CHECK}: usage: node tools/check-tab-identity.mjs <path-to-native-binary>`);
  process.exit(2);
}
const REPLY_MS = 180000;
const MARKER = 'gm-tab-identity';
const OPEN = `(await (await context.newPage()).goto('data:text/html,<title>${MARKER}</title>'), 'opened')`;
const TITLE = 'page.title()';
const TABS_RE = new RegExp(`\\[(t\\d+)\\] data:text/html,<title>${MARKER}`);

const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
const started = Date.now();
const scratch = mkdtempSync(join(tmpdir(), 'gm-tab-identity-'));

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
    return typeof payload === 'string' ? payload : String(reply?.error ?? '');
  };
  const tabs = async () => JSON.stringify(await runCode('return await gm.browser_tabs({});'));
  const start = async () => {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CHECK, version: '1' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
    await rpc('tools/call', { name: 'next_context', arguments: {} });
  };
  return { child, start, execute, tabs };
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
    await a.execute(OPEN);
    const first = await a.tabs();
    const firstId = TABS_RE.exec(first)?.[1] ?? null;
    expect(firstId !== null, `the tab opened in the run is not listed with an id: ${first.slice(0, 400)}`);
    await a.execute(TITLE);
    const second = await a.tabs();
    const secondId = TABS_RE.exec(second)?.[1] ?? null;
    const unchanged = second.includes('tabs: unchanged');
    expect(unchanged || secondId === firstId, `the tab's identity changed across replies: ${firstId} then ${secondId ?? 'not listed'}: ${second.slice(0, 400)}`);
    await b.start();
    const other = await b.tabs();
    expect(!other.includes(MARKER), `a different project's tabs returned this project's tab: ${other.slice(0, 400)}`);
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
  console.log(`${CHECK}: ok (${target}: a tab opened in a run keeps its id on the next browser_tabs reply, and another project's tabs never list it; wall ${wall} s)`);
}
