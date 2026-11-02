// The code surface's run_code tool. A body runs in the project: its static imports load ES modules, its require() loads CommonJS,
// and each project file loads in its own format. It receives gm, which has one method per verb, and gm.verbs(). Each verb call is
// a call through the session, so it is logged as a code-call event. A failed call returns {ok:false, error} as data, so one failure
// does not abort the body. The body runs in the worker's process, so it is trusted as much as run_shell is: it is not sandboxed.
import { register } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Worker } from 'node:worker_threads';
import { resultZone1, resultZone2, shortKind } from './compact.mjs';
import { bodyContext } from './exec.mjs';

// The foreground budget of a body: past it, the body keeps running as a background job, and the call returns at once with its id.
const DEFAULT_TIMEOUT_MS = 180000;
const MAX_TIMEOUT_MS = 300000;
const BUDGET = Symbol('budget');
const OUTPUT_CAP = 20000;
// The thread that runs a body. Each body gets one of its own (body-worker.mjs).
const BODY_WORKER = new URL('./body-worker.mjs', import.meta.url);
// The most bodies that run at once in this process. A body beyond the cap waits in arrival order, and its wait is logged as body-queued.
const BODY_SLOTS = 4;
const waiting = [];
let running = 0;

// A slot for one body. It is granted in arrival order, and releasing a slot grants it to the next waiting body. Only a body that waited is
// logged at its start and finish, so the log of a body that ran at once is unchanged.
function takeSlot(log, { body, step }) {
  const slot = { body, step, log, granted: false, released: false, started: false, queued: running >= BODY_SLOTS };
  slot.ready = new Promise((resolve) => {
    slot.grant = resolve;
  });
  if (slot.queued) log?.append('body-queued', { body, step, ahead: waiting.length, running });
  waiting.push(slot);
  serveSlots();
  return slot;
}

function serveSlots() {
  while (running < BODY_SLOTS && waiting.length > 0) {
    const slot = waiting.shift();
    slot.granted = true;
    running += 1;
    slot.grant();
  }
}

// A body that waited is logged when its thread starts, not when its slot is granted, so a body stopped in between leaves no start.
function startSlot(slot) {
  slot.started = true;
  if (slot.queued) slot.log?.append('body-started', { body: slot.body, step: slot.step, running });
}

function releaseSlot(slot) {
  if (!slot.granted || slot.released) return;
  slot.released = true;
  running -= 1;
  if (slot.queued && slot.started) slot.log?.append('body-finished', { body: slot.body, step: slot.step, running });
  serveSlots();
}

// A body still waiting leaves the queue, so a body stopped before its turn never starts.
function cancelSlot(slot) {
  const at = waiting.indexOf(slot);
  if (at >= 0) waiting.splice(at, 1);
}

// Starts the thread that runs one body. The body's verb calls are messages that this session serves in the body's context, so each call is
// logged with the body's seq and a shell it starts is tagged with it. done resolves with the body's reply: {ok, text} when it returns, and
// {ok:false, error} when it fails or its thread stops. terminate stops the thread at once, which also stops a loop that never awaits.
function spawnWorker({ file, kind, project, verbs, call, log, step, startSeq }) {
  const worker = new Worker(BODY_WORKER, { workerData: { file, kind, project, verbs: verbs.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }, stdout: true, stderr: true });
  // The body's console output is drained here, so it cannot reach the session's stdout, which carries the protocol.
  worker.stdout.resume();
  worker.stderr.resume();
  let stopped = false;
  const done = new Promise((resolve) => {
    worker.on('message', (msg) => {
      if (msg.type === 'call') {
        if (stopped) return;
        const work = bodyContext.run({ body: startSeq }, () => Promise.resolve().then(() => call(msg.name, msg.args)));
        work.catch((err) => ({ ok: false, error: err.message })).then((result) => {
          if (!stopped) worker.postMessage({ type: 'reply', id: msg.id, result });
        });
      } else if (msg.type === 'refusal') {
        log?.append('refusal', { step, tool: 'run_code', stage: 'require', error: msg.error });
      } else if (msg.type === 'done') {
        resolve(msg.ok ? { ok: true, text: msg.text } : { ok: false, error: msg.error });
      }
    });
    worker.on('error', (err) => resolve({ ok: false, error: err.message }));
    worker.on('exit', () => resolve({ ok: false, error: 'the body stopped before it returned' }));
  });
  return {
    done,
    terminate: () => {
      stopped = true;
      worker.terminate();
    },
  };
}

