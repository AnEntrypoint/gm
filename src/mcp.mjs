#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { DEFAULT_WITNESS, MCP_RULES, prefixShaOf, renderTools } from './prompt.mjs';
import { connectReply, SERVER_NAME } from './connect.mjs';
import { isDirectory, loadTask, newRunId, openRun, ROOT } from './run.mjs';
import { flushAllLogs } from './log.mjs';
import { clearPending, hasPending, offPendingAppended, onPendingAppended, PENDING_FILE, takePending } from './pending.mjs';
import { conflicts, createTools, loggedReply, OUTPUT_PAGE, DEFAULT_STUCK_MS, DEFAULT_MONITOR_MS, BODY_NOTICE_MS } from './tools.mjs';
import { bumpGeneration } from './hot.mjs';
import { RELOADABLE } from './hot-config.mjs';
import { SEARCH_TOOLS } from './search.mjs';
import { runBody, runCodeTool, RUN_CODE_PROPERTIES } from './runcode.mjs';
import { bodyContext } from './exec.mjs';
import { COMPACT as SEARCH_COMPACT } from './search.mjs';
import { COMPACT as RUNCODE_COMPACT } from './runcode.mjs';
import { COMPACT as TOOLS_COMPACT } from './tools.mjs';
import { feedOf, registryOf, resultZone1, resultZone2, shownTotalOf } from './compact.mjs';
import { writeSummary } from './summary.mjs';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: SERVER_NAME, version: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version };
const SKILL_URI = 'gm://skill/SKILL.md';
// The skill is read on each request, so an edit to skills/gm/SKILL.md is served without a restart. A file caught mid-write keeps the last
// text that parsed. Before any text has parsed, the error reaches the caller.
let skillLast = null;
function skill() {
  try {
    skillLast = parseSkill(readFileSync(join(ROOT, 'skills', 'gm', 'SKILL.md'), 'utf8'));
  } catch (err) {
    if (skillLast === null) throw err;
  }
  return skillLast;
}
function skillPrompt() {
  const SKILL = skill();
  return { name: SKILL.name, description: SKILL.description, arguments: [{ name: 'task', description: 'The task to run', required: false }] };
}
function skillResource() {
  const SKILL = skill();
  return { uri: SKILL_URI, name: `${SKILL.name} skill`, description: SKILL.description, mimeType: 'text/markdown' };
}
const DEFAULT_MAX_STEPS = 50;
const REPLY_MEMORY = 256;
const DEFAULT_MAX_INFLIGHT = 8;
const DEFAULT_JOB_LIFETIME_MS = 1800000;
// The most open jobs a next_context reply lists. The rest are counted in jobsOpenMore.
const OPEN_LIST = 20;
const USAGE = 'usage: node src/mcp.mjs --workspace <dir> [--task <file-or-text>] [--run-dir <dir>] [--max-steps N] [--max-inflight N] [--job-lifetime-ms N] [--stuck-ms N] [--monitor-ms N] [--notice-ms N] [--host-idle-ms N] [--surface tools|code]';
// A host that stops calling is noticed after this long with no call in flight (--host-idle-ms). next_context waitMs is capped here, because a host cuts a call that runs too long.
const DEFAULT_HOST_IDLE_MS = 600000;
const MAX_WAIT_MS = 300000;

const text = { type: 'string' };
const number = { type: 'number' };
const objectSchema = (properties, required = []) => ({ type: 'object', properties, required });

const BASE_TOOLS = [
  { name: 'next_context', description: 'Begin a step. Returns rules, task, witness requirement, the events new since the last step in full, the older ones in compact form within two horizons, and prefixSha. pending lists the events that need you since your last step, each once, with an id, and pendingFile is the file that holds them for a live tail. Call it at the start of each step. query_log reaches every event. waitMs, when set, holds this call until an event is pending or that many milliseconds pass, at most 300000.', inputSchema: objectSchema({ waitMs: number }) },
  { name: 'read_file', description: 'Read a text file in the workspace, one page of at most 20000 characters. offset and limit are counted in characters, not lines: limit is 1 to 20000, default 20000. Returns output, total characters, the offset of this page and next, the offset of the next page (null at the end).', inputSchema: objectSchema({ path: text, offset: number, limit: number }, ['path']) },
  { name: 'write_file', description: 'Write a text file in the workspace, creating parent directories.', inputSchema: objectSchema({ path: text, content: text }, ['path', 'content']) },
  { name: 'edit_file', description: 'Replace old with new in a workspace text file. old must occur once, unless replaceAll is true.', inputSchema: objectSchema({ path: text, old: text, new: text, replaceAll: { type: 'boolean' } }, ['path', 'old', 'new']) },
  { name: 'stat_file', description: 'Type, size and mtime of a workspace path, as JSON.', inputSchema: objectSchema({ path: text }, ['path']) },
  { name: 'list_dir', description: 'List a workspace directory. Directories end with "/".', inputSchema: objectSchema({ path: text }) },
  { name: 'run_shell', description: 'Run a shell command in the workspace and wait for it. Default timeout 60000 ms. Its process group is killed when it returns, so background work must go through job_start.', inputSchema: objectSchema({ command: text, timeoutMs: number }, ['command']) },
  { name: 'job_start', description: 'Start a shell command as a named background job and return at once. Poll it with job_status.', inputSchema: objectSchema({ job: text, command: text, timeoutMs: number }, ['job', 'command']) },
  { name: 'job_status', description: 'State (running, exited or killed), exit code and output tail of a job. waitMs polls until the job leaves running, at most 30000 ms. offset returns a page of 20000 characters of the output from that offset, with next.', inputSchema: objectSchema({ job: text, waitMs: number, offset: number }, ['job']) },
  { name: 'query_log', description: 'Read the run events, as JSON. after is a seq: only the events after it are read (since), so after the last seq you saw reads on from there. kind keeps events of one kind, and fromMono and toMono keep events in a time window (monotonic milliseconds). last N returns the newest N matching events instead, oldest first, at most 50, and has no next. js is a JavaScript expression over the matching events, and defaults to returning them: js sees one window of at most 1000 events or 4 MB of log. Without js, a reply holds at most 50 events and about 20 KB. When events remain, next is the seq to pass back as after; with js, next is set when the window ends before the end of the log. An unknown argument is refused, and the reply names the arguments query_log takes.', inputSchema: objectSchema({ js: text, kind: text, fromMono: number, toMono: number, after: number, last: number }, []) },
  { name: 'finish', description: 'End the run. witness is one string that quotes the evidence you observed. gaps optionally lists, one string each, what the run did not check; the end event logs them. finish is refused while a background run is running, and stopBackground true kills it first. finish is refused while a PRD or question row is open, and names the rows; stopRows true ends the run anyway, with each open row listed as a gap in the end event.', inputSchema: objectSchema({ witness: text, gaps: { type: 'array', items: text }, stopBackground: { type: 'boolean' }, stopRows: { type: 'boolean' } }, ['witness']) },
  ...SEARCH_TOOLS,
];

