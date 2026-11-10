const decoder = new TextDecoder();

function concat(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return decoder.decode(out);
}

export async function openTxiki({ wasm, createWasi }) {
  const output = { stdout: [], stderr: [] };
  const wasi = createWasi({
    args: ['tjs'],
    stdout: (chunk) => output.stdout.push(chunk),
    stderr: (chunk) => output.stderr.push(chunk),
  });
  let instance = null;
  const bytesAt = (ptr, len) => new Uint8Array(instance.exports.memory.buffer, ptr, len);
  const host = {
    tjs_host_write: (fd, ptr, len) => {
      (fd === 2 ? output.stderr : output.stdout).push(bytesAt(ptr, len).slice());
    },
    tjs_bridge_send: () => {},
    tjs_cancel_requested: () => 0,
    tjs_now_ms: () => Date.now(),
    tjs_random: (ptr, len) => {
      globalThis.crypto.getRandomValues(bytesAt(ptr, len));
    },
  };
  const module = await WebAssembly.compile(wasm);
  const stubbed = WebAssembly.Module.imports(module)
    .filter((entry) => entry.module === 'env' && !(entry.name in host))
    .map((entry) => entry.name);
  for (const name of stubbed) host[name] = () => -1;
  instance = await WebAssembly.instantiate(module, { ...wasi.imports, env: host });
  wasi.bind(instance);
  instance.exports._initialize();
  const { exports } = instance;
  return {
    stubbed,
    async run(source, { timeoutMs = 120000 } = {}) {
      output.stdout.length = 0;
      output.stderr.length = 0;
      const input = new TextEncoder().encode(source + '\u0000');
      const ptr = exports.malloc(input.length);
      bytesAt(ptr, input.length).set(input);
      let status;
      try {
        exports.tjs_browser_set_deadline(Date.now() + timeoutMs);
        status = exports.tjs_browser_eval(ptr);
      } finally {
        exports.free(ptr);
      }
      while (status === 2) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        status = exports.tjs_browser_tick();
      }
      exports.tjs_browser_set_deadline(0);
      exports.tjs_browser_end();
      return { status, stdout: concat(output.stdout), stderr: concat(output.stderr) };
    },
  };
}
