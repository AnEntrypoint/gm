// The code surface's run_code tool. A body runs in the project: its static imports load ES modules, its require() loads CommonJS,
// and each project file loads in its own format. It receives gm, which has one method per verb, and gm.verbs(). Each verb call is
// a call through the session, so it is logged as a code-call event. A failed call returns {ok:false, error} as data, so one failure
// does not abort the body. The body runs in the worker's process, so it is trusted as much as run_shell is: it is not sandboxed.
import { createRequire, register } from 'node:module';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resultZone1, resultZone2, shortKind } from './compact.mjs';

const DEFAULT_TIMEOUT_MS = 120000;
const MAX_TIMEOUT_MS = 600000;
const OUTPUT_CAP = 20000;
let bodies = 0;
const cjsLoad = createRequire(import.meta.url);

// A path inside the root. The check is textual; a symlink is followed separately by confined().
function inside(root, at) {
  const rel = relative(root, at);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

// The path inside the project root, or null. A path that leaves the root, through .. or through a symlink whose real location is
// outside, is refused. A missing file is not refused here; the load fails later and names the file.
function confined(project, path) {
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

// Each call that loads project files takes a new generation. The resolve hook (freshness.mjs) gives every project file the generation as
// its query, so the call loads the files as they are on disk now. The hook is registered once, on the first call; its counter is shared
// with the hook's thread through a SharedArrayBuffer.
let generation = null;
function nextGeneration(project) {
  if (generation === null) {
    const buffer = new SharedArrayBuffer(4);
    register('./freshness.mjs', { parentURL: import.meta.url, data: { root: project, buffer } });
    generation = new Int32Array(buffer);
  }
  Atomics.add(generation, 0, 1);
}

// Node caches CommonJS by path, and an ES module that imports a .cjs file gets the cached copy. Dropping the project's entries before
// each call makes every load read the file again.
function dropCommonJS(project) {
  for (const key of Object.keys(cjsLoad.cache)) if (inside(project, key)) delete cjsLoad.cache[key];
}

// require for the body, rooted at the workspace. A relative path is confined again at the call, so a path that leaves the root is
// refused even if it is built at run time.
function guardedRequire(project, log, step) {
  const base = createRequire(join(project, 'package.json'));
  return (spec) => {
    if (typeof spec !== 'string') throw new TypeError('require needs a string path');
    if (/^\.\.?(\/|$)/.test(spec)) {
      const at = confined(project, spec);
      if (at === null) {
        log?.append('refusal', { step, tool: 'run_code', stage: 'require', error: `the require ${spec} resolves outside the workspace` });
        throw new Error(`refused: the require ${spec} resolves outside the workspace`);
      }
      return base(at);
    }
    return base(spec);
  };
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
    description: `Run a JavaScript body in the project. The body is an ES module when format is esm and CommonJS when format is cjs. Left out, format follows the project's package.json type (type module is esm, anything else is cjs). A CommonJS body loads with require() and cannot use a static import. Static imports (single or multi-line) load ES modules, and require() loads CommonJS; each project file loads in its own format (.mjs is ES module, .cjs is CommonJS, .js follows the package.json type), and each file is read from disk when the call runs. Relative paths resolve against the project root and may not leave it. A non-literal import() or require() is refused. The body receives gm, with one method per verb: await gm.<name>(args), and gm.project is the project root. The verbs are: ${verbNames.join(', ')}. gm.verbs() returns each verb's description and input schema as data. A failed call returns {ok:false, error} and does not stop the body. The body's return value comes back as JSON. finish is not a verb: end the run with the finish tool.`,
    inputSchema: { type: 'object', properties: { body: { type: 'string' }, timeoutMs: { type: 'number' }, format: { type: 'string', enum: ['esm', 'cjs'] } }, required: ['body'] },
  };
}

// Runs one body. The body is written as an ES module, or as CommonJS when its format is cjs, under the run directory, and the file is deleted when the call ends, success or
// failure. A reference that leaves the project root is refused before the body loads, and logged. Each project file it loads is logged
// with its format. verbs is the list of {name, description, inputSchema}, and call(name, args) runs one verb through the session.
export async function runBody({ body, timeoutMs = DEFAULT_TIMEOUT_MS, format, verbs, call, project, runDir, log, step }) {
  if (typeof body !== 'string' || body.trim() === '') return { ok: false, error: 'body must be a non-empty string' };
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) return { ok: false, error: `timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}` };
  if (format !== undefined && format !== 'esm' && format !== 'cjs') return { ok: false, error: 'format must be esm or cjs' };
  const kind = format ?? formatOf(project, join(project, 'body.js'));
  const gm = { project, verbs: () => verbs.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
  for (const { name } of verbs) gm[name] = (args = {}) => call(name, args);
  gm.try = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };
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
  bodies += 1;
  const file = join(runDir, 'code', `body-${bodies}.${kind === 'esm' ? 'mjs' : 'cjs'}`);
  let run;
  try {
    mkdirSync(dirname(file), { recursive: true });
    dropCommonJS(project);
    nextGeneration(project);
    if (kind === 'esm') {
      writeFileSync(file, `${split.imports}\nexport default async function body(gm, require) {\n${split.code}\n}\n`);
      run = (await import(pathToFileURL(file).href)).default;
    } else {
      writeFileSync(file, `module.exports = async function body(gm, require) {\n${split.code}\n};\n`);
      run = cjsLoad(file);
      delete cjsLoad.cache[file];
    }
  } catch (err) {
    rmSync(file, { force: true });
    return { ok: false, error: `the body does not load: ${err.message}` };
  }
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    const value = await Promise.race([run(gm, guardedRequire(project, log, step)), deadline]);
    const text = JSON.stringify(value) ?? 'undefined';
    return { ok: true, output: text.slice(0, OUTPUT_CAP), truncated: text.length > OUTPUT_CAP, loads };
  } catch (err) {
    return { ok: false, error: err.message, loads };
  } finally {
    clearTimeout(timer);
    rmSync(file, { force: true });
  }
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