// The code surface (--surface code) serves next_context, finish and run_code. Every other verb is called from run_code as
// gm.<name>(args). The tools surface serves the whole list, as before.
const SURFACES = ['tools', 'code'];
const CODE_SURFACE = new Set(['next_context', 'run_code', 'finish']);
// The surface the worker serves: the tool list, the verbs and the compaction registry. surfaceOf builds it from the leaf modules it is given,
// so a reload builds the next surface from the new code and swaps it in whole.
function surfaceOf(leaves) {
  const TOOLS = [
    ...BASE_TOOLS,
    ...leaves['wiki-tools.mjs'].WIKI_TOOLS,
    ...leaves['review-tools.mjs'].REVIEW_TOOLS,
    ...leaves['fetch.mjs'].FETCH_TOOLS,
    ...leaves['code-ast.mjs'].CODE_TOOLS,
    ...leaves['git.mjs'].GIT_TOOLS,
    ...leaves['rows.mjs'].ROW_TOOLS,
  ];
  const VERBS = TOOLS.filter((tool) => !CODE_SURFACE.has(tool.name));
  const CODE_LIST = [...TOOLS.filter((tool) => tool.name === 'next_context' || tool.name === 'finish'), runCodeTool(VERBS.map((tool) => tool.name))];
  const REGISTRY = registryOf(TOOLS_COMPACT, SEARCH_COMPACT, leaves['fetch.mjs'].COMPACT, leaves['git.mjs'].COMPACT, leaves['code-ast.mjs'].COMPACT, leaves['rows.mjs'].COMPACT, leaves['wiki-tools.mjs'].COMPACT, leaves['review-tools.mjs'].COMPACT, RUNCODE_COMPACT, SELF_COMPACT);
  return { TOOLS, VERBS, CODE_LIST, REGISTRY, leaves };
}
// Every reloadable module at the current generation. Boot and each reload read them here, so both take the same path.
async function loadLeaves() {
  const leaves = {};
  for (const file of RELOADABLE) leaves[file] = await import(`./${file}`);
  return leaves;
}
function servedTools(surface) {
  return surface === 'code' ? current.CODE_LIST : current.TOOLS;
}
const NO_PATHS = { items: [], free: true };

function parseSkill(text) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) throw new Error('skills/gm/SKILL.md has no frontmatter');
  const fields = Object.fromEntries(match[1].split('\n').map((line) => line.split(/:\s*(.*)/s).slice(0, 2)));
  return { text, name: fields.name, description: fields.description, body: text.slice(match[0].length).trim() };
}

class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// The hold next_context takes when waitMs is set. The listener is added before the check, so an event that lands between them is not missed.
function untilPending(runDir, waitMs) {
  if (waitMs === 0) return Promise.resolve();
  return new Promise((done) => {
    const wake = () => {
      clearTimeout(timer);
      offPendingAppended(wake);
      done();
    };
    const timer = setTimeout(wake, waitMs);
    onPendingAppended(wake);
    if (hasPending(runDir)) wake();
  });
}

function waitOf(value) {
  const ms = Number(value ?? 0);
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, MAX_WAIT_MS) : 0;
}

