#!/usr/bin/env node
import { spawn } from './lib/group.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const CHECK = 'clock-mutation-check';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = resolve(process.argv[2] ?? join(root, 'build', 'release'));
const binary = join(buildDir, 'native', 'components', 'host', 'gm');
if (!existsSync(binary)) {
  console.error(`${CHECK}: usage: node tools/check-clock-mutations.mjs <build dir>`);
  process.exit(2);
}
const started = Date.now();
const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
const build = () => spawnSync('cmake', ['--build', buildDir, '-j', '4'], { encoding: 'utf8', timeout: 580000 });

const guard = async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'gm-clock-guard-'));
  const workspace = join(scratch, 'ws');
  mkdirSync(workspace);
  const quiet = join(scratch, 'quiet.json');
  writeFileSync(quiet, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
  const env = { ...process.env, GM_CLOCK_SCALE: '0.0167' };
  delete env.GMNEW_TEST_CLOCK;
  const child = spawn(binary, ['serve', '--workspace', workspace, '--run-dir', join(workspace, 'run'), '--mcp-config', quiet], { stdio: ['pipe', 'pipe', 'pipe'], env });
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
      pending.set(id, done);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  try {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CHECK, version: '1' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
    await rpc('tools/call', { name: 'next_context', arguments: {} });
    const reply = await rpc('tools/call', { name: 'run_code', arguments: { format: 'esm', body: 'const end = Date.now() + 2000; while (Date.now() < end) {} return { spun: true };' } });
    const body = JSON.parse(reply.result.content[0].text);
    expect(body.ok === true && body.background === undefined, `the scale was honoured without GMNEW_TEST_CLOCK: a 2000 ms body with no timeoutMs became ${JSON.stringify(body).slice(0, 200)}`);
  } finally {
    child.kill('SIGKILL');
    rmSync(scratch, { recursive: true, force: true });
  }
};

const MUTANTS = [
  {
    name: 'job lifetime 60 s',
    file: join(root, 'native', 'components', 'mcp', 'include', 'gm', 'mcp.hpp'),
    from: 'std::uint64_t job_lifetime_ms = 3600000;',
    to: 'std::uint64_t job_lifetime_ms = 60000;',
    check: 'check-run-code-budget.mjs',
  },
  {
    name: 'job wait cap 30 s',
    file: join(root, 'native', 'components', 'verbs', 'job.cpp'),
    from: 'const double max_wait_ms = 60000 * clock_scale();',
    to: 'const double max_wait_ms = 30000 * clock_scale();',
    check: 'check-turn-economy.mjs',
  },
];

try {
  await guard();
  for (const mutant of MUTANTS) {
    const source = readFileSync(mutant.file, 'utf8');
    expect(source.includes(mutant.from), `${mutant.name}: the source text to mutate is not in ${mutant.file}`);
    if (!source.includes(mutant.from)) continue;
    try {
      writeFileSync(mutant.file, source.replace(mutant.from, mutant.to));
      const built = build();
      expect(built.status === 0, `${mutant.name}: the mutant did not build: ${String(built.stderr).slice(-300)}`);
      const run = spawnSync(process.execPath, [join(root, 'tools', mutant.check), binary], { encoding: 'utf8', timeout: 300000 });
      expect(run.status !== 0, `${mutant.name}: ${mutant.check} passed on the mutant, so the scaled check does not prove this regression`);
      console.log(`${CHECK}: ${mutant.name}: ${mutant.check} ${run.status === 0 ? 'passed (not caught)' : `failed as expected (exit ${run.status})`}`);
    } finally {
      writeFileSync(mutant.file, source);
    }
  }
} finally {
  const restored = build();
  expect(restored.status === 0, `the binary did not rebuild after the mutations were reverted: ${String(restored.stderr).slice(-300)}`);
}

const wall = ((Date.now() - started) / 1000).toFixed(2);
if (failures.length > 0) {
  console.error(`${CHECK}: ${failures.length} failure(s) (wall ${wall} s)\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`${CHECK}: ok (the scale is not honoured without GMNEW_TEST_CLOCK; each reinstated old value fails its scaled check; the sources are restored; wall ${wall} s)`);
}
