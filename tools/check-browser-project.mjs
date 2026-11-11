import { execFileSync } from 'node:child_process';
import { spawn } from './lib/group.mjs';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
if (!target || !existsSync(resolve(target))) {
  console.error('browser-project-check: failed: pass the built gm binary as the argument');
  process.exit(1);
}
const WATCHDOG_MS = 900000;
const watchdog = setTimeout(() => {
  console.error('browser-project-check: failed: no completion within ' + WATCHDOG_MS + ' ms');
  process.exit(1);
}, WATCHDOG_MS);
watchdog.unref();

const bin = resolve(target);
const mcpConfig = join(root, 'defaults', 'mcp.json');
const names = ['alpha', 'beta'];
const workspaces = Object.fromEntries(names.map((name) => [name, realpathSync(mkdtempSync(join(tmpdir(), 'gm-browser-' + name + '-')))]));
const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};

const snippet = (title) => "(async () => { state.page = state.page ?? await context.newPage(); await state.page.setContent('<title>" + title + "</title>'); return await state.page.title(); })()";
const body = (name) => 'const exec = await gm.playwriter_execute({ code: ' + JSON.stringify(snippet(name)) + ' }); const browsers = await gm.playwriter_browsers({ action: "list" }); return { exec, browsers };';
const closeBody = 'return { closed: await gm.playwriter_browsers({ action: "close", target: "project" }) };';

const valueOf = (reply) => {
  const text = reply.result?.content?.[0]?.text ?? JSON.stringify(reply.error ?? null);
  let value = JSON.parse(text);
  if (value && value.output !== undefined) value = value.output;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
};

const session = (workspace) => {
  const child = spawn(bin, ['serve', '--workspace', workspace, '--mcp-config', mcpConfig], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.resume();
  const pending = new Map();
  let nextId = 1;
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
  const rpc = (method, params) => {
    const id = nextId++;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return new Promise((done) => pending.set(id, done));
  };
  return { child, rpc };
};

const sessions = [];
const summary = {};
try {
  for (const name of names) {
    const s = session(workspaces[name]);
    sessions.push(s);
    await s.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gm-browser-project-check', version: '1' } });
    s.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    await s.rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
    await s.rpc('tools/call', { name: 'next_context', arguments: {} });
  }
  const runs = await Promise.all(names.map(async (name, index) => {
    const started = Date.now();
    const reply = await sessions[index].rpc('tools/call', { name: 'run_code', arguments: { format: 'esm', body: body(name), timeoutMs: 300000 } });
    return { name, elapsed: Date.now() - started, value: valueOf(reply) };
  }));
  for (const run of runs) {
    const exec = JSON.stringify(run.value?.exec ?? null);
    const list = JSON.stringify(run.value?.browsers ?? null);
    summary[run.name] = { elapsed: run.elapsed, exec: exec.slice(0, 300), list: list.slice(0, 1200) };
    expect(exec.includes('<title>' + run.name) || exec.includes(run.name), run.name + ' run did not return its own page title: ' + exec.slice(0, 300));
  }
  const listed = (name) => JSON.stringify(runs.find((run) => run.name === name)?.value?.browsers ?? null);
  for (const name of names) {
    expect(listed(name).includes(workspaces.alpha) && listed(name).includes(workspaces.beta), name + ' browsers list does not name both project roots: ' + listed(name).slice(0, 400));
  }
  const pidsOf = (text) => new Set([...text.matchAll(/pid\D{0,4}(\d+)/g)].map((m) => m[1]));
  const alphaPids = pidsOf(listed('alpha'));
  expect(alphaPids.size >= 2, 'the browsers list reports fewer than two browser pids: ' + [...alphaPids].join(','));
  const profiles = names.map((name) => join(workspaces[name], '.playwriter', 'browser-profile'));
  expect(profiles.every((profile) => listed('alpha').includes(profile)) || profiles.every((profile) => listed('beta').includes(profile)), 'the profile paths ' + profiles.join(' and ') + ' were not both reported');
  summary.profiles = profiles;
  summary.pids = [...alphaPids];
} catch (error) {
  failures.push(String(error?.stack ?? error));
} finally {
  for (const s of sessions) {
    try {
      await s.rpc('tools/call', { name: 'run_code', arguments: { format: 'esm', body: closeBody, timeoutMs: 120000 } });
    } catch {
      failures.push('close of a project browser did not answer');
    }
    s.child.kill();
  }
  for (const workspace of Object.values(workspaces)) {
    const leftover = execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' }).split('\n').filter((line) => line.includes(workspace) && !line.includes('ps -eo'));
    for (const line of leftover) {
      const pid = Number(line.trim().split(/\s+/)[0]);
      if (Number.isInteger(pid) && pid > 0) process.kill(pid, 'SIGTERM');
    }
    rmSync(workspace, { recursive: true, force: true });
  }
}
if (failures.length > 0) {
  console.error('browser-project-check: failed: ' + failures.join('; '));
  console.error(JSON.stringify(summary));
  process.exit(1);
}
console.log('browser-project-check: ok ' + JSON.stringify(summary));
process.exit(0);
