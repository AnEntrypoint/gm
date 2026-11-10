#!/usr/bin/env node
import { removeTree, stopTree } from './lib/tree.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = 'skill-serve-check';
const target = process.argv[2] ?? null;
if (target === null || !existsSync(resolve(target))) {
  console.error(`${CHECK}: usage: node tools/check-skill-serve.mjs <path-to-native-binary>`);
  process.exit(2);
}
const binary = resolve(target);
const REPLY_MS = 60000;
const SKILL = 'skill://gm/SKILL.md';
const checkoutSkill = join(root, 'skills', 'gm', 'SKILL.md');

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const openConnection = (args) => {
  const child = spawn(binary, ['serve', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
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
  const rpc = (method, params) =>
    new Promise((done) => {
      if (exited) {
        done(null);
        return;
      }
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
  const close = async () => {
    const gone = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit');
    child.kill();
    await Promise.race([gone, sleep(5000)]);
  };
  return { rpc, close, stderr: () => stderr.trim() || '(empty)' };
};

const readSkill = async (connection) => {
  const reply = await connection.rpc('resources/read', { uri: SKILL });
  const text = reply?.result?.contents?.[0]?.text;
  return { text: typeof text === 'string' ? text : null, reply };
};

const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};

const scratch = mkdtempSync(join(tmpdir(), 'gm-skill-serve-'));
try {
  const workspace = join(scratch, 'ws');
  mkdirSync(workspace);
  const quiet = join(scratch, 'quiet-mcp.json');
  writeFileSync(quiet, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
  const initialize = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CHECK, version: '1' } };

  const defaults = openConnection(['--workspace', workspace, '--run-dir', join(workspace, 'run-default'), '--mcp-config', quiet]);
  try {
    const init = await defaults.rpc('initialize', initialize);
    expect(init?.result !== undefined, `default serve: no initialize result (stderr ${defaults.stderr()})`);
    const served = await readSkill(defaults);
    const disk = readFileSync(checkoutSkill, 'utf8');
    expect(served.text === disk, `default serve: ${SKILL} is not the checkout's skills/gm/SKILL.md (served ${served.text === null ? JSON.stringify(served.reply) : `${served.text.length} bytes`}, disk ${disk.length} bytes)`);
  } finally {
    await defaults.close();
  }

  const skills = join(scratch, 'skills');
  cpSync(join(root, 'skills'), skills, { recursive: true });
  const copy = join(skills, 'gm', 'SKILL.md');
  const before = readFileSync(copy, 'utf8');
  const nonce = `served-after-change-${process.pid}-${Date.now()}`;

  const live = openConnection(['--skills', skills, '--workspace', workspace, '--run-dir', join(workspace, 'run-live'), '--mcp-config', quiet]);
  try {
    await live.rpc('initialize', initialize);
    const first = await readSkill(live);
    expect(first.text === before, `live serve: first read is not the copy's text (stderr ${live.stderr()})`);

    writeFileSync(copy, `${before}\n## Served Skill Witness\n\n${nonce}\n`);
    const second = await readSkill(live);
    expect(second.text !== null && second.text.includes(nonce), `live serve: read after a change on the same connection lacks ${nonce} (served ${second.text === null ? JSON.stringify(second.reply) : `${second.text.length} bytes`})`);
    expect(second.text === readFileSync(copy, 'utf8'), 'live serve: read after a change differs from the file on disk');

    appendFileSync(copy, `\n${nonce}-again\n`);
    const third = await readSkill(live);
    expect(third.text !== null && third.text.includes(`${nonce}-again`), 'live serve: a second change is not served on the same connection');
  } finally {
    await live.close();
  }

  if (failures.length) {
    console.error(`${CHECK}: ${failures.length} failure(s) on ${target}\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log(`${CHECK}: ok (${target}: the default serve returns the checkout's ${SKILL}, and a live connection returns each change to the copied file on the next read)`);
  }
} finally {
  await removeTree(scratch);
}
process.exit(process.exitCode ?? 0);
