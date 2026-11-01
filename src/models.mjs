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

export function createModel(name) {
  if (name === 'scripted') return scriptedModel();
  if (name === 'anthropic') return anthropicModel();
  throw new Error(`unknown model: ${name} (use scripted or anthropic)`);
}

function scriptedModel() {
  let turn = 0;
  return {
    async reply() {
      const action = SCRIPT[turn] ?? SCRIPT_EXHAUSTED;
      turn += 1;
      return { text: JSON.stringify(action) };
    },
  };
}

function anthropicModel() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set; export it, or run with --model scripted');
  const model = process.env.GMNEW_MODEL || DEFAULT_ANTHROPIC_MODEL;
  return {
    async reply(prompt) {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': API_VERSION,
        },
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(`Messages API returned HTTP ${response.status}: ${body.error?.message ?? 'no detail'}`);
      }
      return {
        text: (body.content ?? [])
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join(''),
      };
    },
  };
}
