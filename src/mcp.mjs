#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { DEFAULT_WITNESS, prefixShaOf, renderTools } from './prompt.mjs';
import { createRun, isDirectory, loadTask, newRunId, ROOT, RUNS } from './run.mjs';
import { conflicts, createTools } from './tools.mjs';
import { writeSummary } from './summary.mjs';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'gm-new', version: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version };
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
  { name: 'read_file', description: 'Read a text file in the workspace.', inputSchema: objectSchema({ path: text }, ['path']) },
  { name: 'write_file', description: 'Write a text file in the workspace, creating parent directories.', inputSchema: objectSchema({ path: text, content: text }, ['path', 'content']) },
  { name: 'list_dir', description: 'List a workspace directory. Directories end with "/".', inputSchema: objectSchema({ path: text }) },
  { name: 'run_shell', description: 'Run a shell command in the workspace and wait for it. Default timeout 60000 ms. Its process group is killed when it returns, so background work must go through job_start.', inputSchema: objectSchema({ command: text, timeoutMs: number }, ['command']) },
  { name: 'job_start', description: 'Start a shell command as a named background job and return at once. Poll it with job_status.', inputSchema: objectSchema({ job: text, command: text, timeoutMs: number }, ['job', 'command']) },
  { name: 'job_status', description: 'State (running, exited or killed), exit code and output tail of a job. waitMs polls until the job leaves running, at most 30000 ms.', inputSchema: objectSchema({ job: text, waitMs: number }, ['job']) },
  { name: 'query_log', description: 'Evaluate a JavaScript expression over the run events array and return JSON.', inputSchema: objectSchema({ js: text }, ['js']) },
  { name: 'finish', description: 'End the run. witness is one string that quotes the evidence you observed.', inputSchema: objectSchema({ witness: text }, ['witness']) },
];

// The tool list as the prefix hash sees it, rendered the same way as the CLI's list.
const TOOL_TEXT = renderTools(TOOLS);
// next_context reads the rules and a snapshot of the log, so it never waits behind a path call or a barrier.
const NO_PATHS = { items: [], free: true };

class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// One session per run. Requests are handled as independent turns, and each reply is written with its request id.
function createSession({ workspace, runDir, log, task, maxSteps, maxInflight }) {
  const tools = createTools({ workspace, runDir, log, background: true });
  const active = new Map(); // tool calls that have started and not settled, each with its path access
  const waiting = []; // tool calls accepted but not started, in arrival order
  const pending = new Set(); // request turns that have not written their reply
  let steps = 0;
  let ended = null; // null while running, else finished, max_steps or closed
  let endLogged = false;

  const handlers = {
    read_file: (args) => tools.run('read_file', args),
    write_file: (args) => tools.run('write_file', args),
    list_dir: (args) => tools.run('list_dir', args),
    run_shell: ({ command, timeoutMs }) => tools.run('run_shell', { command, timeoutMs }),
    job_start: ({ job, command, timeoutMs }) => tools.run('run_shell', { job, command, timeoutMs, background: true }),
    job_status: ({ job, waitMs }) => tools.run('job_status', { job, waitMs }),
    query_log: ({ js }) => tools.run('query_log', { js }),
  };

  function accept(line) {
    if (line.trim() === '') return;
    const turn = handleLine(line)
      .then((reply) => {
        if (reply !== null) write(reply);
      })
      .catch((err) => console.error(`gm-new: ${err.message}`))
      .finally(() => pending.delete(turn));
    pending.add(turn);
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
    if (method.startsWith('notifications/')) return null;
    throw new RpcError(-32601, `method not found: ${method}`);
  }

  function initialize(params) {
    const version = typeof params?.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION;
    return { protocolVersion: version, capabilities: { tools: {} }, serverInfo: SERVER_INFO };
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

  // A call waits in the queue until drain starts it.
  function startCall(name, args) {
    return new Promise((resolveCall) => {
      waiting.push({ name, args, resolveCall });
      drain();
    });
  }

  // Starts waiting calls while a slot is free. A call starts only when no active call conflicts with it, and no
  // earlier waiting call conflicts with it, so conflicting calls keep their arrival order and none is starved.
  // Once the run has ended, every waiting call is refused.
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

  // Ends the run for new calls. Queued calls that have not started are refused now, so none starts later.
  function stop(status) {
    ended = status;
    drain();
  }

  function endedReason() {
    return ended === 'closed' ? 'stdin closed before the call started' : `run has ended (${ended})`;
  }

  function invoke(name, args, access) {
    if (ended !== null) return refuse(name, args, endedReason());
    if (name === 'next_context') return nextContext(access);
    if (name === 'finish') return finish(args, access);
    if (Object.hasOwn(handlers, name)) return act(name, args, access, () => handlers[name](args));
    return act(name, args, access, () => ({ ok: false, error: `unknown tool: ${name}` }));
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

  // Runs a call that starts work. It counts as in flight from its action event until its result event.
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

  // A refusal starts no work, so it is logged without entering the in-flight count.
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

  // Stdin has ended: no new call starts, calls in flight finish and are answered, then the run ends as closed.
  async function inputEnded() {
    if (ended === null) stop('closed');
    await Promise.allSettled([...pending]);
    if (!endLogged) await endRun(ended, null);
  }

  return { accept, inputEnded };
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

  const runDir = flags['run-dir'] === undefined ? join(RUNS, newRunId()) : resolve(flags['run-dir']);
  const id = basename(runDir);
  const meta = { id, mode: 'mcp', task, witness: DEFAULT_WITNESS, workspace, maxSteps, maxInflight, createdAt: new Date().toISOString() };
  const log = createRun({ runDir, rules: MCP_RULES, meta });
  log.append('start', { mode: 'mcp', maxSteps, maxInflight });

  const session = createSession({ workspace, runDir, log, task, maxSteps, maxInflight });
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on('line', session.accept);
  lines.on('close', () => session.inputEnded().catch((err) => console.error(`gm-new: ${err.message}`)));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => lines.close());
  process.stdout.on('error', (err) => console.error(`gm-new: stdout: ${err.message}`));
  console.error(`gm-new mcp: run ${id} in ${runDir}`);
}

main(process.argv.slice(2)).catch((err) => {
  console.error(`gm-new mcp: ${err.message}`);
  process.exitCode = 1;
});
