#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { DEFAULT_WITNESS, prefixShaOf, renderTools } from './prompt.mjs';
import { isDirectory, loadTask, newRunId, openRun, ROOT, RUNS } from './run.mjs';
import { conflicts, createTools } from './tools.mjs';
import { GIT_TOOLS } from './git.mjs';
import { ROW_TOOLS } from './rows.mjs';
import { SEARCH_TOOLS } from './search.mjs';
import { FETCH_TOOLS } from './fetch.mjs';
import { CODE_TOOLS } from './code.mjs';
import { writeSummary } from './summary.mjs';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'gm-new', version: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version };
const SKILL_URI = 'gm-new://skill/SKILL.md';
const SKILL = parseSkill(readFileSync(join(ROOT, 'skills', 'gm-new', 'SKILL.md'), 'utf8'));
const SKILL_PROMPT = { name: SKILL.name, description: SKILL.description, arguments: [{ name: 'task', description: 'The task to run', required: false }] };
const SKILL_RESOURCE = { uri: SKILL_URI, name: `${SKILL.name} skill`, description: SKILL.description, mimeType: 'text/markdown' };
const WINDOW = 20;
const EVENT_CAP = 4000;
const DEFAULT_MAX_STEPS = 50;
const DEFAULT_MAX_INFLIGHT = 8;
const USAGE = 'usage: node src/mcp.mjs --workspace <dir> --task <file-or-text> [--run-dir <dir>] [--max-steps N] [--max-inflight N]';

const MCP_RULES = `# Rules

1. Work only inside the workspace. A path with a .. segment is refused.
2. Call next_context at the start of every step. Each call is one step; stepsLeft counts the steps the run has left.
3. Verify before you finish: run what you built and read its output.
4. finish needs a witness: one string that quotes the evidence you observed. Calls sent with finish may be refused.
5. Events older than the window are not in next_context. Query them with query_log. Do not guess.
6. Never print, store or request secrets, environment variables or API keys.
7. If the task cannot be done, finish with a witness that states why, with the evidence.
`;

const text = { type: 'string' };
const number = { type: 'number' };
const objectSchema = (properties, required = []) => ({ type: 'object', properties, required });

const TOOLS = [
  { name: 'next_context', description: 'Begin a step. Returns rules, task, witness requirement, the last 20 log events and prefixSha. Call it at the start of each step.', inputSchema: objectSchema({}) },
  { name: 'read_file', description: 'Read a text file in the workspace, one page of at most 20000 characters. Returns output, total characters, the offset of this page and next, the offset of the next page (null at the end).', inputSchema: objectSchema({ path: text, offset: number, limit: number }, ['path']) },
  { name: 'write_file', description: 'Write a text file in the workspace, creating parent directories.', inputSchema: objectSchema({ path: text, content: text }, ['path', 'content']) },
  { name: 'edit_file', description: 'Replace old with new in a workspace text file. old must occur once, unless replaceAll is true.', inputSchema: objectSchema({ path: text, old: text, new: text, replaceAll: { type: 'boolean' } }, ['path', 'old', 'new']) },
  { name: 'stat_file', description: 'Type, size and mtime of a workspace path, as JSON.', inputSchema: objectSchema({ path: text }, ['path']) },
  { name: 'list_dir', description: 'List a workspace directory. Directories end with "/".', inputSchema: objectSchema({ path: text }) },
  { name: 'run_shell', description: 'Run a shell command in the workspace and wait for it. Default timeout 60000 ms. Its process group is killed when it returns, so background work must go through job_start.', inputSchema: objectSchema({ command: text, timeoutMs: number }, ['command']) },
  { name: 'job_start', description: 'Start a shell command as a named background job and return at once. Poll it with job_status.', inputSchema: objectSchema({ job: text, command: text, timeoutMs: number }, ['job', 'command']) },
  { name: 'job_status', description: 'State (running, exited or killed), exit code and output tail of a job. waitMs polls until the job leaves running, at most 30000 ms. offset returns a page of 20000 characters of the output from that offset, with next.', inputSchema: objectSchema({ job: text, waitMs: number, offset: number }, ['job']) },
  { name: 'query_log', description: 'Evaluate a JavaScript expression over the run events array and return JSON.', inputSchema: objectSchema({ js: text }, ['js']) },
  { name: 'finish', description: 'End the run. witness is one string that quotes the evidence you observed.', inputSchema: objectSchema({ witness: text }, ['witness']) },
  ...SEARCH_TOOLS,
  ...FETCH_TOOLS,
  ...CODE_TOOLS,
  ...GIT_TOOLS,
  ...ROW_TOOLS,
];

