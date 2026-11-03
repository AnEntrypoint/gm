import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { killGroupNow } from './exec.mjs';

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18'];
const CLIENT_INFO = { name: 'gm-new', version: '0.1.0' };
const STARTUP_MS = 30000;
const CALL_MS = 60000;
const STDERR_CHARS = 2000;
const DESCRIPTION_CHARS = 300;
const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const DEPTH_VARIABLE = 'GMNEW_MCP_DEPTH';
const MAX_DEPTH = 2;
const BATCH_LAUNCHERS = new Set(['npx', 'npm']);
const IGNORE_ABSOLUTE = /^(?:[\\/]|[A-Za-z]:)/;

const identOf = (text) => text.replace(/[^A-Za-z0-9_]/g, '_');

function launchOf(spec) {
  if (process.platform !== 'win32' || !BATCH_LAUNCHERS.has(spec.command)) return { command: spec.command, args: spec.args };
  return { command: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', spec.command, ...spec.args] };
}

export function verbNameOf(server, tool) {
  const name = `${identOf(server)}_${identOf(tool)}`;
  return /^[0-9]/.test(name) ? `mcp_${name}` : name;
}

export function readServerConfig(files, workspace) {
  const specs = new Map();
  const problems = [];
  for (const { file, required = false } of files) {
    for (const [name, server] of readLayer(file, workspace, required, problems)) specs.set(name, server);
  }
  return { servers: [...specs.values()].filter((server) => server !== null), problems };
}

export function disabledServers(file) {
  const names = Object.keys(JSON.parse(readFileSync(file, 'utf8')).mcpServers ?? {});
  return { mcpServers: Object.fromEntries(names.map((name) => [name, { disabled: true }])) };
}

function readLayer(file, workspace, required, problems) {
  const layer = new Map();
  if (!existsSync(file)) {
    if (required) problems.push(`${file} does not exist`);
    return layer;
  }
  let document;
  try {
    document = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    problems.push(`${file} is not valid JSON: ${err.message}`);
    return layer;
  }
  for (const [name, spec] of Object.entries(document?.mcpServers ?? {})) layer.set(name, serverOf(name, spec, workspace, problems));
  return layer;
}

function serverOf(name, spec, workspace, problems) {
  if (spec?.disabled === true) return null;
  const fail = (text) => {
    problems.push(`server ${name}: ${text}`);
    return null;
  };
  if (name === '') return fail('the name must not be empty');
  if (spec?.type !== undefined && spec.type !== 'stdio') return fail(`type ${spec.type} is not supported, only stdio servers run`);
  if (typeof spec?.command !== 'string' || spec.command === '') return fail('command must be a non-empty string');
  if (spec.cwd !== undefined && typeof spec.cwd !== 'string') return fail('cwd must be a string');
  const args = spec.args ?? [];
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) return fail('args must be an array of strings');
  const env = spec.env ?? {};
  if (typeof env !== 'object' || Array.isArray(env) || Object.values(env).some((value) => typeof value !== 'string')) return fail('env must be an object of strings');
  const ignoreFault = ignoreProblem(spec.ignore ?? []);
  if (ignoreFault !== null) return fail(ignoreFault);
  const timeoutMs = spec.timeoutMs ?? CALL_MS;
  const startupMs = spec.startupTimeoutMs ?? STARTUP_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || !Number.isInteger(startupMs) || startupMs < 1) return fail('timeoutMs and startupTimeoutMs must be positive integers');
  const deny = spec.deny ?? [];
  if (!Array.isArray(deny) || deny.some((tool) => typeof tool !== 'string' || tool === '')) return fail('deny must be an array of non-empty tool names');
  const missing = [];
  const expand = (text) => text.replace(VARIABLE, (match, variable) => {
    if (process.env[variable] === undefined) {
      missing.push(variable);
      return match;
    }
    return process.env[variable];
  });
  const server = {
    name,
    command: expand(spec.command),
    args: args.map(expand),
    env: Object.fromEntries(Object.entries(env).map(([key, value]) => [key, expand(value)])),
    cwd: spec.cwd === undefined ? workspace : resolve(workspace, expand(spec.cwd)),
    timeoutMs,
    startupMs,
    deny,
    ignore: (spec.ignore ?? []).map((line) => line.trim()),
    workspace,
  };
  if (missing.length > 0) return fail(`environment variable ${[...new Set(missing)].join(', ')} is not set`);
  return server;
}

