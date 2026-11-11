#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const CHECK = 'install-switch-check';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const given = resolve(process.argv[2] ?? join(root, 'build', 'release'));
const fromBuild = existsSync(given) && statSync(given).isFile() ? dirname(given) : join(given, 'native', 'components', 'host');
const inBuildTree = fromBuild.endsWith(join('native', 'components', 'host'));
const hostDir = inBuildTree ? fromBuild : join(root, 'build', 'release', 'native', 'components', 'host');
const buildDir = resolve(hostDir, '..', '..', '..');
if (!existsSync(join(hostDir, 'gm'))) {
  console.error(`${CHECK}: usage: node tools/check-install-switch.mjs [build-dir | gm binary]`);
  process.exit(2);
}
const started = Date.now();
const filesUnder = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? filesUnder(join(dir, name)).map((file) => join(name, file)) : [name]));
if (process.argv.includes('--installed')) {
  const current = join(process.env.HOME, '.gmnew', 'current');
  const version = (exe) => (existsSync(exe) ? spawnSync(exe, ['--version'], { encoding: 'utf8', timeout: 30000 }).stdout.trim() : '');
  const built = version(join(hostDir, 'gm'));
  const live = version(join(current, 'gm'));
  const stale = [];
  if (live !== built) stale.push(`installed gm reports "${live}", the validated build reports "${built}"`);
  for (const file of filesUnder(join(root, 'skills'))) {
    const installedFile = join(current, 'skills', file);
    if (!existsSync(installedFile) || !readFileSync(installedFile).equals(readFileSync(join(root, 'skills', file)))) stale.push(`installed skills/${file} is not the checkout's`);
  }
  if (stale.length > 0) {
    console.error(`${CHECK}: stale install, ${stale.length} difference(s)\n- ${stale.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`${CHECK}: ok (the installed build ${live} and its skills equal the validated build and the checkout; wall ${((Date.now() - started) / 1000).toFixed(2)} s)`);
  process.exit(0);
}
const scratch = mkdtempSync(join(tmpdir(), 'gm-install-switch-'));
const home = join(scratch, 'home');
const failures = [];
let first = '';
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};

try {
  mkdirSync(home);
  const install = spawnSync('sh', [join(root, 'scripts', 'install.sh'), '--local', buildDir], {
    cwd: root,
    env: { ...process.env, HOME: home, GMNEW_SKIP_REGISTER: '1' },
    encoding: 'utf8',
    timeout: 120000,
  });
  expect(install.status === 0, `install.sh --local failed: ${install.stderr}`);
  const installedSkills = join(home, '.gmnew', 'current', 'skills');
  const checkoutSkills = join(root, 'skills');
  const checkoutFiles = filesUnder(checkoutSkills);
  expect(install.status === 0 && filesUnder(installedSkills).sort().join('\n') === checkoutFiles.sort().join('\n'), `the installed skill files differ from the checkout's: installed ${filesUnder(installedSkills).join(', ')}`);
  for (const file of checkoutFiles) {
    expect(readFileSync(join(installedSkills, file)).equals(readFileSync(join(checkoutSkills, file))), `installed skills/${file} is not the checkout's`);
  }
  const install_root = join(home, '.gmnew');
  first = readlinkSync(join(install_root, 'current'));
  cpSync(join(install_root, first), join(install_root, 'versions', 'switched-dev'), { recursive: true });
  const workspace = join(scratch, 'ws');
  mkdirSync(workspace);
  writeFileSync(join(workspace, 'README.md'), 'x\n');
  const quiet = join(scratch, 'quiet-mcp.json');
  writeFileSync(quiet, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
  const gm = join(install_root, 'current', 'gm');
  const child = spawn(gm, ['serve', '--workspace', workspace, '--run-dir', join(workspace, 'run'), '--mcp-config', quiet], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, HOME: home },
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => (stderr += chunk));
  child.stdin.on('error', () => {});
  const pending = new Map();
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
      }, 60000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        done(message);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  const pid = child.pid;
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CHECK, version: '1' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  await rpc('tools/call', { name: 'next_context', arguments: {} });
  const before = readlinkSync(`/proc/${pid}/exe`);
  expect(before.includes(first), `the relay did not start from the installed version ${first}: ${before}`);

  const next = join(install_root, 'current.switch');
  symlinkSync(join('versions', 'switched-dev'), next);
  renameSync(next, join(install_root, 'current'));
  const switched_at = Date.now();
  let after = '';
  for (let tick = 0; tick < 30 && !after.includes('switched-dev'); tick += 1) {
    await new Promise((done) => setTimeout(done, 500));
    await rpc('tools/call', { name: 'next_context', arguments: {} });
    after = readlinkSync(`/proc/${pid}/exe`);
  }
  expect(after.includes('switched-dev'), `the relay did not re-execute onto switched-dev within 15 s: exe ${after}; stderr ${stderr.slice(-300)}`);
  expect(stderr.includes('re-executing'), `the relay did not say it re-executed: ${stderr.slice(-300)}`);
  const alive = await rpc('tools/call', { name: 'next_context', arguments: {} });
  expect(alive?.result !== undefined, 'the re-executed relay does not answer next_context');
  child.kill();
  expect(after.includes('switched-dev'), 'the switch was not seen');
  console.log(`check-install-switch: switched in ${Date.now() - switched_at} ms`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
const wall = ((Date.now() - started) / 1000).toFixed(2);
if (failures.length > 0) {
  console.error(`${CHECK}: ${failures.length} failure(s) (wall ${wall} s)\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`${CHECK}: ok (the install link moved from ${first} to switched-dev; the running relay re-executed through the stable path on the same pid; wall ${wall} s)`);
}
