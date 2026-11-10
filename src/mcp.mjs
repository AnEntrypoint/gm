#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { DEFAULT_WITNESS, MCP_RULES, prefixShaOf, renderTools } from './prompt.mjs';
import { connectReply, SERVER_NAME, SERVER_TITLE } from './connect.mjs';
import { currentRunDir, isDirectory, loadTask, newRunId, openRun, ROOT, setSuccessor } from './run.mjs';
import { flushAllLogs } from './log.mjs';
import { clearPending, hasPending, offPendingAppended, onPendingAppended, takePending } from './pending.mjs';
import { conflicts, createTools, headChars, loggedFor, OUTPUT_PAGE, DEFAULT_STUCK_MS, DEFAULT_MONITOR_MS, BODY_NOTICE_MS } from './tools.mjs';
import { bumpGeneration } from './hot.mjs';
import { RELOADABLE } from './hot-config.mjs';
import { SEARCH_TOOLS } from './search.mjs';
import { runBody, runCodeTool, RUN_CODE_PROPERTIES } from './runcode.mjs';
import { bodyContext } from './exec.mjs';
import { readServerConfig, startMcpClients } from './mcp-client.mjs';
import { BROWSER_VERBS, createBrowserScope } from './browser-scope.mjs';
import { COMPACT as SEARCH_COMPACT } from './search.mjs';
import { COMPACT as RUNCODE_COMPACT } from './runcode.mjs';
import { COMPACT as TOOLS_COMPACT } from './tools.mjs';
import { feedOf, registryOf, resultZone1, resultZone2, shownTotalOf } from './compact.mjs';
import { writeSummary } from './summary.mjs';
import { parseSkill, SERVED_SKILLS } from './skills.mjs';
import { completionOf, createSubscriptions, readRun, RESOURCE_TEMPLATES, runResources, witnessOf } from './mcp-resources.mjs';

