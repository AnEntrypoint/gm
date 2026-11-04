import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, rmSync, writeFileSync, readFileSync, symlinkSync, existsSync, cpSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const argValue = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : fallback;
};
const NATIVE_BIN = resolve(argValue('--bin', join(REPO, 'build', 'integ', 'native', 'components', 'host', 'gmnew')));
const REF = resolve(argValue('--ref', '/tmp/parity-ref'));
const SCRATCH = resolve(argValue('--scratch', `/tmp/parity-scratch-${process.pid}`));
const REPLY_TIMEOUT_MS = Number(argValue('--reply-timeout-ms', '30000'));
const VALUE_WIDTH = 160;
const FIXED_DATE = '2026-01-01T00:00:00Z';

function extractReference() {
  rmSync(REF, { recursive: true, force: true });
  mkdirSync(REF, { recursive: true });
  const archive = execFileSync('git', ['-C', REPO, 'archive', '--format=tar', 'HEAD', 'src', 'tools', 'skills', 'defaults', 'package.json'], { maxBuffer: 1 << 28 });
  execFileSync('tar', ['-x', '-C', REF], { input: archive });
  symlinkSync(join(REPO, 'node_modules'), join(REF, 'node_modules'));
  return execFileSync('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
}

function makeWorkspaces(base = SCRATCH) {
  rmSync(base, { recursive: true, force: true });
  const seed = join(base, 'seed');
  mkdirSync(join(seed, 'src'), { recursive: true });
  writeFileSync(join(seed, 'README.md'), 'hello world\nhello again\nhelloworld\n');
  writeFileSync(join(seed, 'src', 'a.js'), "export function hello() {\n  return 'hellooo';\n}\n");
  writeFileSync(join(seed, 'notes.txt'), 'parity notes\nfoo.bar baz\n');
  const env = { ...process.env, GIT_AUTHOR_NAME: 'parity', GIT_AUTHOR_EMAIL: 'parity@example.invalid', GIT_COMMITTER_NAME: 'parity', GIT_COMMITTER_EMAIL: 'parity@example.invalid', GIT_AUTHOR_DATE: FIXED_DATE, GIT_COMMITTER_DATE: FIXED_DATE };
  const git = (...args) => execFileSync('git', ['-C', seed, ...args], { env, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'parity seed');
  const head = git('rev-parse', 'HEAD');
  const spaces = {};
  for (const side of ['node', 'native']) {
    const workspace = join(base, side, 'ws');
    mkdirSync(join(base, side), { recursive: true });
    cpSync(seed, workspace, { recursive: true });
    spaces[side] = { workspace, runDir: join(base, side, 'runs', 'run-parity'), root: join(base, side) };
  }
  writeFileSync(join(base, 'task.md'), 'parity harness task\n');
  writeFileSync(join(base, 'no-default-mcp.json'), JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
  return { spaces, head };
}

function startHttp() {
  const server = createServer((request, response) => {
    if (request.url.startsWith('/hang')) return;
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end(`parity body for ${request.url}\n`);
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

class Peer {
  constructor(command, args, cwd) {
    this.proc = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    this.waiting = new Map();
    this.notifications = [];
    this.stderr = '';
    this.exited = null;
    let buffered = '';
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => {
      buffered += chunk;
      let newline;
      while ((newline = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (line) this.accept(line);
      }
    });
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (chunk) => { this.stderr += chunk; });
    this.proc.on('exit', (code, signal) => {
      this.exited = { code, signal };
      for (const [, settle] of this.waiting) settle({ noReply: `server exited code ${code} signal ${signal}` });
      this.waiting.clear();
    });
    this.proc.stdin.on('error', () => {});
  }

  accept(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.notifications.push({ unparsed: line });
      return;
    }
    if (message.id !== undefined && this.waiting.has(message.id)) {
      const settle = this.waiting.get(message.id);
      this.waiting.delete(message.id);
      settle(message);
    } else {
      this.notifications.push(message);
    }
  }

  send(message) {
    if (this.exited) return Promise.resolve({ noReply: 'server had exited' });
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
    if (message.id === undefined) return Promise.resolve(null);
    return new Promise((settle) => {
      const timer = setTimeout(() => {
        this.waiting.delete(message.id);
        settle({ noReply: `no reply in ${REPLY_TIMEOUT_MS} ms` });
      }, REPLY_TIMEOUT_MS);
      this.waiting.set(message.id, (reply) => {
        clearTimeout(timer);
        settle(reply);
      });
    });
  }

  async stop() {
    if (this.exited) return;
    this.proc.stdin.end();
    const ended = new Promise((done) => this.proc.once('exit', done));
    const timer = setTimeout(() => this.proc.kill('SIGKILL'), 5000);
    await ended;
    clearTimeout(timer);
  }
}

function scenarios({ head, url }) {
  const call = (name, args) => ({ method: 'tools/call', params: { name, arguments: args } });
  const code = (body) => call('run_code', { body });
  const idOf = (prefix) => `(value) => (JSON.stringify(value).match(/${prefix}-[A-Za-z0-9]+/) ?? [null])[0]`;
  return [
    ['initialize', { method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'parity', version: '1' } } }],
    ['initialized', { method: 'notifications/initialized', notify: true }],
    ['tools/list', { method: 'tools/list', params: {} }],
    ['next_context', call('next_context', {})],
    ['read_file', code("return await gm.read_file({ path: 'README.md' });")],
    ['read_file offset', code("return await gm.read_file({ path: 'README.md', offset: 1, limit: 1 });")],
    ['read_file missing', code("return await gm.read_file({ path: 'missing.txt' });")],
    ['write_file', code("return await gm.write_file({ path: 'out/new.txt', content: 'alpha\\nbeta\\n' });")],
    ['edit_file', code("return await gm.edit_file({ path: 'out/new.txt', old: 'beta', new: 'gamma' });")],
    ['edit_file no match', code("return await gm.edit_file({ path: 'out/new.txt', old: 'zzz', new: 'y' });")],
    ['stat_file', code("return await gm.stat_file({ path: 'out/new.txt' });")],
    ['list_dir', code("return await gm.list_dir({ path: '.' });")],
    ['run_shell', code("return await gm.run_shell({ command: 'echo parity && printf tail' });")],
    ['run_shell exit', code("return await gm.run_shell({ command: 'echo oops 1>&2; exit 3' });")],
    ['search', code("return await gm.search({ query: 'hello function', k: 3 });")],
    ['grep literal', code("return await gm.grep({ pattern: 'foo.bar' });")],
    ['grep regex', code("return await gm.grep({ pattern: 'hel+o+', mode: 'regex' });")],
    ['grep word', code("return await gm.grep({ pattern: 'hello', mode: 'word' });")],
    ['query_log', code("return await gm.query_log({ kind: 'start' });")],
    ['query_log js', code("return await gm.query_log({ js: 'e => e.kind === \"tools\"' });")],
    ['git_status', code('return await gm.git_status({});')],
    ['git_log', code('return await gm.git_log({ count: 5 });')],
    ['prd_add', code("return await gm.prd_add({ title: 'parity row A', body: 'first' });")],
    ['prd_list', code('return await gm.prd_list({});')],
    ['prd_resolve', code(`const added = await gm.prd_add({ title: 'parity row B' }); const id = (${idOf('prd')})(added); return { added, resolved: await gm.prd_resolve({ id, event: 1, commit: '${head}' }) };`)],
    ['prd_delete', code(`const open = await gm.prd_list({ status: 'open' }); const id = (${idOf('prd')})(open); return { open, deleted: await gm.prd_delete({ id }) };`)],
    ['unknown_add', code("return await gm.unknown_add({ title: 'parity question', body: 'which?' });")],
    ['unknown_list', code('return await gm.unknown_list({});')],
    ['unknown_resolve', code(`const open = await gm.unknown_list({ status: 'open' }); const id = (${idOf('unknown')})(open); return await gm.unknown_resolve({ id, event: 1, commit: '${head}' });`)],
    ['fetch', code(`return await gm.fetch({ url: '${url}/parity?x=1' });`)],
    ['fetch refused', code("return await gm.fetch({ url: 'ftp://example.invalid/' });")],
    ['job_start', code("const started = await gm.job_start({ job: 'p1', command: 'echo one; echo two' }); await gm.job_status({ job: 'p1', waitMs: 10000 }); return started;")],
    ['job_status', code("return await gm.job_status({ job: 'p1', waitMs: 10000 });")],
    ['job_stop', code("const started = await gm.job_start({ job: 'p2', command: 'sleep 30' }); const stopped = await gm.job_stop({ job: 'p2' }); return { started, stopped };")],
    ['job_status unknown', code("return await gm.job_status({ job: 'nope' });")],
    ['run_code syntax error', call('run_code', { body: 'return (;' })],
    ['run_code background', call('run_code', { body: `await gm.read_file({ path: 'README.md' }); return await gm.fetch({ url: '${url}/hang', timeoutMs: 60000 });`, timeoutMs: 300 })],
    ['job_status background', (replies) => code(`return await gm.job_status({ job: '${backgroundName(replies)}' });`)],
    ['finish', call('finish', { witness: 'parity harness witness: every scenario ran', stopBackground: true })],
    ['next_context after finish', call('next_context', {})],
  ];
}

function backgroundName(replies) {
  const reply = replies.find(([name]) => name === 'run_code background')?.[1];
  return JSON.parse(reply.result.content[0].text).background;
}

async function drive(peer, script) {
  const replies = [];
  let id = 0;
  for (const [name, given] of script) {
    const step = typeof given === 'function' ? given(replies) : given;
    if (step.notify) {
      await peer.send({ jsonrpc: '2.0', method: step.method });
      continue;
    }
    id += 1;
    const reply = await peer.send({ jsonrpc: '2.0', id, method: step.method, params: step.params });
    replies.push([name, reply]);
  }
  return replies;
}

function parsedDeep(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return parsedDeep(JSON.parse(trimmed));
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(parsedDeep);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, parsedDeep(inner)]));
  return value;
}