function createSession({ workspace, runDir, log, task, maxSteps, maxInflight, resume = null, jobLifetimeMs = DEFAULT_JOB_LIFETIME_MS, stuckMs = DEFAULT_STUCK_MS, monitorMs = DEFAULT_MONITOR_MS, noticeMs = BODY_NOTICE_MS, hostIdleMs = DEFAULT_HOST_IDLE_MS, recovery = null, history = [], surface = 'code' }) {
  const runId = basename(runDir);
  const tools = createTools({ workspace, runDir, log, background: true, jobLifetimeMs, stuckMs, monitorMs, noticeMs, leaves: current.leaves });
  activeTools = tools;
  activeLog = log;
  let pendingRecovery = recovery;
  let noticeSeq = lastContextSeq(log.events());
  const active = new Map();
  const waiting = [];
  const unansweredTurns = new Set();
  // A repeated tools/call request id is answered from its first reply, never run again. Only the last REPLY_MEMORY requests are kept.
  const replies = new Map();
  const remember = (key, pending) => {
    replies.set(key, pending);
    if (replies.size > REPLY_MEMORY) replies.delete(replies.keys().next().value);
  };
  for (const [key, reply] of answersFrom(history)) remember(key, Promise.resolve(reply));
  let steps = resume?.steps ?? 0;
  let ended = resume?.ended ?? null;
  let endLogged = ended !== null;
  // A host that stops calling leaves the run open, and nothing wakes it. After hostIdleMs with no call in flight and none since, one
  // host-idle event is queued for a watcher on the pending file. It is queued once per quiet spell, and the timer stops when the run ends.
  let quietSince = log.now();
  let idleQueued = false;
  const touch = () => {
    quietSince = log.now();
    idleQueued = false;
  };
  const idleTimer = setInterval(() => {
    if (ended !== null) {
      clearInterval(idleTimer);
      return;
    }
    if (active.size > 0 || idleQueued || log.now() - quietSince < hostIdleMs) return;
    idleQueued = true;
    log.append('host-idle', { idleMs: Math.round(log.now() - quietSince) });
  }, Math.max(1000, Math.floor(hostIdleMs / 4)));
  idleTimer.unref();
  // The rules watchdog. It notices the rule breaks it can see: a call before the run's first next_context (rule 2), a path or load that
  // leaves the workspace (rule 1), a finish with no call in its step (rule 3), and a finish refused for its witness (rule 4). An open notice is
  // carried in the reply of each call and in next_context until the agent loads the skill again, which clears them all.
  const rulesOpen = new Map();
  let runStarted = steps > 0;
  let stepCalls = 0;
  const RULE_TEXT = { 1: 'work only inside the workspace', 2: 'call next_context at the start of every step', 3: 'verify before you finish', 4: 'finish needs a witness' };
  const LEAVES_WORKSPACE = /workspace|\.\.|link|outside/;
  function noteRule(rule, evidence) {
    if (rulesOpen.has(rule)) return;
    const entry = log.append('rules-notice', { step: steps, rule, evidence });
    rulesOpen.set(rule, { seq: entry.seq, evidence });
  }
  function clearRules() {
    if (rulesOpen.size === 0) return;
    const rules = [...rulesOpen.keys()];
    rulesOpen.clear();
    log.append('rules-cleared', { step: steps, rules });
  }
  function rulesNotice() {
    if (rulesOpen.size === 0) return null;
    const lines = [...rulesOpen].map(([rule, { evidence }]) => `rule ${rule} (${RULE_TEXT[rule]}): ${evidence}`);
    return `The rules check found: ${lines.join('; ')}. Read the gm skill again with ReadMcpResourceTool (server gm, uri gm://skill/SKILL.md) and follow the rules it gives. That one read clears this notice. Do not repeat finished work.`;
  }

  const handlers = {
    read_file: (args) => tools.run('read_file', args),
    write_file: (args) => tools.run('write_file', args),
    list_dir: (args) => tools.run('list_dir', args),
    run_shell: ({ command, timeoutMs }) => tools.run('run_shell', { command, timeoutMs }),
    job_start: ({ job, command, timeoutMs }) => tools.run('run_shell', { job, command, timeoutMs, background: true }),
    job_status: ({ job, waitMs, offset }) => tools.run('job_status', { job, waitMs, offset }),
    query_log: (args) => tools.run('query_log', args),
  };

  // One verb called from run_code. It runs through the same handler the tool surface uses, and it is logged as code-call.
  async function innerCall(name, args) {
    const startMono = log.now();
    // A call that a background body makes carries the body's seq, so the body's output can be read back from the log. While the call is in
    // flight, the body counts as progressing (the stuck check reads it).
    const body = bodyContext.getStore()?.body;
    if (body !== undefined) tools.callStarted(body);
    // A verb that may change something has its start in the file before it runs. Its code-call names that start, as a result names its action.
    const action = READ_ONLY_TOOLS.has(name) ? undefined : log.append('action', { step: steps, tool: name, args, ...(body === undefined ? {} : { body }) });
    if (action !== undefined) flushAllLogs();
    const exec = Object.hasOwn(handlers, name) ? handlers[name] : (value) => tools.run(name, value);
    let result;
    try {
      result = await exec(args);
    } catch (err) {
      result = { ok: false, error: err.message };
    } finally {
      if (body !== undefined) tools.callEnded(body);
    }
    if (result?.refused === true && LEAVES_WORKSPACE.test(String(result.error))) noteRule(1, `${name}: ${result.error}`);
    // The full result is logged, so query_log reaches the output and the exit code of a verb called inside a body.
    const shown = name === 'query_log' ? loggedReply(result) : result;
    const fields = { ok: shown?.ok === true, args, exitCode: shown?.exitCode, signal: shown?.signal, output: shown?.output, outputChars: shown?.outputChars, error: shown?.error };
    log.append('code-call', { step: steps, tool: name, startMono, ...fields, ...(body === undefined ? {} : { body }), ...(action === undefined ? {} : { actionSeq: action.seq }) });
    return result;
  }

  function accept(line) {
    if (line.trim() === '') return;
    const turn = handleLine(line)
      .then((reply) => {
        if (reply !== null) write(reply);
      })
      .catch((err) => console.error(`gm: ${err.message}`))
      .finally(() => unansweredTurns.delete(turn));
    unansweredTurns.add(turn);
  }

  async function handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (err) {
      log.append('parse_error', { error: err.message });
      return errorReply(null, -32700, 'Parse error');
    }
    if (!isRequestShape(message)) {
      log.append('error', { code: -32600, message: 'Invalid Request' });
      return errorReply(null, -32600, 'Invalid Request');
    }
    const request = Object.hasOwn(message, 'id');
    const key = request && message.method === 'tools/call' ? JSON.stringify(message.id) : null;
    try {
      if (key !== null && replies.has(key)) {
        log.append('duplicate', { rpcId: message.id, tool: message.params?.name });
        return { jsonrpc: '2.0', id: message.id, result: await replies.get(key) };
      }
      const pending = route(message.method, message.params, message.id);
      if (key !== null) remember(key, pending);
      const result = await pending;
      return request ? { jsonrpc: '2.0', id: message.id, result: result ?? {} } : null;
    } catch (err) {
      if (!request) return null;
      const code = err instanceof RpcError ? err.code : -32603;
      log.append('error', { method: message.method, code, message: err.message });
      return errorReply(message.id, code, err.message);
    }
  }

  async function route(method, params, rpcId) {
    if (method === 'initialize') return initialize(params);
    if (method === 'ping' || method === 'server/discover') return {};
    if (method === 'tools/list') return { tools: servedTools(surface) };
    if (method === 'tools/call') {
      touch();
      return callTool(params, rpcId);
    }
    if (method === 'prompts/list') return { prompts: [skillPrompt()] };
    if (method === 'prompts/get') return getPrompt(params);
    if (method === 'resources/list') return { resources: [skillResource()] };
    if (method === 'resources/read') return readResource(params);
    if (method === 'resources/templates/list') return { resourceTemplates: [] };
    if (method === 'core/reload') return reloadLeaves();
    if (method.startsWith('notifications/')) return null;
    throw new RpcError(-32601, `method not found: ${method}`);
  }

  function initialize(params) {
    const version = typeof params?.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION;
    return { protocolVersion: version, ...connectReply(surface), serverInfo: SERVER_INFO };
  }

  function getPrompt(params) {
    const SKILL = skill();
    if (params?.name !== SKILL.name) throw new RpcError(-32602, `unknown prompt: ${params?.name}`);
    // Loading the skill again is what the notice asks for, so it clears the open notices. Each fetch is logged, so a live run can count them.
    log.append('skill-loaded', { via: 'prompt', cleared: [...rulesOpen.keys()] });
    clearRules();
    const given = typeof params?.arguments?.task === 'string' ? params.arguments.task.trim() : '';
    // The session's prompt gives the task of a run that was started without --task. The first task given is the run's task, logged once.
    if (task === '' && given !== '') {
      task = given;
      log.append('task', { from: 'session prompt', text: task });
    }
    const text = given === '' ? SKILL.body : `${SKILL.body}\n\nTask: ${given}`;
    return { description: SKILL.description, messages: [{ role: 'user', content: { type: 'text', text } }] };
  }

  function readResource(params) {
    const SKILL = skill();
    if (params?.uri !== SKILL_URI) throw new RpcError(-32602, `unknown resource: ${params?.uri}`);
    log.append('skill-loaded', { via: 'resource', cleared: [...rulesOpen.keys()] });
    clearRules();
    return { contents: [{ uri: SKILL_URI, mimeType: 'text/markdown', text: SKILL.text }] };
  }

  // The checks on one call's result, for the rules the server can see. A finish is judged by its own result. Any other call counts toward the
  // step that is open, which the next_context call started.
  function watchCall(name, out) {
    if (name === 'next_context') return;
    if (name === 'finish') {
      if (out.refused === true && String(out.error).includes('needs a non-empty witness')) noteRule(4, `finish was refused: ${out.error}`);
      else if (out.ok === true && stepCalls === 0) noteRule(3, 'finish was called with no call in its step');
      return;
    }
    stepCalls += 1;
    if (out.refused === true && LEAVES_WORKSPACE.test(String(out.error))) noteRule(1, `${name}: ${out.error}`);
  }

  async function callTool(params, rpcId) {
    const name = params?.name;
    const args = params?.arguments ?? {};
    if (typeof name !== 'string') throw new RpcError(-32602, 'tools/call needs a string name');
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      throw new RpcError(-32602, 'tools/call arguments must be an object');
    }
    if (!runStarted && name !== 'next_context' && name !== 'finish') noteRule(2, `${name} was called before the first next_context of the run`);
    const out = await startCall(name, args, rpcId);
    watchCall(name, out);
    const notice = rulesNotice();
    const payload = notice === null ? out : { ...out, rulesNotice: notice };
    return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: out.ok !== true };
  }

  function startCall(name, args, rpcId) {
    return new Promise((resolveCall) => {
      waiting.push({ name, args, resolveCall, rpcId });
      drain();
    });
  }

  function drain() {
    if (ended !== null) {
      for (const call of waiting.splice(0)) call.resolveCall(refuse(call.name, call.args, endedReason(), call.rpcId));
      return;
    }
    while (active.size < maxInflight && waiting.length > 0) {
      const accesses = waiting.map((call) => accessOf(call.name, call.args));
      const index = startableIndex(accesses);
      if (index < 0) return;
      const [call] = waiting.splice(index, 1);
      call.resolveCall(invoke(call.name, call.args, accesses[index], call.rpcId));
    }
  }

  function startableIndex(accesses) {
    const running = [...active.values()];
    return accesses.findIndex(
      (access, i) =>
        access.free || (!running.some((other) => conflicts(other, access)) && !accesses.slice(0, i).some((earlier) => conflicts(earlier, access))),
    );
  }

  function accessOf(name, args) {
    return name === 'next_context' ? NO_PATHS : tools.access(name, args);
  }

  function stop(status) {
    ended = status;
    drain();
  }

  function endedReason() {
    if (ended === 'closed') return 'stdin closed before the call started';
    if (ended === 'restarting') return 'the server is restarting; repeat the call';
    return `run ${runId} has ended (${ended}); restart the server to open a new run`;
  }

  function invoke(name, args, access, rpcId) {
    if (ended !== null) return refuse(name, args, endedReason(), rpcId);
    if (surface === 'code' && !CODE_SURFACE.has(name)) {
      return refuse(name, args, 'the code surface serves next_context, run_code and finish; call a verb as gm.<name>(args) inside run_code', rpcId);
    }
    if (name === 'run_code') {
      // A wrong argument name is refused by name. The run_code reply names its action, which is the seq of the action event, so a body can cite it.
      const unknown = Object.keys(args).filter((key) => !Object.hasOwn(RUN_CODE_PROPERTIES, key));
      if (unknown.length > 0) return refuse(name, args, `unknown argument ${unknown.join(', ')}; run_code takes ${Object.keys(RUN_CODE_PROPERTIES).join(', ')}`, rpcId);
      return act('run_code', args, access, (actionSeq) => runBody({ body: args.body, timeoutMs: args.timeoutMs, format: args.format, verbs: current.VERBS, call: innerCall, project: workspace, runDir, log, step: steps, background: (handle) => tools.adoptBody(handle) }).then((reply) => ({ ...reply, actionSeq })), undefined, rpcId);
    }
    if (name === 'next_context') return nextContext(access, rpcId, args);
    if (name === 'finish') return finish(args, access, rpcId);
    if (Object.hasOwn(handlers, name)) return act(name, args, access, () => handlers[name](args), name === 'query_log' ? loggedReply : undefined, rpcId);
    return act(name, args, access, () => tools.run(name, args), undefined, rpcId);
  }

  async function nextContext(access, rpcId, args = {}) {
    if (steps >= maxSteps) {
      stop('max_steps');
      const out = refuse('next_context', {}, `step limit ${maxSteps} reached`, rpcId);
      await endRun('max_steps', null);
      return out;
    }
    steps += 1;
    runStarted = true;
    stepCalls = 0;
    const step = steps;
    const waitMs = waitOf(args.waitMs);
    return act('next_context', {}, access, async () => {
      await untilPending(runDir, waitMs);
      return context(step);
    }, ({ ok, error, prefixSha, total }) => ({ ok, error, prefixSha, total }), rpcId);
  }

  // The prefix is the same at every step, except for the rules, which are read again at each step. Its text is built and hashed only when
  // the rules change. A step whose rules are the same reuses the hash, so no step builds the tool text again.
  let prefixMemo = null;
  function prefixShaFor(rules) {
    if (prefixMemo === null || prefixMemo.surface !== current || prefixMemo.rules !== rules || prefixMemo.task !== task) prefixMemo = { surface: current, rules, task, sha: prefixShaOf({ rules, task, witness: DEFAULT_WITNESS, tools: renderTools(servedTools(surface)) }) };
    return prefixMemo.sha;
  }

  async function context(step) {
    const rules = await readFile(join(runDir, 'rules.md'), 'utf8');
    const recoveryNow = pendingRecovery === null ? undefined : recoveryNote(pendingRecovery);
    pendingRecovery = null;
    // The pending events are delivered once. They are removed only after this reply is written, so a crash before that delivers them again.
    const taken = takePending(runDir);
    if (taken.files.length > 0) afterReply.push(() => clearPending(taken.files));
    const since = log.eventsFrom(noticeSeq + 1);
    noticeSeq = log.count();
    const killed = since.filter((event) => event.kind === 'job-killed');
    const killedNames = new Set(killed.map((event) => event.job));
    // A background run's notices: it started, it is still running (once per 3 minutes), and it ended. A kill is named once, by job-killed.
    const started = since.filter((event) => event.kind === 'job' && event.state === 'running' && event.body !== undefined);
    const stillRunning = since.filter((event) => event.kind === 'job-running');
    // What is still happening: the jobs that turned stuck or progressed again since the last step, and every job still open now, so the agent
    // can tell whether anything is stuck. The open list is a snapshot of the present, not a notice, so it is not an event.
    const turnedStuck = since.filter((event) => event.kind === 'job-stuck');
    const progressedAgain = since.filter((event) => event.kind === 'job-unstuck');
    const open = tools.activeJobs();
    const ended = since.filter((event) => event.kind === 'job' && event.state !== 'running' && !(event.state === 'killed' && killedNames.has(event.job)));
    const jobsEnded = await Promise.all(ended.map((event) => endedJob(runDir, event)));
    return {
      ok: true,
      step,
      // The run's id, so a session that hands work to a child session can name the child's log (see query in src/cli.mjs).
      run: runId,
      stepsLeft: maxSteps - step,
      maxSteps,
      rules,
      task: task === '' ? null : task,
      ...(task === '' ? { taskNotice: 'No task yet. The gm skill prompt, with its task argument, gives the task of this run.' } : {}),
      witness: DEFAULT_WITNESS,
      prefixSha: prefixShaFor(rules),
      total: log.count(),
      ...(taken.records.length > 0 ? { pending: taken.records } : {}),
      pendingFile: join(runDir, PENDING_FILE),
      // The shell commands the agent runs. wait runs as a background task and ends at the next event, so the host reports the event as the
      // end of that task; read clears the queue once. Both name the run directory, so they work from any directory.
      pendingCommands: {
        wait: `node "${join(ROOT, 'src', 'cli.mjs')}" events --dir "${runDir}" --wait`,
        read: `node "${join(ROOT, 'src', 'cli.mjs')}" events --dir "${runDir}" --read-clear`,
      },
      ...feedOf(log, current.REGISTRY, { shown: shownTotalOf(log) }),
      ...(recoveryNow ? { recovery: recoveryNow } : {}),
      ...(rulesOpen.size > 0 ? { rulesPending: rulesNotice() } : {}),
      ...(killed.length ? { jobsKilled: killed.map(({ seq, job, reason, lifetimeMs, tail }) => ({ seq, job, reason, lifetimeMs, tail })) } : {}),
      ...(started.length ? { jobsStarted: started.map(({ seq, job }) => ({ seq, job })) } : {}),
      ...(stillRunning.length ? { jobsRunning: stillRunning.map(({ seq, job, runningMs, prd }) => ({ seq, job, runningMs, prd })) } : {}),
      ...(jobsEnded.length ? { jobsEnded } : {}),
      ...(turnedStuck.length ? { jobsStuck: turnedStuck.map(({ seq, job, body, sinceProgressMs }) => ({ seq, job, ...(body === undefined ? {} : { body }), sinceProgressMs })) } : {}),
      ...(progressedAgain.length ? { jobsUnstuck: progressedAgain.map(({ seq, job }) => ({ seq, job })) } : {}),
      ...(open.length ? { jobsOpen: open.slice(0, OPEN_LIST), ...(open.length > OPEN_LIST ? { jobsOpenMore: open.length - OPEN_LIST } : {}) } : {}),
    };
  }

  async function finish(args, access, rpcId) {
    if (typeof args.witness !== 'string' || args.witness.trim() === '') {
      return refuse('finish', args, 'finish needs a non-empty witness string');
    }
    if (args.gaps !== undefined && (!Array.isArray(args.gaps) || args.gaps.some((gap) => typeof gap !== 'string' || gap.trim() === ''))) {
      return refuse('finish', args, 'gaps must be an array of non-empty strings');
    }
    // A background run still running refuses the finish and is named. stopBackground true kills each one, and each kill is logged.
    const running = tools.runningBodies();
    if (running.length > 0 && args.stopBackground !== true) {
      return refuse('finish', args, `background run ${running.join(', ')} is still running; job_status watches it, and finish with stopBackground: true kills it`);
    }
    // An open row refuses the finish and is named, so the run stays open for the work. stopRows true ends the run with each open row listed as a gap.
    const open = await tools.openRows();
    if (open.length > 0 && args.stopRows !== true) {
      const names = open.slice(0, 5).map((row) => `${row.id} ${row.title}`).join('; ');
      return refuse('finish', args, `${open.length} row(s) open: ${names}${open.length > 5 ? '; ...' : ''}. Work them, or finish with stopRows: true to end with them listed as gaps`, rpcId);
    }
    if (args.stopBackground === true) tools.stopBodies('stopBackground');
    stop('finished');
    const out = await act('finish', args, access, () => tools.run('finish', args), undefined, rpcId);
    // The wiki lint loads on the first finish.
    const { lintWiki } = await import('./wiki.mjs');
    const lint = lintWiki(workspace);
    log.append('lint', { problems: lint.problems, pages: lint.pages });
    const gaps = args.stopRows === true ? [...(args.gaps ?? []), ...open.map((row) => `open row ${row.id}: ${row.title}`)] : args.gaps;
    await endRun('finished', out.output, gaps);
    return out;
  }

  function act(tool, args, access, exec, digest = (result) => result, rpcId = undefined) {
    const work = perform(tool, args, exec, digest, rpcId);
    active.set(work, access);
    const forget = () => {
      active.delete(work);
      touch();
      drain();
    };
    work.then(forget, forget);
    return work;
  }

  async function perform(tool, args, exec, digest, rpcId) {
    const step = steps;
    const startMono = log.now();
    log.enter();
    const action = log.append('action', { step, tool, args, ...(rpcId === undefined ? {} : { rpcId }) });
    // A tool that may change something has its start in the file before it runs, so a crash after its effect still leaves the start in the log.
    if (!READ_ONLY_TOOLS.has(tool)) flushAllLogs();
    let result;
    try {
      result = await exec(action.seq);
    } catch (err) {
      result = { ok: false, error: err.message };
    }
    if (result.refused) log.append('refusal', { step, tool, error: result.error, startMono, actionSeq: action.seq });
    else log.append('result', { step, tool, startMono, actionSeq: action.seq, ...digest(result) });
    log.leave();
    return result;
  }

  function refuse(tool, args, reason, rpcId) {
    const step = steps;
    const startMono = log.now();
    const action = log.append('action', { step, tool, args, ...(rpcId === undefined ? {} : { rpcId }) });
    const result = { ok: false, refused: true, error: `refused: ${reason}`, actionSeq: action.seq };
    log.append('refusal', { step, tool, error: result.error, startMono, actionSeq: action.seq });
    return result;
  }

  async function endRun(status, witness, gaps) {
    endLogged = true;
    await Promise.allSettled([...active.keys()]);
    await tools.close('run-ended');
    writeSummary(log);
    log.append('end', { status, steps, witness, ...(gaps === undefined ? {} : { gaps }) });
    rmSync(join(runDir, 'code'), { recursive: true, force: true });
  }

  async function inputEnded() {
    if (ended === null) stop('closed');
    await Promise.allSettled([...unansweredTurns]);
    if (!endLogged) await endRun(ended, null);
  }

  // A restart is not a finish. New calls are refused, background jobs and foreground shell groups are killed and logged
  // first, so no child outlives the worker, and no end event is written, so the next worker resumes this run. The supervisor
  // sends a restart only after every call has answered, so a call still active here means the worker was stopped
  // without a drain, such as a crash; its shell is killed, and the call settles with that result.
  async function quiesceForRestart() {
    ended = 'restarting';
    for (const call of waiting.splice(0)) call.resolveCall(refuse(call.name, call.args, endedReason()));
    await tools.close('restart');
    await Promise.allSettled([...active.keys()]);
  }

  return { accept, inputEnded, quiesceForRestart };
}

