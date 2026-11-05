import { spawnSync } from 'node:child_process';
import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { file, kind, project, verbs } = workerData;
const waiting = new Map();
let nextId = 1;

parentPort.on('message', (msg) => {
  if (msg.type !== 'reply') return;
  const resolve = waiting.get(msg.id);
  waiting.delete(msg.id);
  resolve(msg.result);
});

function call(name, args) {
  return new Promise((resolve) => {
    const id = nextId;
    nextId += 1;
    waiting.set(id, resolve);
    parentPort.postMessage({ type: 'call', id, name, args });
  });
}

const VERBS_SHAPE = 'gm.verbs() takes { name: <verb name> } or { names: true }';
const failed = (error) => ({ ok: false, error });
const all = () => verbs.map((verb) => ({ ...verb }));
function verbsOf(options) {
  if (options === undefined) return all();
  if (options === null || typeof options !== 'object' || Array.isArray(options)) return failed(VERBS_SHAPE);
  const keys = Object.keys(options);
  const unknown = keys.find((key) => key !== 'name' && key !== 'names');
  if (unknown !== undefined) return failed(`gm.verbs() does not take ${unknown}`);
  if (keys.includes('names') && options.names !== true) return failed('gm.verbs() takes { names: true }');
  if (keys.length === 0) return all();
  if (keys.length === 1 && options.names === true) return verbs.map((verb) => verb.name);
  if (keys.length === 1 && typeof options.name === 'string') {
    const found = verbs.find((verb) => verb.name === options.name);
    if (found === undefined) throw new Error(`unknown verb: ${options.name}`);
    return { ...found };
  }
  return failed(VERBS_SHAPE);
}

const gm = { project, verbs: verbsOf };
for (const { name } of verbs) gm[name] = (args = {}) => call(name, args);
gm.try = async (fn) => {
  try {
    return await fn();
  } catch (err) {
    return { ok: false, error: err.message };
  }
};

const base = createRequire(join(project, 'package.json'));
const requireBody = (spec) => {
  if (typeof spec !== 'string') throw new TypeError('require needs a string path');
  return base(spec);
};

function loadPosition(file) {
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  const at = /:(\d+)\r?\n[^\n]*\r?\n( *)\^/.exec(check.stderr);
  return at === null ? null : { line: Number(at[1]), column: at[2].length + 1 };
}

async function run() {
  let body;
  try {
    body = kind === 'esm' ? (await import(pathToFileURL(file).href)).default : createRequire(file)(file);
  } catch (err) {
    return { type: 'done', ok: false, error: `the body does not load: ${err.message}`, at: loadPosition(file) };
  }
  try {
    const value = await body(gm, requireBody);
    return { type: 'done', ok: true, text: JSON.stringify(value) ?? 'undefined' };
  } catch (err) {
    return { type: 'done', ok: false, error: err.message };
  }
}

parentPort.postMessage(await run());