const VOLATILE_KEYS = new Set(['t', 'mono', 'pid', 'durMs', 'startMono', 'endMono', 'createdAt', 'mtime', 'mtimeMs', 'ctime', 'atime', 'birthtime', 'elapsedMs', 'ms', 'startedAt', 'endedAt', 'time', 'ts']);

function normalizer(side, spaces) {
  const { workspace, runDir, root } = spaces[side];
  const swaps = [
    [REF, '<REF>'],
    [workspace, '<WS>'],
    [runDir, '<RUNDIR>'],
    [root, '<SIDE>'],
    [SCRATCH, '<SCRATCH>'],
  ];
  const patterns = [
    [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<ISO>'],
    [/\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-[0-9a-f]{6}/g, '<RUNID>'],
    [/\bprd-[A-Za-z0-9]+/g, '<PRD>'],
    [/\bunknown-[A-Za-z0-9]+/g, '<UNKNOWN>'],
    [/\/tmp\/[A-Za-z0-9._-]+/g, '<TMP>'],
    [/\bpid \d+/g, 'pid <N>'],
    [/(the body does not load: ).*?(?= \(line \d+, column \d+\)$)/gm, '$1<ENGINE-MESSAGE>'],
    [/\b\d+(\.\d+)? ?ms\b/g, '<N>ms'],
  ];
  const text = (value) => {
    let out = value;
    for (const [from, to] of swaps) out = out.split(from).join(to);
    for (const [pattern, to] of patterns) out = out.replace(pattern, to);
    return out;
  };
  const walk = (value) => {
    if (typeof value === 'string') return text(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, VOLATILE_KEYS.has(key) && (typeof inner === 'number' || typeof inner === 'string') ? '<V>' : walk(inner)]));
    }
    return value;
  };
  return (value) => walk(parsedDeep(value));
}