// The answer to every request id that a run already received, rebuilt from its log, so a repeated id is answered from
// the log and never run again. An action with no end event was interrupted by a restart, and its repeat gets an error.
// The seq of the last next_context action in the log. A worker reports every job that ended after it, so a job that a
// restart stopped, which the old worker logged, is named by the first next_context of the new worker.
function lastContextSeq(events) {
  let seq = 0;
  for (const event of events) if (event.kind === 'action' && event.tool === 'next_context') seq = event.seq;
  return seq;
}

// A job that ended since the last next_context: its state, exit code, and the first page of its output. next is the offset of the next
// page for job_status, or null when the output fits on this page.
async function endedJob(runDir, event) {
  const text = event.body !== undefined
    ? await bodyResult(runDir, event.job)
    : await readFile(join(runDir, 'jobs', `${event.job}.out`), 'utf8').catch(() => '');
  return {
    seq: event.seq,
    job: event.job,
    state: event.state,
    exitCode: event.exitCode,
    signal: event.signal,
    output: text.slice(0, OUTPUT_PAGE),
    next: text.length > OUTPUT_PAGE ? OUTPUT_PAGE : null,
  };
}

// A background run's result, from its status file: its value, or its error when it failed. The job event in the log carries the state only.
async function bodyResult(runDir, job) {
  const status = JSON.parse(await readFile(join(runDir, 'jobs', `${job}.json`), 'utf8').catch(() => '{}'));
  return status.value ?? status.error ?? '';
}