// A path inside the root. The check is textual; a symlink is followed separately by confined().
function inside(root, at) {
  const rel = relative(root, at);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

// The path inside the project root, or null. A path that leaves the root, through .. or through a symlink whose real location is
// outside, is refused. A missing file is not refused here; the load fails later and names the file.
export function confined(project, path) {
  const at = resolve(project, path);
  if (!inside(project, at)) return null;
  if (existsSync(at) && !inside(realpathSync(project), realpathSync(at))) return null;
  return at;
}

// The format a project file loads as, read the way Node reads it. .mjs is an ES module and .cjs is CommonJS. A .js file follows the
// "type" of the nearest package.json at or above it, up to the project root; with none, it is CommonJS.
export function formatOf(project, file) {
  if (file.endsWith('.mjs')) return 'esm';
  if (file.endsWith('.cjs')) return 'cjs';
  let dir = dirname(file);
  while (inside(project, dir)) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) return JSON.parse(readFileSync(pkg, 'utf8')).type === 'module' ? 'esm' : 'cjs';
    if (dir === project) break;
    dir = dirname(dir);
  }
  return 'cjs';
}

// The generation is taken only when a project file changed. The resolve hook (freshness.mjs) gives every project file the generation as
// its query. A fingerprint of the project's files (path, mtime and size) is compared with the last one: a call with no edit keeps the
// generation, so no module is loaded again and the memory does not grow with the number of calls. One edit gives one new generation,
// and every project file loads again with it, so a file that imports the edited one is never stale. The hook is registered once; its
// counter is shared with the hook's thread through a SharedArrayBuffer.
let generation = null;
let fingerprint = null;
const SKIP_DIRS = new Set(['node_modules', 'runs', '.gm-new', '.git', 'sources', 'vendor']);
function nextGeneration(project, log, step) {
  if (generation === null) {
    const buffer = new SharedArrayBuffer(4);
    register('./freshness.mjs', { parentURL: import.meta.url, data: { root: project, buffer } });
    generation = new Int32Array(buffer);
  }
  const now = projectFingerprint(project);
  if (now !== fingerprint) {
    fingerprint = now;
    Atomics.add(generation, 0, 1);
    log?.append('generation', { step, generation: Atomics.load(generation, 0) });
  }
}

function projectFingerprint(project) {
  const parts = [];
  walkFiles(project, '', parts);
  return createHash('sha1').update(parts.sort().join('\n')).digest('hex');
}

function walkFiles(dir, rel, parts) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const at = join(dir, entry.name);
    const name = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) walkFiles(at, name, parts);
    else if (entry.isFile()) {
      const info = statSync(at);
      parts.push(`${name}:${info.mtimeMs}:${info.size}`);
    }
  }
}

// The tool's description names the verbs and nothing else about them, so a change to a verb's description does not change
// the served list, or the prefix hash that the list feeds.
// run_code is the tool the default surface serves. A body's arguments keep their size and their head. Its code-load events list the
// project files a body loaded, and the second horizon cuts them.
export const COMPACT = {
  tools: {
    run_code: { zone1: resultZone1, zone2: resultZone2 },
  },
  kinds: {
    'code-load': { zone1: shortKind, zone2: () => null },
  },
};

export function runCodeTool(verbNames) {
  return {
    name: 'run_code',
    description: `Run a JavaScript body in the project. The body is an ES module when format is esm and CommonJS when format is cjs. Left out, format follows the project's package.json type (type module is esm, anything else is cjs). A CommonJS body loads with require() and cannot use a static import. Static imports (single or multi-line) load ES modules, and require() loads CommonJS; each project file loads in its own format (.mjs is ES module, .cjs is CommonJS, .js follows the package.json type), and each file is read from disk when the call runs. Relative paths resolve against the project root and may not leave it. A non-literal import() or require() is refused. The body receives gm, with one method per verb: await gm.<name>(args), and gm.project is the project root. The verbs are: ${verbNames.join(', ')}. gm.verbs() returns each verb's description and input schema as data. A failed call returns {ok:false, error} and does not stop the body. The body's return value comes back as JSON. A body still running after timeoutMs (default 180000, at most 300000) becomes a background run: the call returns its job id at once, job_status with waitMs returns its value, and finish is refused while it runs unless stopBackground is true. One step is one body: read the inputs in one Promise.all, decide in code, act with the independent writes in one Promise.all, and verify in the same body. The ten most-used verbs: read_file({ path, offset?, limit? }), run_shell({ command, timeoutMs? }), write_file({ path, content }), query_log({ js?, kind?, fromMono?, toMono?, after? }), search({ query, k? }), fetch({ url, timeoutMs?, maxBytes?, maxRedirects? }), job_start({ job, command, timeoutMs? }), job_status({ job, waitMs?, offset? }), callers({ name, limit? }), grep({ pattern, mode?, ignoreCase?, limit?, offset? }). finish is not a verb: end the run with the finish tool.`,
    inputSchema: { type: 'object', properties: { body: { type: 'string' }, timeoutMs: { type: 'number' }, format: { type: 'string', enum: ['esm', 'cjs'] } }, required: ['body'] },
  };
}

