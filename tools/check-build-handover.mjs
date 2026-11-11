#!/usr/bin/env node
import { spawnSync, spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const CHECK = 'build-handover-check';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const given = resolve(process.argv[2] ?? join(root, 'build', 'release', 'native', 'components', 'host'));
const hostDir = existsSync(join(given, 'gm')) ? given : dirname(given);
const started = Date.now();
const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
const stampOf = (path) => spawnSync(path, ['--version'], { encoding: 'utf8', timeout: 20000 }).stdout.trim().split(' ')[0];
const stamp = stampOf(join(hostDir, 'gm'));
expect(/-dev$/.test(stamp) || stamp.length > 0, `the build under test reports no stamp: ${stamp}`);

const sandbox = mkdtempSync(join(tmpdir(), 'gm-handover-'));
const install = join(sandbox, 'install');
const versions = join(install, 'versions');
const second = `${stamp[0] === '0' ? '1' : '0'}${stamp.slice(1)}`;
const broken = 'broken-dev';
const place = (version, patch) => {
  const dir = join(versions, version);
  mkdirSync(dir, { recursive: true });
  for (const name of ['gm', 'gm-core']) {
    const from = join(hostDir, name);
    if (patch) {
      const bytes = readFileSync(from).toString('latin1').split(stamp).join(version);
      writeFileSync(join(dir, name), Buffer.from(bytes, 'latin1'));
      chmodSync(join(dir, name), 0o755);
    } else {
      copyFileSync(from, join(dir, name));
    }
  }
  return dir;
};
const brokenDir = join(versions, broken);
mkdirSync(brokenDir, { recursive: true });
for (const name of ['gm', 'gm-core']) {
  writeFileSync(join(brokenDir, name), '#!/bin/sh\necho broken\nexit 1\n');
  chmodSync(join(brokenDir, name), 0o755);
}
place(stamp, false);
place(second, true);
const point = (version) => {
  const link = join(install, `current.${process.pid}`);
  rmSync(link, { force: true });
  symlinkSync(join('versions', version), link);
  renameSync(link, join(install, 'current'));
};
point(stamp);

const workspace = join(sandbox, 'ws');
mkdirSync(workspace);
const quiet = join(sandbox, 'quiet.json');
writeFileSync(quiet, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
const relay = spawn(join(install, 'current', 'gm'), ['serve', '--workspace', workspace, '--run-dir', join(workspace, 'runs', 'hand'), '--mcp-config', quiet, '--skill-read', 'yes'], { stdio: ['pipe', 'pipe', 'pipe'] });
relay.stdin.on('error', () => {});
const stderr = [];
relay.stderr.on('data', (chunk) => stderr.push(chunk.toString()));
const notices = [];
const pending = new Map();
readline.createInterface({ input: relay.stdout }).on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.method === 'notifications/message') notices.push(message.params?.data ?? '');
  if (message.id !== undefined && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
let nextId = 1;
const rpc = (method, params, ms = 60000) =>
  new Promise((done) => {
    const id = nextId++;
    const timer = setTimeout(() => done(null), ms);
    pending.set(id, (m) => {
      clearTimeout(timer);
      done(m);
    });
    relay.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
const call = async (name, args, ms) => (await rpc('tools/call', { name, arguments: args }, ms))?.result?.structuredContent ?? null;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const workerExe = () => {
  const pids = spawnSync('pgrep', ['-P', String(relay.pid)], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
  const worker = pids.find((pid) => existsSync(`/proc/${pid}/exe`));
  return worker ? readlinkSync(`/proc/${worker}/exe`) : 'no worker';
};
const runLog = () => {
  const dir = join(workspace, 'runs', 'hand');
  return existsSync(join(dir, 'log.jsonl')) ? readFileSync(join(dir, 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CHECK, version: '1' } });
  relay.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  await call('next_context', {});
  const before = runLog().length;
  const onA = workerExe();
  expect(onA.includes(join('versions', stamp)), `the first worker should run ${stamp}, runs ${onA}`);

  const held = call('run_code', { body: 'const end = Date.now() + 5000; while (Date.now() < end) {} return "held on A";' }, 60000);
  await sleep(1500);
  point(second);
  const body = await held;
  expect(body?.output === 'held on A', `the body in flight should finish on the old build: ${JSON.stringify(body)?.slice(0, 200)}`);

  await sleep(4000);
  const afterReply = await rpc('tools/call', { name: 'run_code', arguments: { body: 'return (await gm.run_shell({ command: "echo answered" })).output;' } }, 60000);
  const after = afterReply?.result?.structuredContent ?? null;
  expect(after?.ok === true && String(after?.output).includes('answered'), `the next call should be answered by the new build: ${JSON.stringify(after)?.slice(0, 200)}`);
  const onB = workerExe();
  expect(onB.includes(join('versions', second)), `the worker should run ${second} after the hand-over, runs ${onB}`);
  expect(notices.some((text) => text.includes(`gm build changed from ${stamp} to ${second}`)), `the session should get one notice of the change: ${JSON.stringify(notices)}`);
  const log = runLog();
  const restarts = log.filter((event) => event.kind === 'restart');
  const restartAt = log.findIndex((event) => event.kind === 'restart');
  expect(restartAt > 0 && log.slice(restartAt).every((event) => event.kind !== 'skill-loaded'), `an unchanged skill should not be read again after the hand-over: ${JSON.stringify(log.slice(restartAt).filter((event) => event.kind === 'skill-loaded'))}`);
  expect(restarts.length === 1 && restarts[0].skillRead === true && restarts[0].skillChanged === false, `an unchanged skill should carry over without a re-read: ${JSON.stringify(restarts)}`);
  expect(restarts.length === 1 && typeof restarts[0].skillSha === 'string' && restarts[0].skillSha === restarts[0].skillWas, `the restart should record the fingerprint it matched: ${JSON.stringify(restarts)}`);
  expect(log.filter((event) => event.kind === 'start').length === 1, 'the run should keep one start event across the hand-over');
  expect(log.length > before, 'the run log should keep growing across the hand-over');
  expect(log.every((event, index) => index === 0 || event.seq === log[index - 1].seq + 1), 'the run log seq should stay continuous across the hand-over');

  const older = '0b7a16b961ae-dev';
  const directRun = join(workspace, 'runs', 'direct');
  const serve = (fromBuild) => {
    const args = ['serve', '--workspace', workspace, '--run-dir', directRun, '--mcp-config', quiet, ...(fromBuild ? ['--from-build', fromBuild] : [])];
    const child = spawn(join(hostDir, 'gm'), args, { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.on('error', () => {});
    const waiting = new Map();
    let next = 1;
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
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
    const send = (method, params) =>
      new Promise((done) => {
        const id = next++;
        const timer = setTimeout(() => done(null), 60000);
        waiting.set(id, (m) => {
          clearTimeout(timer);
          done(m);
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    const start = async () => {
      await send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CHECK, version: '1' } });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    };
    return { send, start, stop: () => child.kill('SIGKILL') };
  };
  const firstRun = serve(null);
  await firstRun.start();
  await firstRun.send('tools/call', { name: 'next_context', arguments: {} });
  firstRun.stop();
  await sleep(500);
  const restarted = serve(older);
  await restarted.start();
  await restarted.send('resources/read', { uri: 'skill://gm/SKILL.md' });
  const firstReply = await restarted.send('tools/call', { name: 'run_code', arguments: { body: 'return "direct";' } });
  const secondReply = await restarted.send('tools/call', { name: 'run_code', arguments: { body: 'return "again";' } });
  restarted.stop();
  const noticeLine = `gm build changed from ${older} to ${stamp}; this session now runs ${stamp}, and its run carries over`;
  const carriedOf = (reply) => {
    try {
      return JSON.parse(reply?.result?.content?.[0]?.text ?? 'null');
    } catch {
      return null;
    }
  };
  const noticesIn = (reply) => (reply?.result?.content ?? []).filter((block) => block.text === noticeLine).length;
  expect(noticesIn(firstReply) === 1, `the first reply after a hand-over should carry the notice once: ${JSON.stringify(firstReply)?.slice(0, 300)}`);
  expect(carriedOf(firstReply)?.handover === noticeLine, `the first reply's text JSON should carry the notice in handover, which the host keeps: ${JSON.stringify(carriedOf(firstReply))?.slice(0, 300)}`);
  expect(carriedOf(secondReply)?.handover === undefined, 'the handover field should not repeat on the next reply');
  expect(noticesIn(secondReply) === 0, 'the notice should not repeat on the next reply');
  const directRestarts = existsSync(join(directRun, 'log.jsonl')) ? readFileSync(join(directRun, 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.kind === 'restart') : [];
  expect(directRestarts.length === 1 && directRestarts[0].reason === `build ${older} -> ${stamp}`, `the restart should name the build change: ${JSON.stringify(directRestarts)}`);

  point(broken);
  const refusalDeadline = Date.now() + 60000;
  while (!stderr.join('').includes(`refused build ${broken}`) && Date.now() < refusalDeadline) await sleep(250);
  const still = await call('run_code', { body: 'return "still on B";' }, 60000);
  expect(still?.output === 'still on B', `a broken build must not take the session: ${JSON.stringify(still)?.slice(0, 200)}`);
  expect(workerExe().includes(join('versions', second)), 'a broken build must leave the worker on its build');
  expect(stderr.join('').includes(`refused build ${broken}`), `the relay should name the refused build: ${stderr.join('').slice(-300)}`);

  const home = join(sandbox, 'home');
  mkdirSync(home);
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const buildDir = join(hostDir, '..', '..', '..');
  const installOnce = () => spawnSync('sh', [join(root, 'scripts', 'install.sh'), '--local', buildDir], { env, encoding: 'utf8', timeout: 120000 });
  const first = installOnce();
  expect(first.status === 0, `the first local install should succeed: ${first.stderr}`);
  const homeWorkspace = join(sandbox, 'home-ws');
  mkdirSync(homeWorkspace);
  const homeRelay = spawn(join(home, '.gmnew', 'current', 'gm'), ['serve', '--workspace', homeWorkspace, '--run-dir', join(homeWorkspace, 'runs', 'same'), '--mcp-config', quiet, '--skill-read', 'yes'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  homeRelay.stdin.on('error', () => {});
  const homeWaiting = new Map();
  let homeNext = 1;
  readline.createInterface({ input: homeRelay.stdout }).on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id !== undefined && homeWaiting.has(message.id)) {
      homeWaiting.get(message.id)(message);
      homeWaiting.delete(message.id);
    }
  });
  const homeRpc = (method, params) =>
    new Promise((done) => {
      const id = homeNext++;
      const timer = setTimeout(() => done(null), 60000);
      homeWaiting.set(id, (m) => {
        clearTimeout(timer);
        done(m);
      });
      homeRelay.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  const workersOf = () => spawnSync('pgrep', ['-P', String(homeRelay.pid)], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean).sort();
  try {
    await homeRpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CHECK, version: '1' } });
    homeRelay.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    await homeRpc('tools/call', { name: 'next_context', arguments: {} });
    const workersBefore = workersOf();
    expect(workersBefore.length > 0, 'the home relay should have a worker before the identical install');
    const again = installOnce();
    expect(again.status === 0, `the identical install should succeed: ${again.stderr}`);
    expect(again.stdout.includes('the binaries and their processes were kept'), `the identical install should keep the binaries: ${again.stdout}`);
    await sleep(3000);
    expect(JSON.stringify(workersOf()) === JSON.stringify(workersBefore), `an identical install must leave every worker pid unchanged: before ${workersBefore} after ${workersOf()}`);
  } finally {
    homeRelay.kill('SIGKILL');
  }
} finally {
  relay.kill('SIGKILL');
  rmSync(sandbox, { recursive: true, force: true });
}

const wall = ((Date.now() - started) / 1000).toFixed(2);
if (failures.length > 0) {
  console.error(`${CHECK}: ${failures.length} failure(s) (wall ${wall} s)\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`${CHECK}: ok (${stamp} -> ${second}: the body in flight finished on the old build, the next call ran on the new one, the run log carried over, and the broken build ${broken} was refused; wall ${wall} s)`);
}