function differences(left, right, path = '', out = []) {
  if (left === right) return out;
  const kind = (value) => (Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value);
  if (kind(left) !== kind(right) || (kind(left) !== 'object' && kind(left) !== 'array')) {
    out.push([path || '.', left, right]);
    return out;
  }
  if (kind(left) === 'array') {
    const length = Math.max(left.length, right.length);
    for (let i = 0; i < length; i += 1) {
      if (i >= left.length) out.push([`${path}[${i}]`, undefined, right[i]]);
      else if (i >= right.length) out.push([`${path}[${i}]`, left[i], undefined]);
      else differences(left[i], right[i], `${path}[${i}]`, out);
    }
    return out;
  }
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
  for (const key of keys) {
    const next = `${path}.${key}`;
    if (!(key in left)) out.push([next, undefined, right[key]]);
    else if (!(key in right)) out.push([next, left[key], undefined]);
    else differences(left[key], right[key], next, out);
  }
  return out;
}

function shown(value) {
  if (value === undefined) return '(absent)';
  const text = JSON.stringify(value);
  return text.length > VALUE_WIDTH ? `${text.slice(0, VALUE_WIDTH)}...(${text.length} chars)` : text;
}

const CUTOVER_EXPECTED = [/\.pendingCommands\.wait$/, /\._meta\.com\.anentrypoint\.gmnew\/run$/];
const CUTOVER_PLACEHOLDER = '<CUTOVER-EXPECTED>';

