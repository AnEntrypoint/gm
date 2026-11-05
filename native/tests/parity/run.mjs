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
const NATIVE_BIN = resolve(argValue('--bin', join(REPO, 'build', 'integ', 'native', 'components', 'host', 'gm')));
const REF = resolve(argValue('--ref', '/tmp/parity-ref'));
const SCRATCH = resolve(argValue('--scratch', `/tmp/parity-scratch-${process.pid}`));
const REPLY_TIMEOUT_MS = Number(argValue('--reply-timeout-ms', '30000'));
const VALUE_WIDTH = 160;
const FIXED_DATE = '2026-01-01T00:00:00Z';
const STOPPED_PID_FILE = 'stopped-body.pid';
const STOPPED_SLEEP_S = 4711;
const STOPPED_FETCH_KIND = 'code-call:stopped-fetch';
const SUBSCRIBE_ERROR_KIND = 'error:resources/subscribe';
const DOTENV_KEY = 'TOGETHERAI';
const DOTENV_LOCAL_KEY = 'LOCAL_ALIAS';
const DOTENV_DUMMY = 'dummy_not_a_real_key_12345';
const NATIVE_AHEAD_KINDS = [STOPPED_FETCH_KIND, SUBSCRIBE_ERROR_KIND];

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
    ['resources/read missing', { method: 'resources/read', params: { uri: 'skill://gm/NOPE.md' } }],
    ['tools/call unknown tool', call('no_such_tool', {})],
    ['prompts/get unknown', { method: 'prompts/get', params: { name: 'no-such-prompt' } }],
    ['skills/get unknown', { method: 'skills/get', params: { uri: 'skill://gm/NOPE.md' } }],
    ['resources/subscribe', { method: 'resources/subscribe', params: { uri: 'skill://gm/SKILL.md' } }],
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
    ['run_code background shell', call('run_code', { body: `return await gm.run_shell({ command: 'echo $$ > ${STOPPED_PID_FILE}; exec sleep ${STOPPED_SLEEP_S}', timeoutMs: 60000 });`, timeoutMs: 300 })],
    ['run_code esm static import', call('run_code', { body: "import { join } from 'node:path';\nreturn join('a', 'b');", format: 'esm' })],
    ['run_code esm dynamic import', call('run_code', { body: "const os = await import('node:os');\nreturn typeof os.platform;", format: 'esm' })],
    ['run_code esm require', call('run_code', { body: "return require('node:path').join('a', 'b');", format: 'esm' })],
    ['run_code cjs require', call('run_code', { body: "return require('node:path').join('a', 'b');", format: 'cjs' })],
    ['run_code default require', call('run_code', { body: "return require('node:path').join('a', 'b');" })],
    ['run_code cjs static import', call('run_code', { body: "import { join } from 'node:path';\nreturn join('a', 'b');", format: 'cjs' })],
    ['run_code cjs non-literal require', call('run_code', { body: "const spec = 'node:path';\nreturn require(spec);", format: 'cjs' })],
    ['run_code write project module', code("return await gm.write_file({ path: 'lib/add.mjs', content: 'export const add = (a, b) => a + b;\\n' });")],
    ['run_code esm project import', call('run_code', { body: "import { add } from './lib/add.mjs';\nreturn add(2, 3);", format: 'esm' })],
    ['run_code bad format', call('run_code', { body: 'return 1;', format: 'mjs' })],
    ['run_code write package type', code("return await gm.write_file({ path: 'package.json', content: JSON.stringify({ type: 'module' }) + '\\n' });")],
    ['run_code default format follows package type', call('run_code', { body: "import { join } from 'node:path';\nreturn join('a', 'b');" })],
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
    [/\bbody-\d+(-\d+)?\b/g, 'body-<N>'],
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
  return /(\.actionSeq|gm\/seq)$/.test(path);
}