function answersFrom(events) {
  const ends = new Map();
  for (const event of events) {
    if ((event.kind === 'result' || event.kind === 'refusal') && event.actionSeq !== undefined) ends.set(event.actionSeq, event);
  }
  const answers = new Map();
  for (const action of events) {
    if (action.kind !== 'action' || action.rpcId === undefined) continue;
    const end = ends.get(action.seq);
    let out;
    if (end === undefined) out = { ok: false, error: 'the call was interrupted by a restart; check its outside effects before repeating it' };
    else if (end.kind === 'refusal') out = { ok: false, refused: true, error: end.error };
    else out = outputOf(end);
    answers.set(JSON.stringify(action.rpcId), { content: [{ type: 'text', text: JSON.stringify(out) }], isError: out.ok !== true });
  }
  return answers;
}

const LOG_FIELDS = new Set(['seq', 't', 'mono', 'inFlight', 'kind', 'step', 'tool', 'startMono', 'durMs', 'actionSeq', 'rpcId']);

function outputOf(event) {
  return Object.fromEntries(Object.entries(event).filter(([key]) => !LOG_FIELDS.has(key)));
}

// The open actions of a resumed run: actions with no result or refusal. Only runs whose events carry actionSeq are
// read, because older events cannot say which action an end belongs to.
function recoveryOf(events) {
  const first = events.findIndex((event) => event.actionSeq !== undefined || event.rpcId !== undefined);
  const lastSeq = events.length ? events.at(-1).seq : 0;
  if (first < 0) return { lastSeq, open: [] };
  // A body's verb closes its start with a code-call that names the start, as a top-level call closes its start with a result.
  const ended = new Set(events.filter((event) => (event.kind === 'result' || event.kind === 'refusal' || event.kind === 'code-call') && event.actionSeq !== undefined).map((event) => event.actionSeq));
  const open = events.slice(first).filter((event) => event.kind === 'action' && !ended.has(event.seq)).map((event) => ({ seq: event.seq, tool: event.tool, args: event.args }));
  return { lastSeq, open };
}

