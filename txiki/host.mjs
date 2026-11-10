import { createFsImports } from './fs.mjs';
import { createVerbs } from './verbs.mjs';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function installGm() {
  const waiting = new Map();
  let last = 0;
  __thebirdBridge.onResult = (event) => {
    const settle = waiting.get(event.id);
    waiting.delete(event.id);
    settle?.(event);
  };
  const call = (verb, args) => new Promise((settle) => {
    const id = ++last;
    waiting.set(id, settle);
    __thebirdBridge.send(JSON.stringify({ op: 'builtin', id, name: 'gm', argv: [verb, JSON.stringify(args ?? {})], cwd: '/' }));
  }).then((event) => JSON.parse(event.out));
  globalThis.gm = {
    stat_file: (args) => call('stat_file', args),
    read_file: (args) => call('read_file', args),
    list_dir: (args) => call('list_dir', args),
  };
}

const concat = (chunks) => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return decoder.decode(out);
};

export async function openTxiki({ wasm, createWasi, project }) {
  const output = { stdout: [], stderr: [] };
  const wasi = createWasi({
    args: ['tjs'],
    stdout: (chunk) => output.stdout.push(chunk),
    stderr: (chunk) => output.stderr.push(chunk),
  });
  const verbs = createVerbs(project);
  const state = { instance: null, events: [], pending: 0, wake: null };
  const bytesAt = (ptr, len) => new Uint8Array(state.instance.exports.memory.buffer, ptr, len);
  const float64At = (ptr, count) => new Float64Array(state.instance.exports.memory.buffer, ptr, count);
  const wakeUp = () => {
    const wake = state.wake;
    state.wake = null;
    wake?.();
  };
  const host = {
    tjs_host_write(fd, ptr, len) {
      (fd === 2 ? output.stderr : output.stdout).push(bytesAt(ptr, len).slice());
    },
    tjs_bridge_send(ptr, len) {
      const message = JSON.parse(decoder.decode(bytesAt(ptr, len)));
      if (message.op !== 'builtin' || message.name !== 'gm') return;
      state.pending += 1;
      const [verb, json] = message.argv;
      verbs.call(verb, JSON.parse(json)).then((reply) => {
        state.events.push(JSON.stringify({ id: message.id, kind: 'bridge', code: 0, out: JSON.stringify(reply), err: '' }));
        state.pending -= 1;
        wakeUp();
      });
    },
    tjs_cancel_requested: () => 0,
    tjs_now_ms: () => Date.now(),
    tjs_random: (ptr, len) => {
      globalThis.crypto.getRandomValues(bytesAt(ptr, len));
    },
    ...createFsImports(project, { bytesAt, float64At }),
  };
  const module = await WebAssembly.compile(wasm);
  const stubbed = WebAssembly.Module.imports(module)
    .filter((entry) => entry.module === 'env' && !(entry.name in host))
    .map((entry) => entry.name);
  for (const name of stubbed) host[name] = () => -1;
  state.instance = await WebAssembly.instantiate(module, { ...wasi.imports, env: host });
  wasi.bind(state.instance);
  state.instance.exports._initialize();
  const { exports } = state.instance;
  const withBytes = (bytes, call) => {
    const ptr = exports.malloc(bytes.length);
    try {
      bytesAt(ptr, bytes.length).set(bytes);
      return call(ptr);
    } finally {
      exports.free(ptr);
    }
  };
  return {
    stubbed,
    async run(source, { timeoutMs = 120000 } = {}) {
      output.stdout.length = 0;
      output.stderr.length = 0;
      state.events.length = 0;
      state.pending = 0;
      const deadline = Date.now() + timeoutMs;
      exports.tjs_browser_set_deadline(deadline);
      let status = withBytes(encoder.encode('(' + installGm.toString() + ')();\n' + source + '\u0000'), exports.tjs_browser_eval);
      while (status === 2 || (status === 0 && (state.pending > 0 || state.events.length > 0))) {
        if (state.events.length > 0) {
          const bytes = encoder.encode(state.events.shift());
          status = withBytes(bytes, (ptr) => exports.tjs_browser_resume(ptr, bytes.length));
        } else if (status === 2) {
          await sleep(5);
          status = exports.tjs_browser_tick();
        } else {
          const remaining = deadline - Date.now();
          if (remaining <= 0) {
            status = 124;
            break;
          }
          let timer;
          await Promise.race([new Promise((resolve) => { state.wake = resolve; }), new Promise((resolve) => { timer = setTimeout(resolve, remaining); })]);
          clearTimeout(timer);
        }
      }
      exports.tjs_browser_set_deadline(0);
      exports.tjs_browser_end();
      return { status, stdout: concat(output.stdout), stderr: concat(output.stderr) };
    },
  };
}