function ignoreProblem(ignore) {
  if (!Array.isArray(ignore) || ignore.some((line) => typeof line !== 'string' || line.trim() === '')) return 'ignore must be an array of non-empty strings';
  if (ignore.some((line) => IGNORE_ABSOLUTE.test(line.trim()))) return 'ignore lines must be relative paths, not absolute';
  if (ignore.some((line) => line.trim().split(/[\\/]/).includes('..'))) return 'ignore lines must not contain a .. segment';
  return null;
}

function addIgnoreLines(file, wanted) {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const present = new Set(text.split(/\r?\n/).map((line) => line.trim()));
  const added = [...new Set(wanted)].filter((line) => !present.has(line));
  if (added.length === 0) return added;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lead = text === '' || text.endsWith('\n') ? '' : eol;
  appendFileSync(file, `${lead}${added.map((line) => `${line}${eol}`).join('')}`);
  return added;
}

function describe(server, tool) {
  const text = String(tool.description ?? tool.title ?? tool.name);
  const short = text.length > DESCRIPTION_CHARS ? `${text.slice(0, DESCRIPTION_CHARS)}...` : text;
  return `${short} (MCP server ${server}, tool ${tool.name})`;
}

function partText(part) {
  if (part.type === 'text') return part.text;
  return `[${part.type}${part.mimeType === undefined ? '' : ` ${part.mimeType}`}]`;
}

function outcomeOf(result) {
  const output = (result.content ?? []).map(partText).join('\n');
  const failed = result.isError === true;
  return {
    ok: !failed,
    output,
    ...(result.structuredContent === undefined ? {} : { data: result.structuredContent }),
    ...(failed ? { error: output === '' ? 'the tool reported an error' : output } : {}),
  };
}

class ServerProcess {
  constructor(spec, log, depth) {
    this.spec = spec;
    this.log = log;
    this.depth = depth;
    this.tools = [];
    this.child = null;
    this.starting = null;
    this.up = false;
    this.stderr = '';
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = '';
  }

