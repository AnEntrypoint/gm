// The thread that runs one run_code body. The body's verb calls are messages to the session, which runs each verb and posts the reply back
// by its id, so the body's JavaScript runs off the session's thread and the session stays responsive while a body runs. A body that never
// awaits is stopped by the session, which terminates this thread. The body's console output is not sent anywhere: the session drains it.
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

const gm = { project, verbs: () => verbs.map((verb) => ({ ...verb })) };
for (const { name } of verbs) gm[name] = (args = {}) => call(name, args);
gm.try = async (fn) => {
  try {
    return await fn();
  } catch (err) {
    return { ok: false, error: err.message };
  }
};

// require for the body. A relative path resolves against the project root, as the static loads do, and an absolute path loads as it is.
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