const SUBSCRIPTIONS_REASON = 'native removed resources/subscribe: it answers -32601, and subscriptions/listen is the surface (2026-07-28 subscriptions page); Node still serves resources/subscribe';
const CAPABILITY_REASON = 'native no longer advertises resources.subscribe, since subscriptions/listen replaces it (2026-07-28 subscriptions page); Node still advertises it';
const namesAfter = (name) => {
  const names = scenarios({ head: '', url: '' }).map(([row]) => row);
  return new Set(names.slice(names.indexOf(name) + 1));
};
const CASCADE_ROWS = namesAfter('resources/subscribe');
const REFUSAL_ROWS = namesAfter('run_code cjs static import');
const SEQ_PATH = /(^|\.)(seq|actionSeq|body|logged\[\d+\]\.seq)$|\.output\.(output\.)?(seq|body)$|\/seq$/;
const BODY_RESULT_PATH = /^\.result\.(isError|(content\[0\]\.text|structuredContent)\.(ok|output|truncated|error))$/;
const nativeFailed = (left, right) => right === undefined || typeof right === 'string' || (typeof right === 'boolean' && right !== left);
const BUILTIN_IMPORT_ROWS = new Set(['run_code esm static import', 'run_code esm dynamic import', 'run_code esm require', 'run_code cjs require', 'run_code default require', 'run_code default format follows package type']);
const BUILTIN_REASON = 'documented gap: native runs a body with gm only and passes it no require, and its module loader reads files from disk, so require() and import of node: builtins fail; Node passes require to every body and loads node: builtins';
const STATIC_REFUSAL_REASON = 'documented gap: native does not refuse a static import in a CommonJS body; the body fails in the JS engine with a load error and logs no refusal';
const REQUIRE_REFUSAL_REASON = 'documented gap: native does not refuse a non-literal require(); the body reaches the missing require() and fails at run time, and logs no refusal';
const LOAD_EVENT_REASON = 'documented gap: native does not list a project file that a body loads, and logs no code-load event for it; Node does both';
const BOOT_SURFACE_REASON = 'native-ahead: the handshake no longer waits for MCP, so the boot tools event is written before the MCP verbs join; Node has the verbs at boot and writes the server, gitignore and skipped events before its tools event';
const JOIN_SEQ_REASON = 'native-ahead: native writes the MCP join events (mcp-server connected, gitignore added, mcp-tool-skipped) after its first run_code call, so that call is three sequence numbers lower than Node, which writes them at boot';
const JOIN_GENERATION_REASON = 'native-ahead: native logs one generation event after the first MCP run, when the .gitignore the join adds changes the project fingerprint, so every later sequence number is one higher than Node';
const MCP_ROWS = mcpScenarios().map(([name]) => `mcp ${name}`);
const MCP_AFTER_BROWSERS = new Set(MCP_ROWS.slice(MCP_ROWS.indexOf('mcp mcp browsers') + 1));
const REFUSAL_SEQ_REASON ='documented gap: native logs no refusal event (two here) and no code-load event (one here), so each later sequence number is one or two lower than Node';
const NATIVE_AHEAD = [
  { path: /^\.result\.(ttlMs|cacheScope)$/, reason: 'native adds ttlMs and cacheScope to complete list and read results (MCP 2026-07-28 caching)' },
  { path: /^\.result\.tools\[\d+\]\.(title|annotations)(\.|$)/, reason: 'native adds a title and tool annotations (MCP 2026-07-28 tools)' },
  { path: /^\.result\.(content\[0\]\.text|structuredContent)\.events\[\d+\]\.sha$/, reason: 'the tools event sha covers the tool list, which native now titles and annotates' },
  { row: 'resources/read missing', path: /^\.error\.code$/, when: (left, right) => left === -32002 && right === -32602, reason: 'native answers a missing resource with -32602 and data.uri, never an empty contents (AGENTS.md: -32002 is accepted only by clients); Node answers -32002 as the 2025-11-25 spec page does, and the error data matches' },
  { row: 'log event kinds', path: /^\.count\.code-call:stopped-fetch$/, when: (left, right) => left === undefined && right === 1, reason: 'stopBackground kills a fetch that a background body started: native owns its curl to the body (proc::kill_owned) and logs the fetch code-call after the stopBackground job-killed; Node fetch runs in-process, stopBackground does not reach it, so it logs no code-call before end' },
  { row: 'log event kinds', path: /^\.count\.error:resources\/subscribe$/, when: (left, right) => left === undefined && right === 1, reason: SUBSCRIPTIONS_REASON },
  { row: 'resources/subscribe', path: /^\.result$/, when: (left, right) => right === undefined, reason: SUBSCRIPTIONS_REASON },
  { row: 'resources/subscribe', path: /^\.error$/, when: (left, right) => left === undefined && right?.code === -32601, reason: SUBSCRIPTIONS_REASON },
  { row: 'log event kinds', path: /^\.firstDivergence\[\d+\]$/, when: (left, right) => [left, right].some((window) => NATIVE_AHEAD_KINDS.some((kind) => window.includes(kind))), reason: 'the event order follows from the stopped fetch code-call and the resources/subscribe error above' },
  { row: /^(initialize|mcp initialize)$/, path: /^\.result\.instructions$/, reason: 'native names subscriptions/listen in the resources pointer of its instructions; Node still names resources/subscribe' },
  { row: 'job_status', path: /^\.result\.(content\[0\]\.text|structuredContent)\.output\.timeoutMs$/, when: (left, right) => left === 60000 && right === 300000, reason: 'native job_start default is 300000; Node 60000 kept until the owner chooses' },
  { row: CASCADE_ROWS, path: SEQ_PATH, when: (left, right) => Number.isInteger(left) && right === left + 1, reason: 'native logs one more event than Node, the resources/subscribe error (native-ahead above), so every later sequence number is one higher' },
  { row: /^(initialize|mcp initialize)$/, path: /^\.result\.capabilities\.resources\.subscribe$/, when: (left, right) => right === undefined, reason: CAPABILITY_REASON },
  { row: BUILTIN_IMPORT_ROWS, path: BODY_RESULT_PATH, when: nativeFailed, reason: BUILTIN_REASON, gap: true },
  { row: 'run_code cjs static import', path: /^\.result\.(content\[0\]\.text|structuredContent)\.error$/, when: (left, right) => [left, right].every((text) => typeof text === 'string' && text.startsWith('refused: a CommonJS body cannot use a static import;')), reason: STATIC_REFUSAL_REASON, gap: true },
  { row: 'run_code cjs static import', path: /^\.result\.(content\[0\]\.text|structuredContent)\.loads$/, when: (left, right) => left === undefined && Array.isArray(right), reason: STATIC_REFUSAL_REASON, gap: true },
  { row: /^(tools\/list|mcp tools\/list)$/, path: /^\.result\.tools\[\d+\]\.description$/, when: (left, right) => [left, right].every((text) => typeof text === 'string' && text.startsWith('Run a JavaScript body in the project.')), reason: 'documented gap: native\'s run_code description omits require() and calls a CommonJS body a script, since native has no require(); Node\'s description names both', gap: true },
  { row: new Set(['next_context', 'next_context after finish']), path: /^\.result\.(content\[0\]\.text|structuredContent)\.prefixSha$/, when: (left, right) => typeof left === 'string' && typeof right === 'string', reason: 'documented gap: the served prefix hashes the run_code description, which native words differently (see the tools/list row)', gap: true },
  { row: /^(tools\/list|mcp tools\/list)$/, path: /^\.result\.tools\[0\]\.description$/, when: (left, right) => left.includes('at most 300000') && right.includes('at most 100000'), reason: 'native-ahead: next_context waitMs holds at most 100 s and a hold with nothing pending returns progress without a step (native f9cc7f7); Node still holds at most 300 s' },
  { row: 'mcp next_context', path: /^\.result\._meta\.com\.anentrypoint\.gmnew\/seq$/, when: (left, right) => Number.isInteger(left) && Number.isInteger(right) && left - right >= 1 && left - right <= 3, reason: JOIN_SEQ_REASON },
  { row: 'mcp next_context', path: /^\.result\.(content\[0\]\.text|structuredContent)\.(records|fullEvents)$/, when: (left, right) => Number.isInteger(left) && Number.isInteger(right) && left > right, reason: BOOT_SURFACE_REASON },
  { row: 'mcp next_context', path: /^\.result\.(content\[0\]\.text|structuredContent)\.events\[[3-7]\](\.[A-Za-z]+)?$/, reason: BOOT_SURFACE_REASON },
  { row: 'mcp next_context', path: /^\.result\.(content\[0\]\.text|structuredContent)\.query$/, when: (left, right) => typeof left === 'string' && typeof right === 'string', reason: BOOT_SURFACE_REASON },
  { row: 'mcp log event kinds', path: /^\.firstDivergence\[4\]$/, when: (left, right) => left[0] === 'mcp-server' && right[0] === 'tools', reason: BOOT_SURFACE_REASON },
  { row: 'mcp mcp echo', path: SEQ_PATH, when: (left, right) => Number.isInteger(left) && left - right === 3, reason: JOIN_SEQ_REASON },
  { row: MCP_AFTER_BROWSERS, path: SEQ_PATH, when: (left, right) => Number.isInteger(left) && right === left + 1, reason: JOIN_GENERATION_REASON },
  { row: 'mcp notifications', path: /^\[0\]$/, when: (left, right) => left === 'notifications/resources/list_changed' && right === 'notifications/tools/list_changed', reason: 'native announces its tool list (notifications/tools/list_changed) first when its MCP servers are ready; Node announces resources first and no tool list' },
  { row: 'mcp notifications', path: /^\[1\]$/, when: (left, right) => left === undefined && right === 'notifications/resources/list_changed', reason: 'native announces resources (notifications/resources/list_changed) after the tool list on ready; Node sends one resources list_changed' },
  { row: 'mcp next_context', path: /^\.result\.(content\[0\]\.text|structuredContent)\.prefixSha$/, when: (left, right) => typeof left === 'string' && typeof right === 'string', reason: 'documented gap: native serves its tool table before the MCP servers join, so the boot tools event and the prefix hash omit the MCP verbs; the body table waits for them', gap: true },
  { row: 'mcp next_context', path: /^\.result\.(content\[0\]\.text|structuredContent)\.total$/, when: (left, right) => Number.isInteger(left) && Number.isInteger(right) && left > right, reason: 'documented gap: the MCP server events are recorded after the boot tools event, which native writes before the MCP verbs join, so at this call native holds fewer events than Node', gap: true },
  { row: 'mcp log event kinds', path: /^\.count\.generation$/, when: (left, right) => left === 1 && right === 2, reason: 'documented gap: native writes its boot tools event before the MCP verbs join, so the first run_code body sees a changed tool table and bumps the generation once more; Node has the MCP verbs at boot', gap: true },
  { row: 'run_code cjs non-literal require', path: /^\.result\.(content\[0\]\.text|structuredContent)\.(error|loads)$/, when: (left, right) => left === undefined || nativeFailed(left, right), reason: REQUIRE_REFUSAL_REASON, gap: true },
  { row: 'run_code esm project import', path: /^\.result\.(content\[0\]\.text|structuredContent)\.loads\[0\]$/, when: (left, right) => right === undefined, reason: LOAD_EVENT_REASON, gap: true },
  { row: 'log event kinds', path: /^\.count\.(refusal|code-load)$/, when: (left, right) => right === undefined, reason: LOAD_EVENT_REASON, gap: true },
  { row: REFUSAL_ROWS, path: SEQ_PATH, when: (left, right) => Number.isInteger(left) && (left - right === 1 || left - right === 2), reason: REFUSAL_SEQ_REASON, gap: true },
];

