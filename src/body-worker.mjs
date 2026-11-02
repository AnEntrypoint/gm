// The thread that runs one run_code body. The body's verb calls are messages to the session, which runs each verb and posts the reply back
// by its id, so the body's JavaScript runs off the session's thread and the session stays responsive while a body runs. A body that never
// awaits is stopped by the session, which terminates this thread. The body's console output is not sent anywhere: the session drains it.
import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { confined } from './runcode.mjs';

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

// require for the body, rooted at the workspace. A relative path is confined again at the call, so a path that leaves the root is
// refused even if it is built at run time, and the refusal is logged by the session.
const base = createRequire(join(project, 'package.json'));
const requireBody = (spec) => {
  if (typeof spec !== 'string') throw new TypeError('require needs a string path');
  if (/^\.\.?(\/|$)/.test(spec)) {
    const at = confined(project, spec);
    if (at === null) {
      const error = `the require ${spec} resolves outside the workspace`;
      parentPort.postMessage({ type: 'refusal', error });
      throw new Error(`refused: ${error}`);
    }
    return base(at);
  }
  return base(spec);
};

async function run() {
  let body;
  try {
    body = kind === 'esm' ? (await import(pathToFileURL(file).href)).default : createRequire(file)(file);
  } catch (err) {
    return { type: 'done', ok: false, error: `the body does not load: ${err.message}` };
  }
  try {
    const value = await body(gm, requireBody);
    return { type: 'done', ok: true, text: JSON.stringify(value) ?? 'undefined' };
  } catch (err) {
    return { type: 'done', ok: false, error: err.message };
  }
}

parentPort.postMessage(await run());