const TOOL_TEXT = renderTools(TOOLS);
const NO_PATHS = { items: [], free: true };

function parseSkill(text) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) throw new Error('skills/gm-new/SKILL.md has no frontmatter');
  const fields = Object.fromEntries(match[1].split('\n').map((line) => line.split(/:\s*(.*)/s).slice(0, 2)));
  return { text, name: fields.name, description: fields.description, body: text.slice(match[0].length).trim() };
}

class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function createSession({ workspace, runDir, log, task, maxSteps, maxInflight, resume = null }) {
  const runId = basename(runDir);
  const tools = createTools({ workspace, runDir, log, background: true });
  const active = new Map();
  const waiting = [];
  const unansweredTurns = new Set();
  let steps = resume?.steps ?? 0;
  let ended = resume?.ended ?? null;
  let endLogged = ended !== null;

  const handlers = {
    read_file: (args) => tools.run('read_file', args),
    write_file: (args) => tools.run('write_file', args),
    list_dir: (args) => tools.run('list_dir', args),
    run_shell: ({ command, timeoutMs }) => tools.run('run_shell', { command, timeoutMs }),
    job_start: ({ job, command, timeoutMs }) => tools.run('run_shell', { job, command, timeoutMs, background: true }),
    job_status: ({ job, waitMs, offset }) => tools.run('job_status', { job, waitMs, offset }),
    query_log: ({ js }) => tools.run('query_log', { js }),
  };

  function accept(line) {
    if (line.trim() === '') return;
    const turn = handleLine(line)
      .then((reply) => {
        if (reply !== null) write(reply);
      })
      .catch((err) => console.error(`gm-new: ${err.message}`))
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
    try {
      const result = await route(message.method, message.params);
      return request ? { jsonrpc: '2.0', id: message.id, result: result ?? {} } : null;
    } catch (err) {
      if (!request) return null;
      const code = err instanceof RpcError ? err.code : -32603;
      log.append('error', { method: message.method, code, message: err.message });
      return errorReply(message.id, code, err.message);
    }
  }

  async function route(method, params) {
    if (method === 'initialize') return initialize(params);
    if (method === 'ping' || method === 'server/discover') return {};
    if (method === 'tools/list') return { tools: TOOLS };
    if (method === 'tools/call') return callTool(params);
    if (method === 'prompts/list') return { prompts: [SKILL_PROMPT] };
    if (method === 'prompts/get') return getPrompt(params);
    if (method === 'resources/list') return { resources: [SKILL_RESOURCE] };
    if (method === 'resources/read') return readResource(params);
    if (method === 'resources/templates/list') return { resourceTemplates: [] };
    if (method.startsWith('notifications/')) return null;
    throw new RpcError(-32601, `method not found: ${method}`);
  }

  function initialize(params) {
    const version = typeof params?.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION;
    return { protocolVersion: version, capabilities: { tools: { listChanged: true }, prompts: { listChanged: true }, resources: { listChanged: true } }, serverInfo: SERVER_INFO };
  }

  function getPrompt(params) {
    if (params?.name !== SKILL.name) throw new RpcError(-32602, `unknown prompt: ${params?.name}`);
    const task = typeof params?.arguments?.task === 'string' ? params.arguments.task.trim() : '';
    const text = task === '' ? SKILL.body : `${SKILL.body}\n\nTask: ${task}`;
    return { description: SKILL.description, messages: [{ role: 'user', content: { type: 'text', text } }] };
  }

  function readResource(params) {
    if (params?.uri !== SKILL_URI) throw new RpcError(-32602, `unknown resource: ${params?.uri}`);
    return { contents: [{ uri: SKILL_URI, mimeType: 'text/markdown', text: SKILL.text }] };
  }