const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18'];
const ACCEPTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'];
const PROTOCOL_VERSION = SUPPORTED_VERSIONS[0];
const RUN_META = 'com.anentrypoint.gmnew/run';
const RUN_SEQ = 'com.anentrypoint.gmnew/seq';
const TRACE_KEYS = ['traceparent', 'tracestate', 'baggage'];
const CALLER = { connection: process.pid, parent: process.ppid };
const PROGRESS_MS = 5000;
const PROGRESS_TOOLS = new Set(['run_shell', 'run_code']);
const SERVER_INFO = { name: SERVER_NAME, title: SERVER_TITLE, version: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version };
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
    return { path, uri: `skill://${name}/${path}`, bytes, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, size: bytes.length, mimeType: path.endsWith('.md') ? 'text/markdown' : 'text/plain', lastModified: statSync(join(dir, path)).mtime.toISOString() };
  });
  const skillMd = files.find((file) => file.path === 'SKILL.md');
  if (skillMd === undefined) throw new Error(`skills/${name}/SKILL.md is missing`);
  const { frontmatter, body } = parseSkill(skillMd.bytes.toString('utf8'), name);
  return { name, uri: skillMd.uri, frontmatter, body, files };
}
function filesUnder(dir, rel = '') {
  const files = [];
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const path = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) files.push(...filesUnder(dir, path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}
function skillEntry(skill) {
  return { uri: skill.uri, frontmatter: skill.frontmatter, resources: skill.files.map(({ uri, digest, size }) => ({ uri, digest, size })) };
}
function resourceOf(skill, file) {
  const annotations = { audience: ['assistant'], priority: file.path === 'SKILL.md' ? 1 : 0.5, lastModified: file.lastModified };
  if (file.path !== 'SKILL.md') return { uri: file.uri, name: file.path, mimeType: file.mimeType, annotations };
  return { uri: file.uri, name: skill.frontmatter.name, description: skill.frontmatter.description, mimeType: file.mimeType, annotations };
}
function resourceList() {
  return SERVED_SKILLS.flatMap((name) => {
    const skill = skillOf(name);
    return skill.files.map((file) => resourceOf(skill, file));
  });
}
function skillFileOf(uri) {
  const match = typeof uri === 'string' ? /^skill:\/\/([^/]+)\//.exec(uri) : null;
  if (match === null || !SERVED_SKILLS.includes(match[1])) return null;
  const skill = skillOf(match[1]);
  const file = skill.files.find((candidate) => candidate.uri === uri);
  return file === undefined ? null : { skill, file };
}
function skillGet(params) {
  const match = typeof params?.uri === 'string' ? /^skill:\/\/([^/]+)\/SKILL\.md$/.exec(params.uri) : null;
  if (match === null || !SERVED_SKILLS.includes(match[1])) throw new RpcError(-32602, `unknown skill: ${params?.uri}`);
  return { resultType: 'complete', skill: skillEntry(skillOf(match[1])) };
}
const subscriptions = createSubscriptions({
  dirs: SERVED_SKILLS.map((name) => join(ROOT, 'skills', name)),
  digestOf: digestOfUri,
  changed: (uri) => notify({ jsonrpc: '2.0', method: 'notifications/resources/updated', params: { uri } }),
});
function digestOfUri(uri) {
  try {
    return skillFileOf(uri)?.file.digest ?? null;
  } catch {
    return null;
  }
}
function subscribeTo(params) {
  const found = typeof params?.uri === 'string' ? skillFileOf(params.uri) : null;
  if (found === null) throw new RpcError(-32002, `resource not found: ${params?.uri}`, { uri: params?.uri });
  subscriptions.subscribe(params.uri, found.file.digest);
  return {};
}
function unsubscribeFrom(params) {
  subscriptions.unsubscribe(params?.uri);
  return {};
}
const PROMPT_TITLES = { gm: 'gm run', 'gm-continue': 'gm continue' };
const TASK_ARGUMENT = { name: 'task', description: 'The task to run. The whole task text is this one argument. Some hosts pass only its first word.', required: false };
function skillPrompt(name) {
  const SKILL = skillOf(name);
  const prompt = { name, title: PROMPT_TITLES[name], description: SKILL.frontmatter.description };
  return name === 'gm' ? { ...prompt, arguments: [TASK_ARGUMENT] } : prompt;
}
function promptResult(SKILL, text) {
  return { description: SKILL.frontmatter.description, messages: [{ role: 'user', content: { type: 'text', text } }] };
}
const DEFAULT_MAX_STEPS = 50;
const REPLY_MEMORY = 256;
const DEFAULT_MAX_INFLIGHT = 8;
const DEFAULT_JOB_LIFETIME_MS = 3600000;
const OPEN_LIST = 20;
const USAGE = 'usage: node src/mcp.mjs --workspace <dir> [--task <file-or-text>] [--run-dir <dir>] [--max-steps N] [--max-inflight N] [--job-lifetime-ms N] [--stuck-ms N] [--monitor-ms N] [--notice-ms N] [--host-idle-ms N] [--surface tools|code] [--mcp-config <file>]';
const DEFAULT_HOST_IDLE_MS = 600000;
const MAX_WAIT_MS = 300000;
const DEFAULT_MCP_CONFIG = join(ROOT, 'defaults', 'mcp.json');
const STEP_ZERO_WARNING = 'stepsLeft is 0: the next next_context call ends this run without a witness. To close it with a witness, call finish now, while stepsLeft is 0.';

const text = { type: 'string' };
const nullableText = { type: ['string', 'null'] };
const number = { type: 'number' };
const objectSchema = (properties, required = []) => ({ type: 'object', properties, required });

const BASE_TOOLS = [
  { name: 'next_context', description: 'Begin a step. Returns rules, task, witness requirement, the events new since the last step in full, and prefixSha. Events from earlier steps are not repeated; query_log reaches them. pending lists the events that need you since your last step, each once, with an id. Delivery clears an event, so no later step or wait lists it again. Call it at the start of each step. query_log reaches every event. waitMs, when set, holds this call until an event is pending or that many milliseconds pass, at most 300000. child: true makes the call a read by a subagent on this connection: it takes no step, claims no pending event, and its reply has role child and the owning run. run, with child, names that owning run, and another run is refused. compactChildren: true summarizes child run_code and code-call generations into counts with a seq range and a gm.query_log note, while pending, parent-action, job, row and recovery events stay full; the default feed is unchanged. task, when set, replaces the run\'s task text; use it in the first step when a host cut the slash-command task to its first word. The first step may correct a one-word host task without owner:true; later task replacements need owner:true, from the owning run or from a child context (child: true) alike.', inputSchema: objectSchema({ waitMs: number, child: { type: 'boolean' }, run: text, compactChildren: { type: 'boolean' }, task: text, owner: { type: 'boolean' } }) },
  { name: 'task_set', description: 'Replace or clear the run task after the first step. owner:true is required; child contexts cannot set the task. An empty string or null clears the task.', inputSchema: objectSchema({ task: nullableText, owner: { type: 'boolean' } }, ['task']) },
  { name: 'read_file', description: 'Read a text file, inside or outside the workspace. With no offset or limit it returns the whole file when it is at most 1048576 bytes, and fails with the file size when it is larger. With offset or limit it returns one page of at most 20000 characters. Lines are the default unit: offset is a 0-based line index, limit a line count (default: as many whole lines as fit), and total (the file in lines) and next (the line index of the next page, null at the end) count lines. truncated is true when the page stops before the end, totalBytes is the file size in bytes, and hint names the read that gets the rest; a truncated read also has notice, a string that gives the bytes shown, the file size and that read; the output text holds only the page. A line longer than the page is cut to its first 20000 characters, with cutLine true, and next is the line after it. unit "chars" counts offset, limit (1 to 20000; with neither set, the whole file), total and next in characters instead. A path that starts with skill:// reads a served skill file, the text resources/read returns, and a skill:// uri that no served skill has is an error that names it.', inputSchema: objectSchema({ path: text, offset: number, limit: number, unit: text }, ['path']) },
  { name: 'write_file', description: 'Write a text file, inside or outside the workspace, creating parent directories. Replacing an existing file with content less than half its prior byte size adds shrunkByBytes, shrinkRatio and shrinkWarning to the result (never blocks the write); new files and normal rewrites are unchanged.', inputSchema: objectSchema({ path: text, content: text }, ['path', 'content']) },
  { name: 'edit_file', description: 'Replace old with new in a text file, inside or outside the workspace. old must occur once, unless replaceAll is true.', inputSchema: objectSchema({ path: text, old: text, new: text, replaceAll: { type: 'boolean' } }, ['path', 'old', 'new']) },
  { name: 'stat_file', description: 'Type, size and mtime of a path, inside or outside the workspace, as JSON.', inputSchema: objectSchema({ path: text }, ['path']) },
  { name: 'list_dir', description: 'List a directory, inside or outside the workspace. Directories end with "/". prefix keeps names that start with it, offset and limit page the sorted list, and the reply gives total and next.', inputSchema: objectSchema({ path: text, prefix: text, offset: number, limit: number }) },
  { name: 'run_shell', description: 'Run a shell command in the workspace and wait for it. Default timeout 60000 ms. Its process group is killed when it returns, so background work must go through job_start. Large output is condensed by default; raw:true skips condensing. The reply carries at most 20000 characters inline; longer output adds outputPath (the whole text), totalChars, digest, offset, next and truncated, and read_file pages the rest. compressed/originalChars/keptChars/droppedLines report what condensing dropped.', inputSchema: objectSchema({ command: text, timeoutMs: number, raw: { type: 'boolean' } }, ['command']) },
  { name: 'job_start', description: 'Start a shell command as a named background job and return at once. Poll it with job_status. timeoutMs is the job deadline: default 300000 ms, at most 7200000 ms. A deadline past the job lifetime (3600000 ms by default) ends the job at the lifetime (reason lifetime); the job is killed at its deadline (reason timeout). progress is an optional file path whose modification time counts as job progress, so a job that writes results without printing is not reported stuck.', inputSchema: objectSchema({ job: text, command: text, timeoutMs: number, progress: text }, ['job', 'command']) },
  { name: 'job_status', description: 'State (running, exited or killed), exitCode, signal and output of a job as plain fields, with logPath (the job output file). output is the last 20000 characters, with total (its length) and truncated; with offset, output is the 20000 characters from that offset, with next. waitMs polls until the job leaves running, capped at 30000 ms (30 s; a larger waitMs is clamped); re-arm gm.job_status({ job, waitMs: 30000 }) while state is running. Offsets and lengths count characters, not lines.', inputSchema: objectSchema({ job: text, waitMs: number, offset: number }, ['job']) },
  { name: 'job_stop', description: 'Stop a background shell job: its process group is killed, and the job ends killed with reason cancelled. The job event is logged before the answer. A job that already ended is an error result. stopBackground stops run_code bodies only.', inputSchema: objectSchema({ job: text }, ['job']) },
  { name: 'query_log', description: 'Read the run events, as JSON. after is a seq: only the events after it are read (since), so after the last seq you saw reads on from there. kind keeps events of one kind, and fromMono and toMono keep events in a time window (monotonic milliseconds). last N returns the newest N matching events instead, oldest first, at most 50, and has no next. js is a JavaScript expression over the matching events, and defaults to returning them: js sees one window of at most 1000 events or 4 MB of log. Without js, a reply holds at most 50 events and about 20 KB; limit (1 to 50) lowers that count, and is refused with last or js. When events remain, next is the seq to pass back as after; with js, next is set when the window ends before the end of the log. An unknown argument is refused, and the reply names the arguments query_log takes.', inputSchema: objectSchema({ js: text, kind: text, fromMono: number, toMono: number, after: number, last: number, limit: number }, []) },
  { name: 'finish', description: 'End the run. witness is one string that quotes the evidence you observed. gaps optionally lists, one string each, what the run did not check; the end event logs them. finish is refused while a background run is running, and stopBackground true kills it first. finish is refused while a PRD or question row is open, and names the rows. A gap that names an open row is refused too. At the step limit only, openRows lists each open row of this run with a reason, and finish proceeds while those rows stay open.', inputSchema: objectSchema({ witness: text, gaps: { type: 'array', items: text }, stopBackground: { type: 'boolean' }, openRows: { type: 'array', items: { type: 'object' } } }, ['witness']) },
  ...SEARCH_TOOLS,
];

const SURFACES = ['tools', 'code'];
const CODE_SURFACE = new Set(['next_context', 'run_code', 'finish']);
const SKILL_READ_REFUSAL = 'run_code refused: skill://gm/SKILL.md had not been read in this connection, so its text is the second content block of this reply. Read it and follow it, then call run_code again. This refusal is sent once per connection.';
const STEP_START_RULE = 2;
const TASK_PAGE = 4000;
const taskRestNotice = (text) => {
  const shown = headChars(text, TASK_PAGE).length;
  return `[gm: the task is ${text.length} characters; the first ${shown} are shown. Read the rest with gm.query_log({ kind: 'task', last: 1 }) for the task event's seq, then gm.query_log({ seq, field: 'text', offset: ${shown}, limit: 20000 }) and read on from next until next is null.]`;
};
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
  const VERBS = [...TOOLS.filter((tool) => !CODE_SURFACE.has(tool.name)), ...mcp.verbs(), ...BROWSER_VERBS];
  const CODE_LIST = [...TOOLS.filter((tool) => tool.name === 'next_context' || tool.name === 'finish'), annotated(runCodeTool(VERBS.map((tool) => tool.name)))];
  const REGISTRY = registryOf(TOOLS_COMPACT, SEARCH_COMPACT, leaves['fetch.mjs'].COMPACT, leaves['git.mjs'].COMPACT, leaves['code-ast.mjs'].COMPACT, leaves['rows.mjs'].COMPACT, leaves['wiki-tools.mjs'].COMPACT, leaves['review-tools.mjs'].COMPACT, RUNCODE_COMPACT, SELF_COMPACT);
  return { TOOLS, VERBS, CODE_LIST, REGISTRY, leaves };
}
async function loadLeaves() {
  const leaves = {};
  for (const file of RELOADABLE) leaves[file] = await import(`./${file}`);
  return leaves;
}
function servedTools(surface) {
  return surface === 'code' ? current.CODE_LIST : current.TOOLS;
}
const NO_PATHS = { items: [], free: true };