  connect(again = false) {
    if (this.starting !== null) return this.starting;
    if (this.up) return Promise.resolve(null);
    this.starting = this.handshake(again).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  async handshake(again) {
    try {
      this.start();
      const init = await this.request('initialize', { protocolVersion: PROTOCOL_VERSIONS[0], capabilities: {}, clientInfo: CLIENT_INFO }, this.spec.startupMs);
      if (!PROTOCOL_VERSIONS.includes(init.protocolVersion)) throw new Error(`protocol version ${init.protocolVersion} is not one gm-new speaks`);
      this.notify('notifications/initialized');
      this.tools = await this.listTools();
      this.log.append('mcp-server', { server: this.spec.name, state: again ? 'restarted' : 'connected', tools: this.tools.length, protocolVersion: init.protocolVersion });
      this.ignoreWorkspace();
      return null;
    } catch (err) {
      this.stop();
      this.log.append('mcp-server', { server: this.spec.name, state: 'failed', error: err.message, stderr: this.stderr });
      return err.message;
    }
  }

  ignoreWorkspace() {
    const { name, workspace, ignore } = this.spec;
    if (ignore.length === 0) return;
    if (!existsSync(join(workspace, '.git'))) {
      this.log.append('gitignore', { server: name, state: 'skipped', reason: 'the workspace is not a git repository', ignore });
      return;
    }
    const file = join(workspace, '.gitignore');
    try {
      const added = addIgnoreLines(file, ignore);
      if (added.length > 0) this.log.append('gitignore', { server: name, state: 'added', file, added });
    } catch (err) {
      this.log.append('gitignore', { server: name, state: 'failed', file, error: err.message });
    }
  }

  start() {
    const env = { ...process.env, ...this.spec.env, [DEPTH_VARIABLE]: String(this.depth + 1) };
    const { command, args } = launchOf(this.spec);
    const child = spawn(command, args, { cwd: this.spec.cwd, env, detached: true, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    this.up = true;
    this.buffer = '';
    child.stdin.on('error', () => {});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.receive(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      this.stderr = (this.stderr + chunk).slice(-STDERR_CHARS);
    });
    child.on('error', (err) => this.lose(child, `could not start: ${err.message}`));
    child.on('exit', (code, signal) => this.lose(child, `exited with ${signal ?? `code ${code}`}`));
  }

  lose(child, reason) {
    if (this.child !== child) return;
    this.child = null;
    this.up = false;
    const error = new Error(`MCP server ${this.spec.name} ${reason}`);
    for (const waiting of this.pending.values()) waiting.reject(error);
    this.pending.clear();
    this.log.append('mcp-server', { server: this.spec.name, state: 'down', reason, stderr: this.stderr });
  }

  stop() {
    const child = this.child;
    if (child === null) return;
    this.lose(child, 'stopped by gm-new');
    child.stdin.end();
    killGroupNow(child.pid);
  }

  receive(chunk) {
    this.buffer += chunk;
    for (let at = this.buffer.indexOf('\n'); at >= 0; at = this.buffer.indexOf('\n')) {
      const line = this.buffer.slice(0, at).trim();
      this.buffer = this.buffer.slice(at + 1);
      if (line !== '') this.message(line);
    }
  }

  message(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.method !== undefined && message.id !== undefined) {
      const reply = message.method === 'ping' ? { result: {} } : { error: { code: -32601, message: `gm-new does not serve ${message.method}` } };
      this.send({ jsonrpc: '2.0', id: message.id, ...reply });
      return;
    }
    const waiting = this.pending.get(message.id);
    if (waiting === undefined || message.method !== undefined) return;
    this.pending.delete(message.id);
    if (message.error !== undefined) waiting.reject(new Error(message.error.message ?? 'the server returned an error'));
    else waiting.resolve(message.result ?? {});
  }

  send(message) {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  notify(method, params) {
    this.send(params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params });
  }

  request(method, params, timeoutMs) {
    if (!this.up) return Promise.reject(new Error(`MCP server ${this.spec.name} is not running`));
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.notify('notifications/cancelled', { requestId: id, reason: `timed out after ${timeoutMs} ms` });
        reject(new Error(`${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  async listTools() {
    const tools = [];
    const seen = new Set();
    let cursor;
    do {
      const page = await this.request('tools/list', cursor === undefined ? {} : { cursor }, this.spec.startupMs);
      tools.push(...(page.tools ?? []));
      cursor = page.nextCursor || undefined;
      if (seen.has(cursor)) break;
      seen.add(cursor);
    } while (cursor !== undefined);
    return tools;
  }

  async callTool(name, args) {
    if (!this.up) {
      const error = await this.connect(true);
      if (error !== null) return { ok: false, error: `MCP server ${this.spec.name} is not running: ${error}` };
    }
    try {
      return outcomeOf(await this.request('tools/call', { name, arguments: args }, this.spec.timeoutMs));
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}

export function startMcpClients({ servers, problems = [], log, reserved = new Set(), depth = 0 }) {
  for (const problem of problems) log.append('mcp-config', { problem });
  const started = depth < MAX_DEPTH ? servers : [];
  if (started.length < servers.length) log.append('mcp-config', { problem: `servers are not started at MCP depth ${depth}, the limit is ${MAX_DEPTH}` });
  const runners = started.map((spec) => new ServerProcess(spec, log, depth));
  const routes = new Map();
  const verbs = [];
  const ready = Promise.all(runners.map((runner) => runner.connect())).then(() => {
    for (const runner of runners) {
      for (const tool of runner.tools) {
        const name = verbNameOf(runner.spec.name, tool.name);
        if (runner.spec.deny.includes(tool.name)) {
          log.append('mcp-tool-skipped', { server: runner.spec.name, tool: tool.name, verb: name, reason: 'the server entry denies it' });
          continue;
        }
        const taken = reserved.has(name) || routes.has(name);
        if (taken) {
          log.append('mcp-tool-skipped', { server: runner.spec.name, tool: tool.name, verb: name, reason: reserved.has(name) ? 'the name is a gm-new verb' : 'the name is another MCP tool' });
          continue;
        }
        routes.set(name, { runner, tool });
        verbs.push({ name, description: describe(runner.spec.name, tool), inputSchema: tool.inputSchema ?? { type: 'object' } });
      }
    }
  });
  return {
    ready,
    verbs: () => verbs.map((verb) => ({ ...verb })),
    has: (name) => routes.has(name),
    call: (name, args) => {
      const { runner, tool } = routes.get(name);
      return runner.callTool(tool.name, args);
    },
    stop: () => runners.forEach((runner) => runner.stop()),
  };
}
