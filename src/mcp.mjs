#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { DEFAULT_WITNESS, MCP_RULES, prefixShaOf, renderTools } from './prompt.mjs';
import { connectReply, SERVER_NAME } from './connect.mjs';
import { currentRunDir, isDirectory, loadTask, newRunId, openRun, ROOT, setSuccessor } from './run.mjs';
import { flushAllLogs } from './log.mjs';
import { clearPending, hasPending, offPendingAppended, onPendingAppended, takePending } from './pending.mjs';
import { conflicts, createTools, loggedFor, OUTPUT_PAGE, DEFAULT_STUCK_MS, DEFAULT_MONITOR_MS, BODY_NOTICE_MS } from './tools.mjs';
import { bumpGeneration } from './hot.mjs';
import { RELOADABLE } from './hot-config.mjs';
import { SEARCH_TOOLS } from './search.mjs';
import { runBody, runCodeTool, RUN_CODE_PROPERTIES } from './runcode.mjs';
import { bodyContext } from './exec.mjs';
import { readServerConfig, startMcpClients } from './mcp-client.mjs';
import { COMPACT as SEARCH_COMPACT } from './search.mjs';
import { COMPACT as RUNCODE_COMPACT } from './runcode.mjs';
import { COMPACT as TOOLS_COMPACT } from './tools.mjs';
import { feedOf, registryOf, resultZone1, resultZone2, shownTotalOf } from './compact.mjs';
import { writeSummary } from './summary.mjs';
import { parseSkill, SERVED_SKILLS } from './skills.mjs';