class RpcError extends Error {
  constructor(code, message, data = undefined) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

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

function createSession({ workspace, runDir, log, task, maxSteps, maxInflight, resume = null, jobLifetimeMs = DEFAULT_JOB_LIFETIME_MS, stuckMs = DEFAULT_STUCK_MS, monitorMs = DEFAULT_MONITOR_MS, noticeMs = BODY_NOTICE_MS, hostIdleMs = DEFAULT_HOST_IDLE_MS, recovery = null, taskInherited = false, shownFloor = 0, startOverride = null, surface = 'code', requeue = null }) {
  const runId = basename(runDir);
  const runsRoot = dirname(runDir);
  const tools = createTools({ workspace, runDir, log, background: true, jobLifetimeMs, stuckMs, monitorMs, noticeMs, leaves: current.leaves, serveSkill: (uri) => serveSkillFile(uri, 'read_file') });
  const browser = createBrowserScope({ inner: (name, args) => (mcp.has(name) ? mcp.call(name, args) : { ok: false, error: `unknown tool: ${name}` }), log });
  activeTools = tools;
  activeLog = log;
  let pendingRecovery = recovery;
  let noticeSeq = lastContextSeq(log.events());
  const active = new Map();
  const holds = new Map();
  let finishing = Promise.resolve();
  const waiting = [];
  let callOrder = 0;
  const unansweredTurns = new Set();
  const replies = new Map();
  const remember = (key, pending) => {
    replies.set(key, pending);
    if (replies.size > REPLY_MEMORY) replies.delete(replies.keys().next().value);
  };
  const inFlightCalls = new Map();
  const cancelled = new Set();
  const callOf = (rpcId) => inFlightCalls.get(JSON.stringify(rpcId));
  const signalOf = (rpcId) => callOf(rpcId)?.controller.signal;
  const noteAction = (rpcId, seq) => {
    const call = callOf(rpcId);
    if (call !== undefined) call.actionSeq = seq;
  };
  let steps = resume?.steps ?? 0;
  let ended = resume?.ended ?? null;
  let stepLimited = false;
  let endedTask = null;
  let ownerToken = null;
  let endLogged = ended !== null;
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
  const rulesOpen = new Map();
  let gmSkillRead = false;
  let runStarted = steps > 0;
  let childSeen = false;
  let childTask = '';
  let stepCalls = 0;
  const RULE_TEXT = { 2: 'call next_context at the start of every step', 3: 'verify before you finish', 4: 'finish needs a witness' };
  function noteRule(rule, evidence) {
    if (ended !== null || rulesOpen.has(rule)) return;
    const entry = log.append('rules-notice', { step: steps, rule, evidence });
    rulesOpen.set(rule, { seq: entry.seq, evidence });
  }
  function clearRule(rule) {
    if (!rulesOpen.delete(rule)) return;
    log.append('rules-cleared', { step: steps, rules: [rule] });
  }
  function clearRules() {
    if (rulesOpen.size === 0) return;
    const rules = [...rulesOpen.keys()];
    rulesOpen.clear();
    log.append('rules-cleared', { step: steps, rules });
  }
  function rulesNotice() {
    if (ended !== null || rulesOpen.size === 0) return null;
    const lines = [...rulesOpen].map(([rule, { evidence }]) => `rule ${rule} (${RULE_TEXT[rule]}): ${evidence}`);
    return `The rules check found: ${lines.join('; ')}. Read the gm skill again with ReadMcpResourceTool (server gm, uri skill://gm/SKILL.md), or with gm.read_file({ path: 'skill://gm/SKILL.md' }) in a run_code body, and follow the rules it gives. That one read clears this notice, and the next next_context clears a rule 2 notice. Do not repeat finished work.`;
  }

  const handlers = {
    read_file: (args) => tools.run('read_file', args),
    write_file: (args) => tools.run('write_file', args),
    list_dir: (args) => tools.run('list_dir', args),
    run_shell: ({ command, timeoutMs }, signal) => tools.run('run_shell', { command, timeoutMs }, { signal }),
    job_start: ({ job, command, timeoutMs, progress }) => tools.run('run_shell', { job, command, timeoutMs, progress, background: true }),
    job_status: ({ job, waitMs, offset }) => tools.run('job_status', { job, waitMs, offset }),
    query_log: (args) => tools.run('query_log', args),
    task_set: (args) => applyTaskSet(args),
  };

  async function innerCall(name, args) {
    const startMono = log.now();
    const body = bodyContext.getStore()?.body;
    if (body !== undefined) tools.callStarted(body);
    const action = READ_ONLY_TOOLS.has(name) ? undefined : log.append('action', { step: steps, tool: name, args, caller: CALLER, ...(body === undefined ? {} : { body }) });
    if (action !== undefined) flushAllLogs();
    const exec = browser.handles(name) ? (value) => browser.call(name, value) : mcp.has(name) ? (value) => mcp.call(name, value) : Object.hasOwn(handlers, name) ? handlers[name] : (value) => tools.run(name, value);
    let result;
    try {
      result = await exec(args);
    } catch (err) {
      result = { ok: false, error: err.message };
    } finally {
      if (body !== undefined) tools.callEnded(body);
    }
    const shown = loggedFor(name, result);
    const fields = { ok: shown?.ok === true, args, exitCode: shown?.exitCode, signal: shown?.signal, output: shown?.output, outputChars: shown?.outputChars, outputDigest: shown?.outputDigest, error: shown?.error };
    log.append('code-call', { step: steps, tool: name, startMono, ...fields, ...(body === undefined ? {} : { body }), ...(action === undefined ? {} : { actionSeq: action.seq }) });
    return result;
  }

  function accept(line) {
    if (line.trim() === '') return Promise.resolve();
    const turn = handleLine(line)
      .then((reply) => {
        if (reply !== null) write(reply);
      })
      .catch((err) => console.error(`gm: ${err.message}`))
      .finally(() => unansweredTurns.delete(turn));
    unansweredTurns.add(turn);
    return turn;
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
    if (method === 'server/discover') return discover(surface);
    if (method === 'ping') return {};
    await mcpReady;
    if (method === 'tools/list') return { tools: servedTools(surface) };
    if (method === 'tools/call') {
      touch();
      return callTool(params, rpcId);
    }
    if (method === 'prompts/list') return { prompts: SERVED_SKILLS.map((name) => skillPrompt(name)) };
    if (method === 'prompts/get') return getPrompt(params);
    if (method === 'resources/list') return { resources: [...resourceList(), ...runResources(runsRoot, runId, witnessOf(runsRoot, runId))] };
    if (method === 'resources/read') return readResource(params);
    if (method === 'skills/list') return { resultType: 'complete', skills: SERVED_SKILLS.map((name) => skillEntry(skillOf(name))) };
    if (method === 'skills/get') return skillGet(params);
    if (method === 'resources/templates/list') return { resourceTemplates: RESOURCE_TEMPLATES };
    if (method === 'resources/subscribe') return subscribeTo(params);
    if (method === 'resources/unsubscribe') return unsubscribeFrom(params);
    if (method === 'completion/complete') return completionOf(params, { skills: SERVED_SKILLS, filesOf: (name) => skillOf(name).files.map((file) => file.path), runsRoot });
    if (method === 'logging/setLevel') return setLogLevel(params);
    if (method === 'core/reload') return reloadLeaves();
    if (method === 'notifications/cancelled') {
      cancelRequest(params?.requestId);
      return null;
    }
    if (method.startsWith('notifications/')) return null;
    throw new RpcError(-32601, `method not found: ${method}`);
  }

  function initialize(params) {
    const asked = params?.protocolVersion;
    const version = ACCEPTED_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSION;
    return { protocolVersion: version, ...connectReply(surface), serverInfo: SERVER_INFO };
  }

  function discover(surface) {
    return { resultType: 'complete', supportedVersions: SUPPORTED_VERSIONS, ...connectReply(surface), _meta: { 'io.modelcontextprotocol/serverInfo': SERVER_INFO } };
  }

  function getPrompt(params) {
    const name = params?.name;
    if (!SERVED_SKILLS.includes(name)) throw new RpcError(-32602, `unknown prompt: ${name}`);
    if (name !== 'gm') {
      const other = skillOf(name);
      log.append('skill-loaded', { via: 'prompt', skill: name, cleared: [] });
      return promptResult(other, other.body);
    }
    const SKILL = skillOf('gm');
    log.append('skill-loaded', { via: 'prompt', skill: 'gm', caller: CALLER, cleared: [...rulesOpen.keys()] });
    clearRules();
    gmSkillRead = true;
    const given = typeof params?.arguments?.task === 'string' ? params.arguments.task.trim() : '';
    const childSession = ended === null && (runStarted || childSeen);
    if (given !== '' && childSession) childTask = given;
    else if (given !== '' && ended !== null) endedTask = given;
    else if (given !== '' && (task === '' || taskInherited)) {
      task = given;
      taskInherited = false;
      log.append('task', { from: 'session prompt', text: task });
    }
    let text = given === '' ? SKILL.body : `${SKILL.body}\n\nTask: ${given}`;
    if (given !== '' && !/\s/.test(given)) text += '\n\nThe task above is one word. Some hosts cut a slash-command task to its first word. If your slash command had more words, call next_context({ task: \'<the whole slash-command text>\' }) in your first step so the run records the whole task.';
    return promptResult(SKILL, text);
  }

  function readResource(params) {
    const run = readRun(runsRoot, params?.uri);
    if (run !== null) return { contents: [run] };
    const served = serveSkillFile(params?.uri, 'resource');
    if (!served.ok) throw new RpcError(-32002, `resource not found: ${params?.uri}`, { uri: params?.uri });
    return { contents: [{ uri: served.uri, mimeType: served.mimeType, text: served.output }] };
  }

  function serveSkillFile(uri, via) {
    const found = skillFileOf(uri);
    if (found === null) return { ok: false, error: `no served skill file has the uri ${uri}` };
    const isGm = found.file.uri === GM_SKILL_URI;
    log.append('skill-loaded', { via, skill: found.skill.name, uri: found.file.uri, caller: CALLER, cleared: isGm ? [...rulesOpen.keys()] : [] });
    if (isGm) {
      clearRules();
      gmSkillRead = true;
    }
    return { ok: true, output: found.file.bytes.toString('utf8'), uri: found.file.uri, mimeType: found.file.mimeType };
  }

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
    if (!servedTools(surface).some((tool) => tool.name === name)) throw new RpcError(-32602, unknownToolText(name));
    if (name === 'run_code' && !gmSkillRead) {
      const served = serveSkillFile(GM_SKILL_URI, 'run_code');
      gmSkillRead = true;
      if (served.ok) {
        log.append('refusal', { tool: name, stage: 'skill-read', error: SKILL_READ_REFUSAL });
        return toolResultOf(name, { ok: false, error: SKILL_READ_REFUSAL }, {}, served.output);
      }
    }
    if (!runStarted && ended === null && name !== 'next_context' && name !== 'finish') noteRule(STEP_START_RULE, `${name} was called before the first next_context of the run`);
    const meta = params?._meta ?? {};
    const key = JSON.stringify(rpcId);
    const call = { name, trace: traceOf(meta), controller: new AbortController() };
    inFlightCalls.set(key, call);
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
    return toolResultOf(name, payload, { [RUN_META]: runId, [RUN_SEQ]: call.actionSeq });
  }