// Runs one body. The body is written as an ES module, or as CommonJS when its format is cjs, under the run directory, and the file is deleted when the call ends, success or
// failure. A reference that leaves the project root is refused before the body loads, and logged. Each project file it loads is logged
// with its format. verbs is the list of {name, description, inputSchema}, and call(name, args) runs one verb through the session.
export async function runBody({ body, timeoutMs = DEFAULT_TIMEOUT_MS, format, verbs, call, project, runDir, log, step, background }) {
  if (typeof body !== 'string' || body.trim() === '') return { ok: false, error: 'body must be a non-empty string' };
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) return { ok: false, error: `timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}` };
  if (format !== undefined && format !== 'esm' && format !== 'cjs') return { ok: false, error: 'format must be esm or cjs' };
  const kind = format ?? formatOf(project, join(project, 'body.js'));
  const split = splitBody(body, project);
  if (split.refusal) {
    log?.append('refusal', { step, tool: 'run_code', stage: 'load', error: split.refusal });
    return { ok: false, error: `refused: ${split.refusal}` };
  }
  if (split.error) return { ok: false, error: `the body does not load: ${split.error}` };
  if (kind === 'cjs' && split.imports !== '') {
    const error = 'a CommonJS body cannot use a static import; load with require()';
    log?.append('refusal', { step, tool: 'run_code', stage: 'load', error });
    return { ok: false, error: `refused: ${error}` };
  }
  const loads = split.loads.map(({ path, via }) => ({ path: path.slice(project.length + 1), via, format: formatOf(project, path) }));
  for (const load of loads) log?.append('code-load', { step, path: load.path, via: load.via, format: load.format });
  nextGeneration(project, log, step);
  const source = kind === 'esm'
    ? `${split.imports}\nexport default async function body(gm, require) {\n${split.code}\n}\n`
    : `module.exports = async function body(gm, require) {\n${split.code}\n};\n`;
  // The start seq names the body: its verb calls and its shells carry it, and its file is named by it, so two bodies never share a file.
  // The file is deleted when the body ends, success or failure, or is stopped.
  const startSeq = log.count();
  const digest = createHash('sha1').update(source).digest('hex').slice(0, 16);
  const file = join(runDir, 'code', `body-${startSeq}-${digest}.${kind === 'esm' ? 'mjs' : 'cjs'}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
  // The body waits for a slot (takeSlot), and its thread starts when it gets one. The slot is held until the thread stops, so the threads
  // that run at once are the cap. A stop terminates the thread, or, while the body still waits, takes it out of the queue.
  const slot = takeSlot(log, { body: startSeq, step });
  let spawned = null;
  let stoppedBeforeStart = false;
  const stop = () => {
    if (spawned !== null) spawned.terminate();
    else stoppedBeforeStart = true;
    if (slot.granted) releaseSlot(slot);
    else cancelSlot(slot);
  };
  const done = slot.ready.then(() => {
    if (stoppedBeforeStart) return { ok: false, error: 'the body was stopped before it started' };
    startSlot(slot);
    spawned = spawnWorker({ file, kind, project, verbs, call, log, step, startSeq });
    spawned.done.then(stop);
    return spawned.done;
  });
  // The background run's result has the same shape as a foreground reply, so the job's status and the call's reply agree.
  const result = done.then((reply) => (reply.ok
    ? { ok: true, output: reply.text.slice(0, OUTPUT_CAP), truncated: reply.text.length > OUTPUT_CAP }
    : { ok: false, error: reply.error }));
  // If the body settles within the budget, the call returns its result. If the budget is spent first, the body is handed to the caller as a
  // background job, which watches it through the job machinery; its body file stays until the body ends.
  let timer;
  const budget = new Promise((resolve) => {
    timer = setTimeout(() => resolve(BUDGET), timeoutMs);
  });
  const outcome = await Promise.race([result, budget]);
  clearTimeout(timer);
  if (outcome !== BUDGET) {
    rmSync(file, { force: true });
    return { ...outcome, loads };
  }
  const queued = !slot.granted;
  const name = background({ result, cleanup: () => rmSync(file, { force: true }), kill: stop, body: startSeq, queued, started: slot.ready });
  const logged = log.eventsFrom(startSeq + 1).filter((event) => event.kind === 'code-call').map((event) => ({ seq: event.seq, tool: event.tool, ok: event.ok }));
  return { ok: true, background: name, state: queued ? 'queued' : 'running', logged, loads };
}

// Static import statements are hoisted to the module's top, and may span lines. Their ./ and ../ specifiers become confined absolute
// paths. Dynamic import() and require() must take a literal path, and a relative one is confined the same way. Anything else is a refusal,
// and a statement that is not closed is an error. Each confined path is recorded with the way it is loaded.
// The text with the contents of strings, template literals and comments blanked to spaces, so the length and the positions are
// unchanged. A quote or a backtick stays, so the masked text still shows where each string begins and ends.
function maskStrings(text) {
  let out = '';
  let state = 'code';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (state === 'code') {
      if (ch === "'" || ch === '"' || ch === '`') {
        state = ch === "'" ? 'sq' : ch === '"' ? 'dq' : 'tpl';
        out += ch;
      } else if (ch === '/' && next === '/') {
        state = 'line';
        out += '  ';
        i += 1;
      } else if (ch === '/' && next === '*') {
        state = 'block';
        out += '  ';
        i += 1;
      } else {
        out += ch;
      }
    } else if (state === 'line') {
      if (ch === '\n') {
        state = 'code';
        out += '\n';
      } else {
        out += ' ';
      }
    } else if (state === 'block') {
      if (ch === '*' && next === '/') {
        state = 'code';
        out += '  ';
        i += 1;
      } else {
        out += ch === '\n' ? '\n' : ' ';
      }
    } else {
      const close = state === 'sq' ? "'" : state === 'dq' ? '"' : '`';
      if (ch === '\\') {
        out += '  ';
        i += 1;
      } else if (ch === close) {
        state = 'code';
        out += ch;
      } else {
        out += ch === '\n' ? '\n' : ' ';
      }
    }
  }
  return out;
}

