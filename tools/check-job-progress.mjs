#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { once } from 'node:events';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.argv[2] ? resolve(process.argv[2]) : null;
const failures = [];
const arms = [];
const exited = (child) => (child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit'));
const configDir = mkdtempSync(join(tmpdir(), 'gm-progress-check-mcp-'));
const mcpConfig = join(configDir, 'no-default-mcp.json');
writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
const watchdog = setTimeout(() => { console.error('check-job-progress: failed: no completion within 120000 ms'); process.exit(1); }, 120000);
watchdog.unref();

function start(command, args) {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.resume();
  const pending = new Map();
  let nextId = 1;
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  const rpc = (method, params) => {
    const id = nextId++;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return new Promise((resolveReply) => pending.set(id, resolveReply));
  };
  return { child, rpc };
}

const jobsIn = (node, out = []) => {
  if (Array.isArray(node)) node.forEach((item) => jobsIn(item, out));
  else if (node !== null && typeof node === 'object') {
    if (typeof node.job === 'string' && typeof node.stuck === 'boolean') out.push(node);
    Object.values(node).forEach((value) => jobsIn(value, out));
  }
  return out;
};

const COMMAND = 'for i in 1 2 3 4 5 6 7 8 9 10 11 12; do echo row >> results.jsonl; sleep 0.5; done';
const startBody = `await gm.job_start({ job: 'sink', command: ${JSON.stringify(COMMAND)}, progress: 'results.jsonl' }); await gm.job_start({ job: 'blind', command: ${JSON.stringify(COMMAND)} }); return { started: true };`;
const waitBody = 'await gm.run_shell({ command: "sleep 3.5" }); return await gm.query_log({ kind: "job-stuck" });';

async function arm(label, command, args) {
  const server = start(command, args);
  try {
    await server.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'progress-check', version: '1' } });
    server.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    await server.rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
    await server.rpc('tools/call', { name: 'next_context', arguments: { task: 'job progress check' } });
    const runBody = async (code) => {
      const ran = await server.rpc('tools/call', { name: 'run_code', arguments: { body: code } });
      const runned = JSON.parse(ran.result?.content?.[0]?.text ?? 'null');
      if (runned?.ok !== true) throw new Error('run_code refused: ' + JSON.stringify(runned).slice(0, 200));
      return typeof runned.output === 'string' ? runned.output : JSON.stringify(runned.output);
    };
    await runBody(startBody);
    const logged = String(await runBody(waitBody));
    if (!logged.includes('blind')) failures.push(label + ': the run log has no job-stuck event for the silent job, from the monitor alone: ' + logged.slice(0, 400));
    if (logged.includes('sink')) failures.push(label + ': the run log has a job-stuck event for a job that writes its progress file');
    const step = await server.rpc('tools/call', { name: 'next_context', arguments: {} });
    const reply = JSON.parse(step.result?.content?.[0]?.text ?? 'null');
    const jobs = jobsIn(reply);
    const sink = jobs.find((job) => job.job === 'sink');
    const blind = jobs.find((job) => job.job === 'blind');
    if (!sink || !blind) throw new Error('next_context did not list both running jobs: ' + JSON.stringify(jobs).slice(0, 300));
    if (sink.stuck !== false) failures.push(`${label}: a job that writes its progress file was classified stuck (sinceProgressMs ${sink.sinceProgressMs})`);
    if (blind.stuck !== true) failures.push(`${label}: a silent job with no progress sink was not classified stuck (sinceProgressMs ${blind.sinceProgressMs})`);
    arms.push(label);
    console.log(`${label}: sink stuck=${sink.stuck} sinceProgressMs=${sink.sinceProgressMs}; blind stuck=${blind.stuck} sinceProgressMs=${blind.sinceProgressMs}`);
  } catch (error) {
    failures.push(label + ': ' + error.message);
  } finally {
    server.child.kill();
    await exited(server.child);
  }
}

const workspaces = [];
const fresh = (name) => {
  const dir = mkdtempSync(join(tmpdir(), `gm-progress-${name}-`));
  workspaces.push(dir);
  return dir;
};
const nodeWorkspace = fresh('node');
await arm('node', process.execPath, [join(root, 'src', 'mcp.mjs'), '--workspace', nodeWorkspace, '--run-dir', join(nodeWorkspace, 'node-run'), '--mcp-config', mcpConfig, '--stuck-ms', '2000', '--monitor-ms', '300']);
if (binary !== null && existsSync(binary)) {
  const nativeWorkspace = fresh('native');
  await arm('native', binary, ['serve', '--workspace', nativeWorkspace, '--run-dir', join(nativeWorkspace, 'native-run'), '--mcp-config', mcpConfig, '--stuck-ms', '2000', '--monitor-ms', '300']);
} else {
  console.log('native: skipped (no binary given)');
}
for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
rmSync(configDir, { recursive: true, force: true });
clearTimeout(watchdog);
if (failures.length > 0) {
  console.error('check-job-progress: failed: ' + failures.join('; '));
  process.exit(1);
}
console.log(`check-job-progress: passed: a job that writes its declared progress file is not stuck, and a silent job with no progress sink is stuck, in ${arms.join(' and ')}`);
