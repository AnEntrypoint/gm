#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [, , given, which = 'all'] = process.argv;
if (!given) {
  console.error('usage: node tools/parity-contract.mjs <gm binary> [W1..W20 | all]');
  process.exit(2);
}
const binary = resolve(given);
const hostDir = dirname(binary);
const inBuildTree = hostDir.endsWith(join('native', 'components', 'host'));
const buildDir = inBuildTree ? resolve(hostDir, '..', '..', '..') : join(root, 'build', 'release');
const scratch = mkdtempSync(join(tmpdir(), 'gm-parity-'));

const session = (label) => {
  const dir = mkdtempSync(join(scratch, `${label}-`));
  writeFileSync(join(dir, 'README.md'), 'hello\n');
  const quiet = join(dir, 'quiet.json');
  writeFileSync(quiet, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
  const child = spawn(binary, ['serve', '--workspace', dir, '--run-dir', join(dir, 'run'), '--mcp-config', quiet], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.on('error', () => {});
  child.stderr.resume();
  const pending = new Map();
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (m.id !== undefined && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  let next = 1;
  const rpc = (method, params) =>
    new Promise((done) => {
      const id = next++;
      const timer = setTimeout(() => done(null), 120000);
      pending.set(id, (m) => {
        clearTimeout(timer);
        done(m);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  const call = async (name, args) => (await rpc('tools/call', { name, arguments: args }))?.result?.structuredContent ?? null;
  const open = async () => {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'parity-contract', version: '1' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  };
  return { dir, child, rpc, call, open, close: () => child.kill() };
};

const witnesses = {};
const def = (id, fn) => {
  witnesses[id] = fn;
};

def('W1', async () => {
  const s = session('w1');
  await s.open();
  const list = (await s.rpc('tools/list', {})).result.tools.map((t) => t.name).sort();
  s.close();
  return `tools ${list.join(',')}`;
});

def('W2', async () => {
  const s = session('w2');
  await s.open();
  await s.rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  await s.call('next_context', {});
  const r = await s.call('run_code', { body: 'return { a: 1 };' });
  s.close();
  return `run_code ok=${r.ok} output=${JSON.stringify(r.output)} truncated=${r.truncated} loads=${JSON.stringify(r.loads)}`;
});

def('W3', async () => {
  const s = session('w3');
  await s.open();
  await s.rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  await s.call('next_context', {});
  const r = await s.call('run_code', { body: 'throw new Error("x");' });
  const syntax = await s.call('run_code', { body: 'return (;' });
  s.close();
  return `throw ok=${r.ok} error-first-line=${JSON.stringify(r.error.split('\n')[0])}; syntax ok=${syntax.ok} error-prefix=${JSON.stringify(syntax.error.slice(0, 28))}`;
});

def('W4', async () => {
  const s = session('w4');
  await s.open();
  const first = await s.call('run_code', { body: 'return 1;' });
  const again = await s.call('run_code', { body: 'return 2;' });
  s.close();
  const text = first.error ?? '';
  return `first run_code before skill read ok=${first.ok} refused-once=${text.includes('had not been read')}; second ok=${again.ok}`;
});

def('W5', async () => {
  const s = session('w5');
  await s.open();
  await s.rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  const first = await s.call('next_context', {});
  const unchanged = await s.call('next_context', {});
  s.close();
  return `next_context first full=${first.rules !== undefined} keys-include-prefixSha=${'prefixSha' in first}; repeat unchanged=${unchanged.unchanged === true} keys=${Object.keys(unchanged).sort().join(',')}`;
});

def('W6', async () => {
  const s = session('w6');
  await s.open();
  await s.rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  const ctx = await s.call('next_context', { full: true });
  s.close();
  const need = ['ok', 'step', 'run', 'stepsLeft', 'maxSteps', 'rules', 'witness', 'prefixSha', 'total', 'pendingCommands', 'events', 'query'];
  return `full reply has ${need.filter((k) => k in ctx).length}/${need.length} listed keys; stepsLeft=${ctx.stepsLeft} maxSteps=${ctx.maxSteps}`;
});

def('W7', async () => {
  const s = session('w7');
  await s.open();
  await s.rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  await s.call('next_context', {});
  const fin = await s.call('finish', { witness: 'parity witness' });
  const again = await s.call('finish', { witness: 'again' });
  s.close();
  return `finish ok=${fin.ok} finished=${fin.finished} output=${JSON.stringify(fin.output)}; second finish refused=${again.refused === true}`;
});

def('W8', async () => {
  const s = session('w8');
  await s.open();
  await s.rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  await s.call('next_context', {});
  const reply = await s.rpc('tools/call', { name: 'finish', arguments: {} });
  s.close();
  const refused = reply.error !== undefined || reply.result?.structuredContent?.ok === false || reply.result?.isError === true;
  return `finish without witness refused=${refused}`;
});

def('W9', async () => {
  const s = session('w9');
  await s.open();
  const skill = (await s.rpc('resources/read', { uri: 'skill://gm/SKILL.md' })).result.contents[0].text;
  const workflows = (await s.rpc('resources/read', { uri: 'skill://gm/WORKFLOWS.md' })).result.contents[0].text;
  const missing = await s.rpc('resources/read', { uri: 'skill://nope/X.md' });
  s.close();
  return `skill-md starts ${JSON.stringify(skill.slice(0, 9))}; workflows bytes ${workflows.length > 0}; unknown skill code ${missing.error.code} message ${JSON.stringify(missing.error.message)}`;
});

def('W10', async () => {
  const s = session('w10');
  await s.open();
  await s.rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  const ctx = await s.call('next_context', {});
  const log = await s.rpc('resources/read', { uri: `run://${ctx.run}/log` });
  const first = JSON.parse(log.result.contents[0].text.split('\n')[0]);
  s.close();
  return `run log first event kind=${first.kind} seq=${first.seq}`;
});

def('W11', async () => {
  const s = session('w11');
  await s.open();
  await s.rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  const ctx = await s.call('next_context', {});
  const before = await s.rpc('resources/read', { uri: `run://${ctx.run}/witness` });
  await s.call('finish', { witness: 'parity witness text' });
  const after = await s.rpc('resources/read', { uri: `run://${ctx.run}/witness` });
  s.close();
  return `witness before finish code=${before.error?.code}; after finish ${JSON.stringify(after.result.contents[0].text)}`;
});

def('W12', async () => {
  const s = session('w12');
  await s.open();
  const templates = (await s.rpc('resources/templates/list', {})).result.resourceTemplates.map((t) => t.uriTemplate);
  s.close();
  return `templates ${templates.join(' ')}`;
});

def('W13', async () => {
  const s = session('w13');
  await s.open();
  await s.rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  const ctx = await s.call('next_context', {});
  const listed = await s.rpc('resources/read', { uri: `run://${ctx.run}/log` });
  s.close();
  return `run log readable=${listed.result !== undefined}`;
});

def('W14', async () => {
  const s = session('w14');
  await s.open();
  await s.rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  await s.call('next_context', {});
  const proc = spawn('sleep', ['2']);
  const started = Date.now();
  const r = await s.call('run_code', { body: `return await gm.job_status({ pid: ${proc.pid}, waitMs: 20000 });` });
  const wall = Date.now() - started;
  s.close();
  const state = r.output?.state;
  return `pid wait state=${state} returned-before-20s=${wall < 15000} exitCode=${r.output?.exitCode}`;
});

def('W15', async () => {
  const s = session('w15');
  await s.open();
  await s.rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  await s.call('next_context', {});
  const described = await s.call('run_code', { body: 'return gm.verbs().find((v) => v.name === "job_status").description;' });
  const gone = [];
  for (const waitMs of [99999, 100001]) {
    const proc = spawn('sleep', ['2']);
    const r = await s.call('run_code', { body: `return await gm.job_status({ pid: ${proc.pid}, waitMs: ${waitMs} });` });
    gone.push(r.output?.state === 'gone' && r.output?.waitedMs < 3000);
  }
  const live = spawn('sleep', ['300']);
  const held = await s.call('run_code', { body: `return await gm.job_status({ pid: ${live.pid}, waitMs: 3000 });` });
  live.kill();
  s.close();
  const waited = held.output?.waitedMs ?? 0;
  return `cap 100000 in the verb description: ${String(described.output).includes('at most 100000')}; waitMs below and above the cap on a 2 s process: gone ${gone.join(' ')}; a live process with waitMs 3000: state=${held.output?.state} waited-3s=${waited >= 2900 && waited < 3500}`;
});

def('W16', async () => {
  const s = session('w16');
  await s.open();
  await s.rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  await s.call('next_context', {});
  const proc = spawn('sleep', ['2']);
  const body = `let n = 0; for (;;) { n += 1; const r = await gm.job_status({ pid: ${proc.pid}, waitMs: 1000 }); if (r.state !== 'running') return { calls: n, state: r.state }; }`;
  const r = await s.call('run_code', { body });
  s.close();
  return `one-body loop returned state=${r.output?.state} with calls>=2: ${r.output?.calls >= 2}`;
});

def('W17', async () => {
  const home = join(scratch, 'home17');
  mkdirSync(home, { recursive: true });
  const env = { ...process.env, HOME: home, GMNEW_SKIP_REGISTER: '1' };
  const run = () => spawnSync('sh', [join(root, 'scripts', 'install.sh'), '--local', buildDir], { cwd: root, env, encoding: 'utf8', timeout: 120000 });
  const first = run();
  const current = join(home, '.gmnew', 'current');
  const id = readlinkSync(current).split('/').pop();
  const older = join(home, '.gmnew', 'versions', 'older-dev');
  cpSync(join(home, '.gmnew', 'versions', id), older, { recursive: true });
  const link = join(home, '.gmnew', 'current.test');
  symlinkSync(join('versions', 'older-dev'), link);
  renameSync(link, current);
  const second = run();
  const previous = join(home, '.gmnew', `previous-older-dev`);
  const linked = existsSync(previous) && readlinkSync(previous) === join('versions', 'older-dev');
  return `install exit=${first.status}/${second.status}; current is a link ${readlinkSync(current) === join('versions', id)}; previous-older-dev link to versions/older-dev ${linked}; kept line ${second.stdout.includes('kept the previous install')}`;
});

def('W18', async () => {
  const home = join(scratch, 'home18');
  mkdirSync(home, { recursive: true });
  const env = { ...process.env, HOME: home, GMNEW_SKIP_REGISTER: '1' };
  const installed = spawnSync('sh', [join(root, 'scripts', 'install.sh'), '--local', buildDir], { cwd: root, env, encoding: 'utf8', timeout: 120000 });
  const skills = join(home, '.gmnew', 'current', 'skills');
  const files = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)).map((f) => join(n, f)) : [n])).sort();
  const same = JSON.stringify(files(skills)) === JSON.stringify(files(join(root, 'skills'))) && files(skills).every((f) => readFileSync(join(skills, f)).equals(readFileSync(join(root, 'skills', f))));
  return `install exit=${installed.status}; installed skills equal the checkout's: ${same}`;
});

def('W19', async () => {
  const r = spawnSync(process.execPath, [join(root, 'tools', 'check-build.mjs'), buildDir, '--only', 'check-repeated-checks.mjs'], { encoding: 'utf8', timeout: 600000 });
  const labels = [...r.stdout.matchAll(/^check-build: ([a-z0-9.-]+\.mjs)/gm)].map((m) => m[1]);
  return `--only lists ${JSON.stringify([...new Set(labels)])}; exit ${r.status}`;
});

def('W20', async () => {
  const env = { ...process.env };
  delete env.GM_CHECK_JOBS;
  spawnSync(process.execPath, [join(root, 'tools', 'check-build.mjs'), buildDir, '--only', 'check-repeated-checks.mjs'], { encoding: 'utf8', env, timeout: 600000 });
  const r = spawnSync(process.execPath, [join(root, 'tools', 'check-build.mjs'), buildDir, '--only', 'check-repeated-checks.mjs'], { encoding: 'utf8', env, timeout: 600000 });
  const summary = r.stdout.split('\n').find((l) => l.includes(' run, ')) ?? '';
  const jobs = Number(summary.match(/jobs (\d+)/)?.[1]);
  const expected = Math.min(6, Math.floor(cpus().length / 2));
  return `cache: second --only run ${summary.includes('0 run') ? 'runs 0 scenarios' : 'runs scenarios'}; pool default jobs match min(6, floor(cores/2)) on this host: ${jobs === expected}`;
});

def('W21', async () => {
  const r = spawnSync(process.execPath, [join(root, 'tools', 'check-install-switch.mjs'), binary], { encoding: 'utf8', timeout: 300000 });
  return `relay re-exec on the stable path: exit ${r.status}; ${r.stdout.includes('re-executed through the stable path on the same pid') ? 'same pid switched' : 'not seen'}`;
});

def('W22', async () => {
  const r = spawnSync(process.execPath, [join(root, 'tools', 'check-skill-serve.mjs'), binary], { encoding: 'utf8', timeout: 300000 });
  return `skill-serve default: exit ${r.status}; default serve returns checkout skill: ${r.stdout.includes('the default serve returns the checkout')}`;
});

const ids = which === 'all' ? Object.keys(witnesses) : [which];
let failed = 0;
for (const id of ids) {
  const fn = witnesses[id];
  if (!fn) {
    console.error(`${id} unknown`);
    failed += 1;
    continue;
  }
  try {
    console.log(`${id} pass ${await fn()}`);
  } catch (error) {
    failed += 1;
    console.log(`${id} FAIL ${error.message}`);
  }
}
rmSync(scratch, { recursive: true, force: true });
process.exitCode = failed === 0 ? 0 : 1;
