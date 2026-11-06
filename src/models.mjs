const SCRIPT = [
  [
    { tool: 'write_file', args: { path: 'hello.mjs', content: 'console.log("gm scripted witness");\n' } },
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
        'node hello.mjs wrote "gm scripted witness" to out.txt; read_file out.txt returned that line; read_file ../outside.txt was refused (see refusal event).',
    },
  },
];

const SCRIPT_EXHAUSTED = {
  tool: 'finish',
  args: { witness: 'scripted model has no further steps' },
};

export function createModel(name, options = {}) {
  if (name === 'scripted') return scriptedModel(options.script, options.faults, options.latencyMs);
  throw new Error(`unknown model: ${name}; gm calls no API, so the only model is scripted`);
}

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
      return { text };
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
