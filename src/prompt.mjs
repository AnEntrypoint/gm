import { createHash } from 'node:crypto';

export const DEFAULT_RULES = `# Rules

1. Work only inside the workspace. A path with a .. segment is refused.
2. Verify before you finish: run what you built and read its output.
3. Reply with one JSON object {"tool": "<name>", "args": {...}}, or a JSON array of such objects when the actions are independent. Independent actions run together. An action that needs an earlier result goes in a later reply.
4. finish needs a witness: one string that quotes the evidence you observed. finish must be the only action in its reply.
5. Events older than the window are not in this prompt. Query them with query_log. Do not guess.
6. Never print, store or request secrets, environment variables or API keys.
7. If the task cannot be done, finish with a witness that states why, with the evidence.
`;

export const DEFAULT_WITNESS =
  'Finish only with a witness: one string that states the evidence (command output, file content or query result) showing the task is done.';

const TOOL_HELP = `read_file {path}: text of a file.
write_file {path, content}: write a file, creating parent directories.
list_dir {path}: entries of a directory; directories end with "/".
run_shell {command, timeoutMs?, background?, job?}: run a shell command in the workspace (default timeout 60000 ms). Returns exitCode, signal and output. With background true and a job name, it returns at once; the job keeps running while you act. Read a job's files only after job_status shows exited. A job still running when the run ends is killed.
job_status {job, waitMs?}: state (running, exited or killed), exitCode and the last 2000 characters of output. With waitMs it polls the job every 100 ms until it leaves running or waitMs passes (max 30000).
query_log {js}: JavaScript expression over "events", every log event so far (seq, t, mono, kind, ...). Returns JSON. Kinds: start, reply, action, result, refusal, skipped, parse_error, error, end.
finish {witness}: end the run. The witness must state the evidence.`;

const MAX_EVENT_CHARS = 4000;
const MAX_ACTIONS = 16;

// The prefix (rules, task, witness, tools, reply format) is identical on every
// step, so it comes first and prompt caching can cover it. The event window
// changes every step, so it comes last.
export function buildPrompt({ rules, spec, events, total }) {
  const prefix = [
    rules.trim(),
    `## Task\n\n${spec.task}`,
    `## Witness requirement\n\n${spec.witness}`,
    `## Tools\n\n${TOOL_HELP}`,
    '## Reply\n\nOne JSON object {"tool": "...", "args": {...}}, or a JSON array of them when the actions are independent. Nothing else.',
  ].join('\n\n');
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