  function unknownToolText(name) {
    const guidance = surface === 'code' ? '; the code surface serves next_context, run_code, task_set and finish; call a verb as gm.<name>(args) inside run_code' : '';
    return `Unknown tool: ${name}${guidance}`;
  }

  function progressFor(name, token) {
    if (!PROGRESS_TOOLS.has(name) || (typeof token !== 'string' && !Number.isInteger(token))) return () => {};
    const started = Date.now();
    let last = 0;
    const timer = setInterval(() => {
      last = Math.max(last + 1, Math.floor((Date.now() - started) / 1000));
      notify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token, progress: last, message: `running ${last} s` } });
    }, PROGRESS_MS);
    return () => clearInterval(timer);
  }

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
      waiting.push({ name, args, resolveCall, rpcId, order: ++callOrder });
      drain();
    });
  }

  function drain() {
    if (ended !== null) {
      for (const call of waiting.splice(0)) {
        if (ended === 'finished' && requeue !== null && call.name === 'next_context' && call.args.child !== true && call.args.run === undefined) requeue(call);
        else call.resolveCall(refuse(call.name, call.args, endedReason(isChildRead(call.name, call.args)), call.rpcId));
      }
      return;
    }
    while (active.size < maxInflight && waiting.length > 0) {
      const ordered = [...waiting].sort((a, b) => a.order - b.order);
      if (!runStarted) {
        const firstIndex = ordered.findIndex((call) => call.name === 'next_context' && call.args.child !== true && call.args.run === undefined);
        const early = ordered.filter((call) => call.name !== 'next_context');
        if (early.length > 0 && (firstIndex < 0 || ordered.indexOf(early[0]) < firstIndex)) {
          const accesses = early.map((call) => accessOf(call.name, call.args));
          const index = startableIndex(accesses);
          if (index < 0) return;
          const call = early[index];
          waiting.splice(waiting.indexOf(call), 1);
          call.resolveCall(invoke(call.name, call.args, accesses[index], call.rpcId));
          continue;
        }
        if (firstIndex < 0) return;
        const call = ordered[firstIndex];
        const access = accessOf(call.name, call.args);
        waiting.splice(waiting.indexOf(call), 1);
        call.resolveCall(invoke(call.name, call.args, access, call.rpcId));
        return;
      }
      const accesses = ordered.map((call) => accessOf(call.name, call.args));
      const index = startableIndex(accesses);
      if (index < 0) return;
      const call = ordered[index];
      waiting.splice(waiting.indexOf(call), 1);
      call.resolveCall(invoke(call.name, call.args, accesses[index], call.rpcId));
    }
  }

  function startableIndex(accesses) {
    const running = [...active.values(), ...holds.values()];
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
    return `step limit ${maxSteps} reached and this run ended without a witness; call next_context to open a successor run. To close a run with a witness, call finish while stepsLeft is 0, before the next next_context call`;
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
    if (name === 'task_set') return taskSet(args, access, rpcId);
    if (signalOf(rpcId)?.aborted === true) return refuse(name, args, 'cancelled before it started', rpcId);
    if (name === 'run_code') {
      const unknown = Object.keys(args).filter((key) => !Object.hasOwn(RUN_CODE_PROPERTIES, key));
      if (unknown.length > 0) return refuse(name, args, `unknown argument ${unknown.join(', ')}; run_code takes ${Object.keys(RUN_CODE_PROPERTIES).join(', ')}`, rpcId);
      return act('run_code', args, access, (actionSeq) => runBody({ body: args.body, timeoutMs: args.timeoutMs, format: args.format, verbs: current.VERBS, call: innerCall, project: workspace, runDir, log, step: steps, background: (handle) => tools.adoptBody(handle) }).then((reply) => ({ ...reply, actionSeq })), (result) => loggedFor('run_code', result), rpcId);
    }
    if (name === 'next_context') return args.child === true || args.run !== undefined ? childContext(access, rpcId, args) : nextContext(access, rpcId, args);
    if (name === 'finish') return finish(args, access, rpcId);
    if (Object.hasOwn(handlers, name)) return act(name, args, access, () => handlers[name](args, signalOf(rpcId)), (result) => loggedFor(name, result), rpcId);
    return act(name, args, access, () => tools.run(name, args, { signal: signalOf(rpcId) }), undefined, rpcId);
  }

  function childContext(access, rpcId, args) {
    if (!runStarted) return refuse('child_context', args, 'no step has started on this connection; the session that owns the run calls next_context first', rpcId);
    if (args.run !== undefined && args.run !== runId) return refuse('child_context', args, `this connection's run is ${runId}, not ${args.run}`, rpcId);
    const given = typeof args.task === 'string' ? args.task.trim() : '';
    if (given !== '' && args.owner !== true) return refuse('child_context', args, 'a task replacement after the first step needs owner:true', rpcId);
    childSeen = true;
    return act('child_context', args, access, () => childRead(given), ({ ok, error, role, run }) => ({ ok, error, role, run }), rpcId);
  }

  async function replaceTask(text, fields) {
    task = text;
    taskInherited = false;
    endedTask = null;
    startOverride = null;
    childTask = '';
    prefixMemo = null;
    await writeTaskFile(task);
    log.append('task', { from: 'next_context', text: task, ...fields });
  }

  async function childRead(given) {
    if (given !== '' && given !== task) await replaceTask(given, { owner: true, child: true });
    const rules = await readFile(join(runDir, 'rules.md'), 'utf8');
    return {
      ok: true,
      role: 'child',
      run: runId,
      note: `child of run ${runId}: the session that opened the run ends it, so a child does not send finish`,
      stepsLeft: maxSteps - steps,
      maxSteps,
      rules,
      task: task === '' ? null : headChars(task, TASK_PAGE),
      prefixSha: prefixShaFor(rules),
      total: log.count(),
      ...(childTask === '' ? {} : { childTask }),
    };
  }

  async function writeTaskFile(text) {
    const fs = await import('node:fs/promises');
    const file = join(runDir, 'task.json');
    let meta = {};
    try { meta = JSON.parse(await fs.readFile(file, 'utf8')); } catch {}
    if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) meta = {};
    meta.task = text;
    await fs.writeFile(file, JSON.stringify(meta, null, 2) + '\n');
  }
  function taskSetProblem(args) {
    if (!runStarted) return { ok: false, error: 'no step has started; call next_context first' };
    if (args.child === true || args.run !== undefined) return { ok: false, error: 'a child context cannot set the run task' };
    if (args.owner !== true || ownerToken !== 'owner') return { ok: false, error: 'task_set needs owner:true on the owning run' };
    if (args.task !== null && typeof args.task !== 'string') return { ok: false, error: 'task must be a string or null' };
    return null;
  }
  async function applyTaskSet(args) {
    const problem = taskSetProblem(args);
    if (problem !== null) return problem;
    const given = typeof args.task === 'string' ? args.task.trim() : '';
    task = given;
    taskInherited = false;
    endedTask = null;
    startOverride = null;
    childTask = '';
    prefixMemo = null;
    await writeTaskFile(task);
    log.append('task', { from: 'task_set', text: task, cleared: task === '', owner: true });
    return { ok: true, task: task === '' ? null : task, cleared: task === '' };
  }
  function taskSet(args, access, rpcId) {
    const problem = taskSetProblem(args);
    if (problem !== null) return refuse('task_set', args, problem.error, rpcId);
    return act('task_set', { task: args.task ?? null, owner: true }, access, () => applyTaskSet(args), undefined, rpcId);
  }
  async function nextContext(access, rpcId, args = {}) {
    if (steps >= maxSteps) {
      stepLimited = true;
      stop('max_steps');
      const out = refuse('next_context', {}, stepLimitText(), rpcId);
      await browser.closeForRun();
      await endRun('max_steps', null);
      return out;
    }
    const given = typeof args.task === 'string' ? args.task.trim() : '';
    const initial = typeof task === 'string' ? task : '';
    const firstStep = steps === 0 && !runStarted && !childSeen && args.child !== true && args.run === undefined && (initial === '' || !/\s/.test(initial));
    const ownerMarked = args.owner === true;
    const correction = given !== '' && firstStep && !ownerMarked;
    if (given !== '' && !ownerMarked && !correction) return refuse('next_context', args, 'a task replacement after the first step needs owner:true', rpcId);
    const waitMs = waitOf(args.waitMs);
    const compactChildren = args.compactChildren === true;
    const waitedFromStart = runStarted;
    const shownTask = given === '' ? '' : given.length <= 200 ? given : given.slice(0, 200) + ' ...[' + given.length + ' chars]';
    const auditArgs = given === '' ? {} : { task: shownTask, owner: ownerMarked, correction };
    return act('next_context', auditArgs, access, async () => {
      if (waitMs > 0) await untilPending(runDir, waitMs);
      if (waitMs > 0 && waitedFromStart && !hasPending(runDir)) {
        return { ok: true, progress: `no event pending after ${waitMs} ms; no step was used, call next_context again to keep waiting`, steps };
      }
      steps += 1;
      runStarted = true;
      stepCalls = 0;
      const step = steps;
      if (ownerToken === null && (ownerMarked || firstStep || (steps === 1 && !childSeen && args.child !== true && args.run === undefined))) ownerToken = 'owner';
      if (given !== '' && given !== task) await replaceTask(given, { ...(ownerMarked ? { owner: true } : {}), ...(correction ? { correction: true } : {}) });
      const reply = await context(step, rpcId, compactChildren, waitMs > 0);
      clearRule(STEP_START_RULE);
      return { ...reply, tabs: await browser.tabsText() };
    }, ({ ok, error, prefixSha, total, progress }) => ({ ok, error, prefixSha, total, progress }), rpcId, 1);
  }  let prefixMemo = null;
  function prefixShaFor(rules) {
    if (prefixMemo === null || prefixMemo.surface !== current || prefixMemo.rules !== rules || prefixMemo.task !== task) prefixMemo = { surface: current, rules, task, sha: prefixShaOf({ rules, task, witness: DEFAULT_WITNESS, tools: renderTools(servedTools(surface)) }) };
    return prefixMemo.sha;
  }

  async function context(step, rpcId, compactChildren = false, waiting = false) {
    const rules = await readFile(join(runDir, 'rules.md'), 'utf8');
    const recoveryNow = pendingRecovery === null ? undefined : recoveryNote(pendingRecovery);
    pendingRecovery = null;
    const since = log.eventsFrom(noticeSeq + 1);
    noticeSeq = log.count();
    const killed = since.filter((event) => event.kind === 'job-killed');
    const killedNames = new Set(killed.map((event) => event.job));
    const started = since.filter((event) => event.kind === 'job' && event.state === 'running' && event.body !== undefined);
    const stillRunning = since.filter((event) => event.kind === 'job-running');
    const turnedStuck = since.filter((event) => event.kind === 'job-stuck');
    const progressedAgain = since.filter((event) => event.kind === 'job-unstuck');
    const open = tools.activeJobs();
    const ended = since.filter((event) => event.kind === 'job' && event.state !== 'running' && !(event.state === 'killed' && killedNames.has(event.job)));
    const jobsEnded = await Promise.all(ended.map((event) => endedJob(runDir, event)));
    const shown = Math.max(shownTotalOf(log), shownFloor);
    const feed = feedOf(log, current.REGISTRY, { shown, compactChildren });
    const openRows = await tools.openRows();
    const parkedRows = await tools.parkedRows();
    const reply = {
      ok: true,
      step,
      run: runId,
      stepsLeft: maxSteps - step,
      maxSteps,
      ...(maxSteps - step === 0 ? { warning: STEP_ZERO_WARNING } : {}),
      ...(waiting ? { rulesPath: join(runDir, 'rules.md') } : {
        rules,
        task: task === '' ? null : headChars(task, TASK_PAGE),
        ...(task === '' ? { taskNotice: 'No task yet. The gm skill prompt, with its task argument, gives the task of this run.' } : {}),
        ...(task.length > TASK_PAGE ? { taskChars: task.length, taskTruncated: true, taskNotice: taskRestNotice(task) } : {}),
      }),
      witness: DEFAULT_WITNESS,
      prefixSha: prefixShaFor(rules),
      total: log.count(),
      pendingCommands: {
        wait: `node "${join(ROOT, 'src', 'cli.mjs')}" events --dir "${runDir}" --wait`,
      },
      ...(waiting ? {} : feed),
      query: queryHintOf(shown, log.count()),
      ...(recoveryNow ? { recovery: recoveryNow } : {}),
      ...(rulesOpen.size > 0 ? { rulesPending: rulesNotice() } : {}),
      ...(killed.length ? { jobsKilled: killed.map(({ seq, job, reason, statement, lifetimeMs, tail }) => ({ seq, job, reason, statement, lifetimeMs, tail })) } : {}),
      ...(started.length ? { jobsStarted: started.map(({ seq, job }) => ({ seq, job })) } : {}),
      ...(stillRunning.length ? { jobsRunning: stillRunning.map(({ seq, job, runningMs, prd }) => ({ seq, job, runningMs, prd })) } : {}),
      ...(jobsEnded.length ? { jobsEnded } : {}),
      ...(turnedStuck.length ? { jobsStuck: turnedStuck.map(({ seq, job, body, sinceProgressMs }) => ({ seq, job, ...(body === undefined ? {} : { body }), sinceProgressMs })) } : {}),
      ...(progressedAgain.length ? { jobsUnstuck: progressedAgain.map(({ seq, job }) => ({ seq, job })) } : {}),
      ...(open.length ? { jobsOpen: open.slice(0, OPEN_LIST), ...(open.length > OPEN_LIST ? { jobsOpenMore: open.length - OPEN_LIST } : {}) } : {}),
      remaining: { open: openRows.map((row) => row.id), parked: parkedRows.map((row) => row.id), jobs: open.map((job) => job.job) },
    };
    const taken = takePending(runDir);
    if (taken.records.length > 0) reply.pending = taken.records;
    if (taken.files.length > 0) afterReply.set(JSON.stringify(rpcId), () => clearPending(taken.files));
    return reply;
  }

  function finish(args, access, rpcId) {
    const hold = {};
    holds.set(hold, access);
    const done = finishRun(args, access, rpcId).finally(() => {
      holds.delete(hold);
      drain();
    });
    finishing = done;
    return done;
  }
  async function finishRun(args, access, rpcId) {
    if (typeof args.witness !== 'string' || args.witness.trim() === '') {
      return refuse('finish', args, 'finish needs a non-empty witness string');
    }
    if (args.gaps !== undefined && (!Array.isArray(args.gaps) || args.gaps.some((gap) => typeof gap !== 'string' || gap.trim() === ''))) {
      return refuse('finish', args, 'gaps must be an array of non-empty strings');
    }
    const running = tools.runningBodies();
    if (running.length > 0 && args.stopBackground !== true) {
      return refuse('finish', args, `background run ${running.join(', ')} is still running; job_status watches it, and finish with stopBackground: true kills it`);
    }
    const rows = await tools.openRows();
    const gapOnOpen = rows.find((row) => (args.gaps ?? []).some((gap) => gap.split(/[^A-Za-z0-9-]+/).includes(row.id)));
    if (gapOnOpen !== undefined) {
      return refuse('finish', args, `gap names open row ${gapOnOpen.id}; a gap cannot stand in for an open row, so resolve it or, for a PRD, delete it`, rpcId);
    }
    const added = new Set(log.eventsFrom(1).filter((event) => event.kind === 'row-added').map((event) => event.row));
    const open = rows.filter((row) => added.has(row.id));
    const documented = args.openRows;
    if (documented !== undefined && (!Array.isArray(documented) || documented.some((row) => typeof row?.id !== 'string' || typeof row?.reason !== 'string' || row.reason.trim() === ''))) {
      return refuse('finish', args, 'openRows must be an array of {id, reason} with a non-empty reason', rpcId);
    }
    const documentedAll = documented !== undefined && steps >= maxSteps && open.every((row) => documented.some((entry) => entry.id === row.id)) && documented.every((entry) => open.some((row) => row.id === entry.id));
    if (open.length > 0 && !documentedAll) {
      const names = open.slice(0, 5).map((row) => `${row.id} ${row.title}`).join('; ');
      return refuse('finish', args, `${open.length} row(s) open: ${names}${open.length > 5 ? '; ...' : ''}. Resolve each with its witness, or delete a PRD you will not implement with prd_delete. A question for the owner stays open until the owner answers`, rpcId);
    }
    if (open.length > 0) log.append('finish-open-rows', { rows: documented.map(({ id, reason }) => ({ id, reason })), steps });
    const parked = (await tools.parkedRows()).filter((row) => added.has(row.id) && !(args.witness.includes(row.id) && args.witness.includes(row.parkReason)));
    if (parked.length > 0) {
      return refuse('finish', args, `parked row(s) need their id and reason in the witness: ${parked.map((row) => `${row.id} (${row.parkReason})`).join('; ')}`, rpcId);
    }
    if (args.stopBackground === true) tools.stopBodies('stopBackground');
    stop('finished');
    const out = await act('finish', args, access, async () => ({ ...(await tools.run('finish', args)), browser: await browser.closeForRun() }), undefined, rpcId);
    const { lintWiki } = await import('./wiki.mjs');
    const lint = lintWiki(workspace);
    log.append('lint', { problems: lint.problems, pages: lint.pages });
    await endRun('finished', out.output, args.gaps);
    return out;
  }

  function act(tool, args, access, exec, digest = (result) => result, rpcId = undefined, ahead = 0) {
    const work = perform(tool, args, exec, digest, rpcId, ahead);
    active.set(work, access);
    const forget = () => {
      active.delete(work);
      touch();
      drain();
    };
    work.then(forget, forget);
    return work;
  }

  async function perform(tool, args, exec, digest, rpcId, ahead = 0) {
    const step = steps + ahead;
    const startMono = log.now();
    log.enter();
    const action = log.append('action', { step, tool, args, caller: CALLER, ...(rpcId === undefined ? {} : { rpcId, ...callOf(rpcId)?.trace }) });
    noteAction(rpcId, action.seq);
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
    const action = log.append('action', { step, tool, args, caller: CALLER, ...(rpcId === undefined ? {} : { rpcId, ...callOf(rpcId)?.trace }) });
    noteAction(rpcId, action.seq);
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
    if (ended === null) {
      while (waiting.length > 0) {
        drain();
        await Promise.allSettled([...active.keys(), finishing]);
      }
      stop('closed');
    }
    await Promise.allSettled([...unansweredTurns]);
    if (!endLogged) await endRun(ended, null);
  }

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

  return { accept, inputEnded, pause, ended: () => ended, stepLimited: () => stepLimited, settled: () => Promise.allSettled([...unansweredTurns]), hasReply: (id) => replies.has(JSON.stringify(id)), successorStart };
}

