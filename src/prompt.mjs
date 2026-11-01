export const DEFAULT_RULES = `# Rules

1. Work only inside the workspace. A path with a .. segment is refused.
2. Verify before you finish: run what you built and read its output.
3. Reply with exactly one JSON object: {"tool": "<name>", "args": {...}}.
4. finish needs a witness: one string that quotes the evidence you observed.
5. Events older than the window are not in this prompt. Query them with query_log. Do not guess.
6. Never print, store or request secrets, environment variables or API keys.
7. If the task cannot be done, finish with a witness that states why, with the evidence.
`;

export const DEFAULT_WITNESS =
  'Finish only with a witness: one string that states the evidence (command output, file content or query result) showing the task is done.';

const TOOL_HELP = `read_file {path}: text of a file.
write_file {path, content}: write a file, creating parent directories.
list_dir {path}: entries of a directory; directories end with "/".
run_shell {command, timeoutMs?}: run a shell command in the workspace (default timeout 60000 ms). Returns exitCode, signal and output.
query_log {js}: JavaScript expression over "events", every log event so far (seq, t, kind, ...). Returns JSON. Kinds: reply, action, result, refusal, parse_error, error, end.
finish {witness}: end the run. The witness must state the evidence.`;

const MAX_EVENT_CHARS = 4000;

export function buildPrompt({ rules, spec, events, total }) {
  const log = events.map(formatEvent).join('\n') || '(empty)';
  return [
    rules.trim(),
    `## Task\n\n${spec.task}`,
    `## Witness requirement\n\n${spec.witness}`,
    `## Tools\n\n${TOOL_HELP}`,
    `## Log: last ${events.length} of ${total} events (older events: query_log)\n\n${log}`,
    '## Reply\n\nOne JSON object: {"tool": "...", "args": {...}}. Nothing else.',
  ].join('\n\n');
}

export function parseAction(text) {
  const candidates = [text.trim(), text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)];
  for (const candidate of candidates) {
    const action = tryJson(candidate);
    const args = action?.args ?? {};
    if (typeof action?.tool === 'string' && typeof args === 'object' && !Array.isArray(args)) {
      return { ok: true, tool: action.tool, args };
    }
  }
  return { ok: false, error: 'reply is not a JSON object with a string "tool" and an object "args"' };
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
