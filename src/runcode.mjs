// The code surface's run_code tool. A body is a JavaScript async function body. It receives gm, which has one method per
// verb, and gm.verbs(). Each method is a call through the session, so every call is logged as a code-call event. A failed
// call returns {ok:false, error} as data, so one failure does not abort the body. The body runs in the worker's process, so
// it is trusted as much as run_shell is: it is not sandboxed.
const DEFAULT_TIMEOUT_MS = 120000;
const MAX_TIMEOUT_MS = 600000;
const OUTPUT_CAP = 20000;
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

// The tool's description names the verbs and nothing else about them, so a change to a verb's description does not change
// the served list, or the prefix hash that the list feeds.
export function runCodeTool(verbNames) {
  return {
    name: 'run_code',
    description: `Run a JavaScript async function body. It receives gm, with one method per verb: await gm.<name>(args). The verbs are: ${verbNames.join(', ')}. gm.verbs() returns each verb's description and input schema as data. A failed call returns {ok:false, error} and does not stop the body. The body's return value comes back as JSON. finish is not a verb: end the run with the finish tool.`,
    inputSchema: { type: 'object', properties: { body: { type: 'string' }, timeoutMs: { type: 'number' } }, required: ['body'] },
  };
}

// Runs one body. verbs is the list of {name, description, inputSchema}, and call(name, args) runs one verb through the session.
export async function runBody({ body, timeoutMs = DEFAULT_TIMEOUT_MS, verbs, call }) {
  if (typeof body !== 'string' || body.trim() === '') return { ok: false, error: 'body must be a non-empty string' };
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) return { ok: false, error: `timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}` };
  const gm = { verbs: () => verbs.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
  for (const { name } of verbs) gm[name] = (args = {}) => call(name, args);
  let run;
  try {
    run = new AsyncFunction('gm', body);
  } catch (err) {
    return { ok: false, error: `syntax error in the body: ${err.message}` };
  }
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    const value = await Promise.race([run(gm), deadline]);
    const text = JSON.stringify(value) ?? 'undefined';
    return { ok: true, output: text.slice(0, OUTPUT_CAP), truncated: text.length > OUTPUT_CAP };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}
