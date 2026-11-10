#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = 'relay-reexec-check';
const target = process.argv[2] ?? null;
if (target === null || !existsSync(resolve(target))) {
  console.error(`${CHECK}: usage: node tools/check-relay-reexec.mjs <path-to-native-binary>`);
  process.exit(2);
}
const binary = resolve(target);
const hostDir = dirname(binary);
if (process.platform !== 'linux') {
  console.log(`${CHECK}: skipped (${process.platform}: the check packs a linux archive; the relay does not re-execute on win32)`);
  process.exit(0);
}
const stamp = (spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 30000 }).stdout ?? '').trim();
const version = stamp.split(' ')[0];
if (version === 'dev' || version.endsWith('-dev')) {
  console.log(`${CHECK}: skipped (${stamp}: a development build never updates itself, so its relay never re-executes; run this on a build configured with -DGMNEW_VERSION=<commit>-1)`);
  process.exit(0);
}

const WAIT_MS = 30000;
const REEXEC_LIMIT_MS = 5000;
const REPLY_MS = 60000;
const OFFERED = 'ffff111-99';
const platformTarget = `${process.arch === 'arm64' ? 'arm64' : 'x64'}-linux`;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
const short = (value) => JSON.stringify(value ?? null).slice(0, 300);

const scratch = mkdtempSync(join(tmpdir(), 'gm-relay-reexec-'));
let measured = null;
try {
  const published = join(scratch, 'published');
  const stage = join(published, `gmnew-${platformTarget}`);
  mkdirSync(stage, { recursive: true });
  for (const name of ['gm', 'gm-core']) cpSync(join(hostDir, name), join(stage, name));
  const shared = { leaves: join(root, 'native', 'leaves'), skills: join(root, 'skills'), defaults: join(root, 'defaults') };
  for (const [name, fromCheckout] of Object.entries(shared)) {
    cpSync(existsSync(join(hostDir, name)) ? join(hostDir, name) : fromCheckout, join(stage, name), { recursive: true });
  }
  const archiveName = `gmnew-${platformTarget}.tar.gz`;
  const packed = spawnSync('tar', ['-czf', archiveName, `gmnew-${platformTarget}`], { cwd: published, encoding: 'utf8', timeout: 120000 });
  if (packed.status !== 0) throw new Error(`tar failed: ${packed.stderr}`);
  const archive = readFileSync(join(published, archiveName));
  writeFileSync(
    join(published, 'manifest.json'),
    JSON.stringify({
      version: OFFERED,
      commit: `ffff111${'a'.repeat(33)}`,
      built: new Date().toISOString(),
      repo: 'AnEntrypoint/gm',
      assets: { [platformTarget]: { file: archiveName, sha256: createHash('sha256').update(archive).digest('hex'), size: statSync(join(published, archiveName)).size, version: OFFERED } },
    }),
  );

  const install = join(scratch, 'install');
  cpSync(stage, install, { recursive: true });
  const workspace = join(scratch, 'ws');
  mkdirSync(workspace);
  const quiet = join(scratch, 'quiet-mcp.json');
  writeFileSync(quiet, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));

  const environment = { ...process.env, GMNEW_UPDATE_URL: pathToFileURL(join(published, 'manifest.json')).href };
  delete environment.GMNEW_AUTO_UPDATE;
  const relay = spawn(join(install, 'gm'), ['serve', '--workspace', workspace, '--run-dir', join(workspace, 'run'), '--mcp-config', quiet], { stdio: ['pipe', 'pipe', 'pipe'], env: environment });
  relay.stdin.on('error', () => {});
  const said = [];
  readline.createInterface({ input: relay.stderr }).on('line', (line) => said.push({ at: Date.now(), line }));
  const replies = new Map();
  const waiters = new Map();
  readline.createInterface({ input: relay.stdout }).on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id === undefined || message.method !== undefined) return;
    replies.set(message.id, [...(replies.get(message.id) ?? []), { at: Date.now(), message }]);
    waiters.get(message.id)?.();
  });
  const send = (id, method, params) => relay.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  const replyTo = async (id) => {
    if (!replies.has(id)) await Promise.race([new Promise((done) => waiters.set(id, done)), sleep(REPLY_MS)]);
    return replies.get(id)?.[0]?.message ?? null;
  };
  const saidAt = (text) => said.find((entry) => entry.line.includes(text))?.at ?? null;
  const HELD_WAIT = 4;
  try {
    send(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CHECK, version: '1' } });
    relay.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    send(2, 'resources/read', { uri: 'skill://gm/SKILL.md' });
    send(3, 'tools/call', { name: 'next_context', arguments: {} });
    send(HELD_WAIT, 'tools/call', { name: 'next_context', arguments: { waitMs: WAIT_MS } });
    const sentAt = Date.now();

    const held = await replyTo(HELD_WAIT);
    const heldAt = replies.get(HELD_WAIT)?.[0]?.at ?? null;
    const updatedAt = saidAt(`-> ${OFFERED}`);
    const reexecAt = saidAt('re-executing the relay');
    expect(updatedAt !== null, `the relay did not report the update to ${OFFERED}: ${short(said.map((entry) => entry.line))}`);
    expect(updatedAt !== null && heldAt !== null && updatedAt < heldAt, 'the update did not land while the next_context wait was in flight, so the run measured nothing');
    if (reexecAt === null) {
      const idleDeadline = Date.now() + REEXEC_LIMIT_MS;
      while (saidAt('re-executing the relay') === null && Date.now() < idleDeadline) await sleep(100);
    }
    const reexecSeenAt = saidAt('re-executing the relay');
    measured = { waitMs: WAIT_MS, updateAfterSendMs: updatedAt === null ? null : updatedAt - sentAt, reexecAfterUpdateMs: reexecSeenAt === null || updatedAt === null ? null : reexecSeenAt - updatedAt, waitAnsweredAfterSendMs: heldAt === null ? null : heldAt - sentAt };
    expect(reexecSeenAt !== null, 'the relay never said it re-executed');
    expect(measured.reexecAfterUpdateMs !== null && measured.reexecAfterUpdateMs < REEXEC_LIMIT_MS, `the relay re-executed ${measured.reexecAfterUpdateMs} ms after the update while a ${WAIT_MS} ms next_context wait was in flight; the limit is ${REEXEC_LIMIT_MS} ms`);
    expect(reexecSeenAt !== null && heldAt !== null && reexecSeenAt < heldAt, 'the relay re-executed only after the next_context wait had answered');
    expect(held?.result?.structuredContent?.ok === true, `the held next_context wait was not answered ok across the re-execution: ${short(held)}`);

    send(5, 'tools/call', { name: 'run_code', arguments: { body: 'return 6 * 7' } });
    const ran = (await replyTo(5))?.result?.structuredContent ?? {};
    expect(ran.ok === true && ran.output === '42', `run_code after the re-execution did not run: ${short(ran)}`);
    expect((replies.get(HELD_WAIT) ?? []).length === 1, `the held next_context wait was answered ${(replies.get(HELD_WAIT) ?? []).length} times`);
  } finally {
    const gone = relay.exitCode !== null || relay.signalCode !== null ? Promise.resolve() : once(relay, 'exit');
    relay.stdin.end();
    await Promise.race([gone, sleep(5000)]);
    if (relay.exitCode === null && relay.signalCode === null) relay.kill();
    await Promise.race([gone, sleep(5000)]);
  }

  if (failures.length) {
    console.error(`${CHECK}: ${failures.length} failure(s) on ${target} (${stamp})\n- ${failures.join('\n- ')}\n${CHECK}: measured ${JSON.stringify(measured)}`);
    process.exitCode = 1;
  } else {
    console.log(`${CHECK}: ok (${target}, ${stamp}: with a ${WAIT_MS} ms next_context wait in flight the relay re-executed ${measured.reexecAfterUpdateMs} ms after the update, the wait was answered once at ${measured.waitAnsweredAfterSendMs} ms, and run_code ran on the new relay)`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
process.exit(process.exitCode ?? 0);
