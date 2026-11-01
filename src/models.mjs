const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';
const MAX_TOKENS = 4096;

const SCRIPT = [
  [
    { tool: 'write_file', args: { path: 'hello.mjs', content: 'console.log("gmnew scripted witness");\n' } },
    { tool: 'write_file', args: { path: 'notes.txt', content: 'two independent actions in one reply\n' } },
  ],
  { tool: 'run_shell', args: { command: 'node hello.mjs > out.txt' } },
  { tool: 'read_file', args: { path: 'out.txt' } },
  { tool: 'read_file', args: { path: '../outside.txt' } },
  { tool: 'query_log', args: { js: "events.filter((e) => e.kind === 'refusal').length" } },
  {
    tool: 'finish',
    args: {
      witness:
        'node hello.mjs wrote "gmnew scripted witness" to out.txt; read_file out.txt returned that line; read_file ../outside.txt was refused (see refusal event).',
    },
  },
];

const SCRIPT_EXHAUSTED = {
  tool: 'finish',
  args: { witness: 'scripted model has no further steps' },
};

export function createModel(name, options = {}) {
  if (name === 'scripted') return scriptedModel(options.script, options.faults, options.latencyMs);
  if (name === 'anthropic') return anthropicModel();
  throw new Error(`unknown model: ${name} (use scripted or anthropic)`);
}

// A script entry is a reply: a string is sent as the text, anything else as JSON.
// {"httpError": {"status": 429, "retryAfter": 1}} fails that call (retryAfter in seconds).
// Each entry of faults fails one call with that HTTP status before the script resumes.
// latencyMs above 0 simulates a wait: every call, a faulted one included, waits that long first.
function scriptedModel(script, faults = [], latencyMs = 0) {
  const replies = script ?? SCRIPT;
  const pending = [...faults];
  let turn = 0;
  return {
    async reply() {
      if (latencyMs > 0) await new Promise((done) => setTimeout(done, latencyMs));
      if (pending.length > 0) throw scriptedHttpError(pending.shift());
      const entry = turn < replies.length ? replies[turn] : SCRIPT_EXHAUSTED;
      turn += 1;
      if (entry?.httpError) throw scriptedHttpError(entry.httpError);
      const text = typeof entry === 'string' ? entry : JSON.stringify(entry);
      return { text, usage: { cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } };
    },
  };
}

function scriptedHttpError(fault) {
  const { status, message, retryAfter } = typeof fault === 'number' ? { status: fault } : fault;
  return httpError(status, message ?? `scripted HTTP ${status}`, {
    errorType: `http_${status}`,
    retryAfterMs: retryAfter === undefined ? undefined : retryAfter * 1000,
  });
}

function httpError(status, message, { errorType, retryAfterMs }) {
  const err = new Error(message);
  err.status = status;
  err.errorType = errorType;
  if (retryAfterMs !== undefined) err.retryAfterMs = retryAfterMs;
  return err;
}

// retry-after is either a number of seconds or an HTTP date.
function retryAfterMs(response) {
  const value = response.headers.get('retry-after');
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function anthropicModel() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set; export it, or run with --model scripted');
  return {
    async reply(prompt, { prefix } = {}) {
      const response = await send(key, anthropicRequestBody(prompt, { prefix }));
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw httpError(response.status, `Messages API returned HTTP ${response.status}: ${body.error?.message ?? 'no detail'}`, {
          errorType: body.error?.type ?? `http_${response.status}`,
          retryAfterMs: retryAfterMs(response),
        });
      }
      return {
        text: (body.content ?? [])
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join(''),
        usage: cacheUsage(body.usage),
      };
    },
  };
}

// A failure before any response is a network error. Its code (ECONNRESET, UND_ERR_HEADERS_TIMEOUT, ...) is the errorType.
async function send(key, body) {
  try {
    return await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const failure = new Error(`network error calling the Messages API: ${err.cause?.message ?? err.message}`);
    failure.errorType = err.cause?.code ?? err.code ?? err.name;
    failure.network = true;
    throw failure;
  }
}

// The Messages API request for one step. --dump-request prints this same object.
export function anthropicRequestBody(prompt, { prefix } = {}) {
  return {
    model: process.env.GMNEW_MODEL || DEFAULT_ANTHROPIC_MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: userContent(prompt, prefix) }],
  };
}

// The stable prefix gets a cache breakpoint on its last block, so the API can reuse it on the next step.
function userContent(prompt, prefix) {
  if (!prefix || !prompt.startsWith(prefix)) return prompt;
  return [
    { type: 'text', text: prefix, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: prompt.slice(prefix.length) },
  ];
}

// Cache counters are kept only when the API reports them.
function cacheUsage(usage) {
  const counters = {};
  for (const key of ['cache_creation_input_tokens', 'cache_read_input_tokens']) {
    if (usage?.[key] !== undefined) counters[key] = usage[key];
  }
  return counters;
}