  async function callTool(params) {
    const name = params?.name;
    const args = params?.arguments ?? {};
    if (typeof name !== 'string') throw new RpcError(-32602, 'tools/call needs a string name');
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      throw new RpcError(-32602, 'tools/call arguments must be an object');
    }
    const out = await startCall(name, args);
    return { content: [{ type: 'text', text: JSON.stringify(out) }], isError: out.ok !== true };
  }

  function startCall(name, args) {
    return new Promise((resolveCall) => {
      waiting.push({ name, args, resolveCall });
      drain();
    });
  }

  function drain() {
    if (ended !== null) {
      for (const call of waiting.splice(0)) call.resolveCall(refuse(call.name, call.args, endedReason()));
      return;
    }
    while (active.size < maxInflight && waiting.length > 0) {
      const accesses = waiting.map((call) => accessOf(call.name, call.args));
      const index = startableIndex(accesses);
      if (index < 0) return;
      const [call] = waiting.splice(index, 1);
      call.resolveCall(invoke(call.name, call.args, accesses[index]));
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

  function invoke(name, args, access) {
    if (ended !== null) return refuse(name, args, endedReason());
    if (name === 'next_context') return nextContext(access);
    if (name === 'finish') return finish(args, access);
    if (Object.hasOwn(handlers, name)) return act(name, args, access, () => handlers[name](args));
    return act(name, args, access, () => tools.run(name, args));
  }

  async function nextContext(access) {
    if (steps >= maxSteps) {
      stop('max_steps');
      const out = refuse('next_context', {}, `step limit ${maxSteps} reached`);
      await endRun('max_steps', null);
      return out;
    }
    steps += 1;
    const step = steps;
    return act('next_context', {}, access, () => context(step), ({ ok, error, prefixSha, total }) => ({ ok, error, prefixSha, total }));
  }

  async function context(step) {
    const rules = await readFile(join(runDir, 'rules.md'), 'utf8');
    return {
      ok: true,
      step,
      stepsLeft: maxSteps - step,
      maxSteps,
      rules,
      task,
      witness: DEFAULT_WITNESS,
      prefixSha: prefixShaOf({ rules, task, witness: DEFAULT_WITNESS, tools: TOOL_TEXT }),
      total: log.count(),
      events: log.recent(WINDOW).map(compactEvent),
    };
  }

  async function finish(args, access) {
    if (typeof args.witness !== 'string' || args.witness.trim() === '') {
      return refuse('finish', args, 'finish needs a non-empty witness string');
    }
    stop('finished');
    const out = await act('finish', args, access, () => tools.run('finish', args));
    await endRun('finished', out.output);
    return out;
  }

  function act(tool, args, access, exec, digest = (result) => result) {
    const work = perform(tool, args, exec, digest);
    active.set(work, access);
    const forget = () => {
      active.delete(work);
      drain();
    };
    work.then(forget, forget);
    return work;
  }

  async function perform(tool, args, exec, digest) {
    const step = steps;
    const startMono = log.now();
    log.enter();
    log.append('action', { step, tool, args });
    let result;
    try {
      result = await exec();
    } catch (err) {
      result = { ok: false, error: err.message };
    }
    if (result.refused) log.append('refusal', { step, tool, error: result.error, startMono });
    else log.append('result', { step, tool, startMono, ...digest(result) });
    log.leave();
    return result;
  }

  function refuse(tool, args, reason) {
    const step = steps;
    const startMono = log.now();
    log.append('action', { step, tool, args });
    const result = { ok: false, refused: true, error: `refused: ${reason}` };
    log.append('refusal', { step, tool, error: result.error, startMono });
    return result;
  }

  async function endRun(status, witness) {
    endLogged = true;
    await Promise.allSettled([...active.keys()]);
    await tools.close();
    writeSummary(log);
    log.append('end', { status, steps, witness });
  }

  async function inputEnded() {
    if (ended === null) stop('closed');
    await Promise.allSettled([...unansweredTurns]);
    if (!endLogged) await endRun(ended, null);
  }

  // A restart is not a finish. New calls are refused, calls in flight finish, background jobs are stopped and logged,
  // and no end event is written, so the next worker resumes this run.
  async function quiesceForRestart() {
    ended = 'restarting';
    for (const call of waiting.splice(0)) call.resolveCall(refuse(call.name, call.args, endedReason()));
    await Promise.allSettled([...active.keys()]);
    await tools.close();
  }

  return { accept, inputEnded, quiesceForRestart };
}

// Where a resumed run stands: the steps it has taken, and whether it already ended.
function resumeFrom(events) {
  const steps = events.filter((event) => event.kind === 'result' && event.tool === 'next_context' && event.ok === true).length;
  const end = events.findLast((event) => event.kind === 'end');
  return { steps, ended: end ? end.status : null };
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function errorReply(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function isRequestShape(message) {
  return message !== null && typeof message === 'object' && !Array.isArray(message) && typeof message.method === 'string';
}

function compactEvent(event) {
  const text = JSON.stringify(event);
  return text.length <= EVENT_CAP ? event : { seq: event.seq, kind: event.kind, truncated: text.slice(0, EVENT_CAP) };
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
function logTools(log, resumed) {
  const sha = createHash('sha256').update(JSON.stringify(TOOLS)).digest('hex');
  const last = resumed ? log.events().findLast((event) => event.kind === 'tools') : undefined;
  if (last && last.sha !== sha) log.append('tools-changed', { old: last.sha, new: sha });
  log.append('tools', { sha, count: TOOLS.length });
}

function positiveInt(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${name} must be a positive integer`);
  return number;
}

async function main(argv) {
  const flags = parseFlags(argv);
  if (!flags.workspace || !flags.task) throw new Error(USAGE);
  const workspace = resolve(flags.workspace);
  if (!isDirectory(workspace)) throw new Error(`workspace is not a directory: ${workspace}`);
  const maxSteps = positiveInt(flags['max-steps'] ?? DEFAULT_MAX_STEPS, '--max-steps');
  const maxInflight = positiveInt(flags['max-inflight'] ?? DEFAULT_MAX_INFLIGHT, '--max-inflight');
  const task = loadTask(flags.task).trim();
  if (task === '') throw new Error('--task is empty');

  let runDir = flags['run-dir'] === undefined ? join(RUNS, newRunId()) : resolve(flags['run-dir']);
  const runMeta = (dir) => ({ id: basename(dir), mode: 'mcp', task, witness: DEFAULT_WITNESS, workspace, maxSteps, maxInflight, createdAt: new Date().toISOString() });
  let { log, resumed } = openRun({ runDir, rules: MCP_RULES, meta: runMeta(runDir) });
  let resume = resumed ? resumeFrom(log.events()) : null;
  if (resume?.ended) {
    // A closed run stays closed. A start after it opens a new run beside it, with the same task and workspace.
    const closed = `${basename(runDir)} (${resume.ended})`;
    runDir = join(dirname(runDir), newRunId());
    ({ log, resumed } = openRun({ runDir, rules: MCP_RULES, meta: runMeta(runDir) }));
    resume = null;
    console.error(`gm-new mcp: run ${closed} is closed; opened run ${basename(runDir)}`);
  }
  if (resumed) log.append('restart', { reason: flags['restart-reason'] ?? 'restarted without a reason' });
  else log.append('start', { mode: 'mcp', maxSteps, maxInflight });
  logTools(log, resumed);

  const session = createSession({ workspace, runDir, log, task, maxSteps, maxInflight, resume });
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on('line', session.accept);
  lines.on('close', () => session.inputEnded().catch((err) => console.error(`gm-new: ${err.message}`)));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => lines.close());
  process.on('SIGUSR2', () => session.quiesceForRestart().finally(() => process.exit(0)));
  process.stdout.on('error', (err) => console.error(`gm-new: stdout: ${err.message}`));
  console.error(`gm-new mcp: run ${basename(runDir)} in ${runDir}`);
}

main(process.argv.slice(2)).catch((err) => {
  console.error(`gm-new mcp: ${err.message}`);
  process.exitCode = 1;
});