// The protocol versions this server negotiates, newest first. An initialize that asks for another version is answered with the newest.
const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18'];
const PROTOCOL_VERSION = SUPPORTED_VERSIONS[0];
// The key of a tools/call result's run id: a vendor key in reverse-DNS form, owner decision O3. Results carry it; errors do not.
const RUN_META = 'com.anentrypoint.gmnew/run';
// Trace context a tools/call request may carry in _meta (W3C Trace Context and Baggage). It is copied into that call's action event.
const TRACE_KEYS = ['traceparent', 'tracestate', 'baggage'];
// A foreground shell whose request names a progress token reports its elapsed seconds this often.
const PROGRESS_MS = 5000;
const SERVER_INFO = { name: SERVER_NAME, version: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version };
// The served skills (SEP-2640) are read on each request, so an edit under skills/ is served without a restart. Each skill's files are listed
// and read from its directory: every file is a resource with a sha256 digest and a size, and SKILL.md is the skill's uri. A file caught
// mid-write keeps the last read of that skill that succeeded. Before a skill has read cleanly, the error reaches the caller.
const GM_SKILL_URI = 'skill://gm/SKILL.md';
const lastSkill = new Map();
function skillOf(name) {
  try {
    const entry = readSkill(name);
    lastSkill.set(name, entry);
    return entry;
  } catch (err) {
    if (!lastSkill.has(name)) throw err;
    return lastSkill.get(name);
  }
}
function readSkill(name) {
  const dir = join(ROOT, 'skills', name);
  const files = filesUnder(dir).map((path) => {
    const bytes = readFileSync(join(dir, path));
    return { path, uri: `skill://${name}/${path}`, bytes, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, size: bytes.length, mimeType: path.endsWith('.md') ? 'text/markdown' : 'text/plain' };
  });
  const skillMd = files.find((file) => file.path === 'SKILL.md');
  if (skillMd === undefined) throw new Error(`skills/${name}/SKILL.md is missing`);
  const { frontmatter, body } = parseSkill(skillMd.bytes.toString('utf8'), name);
  return { name, uri: skillMd.uri, frontmatter, body, files };
}
// The files under a directory, relative to it with / separators on every platform, sorted.
function filesUnder(dir, rel = '') {
  const files = [];
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const path = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) files.push(...filesUnder(dir, path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}
// The entry that skills/list and skills/get return: the uri, the frontmatter as read, and each file with its digest and size.
function skillEntry(skill) {
  return { uri: skill.uri, frontmatter: skill.frontmatter, resources: skill.files.map(({ uri, digest, size }) => ({ uri, digest, size })) };
}
// The resource of one file. SKILL.md is named by its frontmatter, as the SEP asks, and any other file by its path.
function resourceOf(skill, file) {
  if (file.path !== 'SKILL.md') return { uri: file.uri, name: file.path, mimeType: file.mimeType };
  return { uri: file.uri, name: skill.frontmatter.name, description: skill.frontmatter.description, mimeType: file.mimeType };
}
function resourceList() {
  return SERVED_SKILLS.flatMap((name) => {
    const skill = skillOf(name);
    return skill.files.map((file) => resourceOf(skill, file));
  });
}
// The served file a skill:// uri names, with its skill, or null when no served skill has that file.
function skillFileOf(uri) {
  const match = typeof uri === 'string' ? /^skill:\/\/([^/]+)\//.exec(uri) : null;
  if (match === null || !SERVED_SKILLS.includes(match[1])) return null;
  const skill = skillOf(match[1]);
  const file = skill.files.find((candidate) => candidate.uri === uri);
  return file === undefined ? null : { skill, file };
}
// skills/get: the entry of one served skill, named by its SKILL.md uri. Any other uri is -32602, as resources/read refuses an unknown one.
function skillGet(params) {
  const match = typeof params?.uri === 'string' ? /^skill:\/\/([^/]+)\/SKILL\.md$/.exec(params.uri) : null;
  if (match === null || !SERVED_SKILLS.includes(match[1])) throw new RpcError(-32602, `unknown skill: ${params?.uri}`);
  return { resultType: 'complete', skill: skillEntry(skillOf(match[1])) };
}
// The prompts are the served skills, read on each request. The gm prompt takes the run's task, which its session prompt gives to a run
// started without --task. The gm-continue prompt takes no argument.
const PROMPT_TITLES = { gm: 'gm run', 'gm-continue': 'gm continue' };
const TASK_ARGUMENT = { name: 'task', description: 'The task to run', required: false };
function skillPrompt(name) {
  const SKILL = skillOf(name);
  const prompt = { name, title: PROMPT_TITLES[name], description: SKILL.frontmatter.description };
  return name === 'gm' ? { ...prompt, arguments: [TASK_ARGUMENT] } : prompt;
}
// The result of a prompts/get: the skill's description, and its text as one user message.
function promptResult(SKILL, text) {
  return { description: SKILL.frontmatter.description, messages: [{ role: 'user', content: { type: 'text', text } }] };
}
const DEFAULT_MAX_STEPS = 50;
const REPLY_MEMORY = 256;
const DEFAULT_MAX_INFLIGHT = 8;
const DEFAULT_JOB_LIFETIME_MS = 1800000;
// The most open jobs a next_context reply lists. The rest are counted in jobsOpenMore.
const OPEN_LIST = 20;
const USAGE = 'usage: node src/mcp.mjs --workspace <dir> [--task <file-or-text>] [--run-dir <dir>] [--max-steps N] [--max-inflight N] [--job-lifetime-ms N] [--stuck-ms N] [--monitor-ms N] [--notice-ms N] [--host-idle-ms N] [--surface tools|code] [--mcp-config <file>]';
// A host that stops calling is noticed after this long with no call in flight (--host-idle-ms). next_context waitMs is capped here, because a host cuts a call that runs too long.
const DEFAULT_HOST_IDLE_MS = 600000;
const MAX_WAIT_MS = 300000;
const DEFAULT_MCP_CONFIG = join(ROOT, 'defaults', 'mcp.json');

const text = { type: 'string' };
const number = { type: 'number' };
const objectSchema = (properties, required = []) => ({ type: 'object', properties, required });

const BASE_TOOLS = [
  { name: 'next_context', description: 'Begin a step. Returns rules, task, witness requirement, the events new since the last step in full, the older ones in compact form within two horizons, and prefixSha. pending lists the events that need you since your last step, each once, with an id. Delivery clears an event, so no later step or wait lists it again. Call it at the start of each step. query_log reaches every event. waitMs, when set, holds this call until an event is pending or that many milliseconds pass, at most 300000. child: true makes the call a read by a subagent on this connection: it takes no step, claims no pending event, and its reply has role child and the owning run. run, with child, names that owning run, and another run is refused.', inputSchema: objectSchema({ waitMs: number, child: { type: 'boolean' }, run: text }) },
  { name: 'read_file', description: 'Read a text file, inside or outside the workspace, one page of at most 20000 characters. Lines are the default unit: offset is a 0-based line index, limit a line count (default: as many whole lines as fit), and total (the file in lines) and next (the line index of the next page, null at the end) count lines. truncated is true when the page stops before the end, totalBytes is the file size in bytes, and hint names the read that gets the rest. A line longer than the page is cut to its first 20000 characters, with cutLine true, and next is the line after it. unit "chars" counts offset, limit (1 to 20000, default 20000), total and next in characters instead. A path that starts with skill:// reads a served skill file, the text resources/read returns, and a skill:// uri that no served skill has is an error that names it.', inputSchema: objectSchema({ path: text, offset: number, limit: number, unit: text }, ['path']) },
  { name: 'write_file', description: 'Write a text file, inside or outside the workspace, creating parent directories.', inputSchema: objectSchema({ path: text, content: text }, ['path', 'content']) },
  { name: 'edit_file', description: 'Replace old with new in a text file, inside or outside the workspace. old must occur once, unless replaceAll is true.', inputSchema: objectSchema({ path: text, old: text, new: text, replaceAll: { type: 'boolean' } }, ['path', 'old', 'new']) },
  { name: 'stat_file', description: 'Type, size and mtime of a path, inside or outside the workspace, as JSON.', inputSchema: objectSchema({ path: text }, ['path']) },
  { name: 'list_dir', description: 'List a directory, inside or outside the workspace. Directories end with "/".', inputSchema: objectSchema({ path: text }) },
  { name: 'run_shell', description: 'Run a shell command in the workspace and wait for it. Default timeout 60000 ms. Its process group is killed when it returns, so background work must go through job_start.', inputSchema: objectSchema({ command: text, timeoutMs: number }, ['command']) },
  { name: 'job_start', description: 'Start a shell command as a named background job and return at once. Poll it with job_status.', inputSchema: objectSchema({ job: text, command: text, timeoutMs: number }, ['job', 'command']) },
  { name: 'job_status', description: 'State (running, exited or killed), exitCode, signal and output of a job as plain fields, with logPath (the job output file). output is the last 20000 characters, with total (its length) and truncated; with offset, output is the 20000 characters from that offset, with next. waitMs polls until the job leaves running, at most 30000 ms. Offsets and lengths count characters, not lines.', inputSchema: objectSchema({ job: text, waitMs: number, offset: number }, ['job']) },
  { name: 'job_stop', description: 'Stop a background shell job: its process group is killed, and the job ends killed with reason cancelled. The job event is logged before the answer. A job that already ended is an error result. stopBackground stops run_code bodies only.', inputSchema: objectSchema({ job: text }, ['job']) },
  { name: 'query_log', description: 'Read the run events, as JSON. after is a seq: only the events after it are read (since), so after the last seq you saw reads on from there. kind keeps events of one kind, and fromMono and toMono keep events in a time window (monotonic milliseconds). last N returns the newest N matching events instead, oldest first, at most 50, and has no next. js is a JavaScript expression over the matching events, and defaults to returning them: js sees one window of at most 1000 events or 4 MB of log. Without js, a reply holds at most 50 events and about 20 KB; limit (1 to 50) lowers that count, and is refused with last or js. When events remain, next is the seq to pass back as after; with js, next is set when the window ends before the end of the log. An unknown argument is refused, and the reply names the arguments query_log takes.', inputSchema: objectSchema({ js: text, kind: text, fromMono: number, toMono: number, after: number, last: number, limit: number }, []) },
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
  ].map(annotated);
  const VERBS = [...TOOLS.filter((tool) => !CODE_SURFACE.has(tool.name)), ...mcp.verbs()];
  const CODE_LIST = [...TOOLS.filter((tool) => tool.name === 'next_context' || tool.name === 'finish'), annotated(runCodeTool(VERBS.map((tool) => tool.name)))];
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

// A protocol error. data, when given, is the error's data member (resources/read names the uri it did not find).
class RpcError extends Error {
  constructor(code, message, data = undefined) {
    super(message);
    this.code = code;
    this.data = data;
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

function queryHintOf(shown, total) {
  const reach = 'query_log reads any event (after: seq - 1 returns it first)';
  return total > shown ? `${reach}. This step's new events are seqs ${shown + 1} to ${total}.` : `${reach}.`;
}

function createSession({ workspace, runDir, log, task, maxSteps, maxInflight, resume = null, jobLifetimeMs = DEFAULT_JOB_LIFETIME_MS, stuckMs = DEFAULT_STUCK_MS, monitorMs = DEFAULT_MONITOR_MS, noticeMs = BODY_NOTICE_MS, hostIdleMs = DEFAULT_HOST_IDLE_MS, recovery = null, history = [], taskInherited = false, startOverride = null, surface = 'code' }) {
  const runId = basename(runDir);
  const tools = createTools({ workspace, runDir, log, background: true, jobLifetimeMs, stuckMs, monitorMs, noticeMs, leaves: current.leaves, serveSkill: (uri) => serveSkillFile(uri, 'read_file') });
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
  // The tools/call requests in flight, by id: the call's name, its trace context, and the controller that a cancel aborts. A cancelled request
  // is listed in cancelled, so handleLine drops its reply.
  const inFlightCalls = new Map();
  const cancelled = new Set();
  const callOf = (rpcId) => inFlightCalls.get(JSON.stringify(rpcId));
  const signalOf = (rpcId) => callOf(rpcId)?.controller.signal;
  for (const [key, reply] of answersFrom(history, runId)) remember(key, Promise.resolve(reply));
  let steps = resume?.steps ?? 0;
  let ended = resume?.ended ?? null;
  let stepLimited = false;
  let endedTask = null;
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
  // The rules watchdog. It notices the rule breaks it can see: a call before the run's first next_context (rule 2), a finish with no call
  // in its step (rule 3), and a finish refused for its witness (rule 4). An open notice is
  // carried in the reply of each call and in next_context until the agent loads the skill again, which clears them all.
  const rulesOpen = new Map();
  let runStarted = steps > 0;
  let stepCalls = 0;
  // Rule 1 has no check: a path outside the workspace is allowed, so a refusal of one is not a breach of it.
  const RULE_TEXT = { 2: 'call next_context at the start of every step', 3: 'verify before you finish', 4: 'finish needs a witness' };
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
    return `The rules check found: ${lines.join('; ')}. Read the gm skill again with ReadMcpResourceTool (server gm, uri skill://gm/SKILL.md) and follow the rules it gives. That one read clears this notice. Do not repeat finished work.`;
  }

  const handlers = {
    read_file: (args) => tools.run('read_file', args),
    write_file: (args) => tools.run('write_file', args),
    list_dir: (args) => tools.run('list_dir', args),
    run_shell: ({ command, timeoutMs }, signal) => tools.run('run_shell', { command, timeoutMs }, { signal }),
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
    const exec = mcp.has(name) ? (value) => mcp.call(name, value) : Object.hasOwn(handlers, name) ? handlers[name] : (value) => tools.run(name, value);
    let result;
    try {
      result = await exec(args);
    } catch (err) {
      result = { ok: false, error: err.message };
    } finally {
      if (body !== undefined) tools.callEnded(body);
    }
    // The full result is logged, so query_log reaches the output and the exit code of a verb called inside a body.
    const shown = loggedFor(name, result);
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
      // A cancelled foreground shell gets no answer. Its call ended with its kill, and cancelRequest listed its id.
      if (key !== null && cancelled.delete(key)) return null;
      return request ? { jsonrpc: '2.0', id: message.id, result: result ?? {} } : null;
    } catch (err) {
      if (!request) return null;
      const code = err instanceof RpcError ? err.code : -32603;
      log.append('error', { method: message.method, code, message: err.message });
      return errorReply(message.id, code, err.message, err.data);
    }
  }

  async function route(method, params, rpcId) {
    if (method === 'initialize') return initialize(params);
    // server/discover is not served (owner decision: -32601 until a modern path exists), so it falls through to method not found.
    if (method === 'ping') return {};
    await mcpReady;
    if (method === 'tools/list') return { tools: servedTools(surface) };
    if (method === 'tools/call') {
      touch();
      return callTool(params, rpcId);
    }
    if (method === 'prompts/list') return { prompts: SERVED_SKILLS.map((name) => skillPrompt(name)) };
    if (method === 'prompts/get') return getPrompt(params);
    if (method === 'resources/list') return { resources: resourceList() };
    if (method === 'resources/read') return readResource(params);
    if (method === 'skills/list') return { resultType: 'complete', skills: SERVED_SKILLS.map((name) => skillEntry(skillOf(name))) };
    if (method === 'skills/get') return skillGet(params);
    if (method === 'resources/templates/list') return { resourceTemplates: [] };
    if (method === 'core/reload') return reloadLeaves();
    if (method === 'notifications/cancelled') {
      cancelRequest(params?.requestId);
      return null;
    }
    if (method.startsWith('notifications/')) return null;
    throw new RpcError(-32601, `method not found: ${method}`);
  }

  // The version the host asked for, when this server negotiates it; otherwise the newest version this server speaks (lifecycle page).
  function initialize(params) {
    const asked = params?.protocolVersion;
    const version = SUPPORTED_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSION;
    return { protocolVersion: version, ...connectReply(surface), serverInfo: SERVER_INFO };
  }

  function getPrompt(params) {
    const name = params?.name;
    if (!SERVED_SKILLS.includes(name)) throw new RpcError(-32602, `unknown prompt: ${name}`);
    // The gm-continue prompt is the skill's text. It sets no task and clears no notice, so its fetch is logged with no rule cleared: an ordinary load.
    if (name !== 'gm') {
      const other = skillOf(name);
      log.append('skill-loaded', { via: 'prompt', skill: name, cleared: [] });
      return promptResult(other, other.body);
    }
    const SKILL = skillOf('gm');
    // Loading the skill again is what the notice asks for, so it clears the open notices. Each fetch is logged, so a live run can count them.
    log.append('skill-loaded', { via: 'prompt', skill: 'gm', cleared: [...rulesOpen.keys()] });
    clearRules();
    const given = typeof params?.arguments?.task === 'string' ? params.arguments.task.trim() : '';
    if (given !== '' && ended !== null) endedTask = given;
    else if (given !== '' && (task === '' || taskInherited)) {
      task = given;
      taskInherited = false;
      log.append('task', { from: 'session prompt', text: task });
    }
    const text = given === '' ? SKILL.body : `${SKILL.body}\n\nTask: ${given}`;
    return promptResult(SKILL, text);
  }

  function readResource(params) {
    const served = serveSkillFile(params?.uri, 'resource');
    // A missing resource is -32002 with its uri, as the 2025-11-25 page says. A uri with a .. segment is not served, so it is not found either.
    if (!served.ok) throw new RpcError(-32002, `resource not found: ${params?.uri}`, { uri: params?.uri });
    return { contents: [{ uri: served.uri, mimeType: served.mimeType, text: served.output }] };
  }

  function serveSkillFile(uri, via) {
    const found = skillFileOf(uri);
    if (found === null) return { ok: false, error: `no served skill file has the uri ${uri}` };
    const isGm = found.file.uri === GM_SKILL_URI;
    log.append('skill-loaded', { via, skill: found.skill.name, uri: found.file.uri, cleared: isGm ? [...rulesOpen.keys()] : [] });
    if (isGm) clearRules();
    return { ok: true, output: found.file.bytes.toString('utf8'), uri: found.file.uri, mimeType: found.file.mimeType };
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
  }

  async function callTool(params, rpcId) {
    const name = params?.name;
    const args = params?.arguments ?? {};
    if (typeof name !== 'string') throw new RpcError(-32602, 'tools/call needs a string name');
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      throw new RpcError(-32602, 'tools/call arguments must be an object');
    }
    // A name the surface does not serve is a protocol error, not a tool result. A tool that fails keeps isError true (below).
    if (!servedTools(surface).some((tool) => tool.name === name)) throw new RpcError(-32602, unknownToolText(name));
    if (!runStarted && ended === null && name !== 'next_context' && name !== 'finish') noteRule(2, `${name} was called before the first next_context of the run`);
    const meta = params?._meta ?? {};
    const key = JSON.stringify(rpcId);
    inFlightCalls.set(key, { name, trace: traceOf(meta), controller: new AbortController() });
    const stopProgress = progressFor(name, meta.progressToken);
    let out;
    try {
      out = await startCall(name, args, rpcId);
    } finally {
      inFlightCalls.delete(key);
      stopProgress();
    }
    watchCall(name, out);
    const notice = rulesNotice();
    const payload = notice === null ? out : { ...out, rulesNotice: notice };
    return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: out.ok !== true, _meta: { [RUN_META]: runId } };
  }

  // The message of an unknown tool. The code surface keeps its guidance: a verb is a function on gm, called inside run_code.
  function unknownToolText(name) {
    const guidance = surface === 'code' ? '; the code surface serves next_context, run_code and finish; call a verb as gm.<name>(args) inside run_code' : '';
    return `Unknown tool: ${name}${guidance}`;
  }

  // A foreground shell whose request names a progress token reports every PROGRESS_MS: progress is the elapsed seconds, which rise at each
  // report, and the message says how long the shell has run. The timer stops when the call ends.
  function progressFor(name, token) {
    if (name !== 'run_shell' || (typeof token !== 'string' && !Number.isInteger(token))) return () => {};
    const started = Date.now();
    let last = 0;
    const timer = setInterval(() => {
      last = Math.max(last + 1, Math.floor((Date.now() - started) / 1000));
      notify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token, progress: last, message: `running ${last} s` } });
    }, PROGRESS_MS);
    return () => clearInterval(timer);
  }

  // notifications/cancelled. A foreground run_shell is killed, and its request gets no answer (handleLine). Any other cancelled request runs on:
  // a read-only verb has no effect to undo, and a side-effecting verb must finish its effect. Each cancel that is not honoured is logged.
  function cancelRequest(requestId) {
    const key = JSON.stringify(requestId);
    const call = inFlightCalls.get(key);
    if (call === undefined) {
      log.append('cancel-ignored', { requestId, reason: 'no call in flight with that id' });
      return;
    }
    if (call.name === 'run_shell') {
      cancelled.add(key);
      call.controller.abort();
      log.append('cancel', { requestId, tool: call.name, reason: 'foreground shell killed; no answer is sent' });
      return;
    }
    log.append('cancel-ignored', { requestId, tool: call.name, reason: READ_ONLY_TOOLS.has(call.name) ? 'read-only verb' : 'side-effecting verb' });
  }

  function startCall(name, args, rpcId) {
    return new Promise((resolveCall) => {
      waiting.push({ name, args, resolveCall, rpcId });
      drain();
    });
  }

  function drain() {
    if (ended !== null) {
      for (const call of waiting.splice(0)) call.resolveCall(refuse(call.name, call.args, endedReason(isChildRead(call.name, call.args)), call.rpcId));
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

  function isChildRead(name, args) {
    return name === 'next_context' && args.child === true;
  }

  function stop(status) {
    ended = status;
    drain();
  }

  function stepLimitText() {
    return `step limit ${maxSteps} reached; a restart of the server opens a new run`;
  }

  function endedReason(child = false) {
    if (stepLimited) return stepLimitText();
    if (ended === 'closed') return 'stdin closed before the call started';
    if (ended === 'restarting') return 'the server is restarting; repeat the call';
    if (child) return `run ${runId} has ended; the session that opened it calls next_context to open the next run`;
    return `run ${runId} has ended; call next_context to open a new run`;
  }

  function invoke(name, args, access, rpcId) {
    if (ended !== null) return refuse(name, args, endedReason(isChildRead(name, args)), rpcId);
    // A call cancelled while it waited for a slot never starts.
    if (signalOf(rpcId)?.aborted === true) return refuse(name, args, 'cancelled before it started', rpcId);
    if (name === 'run_code') {
      // A wrong argument name is refused by name. The run_code reply names its action, which is the seq of the action event, so a body can cite it.
      const unknown = Object.keys(args).filter((key) => !Object.hasOwn(RUN_CODE_PROPERTIES, key));
      if (unknown.length > 0) return refuse(name, args, `unknown argument ${unknown.join(', ')}; run_code takes ${Object.keys(RUN_CODE_PROPERTIES).join(', ')}`, rpcId);
      return act('run_code', args, access, (actionSeq) => runBody({ body: args.body, timeoutMs: args.timeoutMs, format: args.format, verbs: current.VERBS, call: innerCall, project: workspace, runDir, log, step: steps, background: (handle) => tools.adoptBody(handle) }).then((reply) => ({ ...reply, actionSeq })), undefined, rpcId);
    }
    if (name === 'next_context') return args.child === true ? childContext(access, rpcId, args) : nextContext(access, rpcId, args);
    if (name === 'finish') return finish(args, access, rpcId);
    if (Object.hasOwn(handlers, name)) return act(name, args, access, () => handlers[name](args, signalOf(rpcId)), (result) => loggedFor(name, result), rpcId);
    return act(name, args, access, () => tools.run(name, args, { signal: signalOf(rpcId) }), undefined, rpcId);
  }

  function childContext(access, rpcId, args) {
    if (!runStarted) return refuse('child_context', args, 'no step has started on this connection; the session that owns the run calls next_context first', rpcId);
    if (args.run !== undefined && args.run !== runId) return refuse('child_context', args, `this connection's run is ${runId}, not ${args.run}`, rpcId);
    return act('child_context', args, access, childRead, ({ ok, error, role, run }) => ({ ok, error, role, run }), rpcId);
  }

  async function childRead() {
    const rules = await readFile(join(runDir, 'rules.md'), 'utf8');
    return {
      ok: true,
      role: 'child',
      run: runId,
      note: `child of run ${runId}: the session that opened the run ends it, so a child does not send finish`,
      stepsLeft: maxSteps - steps,
      maxSteps,
      rules,
      task: task === '' ? null : task,
      prefixSha: prefixShaFor(rules),
      total: log.count(),
    };
  }

  async function nextContext(access, rpcId, args = {}) {
    if (steps >= maxSteps) {
      stepLimited = true;
      stop('max_steps');
      const out = refuse('next_context', {}, stepLimitText(), rpcId);
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
      return context(step, rpcId);
    }, ({ ok, error, prefixSha, total }) => ({ ok, error, prefixSha, total }), rpcId);
  }

  // The prefix is the same at every step, except for the rules, which are read again at each step. Its text is built and hashed only when
  // the rules change. A step whose rules are the same reuses the hash, so no step builds the tool text again.
  let prefixMemo = null;
  function prefixShaFor(rules) {
    if (prefixMemo === null || prefixMemo.surface !== current || prefixMemo.rules !== rules || prefixMemo.task !== task) prefixMemo = { surface: current, rules, task, sha: prefixShaOf({ rules, task, witness: DEFAULT_WITNESS, tools: renderTools(servedTools(surface)) }) };
    return prefixMemo.sha;
  }

  async function context(step, rpcId) {
    const rules = await readFile(join(runDir, 'rules.md'), 'utf8');
    const recoveryNow = pendingRecovery === null ? undefined : recoveryNote(pendingRecovery);
    pendingRecovery = null;
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
    const shown = shownTotalOf(log);
    const feed = feedOf(log, current.REGISTRY, { shown });
    const reply = {
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
      // The shell command that waits for the next event. It ends when it prints the queued events, and what it prints is cleared, so a host
      // that runs it as a background task or a Monitor is told each event once. It names the run directory, so it works from any directory.
      pendingCommands: {
        wait: `node "${join(ROOT, 'src', 'cli.mjs')}" events --dir "${runDir}" --wait`,
      },
      ...feed,
      query: queryHintOf(shown, log.count()),
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
    // The pending events are claimed last: nothing that can throw runs between the claim and the registration of its clear, so a step that
    // fails before this point claims nothing. The clear runs once the reply that carries the events is written, so a crash before that write
    // delivers them again.
    const taken = takePending(runDir);
    if (taken.records.length > 0) reply.pending = taken.records;
    if (taken.files.length > 0) afterReply.set(JSON.stringify(rpcId), () => clearPending(taken.files));
    return reply;
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
    const action = log.append('action', { step, tool, args, ...(rpcId === undefined ? {} : { rpcId, ...callOf(rpcId)?.trace }) });
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
    const action = log.append('action', { step, tool, args, ...(rpcId === undefined ? {} : { rpcId, ...callOf(rpcId)?.trace }) });
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
  async function pause(reason) {
    if (endLogged) return;
    ended = 'restarting';
    for (const call of waiting.splice(0)) call.resolveCall(refuse(call.name, call.args, endedReason()));
    await tools.close('restart');
    await Promise.allSettled([...active.keys()]);
    log.append('paused', { reason });
  }

  function successorStart() {
    if (endedTask !== null) return { task: endedTask, taskFrom: 'session prompt', inherited: false };
    if (startOverride !== null) return { ...startOverride, inherited: false };
    if (task !== '') return { task, taskFrom: `closed run ${runId}`, inherited: true };
    return { task: '', taskFrom: 'session prompt', inherited: false };
  }

  return { accept, inputEnded, pause, ended: () => ended, stepLimited: () => stepLimited, settled: () => Promise.allSettled([...unansweredTurns]), successorStart };
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

function answersFrom(events, runId) {
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
    answers.set(JSON.stringify(action.rpcId), { content: [{ type: 'text', text: JSON.stringify(out) }], isError: out.ok !== true, _meta: { [RUN_META]: runId } });
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

function taskOfRun(events, runDir) {
  const logged = events.findLast((event) => event.kind === 'task');
  if (logged !== undefined) return logged.text;
  const file = join(runDir, 'task.json');
  if (!existsSync(file)) return '';
  return JSON.parse(readFileSync(file, 'utf8')).task ?? '';
}

// The tools that only read. Every other tool is a side effect: its start is flushed before it runs (see perform and innerCall), so recovery
// can list it as open after a crash. A tool that is not on this list is treated as a side effect.
const READ_ONLY_TOOLS = new Set([
  'next_context', 'read_file', 'list_dir', 'stat_file', 'search', 'wiki_search', 'grep', 'callers', 'impact', 'query_log', 'job_status',
  'git_status', 'git_log', 'git_diff', 'git_show', 'ci_status', 'prd_list', 'unknown_list', 'review_join',
]);
// The tools that reach past the workspace: the open-world hint. A tool that only records the run (next_context, finish) is not destructive.
// Every tool carries a title and all three hints, set explicitly, so no host has to guess them.
const OPEN_WORLD = new Set(['fetch', 'git_fetch', 'git_pull', 'git_push', 'ci_status']);
const RECORDS_ONLY = new Set(['next_context', 'finish']);
// readOnlyHint is READ_ONLY_TOOLS, except next_context, which writes a step event. destructiveHint is true for a tool that is not read-only
// and does not only record the run.
function annotated(tool) {
  const readOnly = READ_ONLY_TOOLS.has(tool.name) && tool.name !== 'next_context';
  return { ...tool, title: titleOf(tool.name), annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly && !RECORDS_ONLY.has(tool.name), openWorldHint: OPEN_WORLD.has(tool.name) } };
}
// A title from a tool's name: read_file is "Read file".
function titleOf(name) {
  const words = name.replace(/_/g, ' ');
  return words[0].toUpperCase() + words.slice(1);
}

// The actions that run once the reply to a request is written, keyed by the request's id. A next_context reply clears the pending events it
// delivered, and only after its own write, so a crash before the write delivers them again.
const afterReply = new Map();
// A reply is written only after the events so far are in the log, so the log holds every event a reply reports.
function write(message) {
  flushAllLogs();
  process.stdout.write(`${JSON.stringify(message)}\n`);
  const key = JSON.stringify(message.id);
  const done = afterReply.get(key);
  if (done !== undefined) {
    afterReply.delete(key);
    done();
  }
}

function errorReply(id, code, message, data = undefined) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

// A notification goes out on stdout without running afterReply, which holds the actions of a reply that is not yet written.
function notify(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

// The trace context a request carries in _meta, the keys TRACE_KEYS that are strings. An absent key is left out.
function traceOf(meta) {
  return Object.fromEntries(TRACE_KEYS.filter((key) => typeof meta[key] === 'string').map((key) => [key, meta[key]]));
}

function isRequestShape(message) {
  return message !== null && typeof message === 'object' && !Array.isArray(message) && typeof message.method === 'string';
}

function requestIdOf(line) {
  try {
    const message = JSON.parse(line);
    return message !== null && typeof message === 'object' && Object.hasOwn(message, 'id') ? message.id : undefined;
  } catch {
    return undefined;
  }
}

function isNextContextCall(line) {
  try {
    const message = JSON.parse(line);
    return message?.method === 'tools/call' && message.params?.name === 'next_context' && message.params?.arguments?.child !== true;
  } catch {
    return false;
  }
}

// The lifecycle events the worker writes. A code call is cut in the second horizon. The other kinds use the defaults in compact.mjs.
const SELF_COMPACT = {
  tools: { next_context: { zone1: resultZone1, zone2: resultZone2 } },
};
// The MCP servers configured for this worker. Until main starts them, there are none, and their tools are not in any surface.
const NO_MCP = { ready: Promise.resolve(), verbs: () => [], has: () => false, call: () => undefined, stop: () => {} };
let mcp = NO_MCP;
let mcpReady = NO_MCP.ready;
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
  const limits = { workspace, maxSteps, maxInflight, jobLifetimeMs, stuckMs, monitorMs, noticeMs, hostIdleMs, surface };
  // Without --task, the run's task is the prompt the session sends (the gm prompt's task argument), and the run says so in its start event.
  let task = flags.task === undefined ? '' : loadTask(flags.task).trim();
  if (flags.task !== undefined && task === '') throw new Error('--task is empty');

  let runDir = currentRunDir(flags['run-dir'] === undefined ? join(workspace, 'runs', newRunId()) : resolve(flags['run-dir']));
  const runMeta = (dir, runTask) => ({ id: basename(dir), mode: 'mcp', task: runTask, witness: DEFAULT_WITNESS, workspace, maxSteps, maxInflight, createdAt: new Date().toISOString() });
  let { log, resumed } = openRun({ runDir, rules: MCP_RULES, meta: runMeta(runDir, task) });
  let resume = resumed ? resumeFrom(log.events()) : null;
  const closedAtBoot = resume?.ended ?? null;
  let startOverride = null;
  if (closedAtBoot !== null) {
    const closedTask = taskOfRun(log.events(), runDir);
    if (flags.task !== undefined) startOverride = { task, taskFrom: 'task file' };
    else task = closedTask;
    console.error(`gm mcp: run ${basename(runDir)} (${closedAtBoot}) is closed; the first next_context opens a new run`);
  }
  const history = resumed ? log.events() : [];
  // A resumed run that was started without a task takes the task its session gave, from its task event.
  if (task === '' && resumed) task = history.findLast((event) => event.kind === 'task')?.text ?? '';
  const recovery = resumed && closedAtBoot === null ? recoveryOf(history) : null;
  if (closedAtBoot === null) {
    if (resumed) log.append('restart', { reason: flags['restart-reason'] ?? 'restarted without a reason' });
    else log.append('start', { mode: 'mcp', maxSteps, maxInflight, taskFrom: flags.task !== undefined ? 'task file' : 'session prompt' });
    if (recovery && recovery.open.length > 0) log.append('recovery', { lastSeq: recovery.lastSeq, open: recovery.open });
  }
  const mcpFlag = flags['mcp-config'];
  const mcpFiles = [{ file: DEFAULT_MCP_CONFIG, required: true }, { file: join(workspace, '.gm-new', 'mcp.json') }];
  if (mcpFlag !== undefined) mcpFiles.push({ file: resolve(mcpFlag), required: true });
  const { servers, problems } = readServerConfig(mcpFiles, workspace);
  const depth = Number.parseInt(process.env.GMNEW_MCP_DEPTH ?? '0', 10) || 0;
  const client = startMcpClients({ servers, problems, log, depth, reserved: new Set(current.TOOLS.map((tool) => tool.name)) });
  mcp = client;
  mcpReady = client.ready.then(() => {
    current = surfaceOf(current.leaves);
    if (closedAtBoot === null) logTools(log, resumed, servedTools(surface));
  });
  process.on('exit', () => client.stop());

  sweepEndedCode(dirname(runDir), runDir);
  let session = createSession({ ...limits, runDir, log, task, resume, recovery: recovery && recovery.open.length > 0 ? recovery : null, history, startOverride });
  let retired = Promise.resolve();
  function reopen(ended) {
    const start = ended.successorStart();
    const closedId = basename(runDir);
    const nextDir = join(dirname(runDir), newRunId());
    const { log: fresh } = openRun({ runDir: nextDir, rules: MCP_RULES, meta: runMeta(nextDir, start.task) });
    setSuccessor(runDir, nextDir);
    runDir = nextDir;
    fresh.append('start', { mode: 'mcp', maxSteps, maxInflight, taskFrom: start.taskFrom });
    if (start.task !== '') fresh.append('task', { from: start.taskFrom, text: start.task });
    mcpReady.then(() => logTools(fresh, false, servedTools(surface)));
    console.error(`gm mcp: run ${closedId} has ended; opened run ${basename(runDir)}`);
    return createSession({ ...limits, runDir, log: fresh, task: start.task, taskInherited: start.inherited });
  }
  const acceptLine = (line) => {
    try {
      if (session.ended() !== null && !session.stepLimited() && isNextContextCall(line)) {
        retired = Promise.allSettled([retired, session.settled()]);
        session = reopen(session);
      }
      session.accept(line);
    } catch (err) {
      console.error(`gm mcp: ${err.message}`);
      const id = requestIdOf(line);
      if (id !== undefined) write(errorReply(id, -32603, err.message));
    }
  };
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on('line', acceptLine);
  // Under a supervisor, the end of stdin means the supervisor has gone, so the run is paused. Closing it here would end the
  // run as closed, and a closed run stays closed. A paused run has no end event, and the next start resumes it.
  let pausing = null;
  const pauseRun = (reason) => {
    pausing ??= Promise.all([session.pause(reason), retired]).finally(() => process.exit(0));
    return pausing;
  };
  lines.on('close', () => (flags.supervised === 'yes' ? pauseRun('the supervisor ended stdin') : session.inputEnded().then(() => retired).catch((err) => console.error(`gm: ${err.message}`)).finally(() => client.stop())));
  process.once('SIGINT', () => lines.close());
  process.once('SIGTERM', () => pauseRun('SIGTERM from the supervisor'));
  process.stdout.on('error', (err) => console.error(`gm: stdout: ${err.message}`));
  console.error(`gm mcp: run${basename(runDir)} in ${runDir}`);
}

main(process.argv.slice(2)).catch((err) => {
  console.error(`gm mcp: ${err.message}`);
  process.exitCode = 1;
});