function lastContextSeq(events) {
  let seq = 0;
  for (const event of events) if (event.kind === 'action' && event.tool === 'next_context') seq = event.seq;
  return seq;
}

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

async function bodyResult(runDir, job) {
  const status = JSON.parse(await readFile(join(runDir, 'jobs', `${job}.json`), 'utf8').catch(() => '{}'));
  return status.value ?? status.error ?? '';
}

function recoveryOf(events) {
  const first = events.findIndex((event) => event.actionSeq !== undefined || event.rpcId !== undefined);
  const lastSeq = events.length ? events.at(-1).seq : 0;
  if (first < 0) return { lastSeq, open: [] };
  const ended = new Set(events.filter((event) => (event.kind === 'result' || event.kind === 'refusal' || event.kind === 'code-call') && event.actionSeq !== undefined).map((event) => event.actionSeq));
  const open = events.slice(first).filter((event) => event.kind === 'action' && !ended.has(event.seq)).map((event) => ({ seq: event.seq, tool: event.tool, args: event.args }));
  return { lastSeq, open };
}

function recoveryNote(recovery) {
  const list = recovery.open.map((action) => `seq ${action.seq} ${action.tool} ${JSON.stringify(action.args)}`).join('; ');
  return {
    lastSeq: recovery.lastSeq,
    open: recovery.open,
    note: `This run resumed after a restart, at last seq ${recovery.lastSeq}. These actions started and have no end event: ${list}. Before you repeat any of them, check the outside effects: git log and git status, the remote, and the row files under work/rows. Do not repeat a push, a commit, a fetch that posted, or a row resolve unless those checks show that it did not happen.`,
  };
}

