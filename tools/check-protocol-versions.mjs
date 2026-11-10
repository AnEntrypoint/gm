#!/usr/bin/env node
import { removeTree, stopTree } from './lib/tree.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = 'protocol-versions-check';
const target = process.argv[2] ?? null;
if (target === null) {
  console.error(`${CHECK}: usage: node tools/check-protocol-versions.mjs <node|path-to-native-binary>`);
  process.exit(2);
}
const onNode = target === 'node';
const binary = onNode ? process.execPath : resolve(target);
if (!onNode && !existsSync(binary)) {
  console.error(`${CHECK}: failed: no native binary at ${binary}`);
  process.exit(2);
}

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'];
const LATEST = VERSIONS[0];
const UNKNOWN = '1999-01-01';
const REFUSED = '2024-01-01';
const REPLY_MS = 60000;
const BOOT_MS = 180000;
const EVENT_MS = 60000;
const STDERR_TAIL = 2000;

const FAKE_SERVER = String.raw`import readline from 'node:readline';
const [version, mode] = process.argv.slice(2);
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    const result = { protocolVersion: version, capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1.0.0' } };
    if (mode === 'no-capabilities') delete result.capabilities;
    if (mode === 'no-server-version') delete result.serverInfo.version;
    send({ jsonrpc: '2.0', id: message.id, result });
  } else if (message.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: message.id, result: { tools: [] } });
  } else if (message.id !== undefined) {
    send({ jsonrpc: '2.0', id: message.id, result: {} });
  }
});
`;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const spawnEngine = (args) => {
  const leading = onNode ? [join(root, 'src', 'mcp.mjs')] : ['serve'];
  const child = spawn(onNode ? process.execPath : binary, [...leading, ...args], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, GMNEW_TRACE_STARTUP: '1' } });
  let stderr = '';
  const startedAt = Date.now();
  let relayAt = null;
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + String(chunk)).slice(-STDERR_TAIL);
    if (relayAt === null && stderr.includes('worker running')) relayAt = Date.now() - startedAt;
  });
  let exit = null;
  child.once('exit', (code, signal) => {
    exit = { code, signal };
    for (const done of pending.values()) done(null);
    pending.clear();
  });
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
  const rpc = (method, params) =>
    new Promise((done) => {
      if (exit !== null) {
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
  const stop = async () => {
    await stopTree(child);
  };
  const cause = () => {
    if (exit === null) return '';
    const how = exit.signal !== null ? `signal ${exit.signal}` : `code ${exit.code}`;
    return `engine exited with ${how} before it answered; stderr: ${stderr.trim() || '(empty)'}`;
  };
  return { rpc, stop, cause, stderrTail: () => stderr.trim() || '(empty)', exited: () => exit !== null, startedAt, relayAt: () => relayAt };
};

const layoutOf = (dir) => {
  if (!existsSync(dir)) return 'missing';
  return readdirSync(dir, { withFileTypes: true }).map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name)).join(' ') || '(empty)';
};

const findEvent = (logFile, predicate) => {
  if (!existsSync(logFile)) return null;
  for (const line of readFileSync(logFile, 'utf8').split('\n')) {
    if (line === '') continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (predicate(entry)) return entry;
  }
  return null;
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const serverCase = async (scratch, asked) => {
  const workspace = mkdtempSync(join(scratch, 'server-'));
  const engine = spawnEngine(['--workspace', workspace, '--run-dir', join(workspace, 'run'), '--mcp-config', join(scratch, 'quiet-mcp.json')]);
  try {
    const reply = await engine.rpc('initialize', { protocolVersion: asked, capabilities: {}, clientInfo: { name: CHECK, version: '1' } });
    return { reply, cause: engine.cause() };
  } finally {
    await engine.stop();
  }
};

const clientCase = async (scratch, { version, mode }) => {
  const workspace = mkdtempSync(join(scratch, 'client-'));
  const runDir = join(workspace, 'run');
  const config = join(workspace, 'mcp.json');
  writeFileSync(config, JSON.stringify({ mcpServers: { playwriter: { disabled: true }, fake: { command: process.execPath, args: [join(scratch, 'fake-server.mjs'), version, mode] } } }));
  const engine = spawnEngine(['--workspace', workspace, '--run-dir', runDir, '--mcp-config', config]);
  const matches = (entry) => entry.kind === 'mcp-server' && entry.server === 'fake' && (entry.state === 'connected' || entry.state === 'failed');
  const logFile = join(runDir, 'log.jsonl');
  const bootDeadline = Date.now() + BOOT_MS;
  try {
    let logAt = null;
    while (logAt === null && !engine.exited() && Date.now() < bootDeadline) {
      if (existsSync(logFile)) logAt = Date.now() - engine.startedAt;
      else await sleep(50);
    }
    let event = logAt === null ? null : findEvent(logFile, matches);
    const deadline = Date.now() + EVENT_MS;
    while (logAt !== null && event === null && !engine.exited() && Date.now() < deadline) {
      await sleep(100);
      event = findEvent(logFile, matches);
    }
    const logTail = event === null && existsSync(logFile) ? readFileSync(logFile, 'utf8').slice(-600) : '';
    const layout = event === null ? `workspace: ${layoutOf(workspace)}; run: ${layoutOf(runDir)}` : '';
    const timeline = `relay said worker running at ${engine.relayAt() ?? 'never'} ms after spawn; run log created at ${logAt ?? 'never'} ms`;
    return { event, cause: engine.cause(), stderr: engine.stderrTail(), logTail, layout, timeline, logAt };
  } finally {
    await engine.stop();
  }
};

const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};

