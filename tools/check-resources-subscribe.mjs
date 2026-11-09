#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ?? null;
const onNode = target === 'node';
const binary = onNode ? process.execPath : target === null ? null : resolve(target);
if (binary === null || (!onNode && !existsSync(binary))) {
  console.log('resources-subscribe-check: skipped (no binary given)');
  process.exit(0);
}

const REPLY_MS = 10000;
const ARRIVE_MS = 5000;
const URI = 'skill://gm-continue/SKILL.md';
const UPDATED = 'notifications/resources/updated';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const short = (value) => JSON.stringify(value ?? null).slice(0, 240);

const scratch = mkdtempSync(join(tmpdir(), 'gm-resources-subscribe-'));
const workspace = join(scratch, 'workspace');
const mcpConfig = join(scratch, 'no-default-mcp.json');
const skillsDir = join(scratch, 'skills');
mkdirSync(workspace);
cpSync(join(root, 'skills'), skillsDir, { recursive: true });
writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
const served = onNode ? join(root, 'skills', 'gm-continue', 'SKILL.md') : join(skillsDir, 'gm-continue', 'SKILL.md');
const originalText = readFileSync(served, 'utf8');

const lead = onNode ? [join(root, 'src', 'mcp.mjs')] : ['serve'];
const skillsFlag = onNode ? [] : ['--skills', skillsDir];
const child = spawn(binary, [...lead, '--workspace', workspace, '--mcp-config', mcpConfig, ...skillsFlag], { stdio: ['pipe', 'pipe', 'pipe'] });
child.stderr.resume();
const pending = new Map();
const notes = [];
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
  } else if (message.method !== undefined) {
    notes.push(message);
  }
});
const rpc = (method, params) => {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return Promise.race([new Promise((done) => pending.set(id, done)), sleep(REPLY_MS).then(() => null)]);
};
const updatesFor = (uri) => notes.filter((note) => note.method === UPDATED && note.params?.uri === uri);
const waitFor = async (test, ms) => {
  const until = Date.now() + ms;
  while (!test()) {
    if (Date.now() >= until) return false;
    await sleep(50);
  }
  return true;
};

const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
let edits = 0;
let written = null;
const change = () => {
  edits += 1;
  written = `${originalText}\nresources-subscribe-check edit ${edits}\n`;
  writeFileSync(served, written);
};

let elapsed = null;
try {
  const init = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'gm-resources-subscribe-check', version: '1' } });
  expect(init?.result?.capabilities?.resources?.subscribe === true, `initialize: resources.subscribe is not advertised, capabilities.resources is ${short(init?.result?.capabilities?.resources)}`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  const sub = await rpc('resources/subscribe', { uri: URI });
  expect(sub?.error === undefined && JSON.stringify(sub?.result) === '{}', `resources/subscribe ${URI}: expected an ok {} result, got ${short(sub)}`);

  change();
  const started = Date.now();
  const arrived = await waitFor(() => updatesFor(URI).length > 0, ARRIVE_MS);
  elapsed = Date.now() - started;
  expect(arrived, `a change to ${URI} on disk sent no notifications/resources/updated within ${ARRIVE_MS} ms`);
  if (arrived) {
    const params = updatesFor(URI)[0].params;
    expect(JSON.stringify(params) === JSON.stringify({ uri: URI }), `the update notification params are ${short(params)}, expected {"uri":"${URI}"}`);
  }

  const unsub = await rpc('resources/unsubscribe', { uri: URI });
  expect(unsub?.error === undefined && JSON.stringify(unsub?.result) === '{}', `resources/unsubscribe ${URI}: expected an ok {} result, got ${short(unsub)}`);
  const seen = updatesFor(URI).length;
  change();
  await sleep(1500);
  expect(updatesFor(URI).length === seen, `after resources/unsubscribe a change to ${URI} still sent notifications/resources/updated`);

  const bad = await rpc('resources/subscribe', { uri: 'skill://nope/SKILL.md' });
  expect(bad?.error?.code === -32002 && bad.error.message === 'resource not found: skill://nope/SKILL.md' && JSON.stringify(bad.error.data) === '{"uri":"skill://nope/SKILL.md"}', `resources/subscribe to an unknown uri: expected -32002 resource not found, got ${short(bad)}`);

  if (failures.length) {
    console.error(`resources-subscribe-check: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log(`resources-subscribe-check: ok (initialize advertises resources.subscribe; resources/subscribe to ${URI} answers {}; a change on disk sent notifications/resources/updated with params {"uri":"${URI}"} in ${elapsed} ms; resources/unsubscribe answers {} and a later change sent nothing; an unknown uri answers -32002 resource not found)`);
  }
} finally {
  if (written !== null && readFileSync(served, 'utf8') === written) writeFileSync(served, originalText);
  const exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit');
  child.kill();
  await Promise.race([exited, sleep(5000)]);
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(process.exitCode ?? 0);