function splitBody(body, project) {
  const statements = [];
  const code = [];
  let pending = null;
  let started = false;
  for (const line of body.split('\n')) {
    if (pending !== null) {
      pending += `\n${line}`;
      if (/['"][^'"\n]+['"]\s*;?\s*$/.test(line)) {
        statements.push(pending);
        pending = null;
      }
      continue;
    }
    if (!started && /^\s*import\s/.test(line)) {
      if (/['"][^'"\n]+['"]\s*;?\s*$/.test(line)) statements.push(line);
      else pending = line;
      continue;
    }
    if (line.trim() !== '' && !line.trim().startsWith('//')) started = true;
    code.push(line);
  }
  if (pending !== null) return { error: 'an import statement is not closed' };
  let refusal = null;
  const loads = [];
  const confine = (path, via) => {
    const at = confined(project, path);
    if (at === null) refusal = refusal ?? `the ${via} ${path} resolves outside the workspace`;
    else loads.push({ path: at, via });
    return at;
  };
  const imports = statements.map((text) => text.replace(/(['"])(\.{1,2}\/[^'"\n]*)\1/g, (match, quote, path) => `${quote}${confine(path, 'import') ?? path}${quote}`));
  let rest = code.join('\n');
  // A call written inside a string, a template or a comment is not a call. Calls are found in the masked text, and the path is read
  // from the original text at the same position, so a relative literal can be confined and rewritten.
  const callsOf = (keyword) => {
    const literal = new RegExp(`${keyword}\\s*\\(\\s*(['"])([^'"\\n]+)\\1\\s*\\)`, 'y');
    const found = [];
    for (const call of maskStrings(rest).matchAll(new RegExp(`\\b${keyword}\\s*\\(`, 'g'))) {
      literal.lastIndex = call.index;
      found.push({ index: call.index, match: literal.exec(rest) });
    }
    return found;
  };
  for (const keyword of ['import', 'require']) {
    const edits = [];
    for (const { index, match } of callsOf(keyword)) {
      if (match === null) {
        refusal = refusal ?? (keyword === 'import' ? 'a dynamic import() needs a literal specifier' : 'a require() needs a literal path');
        continue;
      }
      if (/^\.\.?\//.test(match[2])) {
        const via = keyword === 'import' ? 'import()' : 'require';
        edits.push({ start: index, end: index + match[0].length, text: `${keyword}(${match[1]}${confine(match[2], via) ?? match[2]}${match[1]})` });
      }
    }
    for (const edit of edits.reverse()) rest = rest.slice(0, edit.start) + edit.text + rest.slice(edit.end);
  }
  if (refusal !== null) return { refusal };
  return { imports: imports.join('\n'), code: rest, loads };
}