// The recovery note the next next_context carries after a resume. It names the open actions and asks the model to
// verify their outside effects before repeating any of them.
function recoveryNote(recovery) {
  const list = recovery.open.map((action) => `seq ${action.seq} ${action.tool} ${JSON.stringify(action.args)}`).join('; ');
  return {
    lastSeq: recovery.lastSeq,
    open: recovery.open,
    note: `This run resumed after a restart, at last seq ${recovery.lastSeq}. These actions started and have no end event: ${list}. Before you repeat any of them, check the outside effects: git log and git status, the remote, and the row files under work/rows. Do not repeat a push, a commit, a fetch that posted, or a row resolve unless those checks show that it did not happen.`,
  };
}

// Where a resumed run stands: the steps it has taken, and whether it already ended.
function resumeFrom(events) {
  const steps = events.filter((event) => event.kind === 'result' && event.tool === 'next_context' && event.ok === true).length;
  const end = events.findLast((event) => event.kind === 'end');
  return { steps, ended: end ? end.status : null };
}

// The tools that only read. Every other tool is a side effect: its start is flushed before it runs (see perform and innerCall), so recovery
// can list it as open after a crash. A tool that is not on this list is treated as a side effect.
const READ_ONLY_TOOLS = new Set([
  'next_context', 'read_file', 'list_dir', 'stat_file', 'search', 'wiki_search', 'grep', 'callers', 'impact', 'query_log', 'job_status',
  'git_status', 'git_log', 'git_diff', 'git_show', 'ci_status', 'prd_list', 'unknown_list', 'review_join',
]);
// Actions that run once the reply they belong to is written, such as the removal of pending events the reply delivered.
const afterReply = [];
// A reply is written only after the events so far are in the log, so the log holds every event a reply reports.
function write(message) {
  flushAllLogs();
  process.stdout.write(`${JSON.stringify(message)}\n`);
  for (const done of afterReply.splice(0)) done();
}

