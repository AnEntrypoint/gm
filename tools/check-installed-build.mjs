#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const CHECK = 'installed-build-check';
const SKILL = 'skill://gm/SKILL.md';
const REPLY_MS = 60000;
const VERSION_MS = 20000;
const target = process.argv[2] ?? null;
if (target === null || !existsSync(resolve(target))) {
  console.error(`${CHECK}: usage: node tools/check-installed-build.mjs <path-to-installed-gm> [expected-stamp-prefix]`);
  process.exit(2);
}
const binary = resolve(target);
const expectedStamp = process.argv[3] ?? null;
const skillsDir = join(dirname(binary), 'skills');
const diskSkill = join(skillsDir, 'gm', 'SKILL.md');
const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const version = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: VERSION_MS });
const versionText = `${version.stdout ?? ''}${version.stderr ?? ''}`.trim();
expect(version.status === 0, `--version exited ${version.status} (${versionText.slice(0, 200) || 'no output'})`);
expect(versionText.length > 0, '--version printed nothing');
if (expectedStamp !== null) {
  expect(versionText.includes(expectedStamp), `--version does not carry ${expectedStamp}: ${versionText.slice(0, 200)}`);
}

const scratch = mkdtempSync(join(tmpdir(), 'gm-installed-build-'));
try {
  const workspace = join(scratch, 'ws');
  mkdirSync(workspace);
  const quiet = join(scratch, 'quiet-mcp.json');
  writeFileSync(quiet, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));

  const child = spawn(binary, ['serve', '--workspace', workspace, '--run-dir', join(workspace, 'run'), '--mcp-config', quiet], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
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

  try {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CHECK, version: '1' } });
    const serverVersion = init?.result?.serverInfo?.version ?? null;
    expect(serverVersion !== null, `initialize has no serverInfo.version (stderr ${stderr.trim() || '(empty)'})`);
    if (expectedStamp !== null && serverVersion !== null) {
      expect(String(serverVersion).includes(expectedStamp), `initialize serverInfo.version ${serverVersion} does not carry ${expectedStamp}`);
    }
    const read = await rpc('resources/read', { uri: SKILL });
    const served = read?.result?.contents?.[0];
    const disk = existsSync(diskSkill) ? readFileSync(diskSkill, 'utf8') : null;
    expect(disk !== null, `no skill file at ${diskSkill}`);
    expect(served?.text === disk, `${SKILL} served ${served?.text === undefined ? JSON.stringify(read) : `${served.text.length} bytes`}, expected the binary's skills copy ${disk === null ? 'missing' : `${disk.length} bytes`}`);
    expect(read?.result?.ttlMs === 0, `${SKILL} read has ttlMs ${read?.result?.ttlMs}, expected 0 so an open connection re-reads it`);
  } finally {
    child.kill();
    await Promise.race([child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit'), sleep(5000)]);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`${CHECK}: ${failures.length} failure(s) on ${target}\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`${CHECK}: ok (${target}: version "${versionText.split('\n')[0]}"; ${SKILL} equals ${diskSkill} with ttlMs 0)`);
}
process.exit(process.exitCode ?? 0);