function nativeAheadOf(row, path, left, right) {
  const rowMatches = (entry) => !entry.row || (entry.row instanceof Set ? entry.row.has(row) : entry.row instanceof RegExp ? entry.row.test(row) : entry.row === row);
  return NATIVE_AHEAD.find((entry) => rowMatches(entry) && entry.path.test(path) && (!entry.when || entry.when(left, right)));
}

function mirroredInText(path, diffs) {
  if (!path.startsWith('.result.structuredContent')) return false;
  const twin = path.replace('.result.structuredContent', '.result.content[0].text');
  return diffs.some(([other]) => other === twin);
}

function logKinds(runDir) {
  const file = join(runDir, 'log.jsonl');
  if (!existsSync(file)) return [`no log at ${file}`];
  let stopped = false;
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    try {
      const event = JSON.parse(line);
      if (event.kind === 'job-killed' && event.reason === 'stopBackground') stopped = true;
      if (event.kind === 'code-call' && stopped && event.tool === 'fetch' && /\/hang$/.test(event.args?.url ?? '')) return STOPPED_FETCH_KIND;
      if (event.kind === 'error' && event.method === 'resources/subscribe') return SUBSCRIBE_ERROR_KIND;
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

function processState(pid) {
  try {
    return execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

async function stoppedShellRows(spaces) {
  const rows = [];
  for (const side of ['node', 'native']) {
    const name = `stopped body shell ${side}`;
    const file = join(spaces[side].workspace, STOPPED_PID_FILE);
    if (!existsSync(file)) {
      rows.push([name, [['.pidFile', 'written by the shell', 'missing']]]);
      continue;
    }
    const pid = Number(readFileSync(file, 'utf8').trim());
    const deadline = Date.now() + 3000;
    let state = processState(pid);
    while (state !== '' && !state.startsWith('Z') && Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 100));
      state = processState(pid);
    }
    const alive = state !== '' && !state.startsWith('Z');
    if (alive) process.kill(pid, 'SIGKILL');
    rows.push([name, alive ? [['.sleep', `pid ${pid} still running after finish`, 'stopped']] : []]);
  }
  return rows;
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

async function dotenvPass() {
  const base = join(SCRATCH, 'dotenv');
  const { spaces } = makeWorkspaces(base);
  const config = join(base, 'no-default-mcp.json');
  const task = join(base, 'task.md');
  for (const side of ['node', 'native']) {
    const workspace = spaces[side].workspace;
    writeFileSync(join(workspace, '.env'), `${DOTENV_KEY}=${DOTENV_DUMMY}\n`);
    writeFileSync(join(workspace, '.env.local'), `${DOTENV_LOCAL_KEY}=${DOTENV_DUMMY}\n`);
    execFileSync('git', ['-C', workspace, 'add', '-f', '.env', '.env.local']);
  }
  const call = (name, args) => ({ method: 'tools/call', params: { name, arguments: args } });
  const code = (body) => call('run_code', { body });
  const script = [
    ['initialize', { method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dotenv', version: '1' } } }],
    ['initialized', { method: 'notifications/initialized', notify: true }],
    ['next_context', call('next_context', {})],
    ['grep .env', code(`return await gm.grep({ pattern: '${DOTENV_KEY}' });`)],
    ['grep .env.local', code(`return await gm.grep({ pattern: '${DOTENV_LOCAL_KEY}' });`)],
    ['search .env', code(`return await gm.search({ query: '${DOTENV_KEY.toLowerCase()}', k: 5 });`)],
  ];
  const node = new Peer(process.execPath, [join(REF, 'src', 'mcp.mjs'), '--workspace', spaces.node.workspace, '--run-dir', spaces.node.runDir, '--task', task, '--mcp-config', config], REF);
  const nodeReplies = await drive(node, script);
  await node.stop();
  const native = new Peer(NATIVE_BIN, ['worker', '--workspace', spaces.native.workspace, '--run-dir', spaces.native.runDir, '--task', task, '--skills', join(REF, 'skills'), '--leaves', join(REPO, 'native', 'leaves'), '--mcp-config', config], REPO);
  const nativeReplies = await drive(native, script);
  await native.stop();
  const rows = [];
  for (const [side, replies] of [['node', nodeReplies], ['native', nativeReplies]]) {
    for (const [name, reply] of replies) {
      if (!name.startsWith('grep .') && !name.startsWith('search .')) continue;
      const text = reply?.result?.content?.[0]?.text ?? '';
      let output = text;
      try { output = JSON.parse(text).output ?? text; } catch {}
      const masked = typeof output === 'string' && output.includes('<redacted>') && !output.includes(DOTENV_DUMMY);
      rows.push([`dotenv ${name} ${side}`, masked ? [] : [['.mask', 'masked', String(output).slice(0, VALUE_WIDTH)]]]);
      const row = String(output).split('\n').find((line) => line.includes('<redacted>'));
      console.log(`dotenv ${name} ${side}: ${row ?? String(output).slice(0, VALUE_WIDTH)}`);
    }
  }
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
    rows.push(...(await dotenvPass()));
    rows.push(...(await stoppedShellRows(spaces)));

    const classified = rows.map(([name, diffs]) => {
      const cutover = diffs.filter(([path]) => isCutoverPath(path));
      const counted = diffs.filter(([path]) => !isCutoverPath(path));
      const ahead = counted.filter(([path, left, right]) => nativeAheadOf(name, path, left, right));
      const real = counted.filter(([path, left, right]) => !isSeqPath(path) && !nativeAheadOf(name, path, left, right));
      const gapped = ahead.some(([path, left, right]) => nativeAheadOf(name, path, left, right).gap);
      const verdict = diffs.length === 0 ? 'match' : counted.length === 0 ? 'cutover-expected' : real.length === 0 ? (ahead.length === 0 ? 'seq-only' : gapped ? 'documented-gap' : 'native-ahead') : 'diff';
      return { name, diffs, cutover, counted, ahead, real, verdict };
    });

    console.log(`parity: reference HEAD ${refHead} at ${REF}; native ${NATIVE_BIN}`);
    console.log(`transcripts: ${join(SCRATCH, 'transcript-node.json')} ${join(SCRATCH, 'transcript-native.json')}`);
    const width = Math.max(...rows.map(([name]) => name.length));
    const verdictWidth = 'cutover-expected'.length;
    console.log(`${'scenario'.padEnd(width)} | ${'result'.padEnd(verdictWidth)} | first differing field (seq-only: only log seq numbers differ; cutover-expected: not counted; native-ahead: expected, listed below)`);
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
        const expected = nativeAheadOf(row.name, path, left, right);
        const label = isCutoverPath(path) ? ' [cutover-expected]' : expected ? (expected.gap ? ' [documented-gap]' : ' [native-ahead]') : '';
        console.log(`  ${path}${label}\n    node:   ${shown(left)}\n    native: ${shown(right)}`);
      }
    }
    const seenAhead = new Map();
    for (const row of classified) for (const [path, left, right] of row.ahead) {
      const entry = nativeAheadOf(row.name, path, left, right);
      seenAhead.set(entry.reason, entry);
    }
    for (const entry of seenAhead.values()) console.log(`${entry.gap ? 'documented gap' : 'native-ahead'}: ${entry.path.source} -- ${entry.reason}`);
    const differing = classified.filter((row) => row.verdict === 'diff' || row.verdict === 'seq-only').length;
    const cutoverOnly = classified.filter((row) => row.verdict === 'cutover-expected').length;
    const aheadRows = classified.filter((row) => row.verdict === 'native-ahead').length;
    const gapRows = classified.filter((row) => row.verdict === 'documented-gap').length;
    const matching = classified.filter((row) => row.verdict === 'match').length;
    console.log(`\n${matching}/${rows.length} scenarios match, ${cutoverOnly} cutover-expected, ${aheadRows} native-ahead, ${gapRows} documented-gap, ${differing} differ`);
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
