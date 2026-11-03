import { createHash } from 'node:crypto';

export const DEFAULT_RULES = `# Rules

1. Paths may point inside or outside the workspace. An outside path should be absolute.
2. Verify before you finish: run what you built and read its output.
3. Reply with one JSON object {"tool": "<name>", "args": {...}}, or a JSON array of such objects when the actions are independent. Independent actions run together. An action that needs an earlier result goes in a later reply.
4. finish needs a witness: one string that quotes the evidence you observed. finish must be the only action in its reply.
5. Events older than the window are not in this prompt. Query them with query_log. Do not guess.
6. Never print, store or request secrets, environment variables or API keys.
7. If the task cannot be done, finish with a witness that states why, with the evidence.
`;

// The rules of an MCP run. They are written to the run's rules.md, served by the server's instructions, and held word for word by the gm
// skill: the gate checks the skill against this text (src/skills.mjs).
export const MCP_RULES = `# Rules

1. Paths may point inside or outside the workspace. An outside path should be absolute.
2. Call next_context at the start of every step. Each call is one step; stepsLeft counts the steps the run has left.
3. Verify before you finish: run what you built and read its output.
4. finish needs a witness: one string that quotes the evidence you observed. Calls sent with finish may be refused.
5. Events older than the window are not in next_context. Query them with query_log. Do not guess.
6. Never print, store or request secrets, environment variables or API keys.
7. If the task cannot be done, finish with a witness that states why, with the evidence.
`;

export const DEFAULT_WITNESS =
  'Finish only with a witness: one string that states the evidence (command output, file content or query result) showing the task is done.';

const str = { type: 'string' };
const num = { type: 'number' };
const obj = (properties, required = []) => ({ type: 'object', properties, required });

export const CLI_TOOLS = [
  { name: 'read_file', description: 'text of a file.', inputSchema: obj({ path: str }, ['path']) },
  { name: 'write_file', description: 'write a file, creating parent directories.', inputSchema: obj({ path: str, content: str }, ['path', 'content']) },
  { name: 'list_dir', description: 'entries of a directory; directories end with "/".', inputSchema: obj({ path: str }) },
  {
    name: 'run_shell',
    description: 'run a shell command in the workspace (default timeout 60000 ms). Returns exitCode, signal and output. The command process group is killed when the command returns, so background work must use background true with a job name. Read the job files only after job_status shows exited. A job still running when the run ends is killed.',
    inputSchema: obj({ command: str, timeoutMs: num, background: { type: 'boolean' }, job: str }, ['command']),
  },
  { name: 'job_status', description: 'state (running, exited or killed), exitCode and the last 2000 characters of output. With waitMs it polls every 100 ms until the job leaves running or waitMs passes (max 30000).', inputSchema: obj({ job: str, waitMs: num }, ['job']) },
  { name: 'query_log', description: 'JavaScript expression over "events", every log event so far (seq, t, mono, kind, ...). Returns JSON. Kinds: start, reply, action, result, refusal, skipped, parse_error, error, retry, job, pending, summary, end.', inputSchema: obj({ js: str }, ['js']) },
  { name: 'finish', description: 'end the run. The witness must state the evidence.', inputSchema: obj({ witness: str }, ['witness']) },
];

export function renderTools(tools) {
  return tools.map((tool) => `${tool.name} ${JSON.stringify(tool.inputSchema)}: ${tool.description}`).join('\n');
}

const MAX_EVENT_CHARS = 4000;
const MAX_ACTIONS = 16;

const REPLY_TEXT = '## Reply\n\nOne JSON object {"tool": "...", "args": {...}}, or a JSON array of them when the actions are independent. Nothing else.';

export function renderPrefix({ rules, task, witness, tools }) {
  return [rules.trim(), `## Task\n\n${task}`, `## Witness requirement\n\n${witness}`, `## Tools\n\n${tools}`, REPLY_TEXT].join('\n\n');
}

export function prefixShaOf(args) {
  return hashPrefix(renderPrefix(args));
}

export function buildPrompt({ rules, spec, events, total }) {
  const prefix = renderPrefix({ rules, task: spec.task, witness: spec.witness, tools: renderTools(CLI_TOOLS) });
  const log = events.map(formatEvent).join('\n') || '(empty)';
  const window = `## Log: last ${events.length} of ${total} events (older events: query_log)\n\n${log}`;
  return { prompt: `${prefix}\n\n${window}`, prefix, prefixSha: hashPrefix(prefix) };
}

function hashPrefix(prefix) {
  return createHash('sha256').update(prefix).digest('hex');
}

export function parseActions(text) {
  const candidates = [text.trim(), between(text, '{', '}'), between(text, '[', ']')];
  for (const candidate of candidates) {
    const value = tryJson(candidate);
    if (value === undefined) continue;
    const list = Array.isArray(value) ? value : [value];
    if (list.length === 0 || list.length > MAX_ACTIONS) continue;
    if (list.every(isAction)) return { ok: true, actions: list.map((item) => ({ tool: item.tool, args: item.args ?? {} })) };
  }
  return {
    ok: false,
    error: `reply is not a JSON object or array of 1 to ${MAX_ACTIONS} objects, each with a string "tool" and an object "args"`,
  };
}

function isAction(item) {
  const args = item?.args ?? {};
  return typeof item?.tool === 'string' && typeof args === 'object' && args !== null && !Array.isArray(args);
}

function between(text, open, close) {
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  return start === -1 || end < start ? '' : text.slice(start, end + 1);
}

function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function formatEvent(event) {
  const text = JSON.stringify(event);
  if (text.length <= MAX_EVENT_CHARS) return text;
  return `${text.slice(0, MAX_EVENT_CHARS)} ...[cut in prompt, full text via query_log]`;
}
