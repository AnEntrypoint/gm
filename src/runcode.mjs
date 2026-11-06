import { register } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Worker } from 'node:worker_threads';
import { resultZone1, resultZone2, shortKind } from './compact.mjs';
import { bodyContext } from './exec.mjs';

const DEFAULT_TIMEOUT_MS = 180000;
const MAX_TIMEOUT_MS = 300000;
const BUDGET = Symbol('budget');
const OUTPUT_CAP = 20000;
const NOTICE_ROOM = 160;
const cutRunOutput = (text) => `${text.slice(0, OUTPUT_CAP - NOTICE_ROOM)}\n[gm: run_code output cut at ${OUTPUT_CAP - NOTICE_ROOM} of ${text.length} characters; read less, or read the rest with read_file pages]`;
const BODY_WORKER = new URL('./body-worker.mjs', import.meta.url);
const BODY_SLOTS = 4;
const CONSOLE_LINES = 200;
const CONSOLE_BYTES = 8192;
const CONSOLE_LINE_BYTES = 512;
const waiting = [];
let running = 0;

function cutLine(text) {
  const raw = Buffer.from(text);
  if (raw.length <= CONSOLE_LINE_BYTES) return text;
  let cut = CONSOLE_LINE_BYTES;
  while (cut > 0 && (raw[cut] & 0xc0) === 0x80) cut -= 1;
  return raw.subarray(0, cut).toString('utf8');
}

function consoleBuffer() {
  const lines = [];
  let bytes = 0;
  let dropped = 0;
  return {
    add(text) {
      const line = cutLine(text);
      const size = Buffer.byteLength(line);
      if (lines.length >= CONSOLE_LINES || bytes + size > CONSOLE_BYTES) {
        dropped += 1;
        return;
      }
      lines.push(line);
      bytes += size;
    },
    report: () => ({ lines, dropped, bytes }),
  };
}

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

function cancelSlot(slot) {
  const at = waiting.indexOf(slot);
  if (at >= 0) waiting.splice(at, 1);
}

