#!/usr/bin/env node
import { spawn } from './lib/group.mjs';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const CHECK = 'check-install-follows';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(process.argv[2] ?? join(root, 'build', 'release', 'native', 'components', 'host', 'gm'));
const hostDir = dirname(target);
const started = Date.now();
const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const hash = (path) => (existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'missing');
const textHash = (text) => createHash('sha256').update(text).digest('hex');
const run = (command, args, env, ms, cwd) =>
  new Promise((done) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), ms);
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code, out });
    });
  });

const scratch = mkdtempSync(join(tmpdir(), 'gm-install-follows-'));
const tree = join(scratch, 'tree');
const home = join(scratch, 'home');
const workspace = join(scratch, 'ws');
const sandboxBuild = join(tree, 'build');
const sandboxHost = join(sandboxBuild, 'native', 'components', 'host');
mkdirSync(join(tree, 'scripts'), { recursive: true });
mkdirSync(sandboxHost, { recursive: true });
mkdirSync(home);
mkdirSync(workspace);
for (const dir of ['native/leaves', 'skills', 'defaults']) cpSync(join(root, dir), join(tree, dir), { recursive: true });
cpSync(join(root, 'skills'), join(sandboxHost, 'skills'), { recursive: true });
for (const name of ['gm', 'gm-core']) {
  copyFileSync(join(hostDir, name), join(sandboxHost, name));
  chmodSync(join(sandboxHost, name), 0o755);
}
const refreshBuildSkills = () => {
  rmSync(join(sandboxHost, 'skills'), { recursive: true, force: true });
  cpSync(join(tree, 'skills'), join(sandboxHost, 'skills'), { recursive: true });
};
refreshBuildSkills();

const env = { ...process.env, HOME: home };
const installed = join(home, '.gmnew', 'current');
const quiet = join(scratch, 'quiet.json');
writeFileSync(quiet, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
const leafPath = join(tree, 'native', 'leaves', 'git.mjs');
const skillPath = join(tree, 'skills', 'gm', 'SKILL.md');
const leafOriginal = readFileSync(leafPath, 'utf8');
const skillOriginal = readFileSync(skillPath, 'utf8');
const leafMarker = '\nexport const checkInstallFollows = 1;\n';
const skillMarker = `\n${CHECK}\n`;
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
const install = () => run(join(sandboxHost, 'gm'), ['install', '--local', sandboxBuild, '--source', tree], env, 300000, tree);

let picked = null;
try {
  const first = await install();
  expect(first.code === 0, `the first install failed (${first.code}): ${first.out.slice(-400)}`);
  expect(existsSync(join(installed, 'gm')), 'the first install did not create current/gm in the sandbox HOME');
  start(join(installed, 'gm'));
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CHECK, version: '1' } });
  relay.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  await rpc('tools/call', { name: 'next_context', arguments: {} });
  const installedLeaf = hash(join(installed, 'leaves', 'git.mjs'));
  const installedSkill = hash(join(installed, 'skills', 'gm', 'SKILL.md'));
  expect(installedLeaf === textHash(leafOriginal), 'the first install did not copy the scratch leaf');
  const before = log().length;

  writeFileSync(leafPath, leafOriginal + leafMarker);
  writeFileSync(skillPath, skillOriginal + skillMarker);
  await sleep(6000);
  expect(hash(join(installed, 'leaves', 'git.mjs')) === installedLeaf, 'the installed leaf changed on a scratch edit');
  expect(hash(join(installed, 'skills', 'gm', 'SKILL.md')) === installedSkill, 'the installed skill changed on a scratch edit');
  expect(log().slice(before).every((event) => event.kind !== 'restart'), `a scratch edit restarted the installed worker: ${JSON.stringify(restarts())}`);
  expect(!(await skillText()).includes(CHECK), 'the session read the scratch skill edit before an install');
  expect(!stderr.includes('restarting the worker'), `the relay reacted to a scratch edit: ${stderr.slice(-300)}`);

  refreshBuildSkills();
  const second = await install();
  expect(second.code === 0, `the second install failed (${second.code}): ${second.out.slice(-400)}`);
  expect(hash(join(installed, 'leaves', 'git.mjs')) === textHash(leafOriginal + leafMarker), 'the install did not copy the edited leaf');
  for (let i = 0; i < 40 && !picked; i += 1) {
    await sleep(500);
    picked = restarts().find((event) => String(event.reason ?? '').includes('git.mjs')) ?? null;
  }
  expect(picked !== null, `the running session did not pick up the installed leaf: ${JSON.stringify(restarts().slice(-2))}`);
  expect((await skillText()).includes(CHECK), 'the installed skill edit is not what the session reads on its next read');
} finally {
  if (relay) relay.kill('SIGKILL');
  rmSync(scratch, { recursive: true, force: true });
}

const wall = ((Date.now() - started) / 1000).toFixed(2);
if (failures.length > 0) {
  console.error(`${CHECK}: ${failures.length} failure(s) (wall ${wall} s)\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`${CHECK}: ok (a scratch leaf and skill edit left the sandbox install and its session unchanged; the install then reached the session through a restart, reason "${picked?.reason}"; wall ${wall} s)`);
}