function resumeFrom(events) {
  const steps = events.filter((event) => event.kind === 'result' && event.tool === 'next_context' && event.ok === true && event.progress === undefined).length;
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

const READ_ONLY_TOOLS = new Set([
  'next_context', 'read_file', 'list_dir', 'stat_file', 'search', 'wiki_search', 'grep', 'callers', 'impact', 'query_log', 'job_status',
  'git_status', 'git_log', 'git_diff', 'git_show', 'ci_status', 'prd_list', 'unknown_list', 'review_join',
]);
const OPEN_WORLD = new Set(['fetch', 'git_fetch', 'git_pull', 'git_push', 'ci_status']);
const RECORDS_ONLY = new Set(['next_context', 'finish']);
function annotated(tool) {
  const readOnly = READ_ONLY_TOOLS.has(tool.name) && tool.name !== 'next_context';
  const described = { ...tool, title: titleOf(tool.name), annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly && !RECORDS_ONLY.has(tool.name), openWorldHint: OPEN_WORLD.has(tool.name) } };
  return Object.hasOwn(OUTPUT_SCHEMAS, tool.name) ? { ...described, outputSchema: OUTPUT_SCHEMAS[tool.name] } : described;
}
const OUTPUT_SCHEMAS = {
  next_context: objectSchema({ ok: { type: 'boolean' }, refused: { type: 'boolean' }, error: text, step: number, run: text, stepsLeft: number, maxSteps: number, warning: text, total: number, prefixSha: text, actionSeq: number }, ['ok']),
  run_code: objectSchema({ ok: { type: 'boolean' }, refused: { type: 'boolean' }, error: text, truncated: { type: 'boolean' }, background: text, job: text, hint: text, state: text, actionSeq: number }, ['ok']),
  finish: objectSchema({ ok: { type: 'boolean' }, refused: { type: 'boolean' }, error: text, finished: { type: 'boolean' }, actionSeq: number }, ['ok']),
};
function toolResultOf(name, out, meta, attachedText = null) {
  const structured = Object.hasOwn(OUTPUT_SCHEMAS, name) ? { structuredContent: out } : {};
  const attached = attachedText === null ? [] : [{ type: 'text', text: attachedText }];
  return { content: [{ type: 'text', text: JSON.stringify(out) }, ...attached], ...structured, isError: out.ok !== true, _meta: meta };
}
function titleOf(name) {
  const words = name.replace(/_/g, ' ');
  return words[0].toUpperCase() + words.slice(1);
}

