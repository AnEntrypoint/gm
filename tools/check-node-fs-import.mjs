#!/usr/bin/env node
import { spawn } from './lib/group.mjs';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import readline from 'node:readline';

const CHECK = 'node-fs-import-check';
const target = process.argv[2] ?? null;
if (target === null || !existsSync(resolve(target))) {
  console.error(`${CHECK}: usage: node tools/check-node-fs-import.mjs <path-to-native-binary>`);
  process.exit(2);
}
const REPLY_MS = 120000;
const VERBS = ['gm.read_file', 'gm.write_file', 'gm.fs_op', 'gm.run_shell'];

const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};

const scratch = mkdtempSync(join(tmpdir(), 'gm-node-fs-import-'));
const started = Date.now();
try {
  const workspace = mkdtempSync(join(scratch, 'ws-'));
  const quiet = join(scratch, 'quiet-mcp.json');
  writeFileSync(quiet, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
  const child = spawn(resolve(target), ['serve', '--workspace', workspace, '--run-dir', join(workspace, 'run'), '--mcp-config', quiet], { stdio: ['pipe', 'pipe', 'pipe'] });
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
  try {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CHECK, version: '1' } });
    expect(init?.result !== undefined, 'no initialize result');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
    await rpc('tools/call', { name: 'next_context', arguments: {} });
    const reply = (await rpc('tools/call', { name: 'run_code', arguments: { body: "import fs from 'node:fs';\nreturn typeof fs;", format: 'esm' } }))?.result?.structuredContent ?? {};
    const text = String(reply.error ?? reply.output ?? '');
    expect(reply.ok === false, `a node:fs import ran instead of failing: ${JSON.stringify(reply).slice(0, 300)}`);
    expect(text.includes('node:fs') && text.includes('not available in run_code'), `the refusal does not name node:fs as unavailable: ${text.slice(0, 300)}`);
    expect(VERBS.some((verb) => text.includes(verb)), `the refusal does not name a replacement verb: ${text.slice(0, 300)}`);
  } finally {
    child.kill();
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
const wall = ((Date.now() - started) / 1000).toFixed(2);
if (failures.length > 0) {
  console.error(`${CHECK}: ${failures.length} failure(s) on ${target} (wall ${wall} s)\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`${CHECK}: ok (${target}: an import of node:fs fails in run_code and names gm.read_file, gm.write_file, gm.fs_op and gm.run_shell as the replacements; wall ${wall} s)`);
}