function isCutoverPath(path) {
  return CUTOVER_EXPECTED.some((pattern) => pattern.test(path));
}

function withCutoverPlaceholders(value, path = '') {
  if (isCutoverPath(path) && value !== undefined) return CUTOVER_PLACEHOLDER;
  if (Array.isArray(value)) return value.map((inner, i) => withCutoverPlaceholders(inner, `${path}[${i}]`));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, withCutoverPlaceholders(inner, `${path}.${key}`)]));
  return value;
}

function isSeqPath(path) {
  return /(\.actionSeq|gmnew\/seq)$/.test(path);
}

function mirroredInText(path, diffs) {
  if (!path.startsWith('.result.structuredContent')) return false;
  const twin = path.replace('.result.structuredContent', '.result.content[0].text');
  return diffs.some(([other]) => other === twin);
}

function logKinds(runDir) {
  const file = join(runDir, 'log.jsonl');
  if (!existsSync(file)) return [`no log at ${file}`];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    try {
      const event = JSON.parse(line);
      return event.kind === 'action' || event.kind === 'result' ? `${event.kind}:${event.tool ?? event.name ?? ''}` : event.kind;
    } catch {
      return 'unparsed';
    }
  });
}

function logKindDifferences(nodeKinds, nativeKinds) {
  const tally = (kinds) => kinds.reduce((counts, kind) => ({ ...counts, [kind]: (counts[kind] ?? 0) + 1 }), {});
  const out = differences(tally(nodeKinds), tally(nativeKinds), '.count');
  const split = nodeKinds.findIndex((kind, i) => kind !== nativeKinds[i]);
  const at = split === -1 && nodeKinds.length !== nativeKinds.length ? Math.min(nodeKinds.length, nativeKinds.length) : split;
  if (at !== -1) out.push([`.firstDivergence[${at + 1}]`, nodeKinds.slice(at, at + 6), nativeKinds.slice(at, at + 6)]);
  return out;
}

function toolMethods(notifications) {
  return notifications.map((message) => message.method ?? (message.unparsed ? `unparsed: ${message.unparsed.slice(0, 80)}` : 'reply-without-waiter'));
}

const MCP_KINDS = new Set(['mcp-config', 'mcp-server', 'mcp-tool-skipped', 'gitignore']);

function mcpScenarios() {
  const call = (name, args) => ({ method: 'tools/call', params: { name, arguments: args } });
  const code = (body) => call('run_code', { body });
  return [
    ['initialize', { method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'parity', version: '1' } } }],
    ['initialized', { method: 'notifications/initialized', notify: true }],
    ['tools/list', { method: 'tools/list', params: {} }],
    ['next_context', call('next_context', {})],
    ['mcp echo', code("return await gm.fake_echo({ text: 'hello mcp', n: 2 });")],
    ['mcp browsers', code('return await gm.fake_browsers({});')],
    ['mcp fail', code('return await gm.fake_fail({});')],
    ['mcp denied', code('return typeof gm.fake_hidden;')],
    ['mcp hang', code('return await gm.fake_hang({});')],
    ['mcp crash', code('return await gm.fake_crash({});')],
    ['mcp restart', code('return await gm.fake_browsers({});')],
    ['finish', call('finish', { witness: 'parity harness witness: the MCP servers ran', stopBackground: true })],
  ];
}