const scratch = mkdtempSync(join(tmpdir(), 'gm-protocol-versions-'));
try {
  writeFileSync(join(scratch, 'quiet-mcp.json'), JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
  writeFileSync(join(scratch, 'fake-server.mjs'), FAKE_SERVER);

  const served = await Promise.all([...VERSIONS, UNKNOWN].map(async (asked) => ({ asked, ...(await serverCase(scratch, asked)) })));
  for (const { asked, reply, cause } of served) {
    const expected = VERSIONS.includes(asked) ? asked : LATEST;
    const label = `server asked ${asked}`;
    if (reply === null || reply.error !== undefined) {
      failures.push(`${label}: no initialize result: ${JSON.stringify(reply)}${cause ? `; ${cause}` : ''}`);
      continue;
    }
    const result = reply.result ?? {};
    expect(result.protocolVersion === expected, `${label}: protocolVersion is ${JSON.stringify(result.protocolVersion)}, expected ${expected}`);
    expect(isObject(result.capabilities), `${label}: capabilities is not an object`);
    expect(typeof result.serverInfo?.version === 'string' && result.serverInfo.version !== '', `${label}: serverInfo.version is not a non-empty string`);
  }

  const cases = [
    ...VERSIONS.map((version) => ({ label: `client accepts ${version}`, version, mode: 'ok' })),
    { label: `client refuses ${REFUSED}`, version: REFUSED, mode: 'ok' },
    { label: 'client refuses a result without capabilities', version: LATEST, mode: 'no-capabilities' },
    { label: 'client refuses a result without serverInfo.version', version: LATEST, mode: 'no-server-version' },
  ];
  const events = await Promise.all(cases.map((item) => clientCase(scratch, item)));
  cases.forEach((item, index) => {
    const { event, cause, stderr, logTail, layout, timeline, logAt } = events[index];
    const label = item.label;
    if (event === null) {
      failures.push(`${label}: ${logAt === null ? `no run log within ${BOOT_MS} ms of spawn` : `no mcp-server event within ${EVENT_MS} ms of the run log (created at ${logAt} ms)`}${cause ? `; ${cause}` : ''}; engine stderr: ${stderr || '(none)'}; log tail: ${JSON.stringify(logTail || '(no log)')}; layout ${layout}; ${timeline}`);
      return;
    }
    if (item.mode === 'ok' && VERSIONS.includes(item.version)) {
      expect(event.state === 'connected' && event.protocolVersion === item.version, `${label}: state ${event.state}, protocolVersion ${event.protocolVersion}${event.error ? `, error ${event.error}` : ''}`);
    } else {
      expect(event.state === 'failed', `${label}: state ${event.state}, expected failed${event.error ? ` (error ${event.error})` : ''}`);
    }
  });

  const boots = events.map((item) => item.logAt).filter((ms) => ms !== null);
  const slowestBoot = boots.length ? Math.max(...boots) : null;
  const slowest = events.reduce((a, b) => ((b.logAt ?? 0) > (a.logAt ?? 0) ? b : a));
  const traces = slowest.stderr.split('\n').filter((line) => line.startsWith('gm trace:')).join(' | ');
  if (failures.length) {
    console.error(`${CHECK}: ${failures.length} failure(s) on ${target}\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log(`${CHECK}: ok (${target}: server echoes the ${VERSIONS.length} supported versions, answers ${UNKNOWN} with ${LATEST}, every initialize result has capabilities and serverInfo.version; client connects all ${VERSIONS.length} versions, refuses ${REFUSED}, refuses a result without capabilities and one without serverInfo.version; the run log of each of ${boots.length} client engines was created within ${slowestBoot} ms of spawn; slowest engine trace: ${traces || 'no trace lines'})`);
  }
} finally {
  await removeTree(scratch);
}
process.exit(process.exitCode ?? 0);
