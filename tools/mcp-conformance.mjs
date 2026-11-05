import { spawn } from 'node:child_process';

const PROTOCOL = '2025-06-18';
const SERVED_VERSIONS = ['2025-11-25', '2025-06-18'];
const CAPABILITIES = ['tools', 'prompts', 'resources', 'logging', 'completions'];
const LOG_LEVELS = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'];
const CODE_TOOLS = ['next_context', 'run_code', 'finish'];
const SKILL_URI = 'skill://gm/SKILL.md';
const HOUR_MS = 3600000;
const REQUEST_TIMEOUT_MS = 60000;
const RULES_RUN_DIR = `/tmp/gm-conformance-rules-${process.pid}-${Date.now()}`;
const INVALID_PARAMS = -32602;
const METHOD_NOT_FOUND = -32601;

const argv = process.argv.slice(2);
const stdioAt = argv.indexOf('--stdio');
const command = stdioAt >= 0 ? argv.slice(stdioAt + 1) : [];
if (command.length === 0) {
  console.error('usage: node tools/mcp-conformance.mjs --stdio <program> [args...]');
  process.exit(2);
}

let passed = 0;
let failed = 0;

function record(name, ok, detail = '') {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? 'ok   ' : 'FAIL '}${name}${!ok && detail ? ` -- ${detail}` : ''}`);
}

const nonEmpty = (v) => typeof v === 'string' && v.length > 0;
const sameList = (a, b) => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);
const cached = (r, ttl) => r && r.ttlMs === ttl && r.cacheScope === 'public';
const short = (v) => JSON.stringify(v)?.slice(0, 240);

class Client {
  constructor(extraArgs = []) {
    this.child = spawn(command[0], [...command.slice(1), ...extraArgs], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.child.stdout.setEncoding('utf8');
    this.buffer = '';
    this.inbox = [];
    this.waiters = [];
    this.nextId = 1;
    this.initResult = null;
    this.child.stdout.on('data', (chunk) => this.onData(chunk));
  }

  onData(chunk) {
    this.buffer += chunk;
    let at = this.buffer.indexOf('\n');
    while (at >= 0) {
      const line = this.buffer.slice(0, at).trim();
      this.buffer = this.buffer.slice(at + 1);
      if (line) this.inbox.push(JSON.parse(line));
      at = this.buffer.indexOf('\n');
    }
    this.wake();
  }

  wake() {
    this.waiters = this.waiters.filter((waiter) => {
      const found = this.inbox.find(waiter.match);
      if (!found) return true;
      clearTimeout(waiter.timer);
      waiter.resolve(found);
      return false;
    });
  }

  waitFor(match, what) {
    return new Promise((resolve, reject) => {
      const waiter = { match, resolve, timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error(`no ${what} within ${REQUEST_TIMEOUT_MS} ms`));
      }, REQUEST_TIMEOUT_MS);
      this.waiters.push(waiter);
      this.wake();
    });
  }

  send(message) {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async rpc(method, params = {}) {
    const id = this.nextId++;
    this.send({ jsonrpc: '2.0', id, method, params });
    return this.waitFor((m) => m.id === id, `answer to ${method}`);
  }

  async notify(method, params = {}) {
    this.send({ jsonrpc: '2.0', method, params });
  }

  async open() {
    const init = await this.rpc('initialize', {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: { name: 'gm-conformance', version: '1' },
    });
    this.initResult = init.result ?? null;
    await this.notify('notifications/initialized');
  }

  async close() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    const exited = new Promise((resolve) => this.child.once('exit', resolve));
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill('SIGTERM'), 5000);
    await exited;
    clearTimeout(timer);
  }
}

const SCENARIOS = [
  {
    name: 'server-initialize',
    run: async (c, ok) => {
      const r = c.initResult ?? {};
      ok('protocolVersion is a served version', SERVED_VERSIONS.includes(r.protocolVersion), short(r.protocolVersion));
      ok('serverInfo has a name and a version', nonEmpty(r.serverInfo?.name) && nonEmpty(r.serverInfo?.version), short(r.serverInfo));
      ok('declares tools, prompts, resources, logging and completions', CAPABILITIES.every((k) => k in (r.capabilities ?? {})), short(r.capabilities));
      ok('tools, prompts and resources declare listChanged', r.capabilities?.tools?.listChanged === true && r.capabilities?.prompts?.listChanged === true && r.capabilities?.resources?.listChanged === true);
      ok('resources declares no subscribe, since subscriptions/listen replaces resources/subscribe', r.capabilities?.resources?.subscribe === undefined, short(r.capabilities?.resources));
      ok('instructions are a non-empty string', nonEmpty(r.instructions));
    },
  },
  {
    name: 'server/discover',
    run: async (c, ok) => {
      const r = await c.rpc('server/discover');
      const d = r.result;
      ok('answers a result, not an error', d !== undefined, short(r.error));
      ok('resultType is complete', d?.resultType === 'complete', short(d?.resultType));
      ok('supportedVersions lists the served versions', sameList(d?.supportedVersions, SERVED_VERSIONS), short(d?.supportedVersions));
      ok('declares the served capabilities', CAPABILITIES.every((k) => k in (d?.capabilities ?? {})), short(d?.capabilities));
      ok('declares no resources.subscribe', d?.capabilities?.resources?.subscribe === undefined, short(d?.capabilities?.resources));
      ok('carries instructions', nonEmpty(d?.instructions));
      ok('carries ttlMs 3600000 and cacheScope public', d?.ttlMs === HOUR_MS && d?.cacheScope === 'public', `ttlMs=${d?.ttlMs} cacheScope=${d?.cacheScope}`);
      ok('serverInfo in _meta names gm', d?._meta?.['io.modelcontextprotocol/serverInfo']?.name === 'gm', short(d?._meta));
    },
  },
  {
    name: 'caching',
    run: async (c, ok) => {
      const tools = (await c.rpc('tools/list')).result;
      const prompts = (await c.rpc('prompts/list')).result;
      const resources = (await c.rpc('resources/list')).result;
      const templates = (await c.rpc('resources/templates/list')).result;
      const skill = (await c.rpc('resources/read', { uri: SKILL_URI })).result;
      const next = (await c.rpc('tools/call', { name: 'next_context', arguments: {} })).result;
      const run = next?._meta?.['com.anentrypoint.gmnew/run'];
      const log = (await c.rpc('resources/read', { uri: `run://${run}/log` })).result;
      ok('tools/list carries ttlMs 3600000 and cacheScope public', cached(tools, HOUR_MS), short({ ttlMs: tools?.ttlMs, cacheScope: tools?.cacheScope }));
      ok('prompts/list carries ttlMs 3600000 and cacheScope public', cached(prompts, HOUR_MS), short({ ttlMs: prompts?.ttlMs, cacheScope: prompts?.cacheScope }));
      ok('resources/list carries ttlMs 0 and cacheScope public', cached(resources, 0), short({ ttlMs: resources?.ttlMs, cacheScope: resources?.cacheScope }));
      ok('resources/templates/list carries ttlMs 3600000 and cacheScope public', cached(templates, HOUR_MS), short({ ttlMs: templates?.ttlMs, cacheScope: templates?.cacheScope }));
      ok('resources/read of a skill file carries ttlMs 3600000 and cacheScope public', cached(skill, HOUR_MS), short({ ttlMs: skill?.ttlMs, cacheScope: skill?.cacheScope }));
      ok('resources/read of a run log carries ttlMs 0 and cacheScope public', cached(log, 0), short({ run, ttlMs: log?.ttlMs, cacheScope: log?.cacheScope }));
    },
  },
  {
    name: 'tools/list',
    run: async (c, ok) => {
      const tools = (await c.rpc('tools/list')).result?.tools ?? [];
      const names = tools.map((t) => t.name);
      ok('serves next_context, run_code and finish', CODE_TOOLS.every((n) => names.includes(n)), names.join(','));
      for (const tool of tools.filter((t) => CODE_TOOLS.includes(t.name))) {
        ok(`${tool.name} has a title, an object inputSchema and an object outputSchema`, nonEmpty(tool.title) && tool.inputSchema?.type === 'object' && tool.outputSchema?.type === 'object', short({ title: tool.title, input: tool.inputSchema?.type, output: tool.outputSchema?.type }));
      }
      ok('next_context is read-only', tools.find((t) => t.name === 'next_context')?.annotations?.readOnlyHint === true);
      ok('finish is not destructive', tools.find((t) => t.name === 'finish')?.annotations?.destructiveHint === false);
    },
  },
  {
    name: 'tools/call next_context',
    run: async (c, ok) => {
      const r = (await c.rpc('tools/call', { name: 'next_context', arguments: {} })).result;
      ok('result has a text content item', r?.content?.[0]?.type === 'text', short(r?.content?.[0]?.type));
      ok('structuredContent carries a boolean ok', typeof r?.structuredContent?.ok === 'boolean', short(r?.structuredContent));
      let same = false;
      try {
        same = JSON.stringify(JSON.parse(r.content[0].text)) === JSON.stringify(r.structuredContent);
      } catch {
        same = false;
      }
      ok('text content is the same JSON as structuredContent', same);
    },
  },
  {
    name: 'tools/call run_code',
    run: async (c, ok) => {
      const r = (await c.rpc('tools/call', { name: 'run_code', arguments: { body: 'return 2' } })).result;
      ok('result has a text content item', r?.content?.[0]?.type === 'text', short(r?.content?.[0]?.type));
      ok('structuredContent carries a boolean ok', typeof r?.structuredContent?.ok === 'boolean', short(r?.structuredContent));
      const code = async (body) => {
        const reply = (await c.rpc('tools/call', { name: 'run_code', arguments: { body } })).result;
        const raw = reply?.structuredContent?.output ?? JSON.parse(reply?.content?.[0]?.text ?? '{}').output;
        return typeof raw === 'string' ? JSON.parse(raw) : null;
      };
      const verbs = await code("const all = gm.verbs(); const one = gm.verbs({ name: 'read_file' }); const names = gm.verbs({ names: true }); return { count: all.length, full: all.every((v) => typeof v.description === 'string' && v.inputSchema !== null && typeof v.inputSchema === 'object'), one, names };");
      ok('gm.verbs() still returns every schema', verbs?.full === true && verbs?.count > 1, short(verbs?.count));
      ok('gm.verbs({ name }) returns one schema', verbs?.one?.name === 'read_file' && typeof verbs.one.inputSchema === 'object', short(verbs?.one));
      ok('gm.verbs({ names: true }) returns just the names', Array.isArray(verbs?.names) && verbs.names.length === verbs.count && verbs.names.every((name) => typeof name === 'string'), short(verbs?.names?.length));
      const unknown = await code("return await gm.try(() => gm.verbs({ name: 'no_such_verb' }));");
      ok('an unknown verb name is a clear error', unknown?.ok === false && String(unknown.error).includes('no_such_verb'), short(unknown));
    },
  },
  {
    name: 'tools/call finish without a witness',
    run: async (c, ok) => {
      const r = await c.rpc('tools/call', { name: 'finish', arguments: {} });
      ok('a missing required witness is -32602 or an isError result', r.error?.code === INVALID_PARAMS || r.result?.isError === true, short(r));
    },
  },
  {
    name: 'tools/call unknown tool',
    run: async (c, ok) => {
      const r = await c.rpc('tools/call', { name: 'no_such_tool', arguments: {} });
      ok('an unknown tool is -32602', r.error?.code === INVALID_PARAMS, short(r));
    },
  },
  {
    name: 'tools/call without a name',
    run: async (c, ok) => {
      const r = await c.rpc('tools/call', {});
      ok('a tools/call without a name is -32602', r.error?.code === INVALID_PARAMS, short(r));
    },
  },
  {
    name: 'prompts/list',
    run: async (c, ok) => {
      const prompts = (await c.rpc('prompts/list')).result?.prompts ?? [];
      const gm = prompts.find((p) => p.name === 'gm');
      ok('serves the gm prompt', gm !== undefined, short(prompts.map((p) => p.name)));
      ok('the gm prompt has a description', nonEmpty(gm?.description));
      ok('the gm prompt takes an optional task argument', gm?.arguments?.some((a) => a.name === 'task' && a.required !== true) === true, short(gm?.arguments));
    },
  },
  {
    name: 'prompts/get gm',
    run: async (c, ok) => {
      const r = (await c.rpc('prompts/get', { name: 'gm', arguments: { task: 'conformance' } })).result;
      const message = r?.messages?.[0];
      ok('returns a user message', message?.role === 'user', short(message?.role));
      ok('the message content is text', message?.content?.type === 'text' && nonEmpty(message?.content?.text), short(message?.content?.type));
    },
  },
  {
    name: 'prompts/get unknown prompt',
    run: async (c, ok) => {
      const r = await c.rpc('prompts/get', { name: 'no_such_prompt' });
      ok('an unknown prompt is -32602', r.error?.code === INVALID_PARAMS, short(r));
    },
  },
  {
    name: 'resources/list',
    run: async (c, ok) => {
      const resources = (await c.rpc('resources/list')).result?.resources ?? [];
      ok('lists the gm skill', resources.some((r) => r.uri === SKILL_URI), short(resources.map((r) => r.uri)));
      ok('every resource has a uri and a name', resources.every((r) => nonEmpty(r.uri) && nonEmpty(r.name)));
    },
  },
  {
    name: 'resources/templates/list',
    run: async (c, ok) => {
      const templates = (await c.rpc('resources/templates/list')).result?.resourceTemplates ?? [];
      ok('lists at least one resource template', templates.length > 0, short(templates));
      ok('every template has a uriTemplate and a name', templates.every((t) => nonEmpty(t.uriTemplate) && nonEmpty(t.name)));
    },
  },
  {
    name: 'resources/read skill',
    run: async (c, ok) => {
      const r = (await c.rpc('resources/read', { uri: SKILL_URI })).result;
      const item = r?.contents?.[0];
      ok('contents is the requested skill uri', item?.uri === SKILL_URI, short(item?.uri));
      ok('the skill text is non-empty', nonEmpty(item?.text));
    },
  },
  {
    name: 'resources/read missing',
    run: async (c, ok) => {
      const r = await c.rpc('resources/read', { uri: 'skill://gm/NOPE.md' });
      ok('a missing resource is -32602 with data.uri and no contents', r.error?.code === INVALID_PARAMS && r.error?.data?.uri === 'skill://gm/NOPE.md' && r.result === undefined, short(r));
    },
  },
  {
    name: 'subscriptions/listen',
    run: async (c, ok) => {
      const listenId = c.nextId++;
      c.send({ jsonrpc: '2.0', id: listenId, method: 'subscriptions/listen', params: { notifications: { resourceSubscriptions: [SKILL_URI] } } });
      const ack = await c.waitFor((m) => m.method === 'notifications/subscriptions/acknowledged', 'subscriptions/acknowledged notification');
      ok('the acknowledgement names the skill subscription', ack.params?.notifications?.resourceSubscriptions?.includes(SKILL_URI) === true, short(ack.params));
      ok('the acknowledgement carries the listen request id as subscriptionId', ack.params?._meta?.['io.modelcontextprotocol/subscriptionId'] === listenId, short(ack.params?._meta));
      c.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: listenId } });
      const done = await c.waitFor((m) => m.id === listenId, 'subscriptions/listen result');
      ok('cancelling the stream answers subscriptions/listen with a complete result', done.result?.resultType === 'complete', short(done));
    },
  },
  {
    name: 'subscriptions/listen missing',
    run: async (c, ok) => {
      const r = await c.rpc('subscriptions/listen', { notifications: { resourceSubscriptions: ['skill://gm/NOPE.md'] } });
      ok('subscriptions/listen of a missing resource is -32602', r.error?.code === INVALID_PARAMS, short(r));
    },
  },
  {
    name: 'resources/subscribe replaced',
    run: async (c, ok) => {
      const sub = await c.rpc('resources/subscribe', { uri: SKILL_URI });
      const unsub = await c.rpc('resources/unsubscribe', { uri: SKILL_URI });
      ok('resources/subscribe answers method not found, since subscriptions/listen replaces it', sub.error?.code === METHOD_NOT_FOUND, short(sub));
      ok('resources/unsubscribe answers method not found, since subscriptions/listen replaces it', unsub.error?.code === METHOD_NOT_FOUND, short(unsub));
    },
  },
  {
    name: 'logging/setLevel',
    run: async (c, ok) => {
      const results = [];
      for (const level of LOG_LEVELS) results.push((await c.rpc('logging/setLevel', { level })).result);
      ok('accepts every RFC 5424 level', results.every((r) => r !== undefined && Object.keys(r).length === 0), short(results));
    },
  },
  {
    name: 'ping',
    run: async (c, ok) => {
      const r = await c.rpc('ping');
      ok('ping answers an empty result', r.result !== undefined && Object.keys(r.result).length === 0, short(r));
    },
  },
  {
    name: 'method not found',
    run: async (c, ok) => {
      const r = await c.rpc('no/such/method');
      ok('an unknown method is -32601', r.error?.code === METHOD_NOT_FOUND, short(r));
    },
  },
  {
    name: 'rules notice after successor',
    args: ['--run-dir', RULES_RUN_DIR],
    run: async (c, ok) => {
      const call = async (name, args) => (await c.rpc('tools/call', { name, arguments: args })).result?.structuredContent ?? {};
      const early = await call('run_code', { body: 'return 1' });
      ok('run_code before the first next_context carries rule 2', String(early.rulesNotice ?? '').includes('rule 2'), short(early.rulesNotice));
      const first = await call('next_context', {});
      await call('run_code', { body: 'return 2' });
      await call('finish', { witness: 'successor rules notice check' });
      const successor = await call('next_context', {});
      ok('next_context after finish opens a fresh run', successor.run !== first.run && first.run !== undefined, short({ first: first.run, successor: successor.run }));
      const after = await call('run_code', { body: 'return 3' });
      ok('the successor run does not inherit the rule 2 notice', after.rulesNotice === undefined, short(after.rulesNotice));
    },
  },
];

for (const scenario of SCENARIOS) {
  console.log(`=== ${scenario.name}`);
  const client = new Client(scenario.args ?? []);
  try {
    await client.open();
    await scenario.run(client, record);
  } catch (error) {
    record(`${scenario.name} runs to completion`, false, String(error?.message ?? error));
  } finally {
    await client.close();
  }
}

console.log(`conformance: ${passed} passed, ${failed} failed of ${passed + failed} checks in ${SCENARIOS.length} scenarios`);
process.exit(failed === 0 ? 0 : 1);