function spawnWorker({ file, kind, project, verbs, call, output, startSeq }) {
  const worker = new Worker(BODY_WORKER, { workerData: { file, kind, project, verbs: verbs.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }, stdout: true, stderr: true });
  worker.stdout.resume();
  worker.stderr.resume();
  let stopped = false;
  const done = new Promise((resolve) => {
    worker.on('message', (msg) => {
      if (msg.type === 'console') {
        output.add(msg.text);
      } else if (msg.type === 'call') {
        if (stopped) return;
        const work = bodyContext.run({ body: startSeq }, () => Promise.resolve().then(() => call(msg.name, msg.args)));
        work.catch((err) => ({ ok: false, error: err.message })).then((result) => {
          if (!stopped) worker.postMessage({ type: 'reply', id: msg.id, result });
        });
      } else if (msg.type === 'done') {
        resolve(msg.ok ? { ok: true, text: msg.text } : { ok: false, error: msg.error, at: msg.at });
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

function inside(root, at) {
  const rel = relative(root, at);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function formatOf(project, file) {
  if (file.endsWith('.mjs')) return 'esm';
  if (file.endsWith('.cjs')) return 'cjs';
  const top = inside(project, file) ? project : null;
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) return JSON.parse(readFileSync(pkg, 'utf8')).type === 'module' ? 'esm' : 'cjs';
    if (dir === top || dirname(dir) === dir) return 'cjs';
  }
}

let generation = null;
let fingerprint = null;
const SKIP_DIRS = new Set(['node_modules', 'runs', '.gm', '.git', 'sources', 'vendor']);
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
    description: `Run a JavaScript body in the project. The body is an ES module when format is esm and CommonJS when format is cjs. Left out, format follows the project's package.json type (type module is esm, anything else is cjs). A CommonJS body loads with require() and cannot use a static import. Static imports (single or multi-line) load ES modules, and require() loads CommonJS; each project file loads in its own format (.mjs is ES module, .cjs is CommonJS, .js follows the package.json type), and each file is read from disk when the call runs. Relative paths resolve against the project root. Paths may point inside or outside the workspace, for the body's own require and import and for the file verbs alike; an outside path should be absolute. A non-literal import() or require() is refused. The body receives gm, with one method per verb: await gm.<name>(args), and gm.project is the project root. The verbs are: ${verbNames.join(', ')}. gm.verbs() returns each verb's description and input schema as data. gm.verbs({ name: 'read_file' }) returns just that verb's schema, gm.verbs({ names: true }) returns just the names, and an unknown name is an error. Wrap a call that may throw in gm.try(fn), which returns its value or { ok: false, error } as data, so one failure does not hide the rest of a batch. A failed call returns {ok:false, error} and does not stop the body. The body's return value comes back as JSON. A body still running after timeoutMs (default 180000, at most 300000) becomes a background run: the call returns its job id at once, job_status with waitMs returns its value, and finish is refused while it runs unless stopBackground is true. One step is one body: read the inputs in one Promise.all, decide in code, act with the independent writes in one Promise.all, and verify in the same body. The ten most-used verbs: read_file({ path, offset?, limit? }), run_shell({ command, timeoutMs? }), write_file({ path, content }), query_log({ js?, kind?, fromMono?, toMono?, after?, last? }), search({ query, k? }), fetch({ url, timeoutMs? }), job_start({ job, command, timeoutMs? }), job_status({ job, waitMs?, offset? }), callers({ name, limit? }), grep({ pattern, root?, mode?, scope?, ignoreCase?, limit?, offset? }). A file written in this run is untracked; grep it with scope: 'all'. finish is not a verb: end the run with the finish tool. The reply names its own action in actionSeq, the seq of the run_code action event in the log. A body's console output is not returned; it is logged once per body as a body-console event, at most 200 lines of 512 bytes and 8 KiB, with a dropped count for the lines past the cap. An argument this tool does not take is refused by name.`,
    inputSchema: { type: 'object', properties: RUN_CODE_PROPERTIES, required: ['body'] },
  };
}

export const RUN_CODE_PROPERTIES = { body: { type: 'string' }, timeoutMs: { type: 'integer', minimum: 1, maximum: MAX_TIMEOUT_MS }, format: { type: 'string', enum: ['esm', 'cjs'] } };

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
  const loads = split.loads.map(({ path, via }) => ({ path: inside(project, path) ? relative(project, path) : path, via, format: formatOf(project, path) }));
  for (const load of loads) log?.append('code-load', { step, path: load.path, via: load.via, format: load.format });
  nextGeneration(project, log, step);
  const source = kind === 'esm'
    ? `${split.imports}\nexport default async function body(gm, require) {\n${split.code}\n}\n`
    : `module.exports = async function body(gm, require) {\n${split.code}\n};\n`;
  const startSeq = log.count();
  const digest = createHash('sha1').update(source).digest('hex').slice(0, 16);
  const file = join(runDir, 'code', `body-${startSeq}-${digest}.${kind === 'esm' ? 'mjs' : 'cjs'}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
  const slot = takeSlot(log, { body: startSeq, step });
  const output = consoleBuffer();
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
    spawned = spawnWorker({ file, kind, project, verbs, call, output, startSeq });
    spawned.done.then(stop);
    return spawned.done;
  });
  const head = kind === 'esm' ? split.imports.split('\n').length + 1 : 1;
  const removed = body.split('\n').length - split.code.split('\n').length;
  const bodyLines = body.split('\n').length;
  const locate = (at) => {
    const line = at.line - head + removed;
    return line >= 1 && line <= bodyLines ? ` (line ${line}, column ${at.column})` : '';
  };
  let killed = false;
  const kill = () => {
    killed = true;
    stop();
  };
  const lost = () => `its return value is lost; ${log.eventsFrom(startSeq + 1).filter((event) => event.kind === 'code-call').length} verb calls completed before the stop, each in query_log as a code-call after seq ${startSeq}`;
  const result = done.then((reply) => (reply.ok
    ? { ok: true, output: reply.text.length > OUTPUT_CAP ? cutRunOutput(reply.text) : reply.text, truncated: reply.text.length > OUTPUT_CAP }
    : { ok: false, error: killed ? `${reply.error}: ${lost()}` : reply.at ? reply.error + locate(reply.at) : reply.error }));
  result.then(() => {
    const report = output.report();
    if (report.lines.length > 0 || report.dropped > 0) log.append('body-console', { body: startSeq, step, ...report });
  });
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
  const name = background({ result, cleanup: () => rmSync(file, { force: true }), kill, body: startSeq, queued, started: slot.ready });
  const logged = log.eventsFrom(startSeq + 1).filter((event) => event.kind === 'code-call').map((event) => ({ seq: event.seq, tool: event.tool, ok: event.ok }));
  return { ok: true, background: name, job: name, state: queued ? 'queued' : 'running', hint: `job_status({ job: "${name}", waitMs }) returns its state and, once it ends, its value`, logged, loads };
}

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
  const resolveLoad = (path, via) => {
    const at = resolve(project, path);
    loads.push({ path: at, via });
    return at;
  };
  const imports = statements.map((text) => text.replace(/(['"])(\.{0,2}\/[^'"\n]*)\1/g, (match, quote, path) => `${quote}${resolveLoad(path, 'import')}${quote}`));
  let rest = code.join('\n');
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
      if (/^\.{0,2}\//.test(match[2])) {
        const via = keyword === 'import' ? 'import()' : 'require';
        edits.push({ start: index, end: index + match[0].length, text: `${keyword}(${match[1]}${resolveLoad(match[2], via)}${match[1]})` });
      }
    }
    for (const edit of edits.reverse()) rest = rest.slice(0, edit.start) + edit.text + rest.slice(edit.end);
  }
  if (refusal !== null) return { refusal };
  return { imports: imports.join('\n'), code: rest, loads };
}