const afterReply = new Map();
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

function notify(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const RESOURCES_CHANGED = { jsonrpc: '2.0', method: 'notifications/resources/list_changed' };
const LOG_LEVELS = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'];
const NOTICE_LEVELS = new Map([
  ['restart', 'notice'], ['reload', 'notice'], ['tools-changed', 'notice'], ['end', 'notice'],
  ['paused', 'info'], ['cancel', 'info'], ['job-unstuck', 'info'],
  ['recovery', 'warning'], ['job-stuck', 'warning'], ['job-killed', 'warning'], ['rules-notice', 'warning'],
  ['error', 'error'],
]);
const DETAIL_FIELDS = ['job', 'tool', 'state', 'code', 'method', 'message', 'error', 'reason', 'status', 'rules', 'sinceProgressMs', 'lastSeq'];
const QUEUE_MAX = 64;
let logLevel = null;
const queuedNotices = [];

function hosted(log) {
  return { ...log, append(kind, data, monoAt) {
    const event = log.append(kind, data, monoAt);
    hostNotice(event);
    return event;
  } };
}

function hostNotice(event) {
  if (event.kind === 'end') notify(RESOURCES_CHANGED);
  const level = NOTICE_LEVELS.get(event.kind);
  if (level === undefined) return;
  const notice = { level, logger: SERVER_NAME, data: { kind: event.kind, seq: event.seq, ...detailOf(event) } };
  if (logLevel !== null) sendNotice(notice);
  else if (queuedNotices.length < QUEUE_MAX) queuedNotices.push(notice);
}

function detailOf(event) {
  return Object.fromEntries(DETAIL_FIELDS.filter((key) => event[key] !== undefined).map((key) => [key, event[key]]));
}

function sendNotice(notice) {
  if (LOG_LEVELS.indexOf(notice.level) >= LOG_LEVELS.indexOf(logLevel)) notify({ jsonrpc: '2.0', method: 'notifications/message', params: notice });
}

function setLogLevel(params) {
  if (!LOG_LEVELS.includes(params?.level)) throw new RpcError(-32602, `unknown log level: ${params?.level}`);
  logLevel = params.level;
  for (const notice of queuedNotices.splice(0)) sendNotice(notice);
  return {};
}

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
    return message?.method === 'tools/call' && message.params?.name === 'next_context' && message.params?.arguments?.child !== true && message.params?.arguments?.run === undefined;
  } catch {
    return false;
  }
}