function errorReply(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function isRequestShape(message) {
  return message !== null && typeof message === 'object' && !Array.isArray(message) && typeof message.method === 'string';
}

// The lifecycle events the worker writes. A code call is cut in the second horizon. The other kinds use the defaults in compact.mjs.
const SELF_COMPACT = {
  tools: { next_context: { zone1: resultZone1, zone2: resultZone2 } },
};
// The surface of the running worker, built at boot from the leaf modules. activeTools and activeLog are the session's, set when it starts.
let current = surfaceOf(await loadLeaves());
let activeTools = null;
let activeLog = null;

// A reload applies the leaf modules' new code between calls. The surface and the session's verbs are built from the new modules before anything
// is replaced, so a build that fails leaves the old code serving, and the core is told why. Runs, jobs and the log are not touched.
async function reloadLeaves() {
  try {
    const generation = bumpGeneration();
    const next = surfaceOf(await loadLeaves());
    activeTools?.setLeaves(next.leaves);
    current = next;
    activeLog?.append('reload', { generation, modules: RELOADABLE });
    return { ok: true, generation, reloaded: RELOADABLE };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    const value = argv[i + 1];
    if (!name?.startsWith('--') || value === undefined || value.startsWith('--')) throw new Error(USAGE);
    flags[name.slice(2)] = value;
  }
  return flags;
}

// The hash of the served tool list is logged at each start. A resumed run whose list differs from its last start
// gets a tools-changed event with both hashes. A changed description invalidates the host's prompt cache, so the
// log shows when it happens.
// At a server start, the body directories of runs that have already ended are deleted. A run with no end event is left alone,
// because it may still be resumed.
function sweepEndedCode(runsRoot, current) {
  if (!existsSync(runsRoot)) return;
  for (const name of readdirSync(runsRoot)) {
    const dir = join(runsRoot, name);
    if (dir === current || !existsSync(join(dir, 'log.jsonl'))) continue;
    const ended = readFileSync(join(dir, 'log.jsonl'), 'utf8').split('\n').some((line) => line !== '' && JSON.parse(line).kind === 'end');
    if (ended) rmSync(join(dir, 'code'), { recursive: true, force: true });
  }
}

function logTools(log, resumed, served) {
  const sha = createHash('sha256').update(JSON.stringify(served)).digest('hex');
  const last = resumed ? log.events().findLast((event) => event.kind === 'tools') : undefined;
  if (last && last.sha !== sha) log.append('tools-changed', { old: last.sha, new: sha });
  log.append('tools', { sha, count: served.length });
}

function positiveInt(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${name} must be a positive integer`);
  return number;
}

async function main(argv) {
  const flags = parseFlags(argv);
  if (!flags.workspace) throw new Error(USAGE);
  const workspace = resolve(flags.workspace);
  if (!isDirectory(workspace)) throw new Error(`workspace is not a directory: ${workspace}`);
  const maxSteps = positiveInt(flags['max-steps'] ?? DEFAULT_MAX_STEPS, '--max-steps');
  const maxInflight = positiveInt(flags['max-inflight'] ?? DEFAULT_MAX_INFLIGHT, '--max-inflight');
  const jobLifetimeMs = positiveInt(flags['job-lifetime-ms'] ?? DEFAULT_JOB_LIFETIME_MS, '--job-lifetime-ms');
  const stuckMs = positiveInt(flags['stuck-ms'] ?? DEFAULT_STUCK_MS, '--stuck-ms');
  const monitorMs = positiveInt(flags['monitor-ms'] ?? DEFAULT_MONITOR_MS, '--monitor-ms');
  const noticeMs = positiveInt(flags['notice-ms'] ?? BODY_NOTICE_MS, '--notice-ms');
  const hostIdleMs = positiveInt(flags['host-idle-ms'] ?? DEFAULT_HOST_IDLE_MS, '--host-idle-ms');
  const surface = flags.surface ?? 'code';
  if (!SURFACES.includes(surface)) throw new Error('--surface takes tools or code');
  // Without --task, the run's task is the prompt the session sends (the gm prompt's task argument), and the run says so in its start event.
  let task = flags.task === undefined ? '' : loadTask(flags.task).trim();
  if (flags.task !== undefined && task === '') throw new Error('--task is empty');

  let runDir = flags['run-dir'] === undefined ? join(workspace, 'runs', newRunId()) : resolve(flags['run-dir']);
  const runMeta = (dir) => ({ id: basename(dir), mode: 'mcp', task, witness: DEFAULT_WITNESS, workspace, maxSteps, maxInflight, createdAt: new Date().toISOString() });
  let { log, resumed } = openRun({ runDir, rules: MCP_RULES, meta: runMeta(runDir) });
  let resume = resumed ? resumeFrom(log.events()) : null;
  if (resume?.ended) {
    // A closed run stays closed. A start after it opens a new run beside it, with the same task and workspace.
    const closed = `${basename(runDir)} (${resume.ended})`;
    runDir = join(dirname(runDir), newRunId());
    ({ log, resumed } = openRun({ runDir, rules: MCP_RULES, meta: runMeta(runDir) }));
    resume = null;
    console.error(`gm mcp: run${closed} is closed; opened run ${basename(runDir)}`);
  }
  const history = resumed ? log.events() : [];
  // A resumed run that was started without a task takes the task its session gave, from its task event.
  if (task === '' && resumed) task = history.findLast((event) => event.kind === 'task')?.text ?? '';
  const recovery = resumed ? recoveryOf(history) : null;
  if (resumed) log.append('restart', { reason: flags['restart-reason'] ?? 'restarted without a reason' });
  else log.append('start', { mode: 'mcp', maxSteps, maxInflight, taskFrom: flags.task === undefined ? 'session prompt' : 'task file' });
  if (recovery && recovery.open.length > 0) log.append('recovery', { lastSeq: recovery.lastSeq, open: recovery.open });
  logTools(log, resumed, servedTools(surface));

  sweepEndedCode(dirname(runDir), runDir);
  const session = createSession({ workspace, runDir, log, task, maxSteps, maxInflight, resume, jobLifetimeMs, stuckMs, monitorMs, noticeMs, hostIdleMs, recovery: recovery && recovery.open.length > 0 ? recovery : null, history, surface });
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on('line', session.accept);
  // Under a supervisor, the end of stdin means the supervisor has gone, so the run is paused. Closing it here would end the
  // run as closed, and a closed run stays closed. A paused run has no end event, and the next start resumes it.
  let pausing = null;
  const pauseRun = (reason) => {
    pausing ??= session.quiesceForRestart().then(() => log.append('paused', { reason })).finally(() => process.exit(0));
    return pausing;
  };
  lines.on('close', () => (flags.supervised === 'yes' ? pauseRun('the supervisor ended stdin') : session.inputEnded().catch((err) => console.error(`gm: ${err.message}`))));
  process.once('SIGINT', () => lines.close());
  process.once('SIGTERM', () => pauseRun('SIGTERM from the supervisor'));
  process.stdout.on('error', (err) => console.error(`gm: stdout: ${err.message}`));
  console.error(`gm mcp: run${basename(runDir)} in ${runDir}`);
}

main(process.argv.slice(2)).catch((err) => {
  console.error(`gm mcp: ${err.message}`);
  process.exitCode = 1;
});