function writeMcpConfig(base) {
  const file = join(base, 'fake-mcp.json');
  const fake = { command: process.execPath, args: [join(REPO, 'native', 'tests', 'parity', 'fake-mcp.mjs')], timeoutMs: 1500, startupTimeoutMs: 10000, deny: ['hidden'], ignore: ['cache/'] };
  const broken = { command: '${GMNEW_PARITY_UNSET_VARIABLE}' };
  const typed = { type: 'http', command: 'unused' };
  writeFileSync(file, JSON.stringify({ mcpServers: { playwriter: { disabled: true }, fake, broken, typed } }));
  return file;
}

function mcpEvents(runDir) {
  const file = join(runDir, 'log.jsonl');
  if (!existsSync(file)) return [`no log at ${file}`];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((event) => MCP_KINDS.has(event.kind))
    .map(({ seq, t, mono, startMono, inFlight, ...fields }) => fields);
}

async function mcpPass() {
  const base = join(SCRATCH, 'mcp');
  const { spaces } = makeWorkspaces(base);
  const config = writeMcpConfig(base);
  const task = join(base, 'task.md');
  const script = mcpScenarios();
  const node = new Peer(process.execPath, [join(REF, 'src', 'mcp.mjs'), '--workspace', spaces.node.workspace, '--run-dir', spaces.node.runDir, '--task', task, '--mcp-config', config], REF);
  const nodeReplies = await drive(node, script);
  await node.stop();
  const native = new Peer(NATIVE_BIN, ['worker', '--workspace', spaces.native.workspace, '--run-dir', spaces.native.runDir, '--task', task, '--skills', join(REF, 'skills'), '--leaves', join(REPO, 'native', 'leaves'), '--mcp-config', config], REPO);
  const nativeReplies = await drive(native, script);
  await native.stop();
  const normalNode = normalizer('node', spaces);
  const normalNative = normalizer('native', spaces);
  const rows = nodeReplies.map(([name, reply], i) => [`mcp ${name}`, differences(normalNode(reply), normalNative(nativeReplies[i]?.[1]))]);
  rows.push(['mcp notifications', differences(toolMethods(node.notifications), toolMethods(native.notifications))]);
  rows.push(['mcp log event kinds', logKindDifferences(logKinds(spaces.node.runDir), logKinds(spaces.native.runDir))]);
  rows.push(['mcp server events', differences(normalNode(mcpEvents(spaces.node.runDir)), normalNative(mcpEvents(spaces.native.runDir)))]);
  return rows;
}

