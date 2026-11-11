#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import readline from 'node:readline';

const CHECK = 'check-install-follows';
const root = resolve('.');
const buildDir = resolve(process.argv[2] ?? 'build/release');
const host = join(buildDir, 'native/components/host');
const started = Date.now();
const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const hash = (path) => (existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'missing');
const run = (command, args, env, ms) =>
  new Promise((done) => {
    const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), ms);
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code, out });
    });
  });

const leafPath = join(root, 'native/leaves/fetch.mjs');
const skillPath = join(root, 'skills/gm/SKILL.md');
const leafOriginal = readFileSync(leafPath, 'utf8');
const skillOriginal = readFileSync(skillPath, 'utf8');
const leafMarker = '\nexport const checkInstallFollows = 1;\n';
const skillMarker = `\n${CHECK}\n`;
const sandbox = mkdtempSync(join(tmpdir(), 'gm-install-follows-'));
const home = join(sandbox, 'home');
const workspace = join(sandbox, 'ws');
mkdirSync(home);
mkdirSync(workspace);
const env = { ...process.env, HOME: home };
const installed = join(home, '.gmnew', 'current');
const quiet = join(sandbox, 'quiet.json');
writeFileSync(quiet, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
let relay = null;
let stderr = '';
const waiting = new Map();
let nextId = 1;
const start = (binary) => {
  relay = spawn(binary, ['serve', '--workspace', workspace, '--run-dir', join(workspace, 'runs', 'follow'), '--mcp-config', quiet], { stdio: ['pipe', 'pipe', 'pipe'], env });
  relay.stdin.on('error', () => {});
  relay.stderr.on('data', (d) => (stderr += d));
  readline.createInterface({ input: relay.stdout }).on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id !== undefined && waiting.has(message.id)) {
      waiting.get(message.id)(message);
      waiting.delete(message.id);
    }
  });
};
const rpc = (method, params, ms = 60000) =>
  new Promise((done) => {
    const id = nextId++;
    const timer = setTimeout(() => done(null), ms);
    waiting.set(id, (m) => {
      clearTimeout(timer);
      done(m);
    });
    relay.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
const log = () => {
  const file = join(workspace, 'runs', 'follow', 'log.jsonl');
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
};
const restarts = () => log().filter((event) => event.kind === 'restart');
const skillText = async () => (await rpc('resources/read', { uri: 'skill://gm/SKILL.md' }))?.result?.contents?.[0]?.text ?? '';

let picked = null;
try {
  const first = await run('bash', ['scripts/install.sh', '--local', buildDir], env, 300000);
  expect(first.code === 0, `the first install failed (${first.code}): ${first.out.slice(-400)}`);
  expect(existsSync(join(installed, 'gm')), 'the first install did not create current/gm in the sandbox HOME');
  start(join(installed, 'gm'));
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CHECK, version: '1' } });
  relay.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  await rpc('tools/call', { name: 'next_context', arguments: {} });
  const installedLeaf = hash(join(installed, 'leaves/fetch.mjs'));
  const installedSkill = hash(join(installed, 'skills/gm/SKILL.md'));
  expect(installedLeaf === createHash('sha256').update(leafOriginal).digest('hex'), 'the first install did not copy the checkout leaf');
  const before = log().length;

  writeFileSync(leafPath, leafOriginal + leafMarker);
  writeFileSync(skillPath, skillOriginal + skillMarker);
  await sleep(6000);
  const quietPhase = {
    leafUnchanged: hash(join(installed, 'leaves/fetch.mjs')) === installedLeaf,
    skillUnchanged: hash(join(installed, 'skills/gm/SKILL.md')) === installedSkill,
    noRestart: restarts().length === 0,
    noNewEvents: log().slice(before).every((event) => event.kind !== 'restart'),
    skillText: (await skillText()).includes(CHECK) === false,
  };
  expect(quietPhase.leafUnchanged, 'the installed leaf changed on a checkout edit');
  expect(quietPhase.skillUnchanged, 'the installed skill changed on a checkout edit');
  expect(quietPhase.noRestart, `a checkout edit restarted the installed worker: ${JSON.stringify(restarts())}`);
  expect(quietPhase.skillText, 'the session read the checkout skill edit before an install');
  expect(!stderr.includes('restarting the worker'), `the relay reacted to a checkout edit: ${stderr.slice(-300)}`);

  const build = await run('cmake', ['--build', buildDir, '--target', 'gm_skills'], env, 300000);
  expect(build.code === 0, `refreshing the build skills failed: ${build.out.slice(-300)}`);
  const second = await run('bash', ['scripts/install.sh', '--local', buildDir], env, 300000);
  expect(second.code === 0, `the second install failed (${second.code}): ${second.out.slice(-400)}`);
  const leafNow = hash(join(installed, 'leaves/fetch.mjs'));
  expect(leafNow === createHash('sha256').update(leafOriginal + leafMarker).digest('hex'), 'the install did not copy the edited leaf');
  picked = null;
  for (let i = 0; i < 40 && !picked; i += 1) {
    await sleep(500);
    picked = restarts().find((event) => String(event.reason ?? '').includes('fetch.mjs')) ?? null;
  }
  expect(picked !== null, `the running session did not pick up the installed leaf: ${JSON.stringify(restarts().slice(-2))}`);
  expect((await skillText()).includes(CHECK), 'the installed skill edit is not what the session reads on its next read');
} finally {
  if (relay) relay.kill('SIGKILL');
  writeFileSync(leafPath, leafOriginal);
  writeFileSync(skillPath, skillOriginal);
  await run('cmake', ['--build', buildDir, '--target', 'gm_skills'], env, 300000);
  rmSync(sandbox, { recursive: true, force: true });
}

const wall = ((Date.now() - started) / 1000).toFixed(2);
if (failures.length > 0) {
  console.error(`${CHECK}: ${failures.length} failure(s) (wall ${wall} s)\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`${CHECK}: ok (a checkout leaf and skill edit left the installed files and session unchanged; the install then reached the session through a restart, reason "${picked?.reason}"; wall ${wall} s)`);
}