const SELF_COMPACT = {
  tools: { next_context: { zone1: resultZone1, zone2: resultZone2 } },
};
const NO_MCP = { ready: Promise.resolve(), verbs: () => [], has: () => false, call: () => undefined, stop: () => {} };
let mcp = NO_MCP;
let mcpReady = NO_MCP.ready;
let current = surfaceOf(await loadLeaves());
let activeTools = null;
let activeLog = null;

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
  let task = flags.task === undefined ? '' : loadTask(flags.task).trim();
  if (flags.task !== undefined && task === '') throw new Error('--task is empty');

  let runDir = currentRunDir(flags['run-dir'] === undefined ? join(workspace, 'runs', newRunId()) : resolve(flags['run-dir']));
  const runMeta = (dir, runTask) => ({ id: basename(dir), mode: 'mcp', task: runTask, witness: DEFAULT_WITNESS, workspace, maxSteps, maxInflight, createdAt: new Date().toISOString() });
  const opened = openRun({ runDir, rules: MCP_RULES, meta: runMeta(runDir, task) });
  const { resumed } = opened;
  const log = hosted(opened.log);
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
  if (task === '' && resumed) task = history.findLast((event) => event.kind === 'task')?.text ?? '';
  const recovery = resumed && closedAtBoot === null ? recoveryOf(history) : null;
  if (closedAtBoot === null) {
    if (resumed) log.append('restart', { reason: flags['restart-reason'] ?? 'restarted without a reason' });
    else log.append('start', { mode: 'mcp', maxSteps, maxInflight, taskFrom: flags.task !== undefined ? 'task file' : 'session prompt' });
    if (recovery && recovery.open.length > 0) log.append('recovery', { lastSeq: recovery.lastSeq, open: recovery.open });
  }
  const mcpFlag = flags['mcp-config'];
  const mcpFiles = [{ file: DEFAULT_MCP_CONFIG, required: true }, { file: join(workspace, '.gm', 'mcp.json') }];
  if (mcpFlag !== undefined) mcpFiles.push({ file: resolve(mcpFlag), required: true });
  const { servers, problems } = readServerConfig(mcpFiles, workspace);
  const depth = Number.parseInt(process.env.GMNEW_MCP_DEPTH ?? '0', 10) || 0;
  const client = startMcpClients({ servers, problems, log, depth, reserved: new Set([...current.TOOLS.map((tool) => tool.name), ...BROWSER_VERBS.map((verb) => verb.name)]) });
  mcp = client;
  mcpReady = client.ready.then(() => {
    current = surfaceOf(current.leaves);
    if (closedAtBoot === null) logTools(log, resumed, servedTools(surface));
  });
  process.on('exit', () => client.stop());

  sweepEndedCode(dirname(runDir), runDir);
  const requeueNext = (call) => acceptNow(JSON.stringify({ jsonrpc: '2.0', id: call.rpcId, method: 'tools/call', params: { name: 'next_context', arguments: call.args } }));
  let session = createSession({ ...limits, runDir, log, task, resume, recovery: recovery && recovery.open.length > 0 ? recovery : null, startOverride, requeue: requeueNext });
  let retired = Promise.resolve();
  function reopen(ended) {
    const start = ended.successorStart();
    const closedId = basename(runDir);
    const nextDir = join(dirname(runDir), newRunId());
    const fresh = hosted(openRun({ runDir: nextDir, rules: MCP_RULES, meta: runMeta(nextDir, start.task) }).log);
    setSuccessor(runDir, nextDir);
    runDir = nextDir;
    fresh.append('start', { mode: 'mcp', maxSteps, maxInflight, taskFrom: start.taskFrom });
    if (start.task !== '') fresh.append('task', { from: start.taskFrom, text: start.task });
    const shownFloor = start.inherited ? fresh.count() : 0;
    mcpReady.then(() => logTools(fresh, false, servedTools(surface)));
    console.error(`gm mcp: run ${closedId} has ended; opened run ${basename(runDir)}`);
    return createSession({ ...limits, runDir, log: fresh, task: start.task, taskInherited: start.inherited, shownFloor, requeue: requeueNext });
  }
  const accepting = new Set();
  const acceptNow = (line) => {
    try {
      if (session.ended() !== null && isNextContextCall(line) && !session.hasReply(requestIdOf(line))) {
        retired = Promise.allSettled([retired, session.settled()]);
        session = reopen(session);
        notify(RESOURCES_CHANGED);
      }
      return session.accept(line);
    } catch (err) {
      console.error(`gm mcp: ${err.message}`);
      const id = requestIdOf(line);
      if (id !== undefined) write(errorReply(id, -32603, err.message));
      return Promise.resolve();
    }
  };
  const acceptLine = (line) => {
    const turn = Promise.resolve()
      .then(() => acceptNow(line))
      .catch((err) => console.error(`gm mcp: ${err.message}`))
      .finally(() => accepting.delete(turn));
    accepting.add(turn);
  };
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on('line', acceptLine);
  let pausing = null;
  const pauseRun = (reason) => {
    pausing ??= Promise.all([session.pause(reason), retired]).finally(() => process.exit(0));
    return pausing;
  };
  lines.on('close', () => (flags.supervised === 'yes' ? pauseRun('the supervisor ended stdin') : Promise.allSettled([...accepting]).then(() => session.inputEnded()).then(() => retired).catch((err) => console.error(`gm: ${err.message}`)).finally(() => client.stop())));
  process.once('SIGINT', () => lines.close());
  process.once('SIGTERM', () => pauseRun('SIGTERM from the supervisor'));
  process.stdout.on('error', (err) => console.error(`gm: stdout: ${err.message}`));
  console.error(`gm mcp: run${basename(runDir)} in ${runDir}`);
}

main(process.argv.slice(2)).catch((err) => {
  console.error(`gm mcp: ${err.message}`);
  process.exitCode = 1;
});