async function main() {
  if (!existsSync(NATIVE_BIN)) throw new Error(`native binary not found: ${NATIVE_BIN} (build build/integ or pass --bin)`);
  const refHead = extractReference();
  const { spaces, head } = makeWorkspaces();
  const http = await startHttp();
  const url = `http://127.0.0.1:${http.address().port}`;
  const task = join(SCRATCH, 'task.md');
  const script = scenarios({ head, url });
  try {
    const node = new Peer(process.execPath, [join(REF, 'src', 'mcp.mjs'), '--workspace', spaces.node.workspace, '--run-dir', spaces.node.runDir, '--task', task, '--mcp-config', join(SCRATCH, 'no-default-mcp.json')], REF);
    const nodeReplies = await drive(node, script);
    await node.stop();
    const native = new Peer(NATIVE_BIN, ['worker', '--workspace', spaces.native.workspace, '--run-dir', spaces.native.runDir, '--task', task, '--skills', join(REF, 'skills'), '--leaves', join(REPO, 'native', 'leaves'), '--mcp-config', join(SCRATCH, 'no-default-mcp.json')], REPO);
    const nativeReplies = await drive(native, script);
    await native.stop();

    const normalNode = normalizer('node', spaces);
    const normalNative = normalizer('native', spaces);
    const nodeTranscript = nodeReplies.map(([name, reply]) => [name, normalNode(reply)]);
    const nativeTranscript = nativeReplies.map(([name, reply]) => [name, normalNative(reply)]);
    writeFileSync(join(SCRATCH, 'transcript-node.json'), JSON.stringify(withCutoverPlaceholders(nodeTranscript), null, 1));
    writeFileSync(join(SCRATCH, 'transcript-native.json'), JSON.stringify(withCutoverPlaceholders(nativeTranscript), null, 1));

    const rows = [];
    for (let i = 0; i < nodeTranscript.length; i += 1) {
      const [name, nodeReply] = nodeTranscript[i];
      const nativeReply = nativeTranscript[i]?.[1];
      rows.push([name, differences(nodeReply, nativeReply)]);
    }
    rows.push(['notifications', differences(toolMethods(node.notifications), toolMethods(native.notifications))]);
    rows.push(['log event kinds', logKindDifferences(logKinds(spaces.node.runDir), logKinds(spaces.native.runDir))]);
    rows.push(...(await mcpPass()));

    const classified = rows.map(([name, diffs]) => {
      const cutover = diffs.filter(([path]) => isCutoverPath(path));
      const counted = diffs.filter(([path]) => !isCutoverPath(path));
      const real = counted.filter(([path]) => !isSeqPath(path));
      const verdict = diffs.length === 0 ? 'match' : counted.length === 0 ? 'cutover-expected' : real.length === 0 ? 'seq-only' : 'diff';
      return { name, diffs, cutover, counted, real, verdict };
    });

    console.log(`parity: reference HEAD ${refHead} at ${REF}; native ${NATIVE_BIN}`);
    console.log(`transcripts: ${join(SCRATCH, 'transcript-node.json')} ${join(SCRATCH, 'transcript-native.json')}`);
    const width = Math.max(...rows.map(([name]) => name.length));
    const verdictWidth = 'cutover-expected'.length;
    console.log(`${'scenario'.padEnd(width)} | ${'result'.padEnd(verdictWidth)} | first differing field (seq-only: only log seq numbers differ; cutover-expected: not counted)`);
    console.log(`${'-'.repeat(width)}-|-${'-'.repeat(verdictWidth)}-|----------------------`);
    for (const row of classified) {
      const first = row.real[0] ?? row.counted[0] ?? row.cutover[0];
      const detail = first ? `${first[0]} (${row.counted.length} counted, ${row.cutover.length} cutover-expected)` : '';
      console.log(`${row.name.padEnd(width)} | ${row.verdict.padEnd(verdictWidth)} | ${detail}`);
    }
    for (const row of classified) {
      const shownDiffs = row.diffs.filter(([path]) => !isSeqPath(path) && !mirroredInText(path, row.diffs));
      if (shownDiffs.length === 0) continue;
      console.log(`\n== ${row.name}`);
      for (const [path, left, right] of shownDiffs) {
        const label = isCutoverPath(path) ? ' [cutover-expected]' : '';
        console.log(`  ${path}${label}\n    node:   ${shown(left)}\n    native: ${shown(right)}`);
      }
    }
    const differing = classified.filter((row) => row.counted.length > 0).length;
    const cutoverOnly = classified.filter((row) => row.verdict === 'cutover-expected').length;
    const matching = classified.filter((row) => row.verdict === 'match').length;
    console.log(`\n${matching}/${rows.length} scenarios match, ${cutoverOnly} cutover-expected, ${differing} differ`);
    if (node.stderr.trim()) console.log(`\nnode stderr (tail): ${node.stderr.trim().split('\n').slice(-5).join(' | ')}`);
    if (native.stderr.trim()) console.log(`native stderr (tail): ${native.stderr.trim().split('\n').slice(-5).join(' | ')}`);
    process.exitCode = differing > 0 ? 1 : 0;
  } finally {
    http.closeAllConnections();
    http.close();
  }
}

main().catch((error) => {
  console.error(`parity: ${error.stack ?? error}`);
  process.exitCode = 2;
});
