const ENOSYS = 52;
const EBADF = 8;
const FILETYPE_CHARACTER_DEVICE = 2;
const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
const report = document.getElementById('result');
const finish = (line) => {
  report.textContent = line;
  console.log(line);
};

const wasmPath = decodeURIComponent(location.hash.slice(1));
const wasmUrl = new URL(wasmPath, location.href).href;

let stderr = '';
let instance = null;
const memoryBytes = () => new Uint8Array(instance.exports.memory.buffer);
const memoryView = () => new DataView(instance.exports.memory.buffer);
const decodeAt = (base, length) => new TextDecoder().decode(memoryBytes().subarray(base, base + length));

const implemented = {
  args_sizes_get(countPtr, sizePtr) {
    memoryView().setUint32(countPtr, 0, true);
    memoryView().setUint32(sizePtr, 0, true);
    return 0;
  },
  args_get: () => 0,
  environ_sizes_get(countPtr, sizePtr) {
    memoryView().setUint32(countPtr, 0, true);
    memoryView().setUint32(sizePtr, 0, true);
    return 0;
  },
  environ_get: () => 0,
  clock_res_get(id, resultPtr) {
    memoryView().setBigUint64(resultPtr, 1000000n, true);
    return 0;
  },
  clock_time_get(id, precision, resultPtr) {
    const nanoseconds = id === 0 ? BigInt(Date.now()) * 1000000n : BigInt(Math.round(performance.now() * 1000000));
    memoryView().setBigUint64(resultPtr, nanoseconds, true);
    return 0;
  },
  fd_write(fd, iovs, iovsLength, writtenPtr) {
    if (fd !== 1 && fd !== 2) return EBADF;
    const view = memoryView();
    let written = 0;
    let text = '';
    for (let index = 0; index < iovsLength; index += 1) {
      const base = view.getUint32(iovs + index * 8, true);
      const length = view.getUint32(iovs + index * 8 + 4, true);
      text += decodeAt(base, length);
      written += length;
    }
    if (fd === 2) stderr += text;
    view.setUint32(writtenPtr, written, true);
    return 0;
  },
  fd_read(fd, iovs, iovsLength, readPtr) {
    if (fd !== 0) return EBADF;
    memoryView().setUint32(readPtr, 0, true);
    return 0;
  },
  fd_close: (fd) => (fd >= 0 && fd <= 2 ? 0 : EBADF),
  fd_fdstat_get(fd, statPtr) {
    if (fd < 0 || fd > 2) return EBADF;
    const view = memoryView();
    view.setUint8(statPtr, FILETYPE_CHARACTER_DEVICE);
    view.setUint16(statPtr + 2, 0, true);
    view.setBigUint64(statPtr + 8, 0n, true);
    view.setBigUint64(statPtr + 16, 0n, true);
    return 0;
  },
  fd_prestat_get: () => EBADF,
  fd_prestat_dir_name: () => EBADF,
  random_get(base, length) {
    crypto.getRandomValues(memoryBytes().subarray(base, base + length));
    return 0;
  },
  poll_oneoff(inPtr, outPtr, subscriptions, eventsPtr) {
    memoryView().setUint32(eventsPtr, 0, true);
    return 0;
  },
  sched_yield: () => 0,
  proc_exit(code) {
    throw new Error(`proc_exit ${code}`);
  },
  tjs_host_write(fd, base, length) {
    if (fd === 2) stderr += decodeAt(base, length);
  },
};

const run = async () => {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`fetch ${wasmUrl} returned ${response.status}`);
  const module = await WebAssembly.compile(await response.arrayBuffer());
  const imports = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    const target = entry.module === 'env' ? (imports.env ??= {}) : (imports.wasi_snapshot_preview1 ??= {});
    if (entry.kind !== 'function') continue;
    target[entry.name] = implemented[entry.name] ?? (entry.module === 'env' ? () => 0 : () => ENOSYS);
  }
  instance = await WebAssembly.instantiate(module, imports);
  if (instance.exports._initialize) instance.exports._initialize();
  const exp = instance.exports;

  const allocString = (text) => {
    const bytes = new TextEncoder().encode(`${text}\0`);
    const ptr = exp.malloc(bytes.length);
    memoryBytes().set(bytes, ptr);
    return ptr;
  };

  const rt = exp.gm_txiki_new();
  expect(rt !== 0, 'gm_txiki_new returned NULL');
  const ctx = rt !== 0 ? exp.gm_txiki_context(rt) : 0;
  expect(ctx !== 0, 'gm_txiki_context returned NULL');
  const alive = rt !== 0 ? exp.gm_txiki_loop_alive(rt) : -1;
  expect(alive === 0 || alive === 1, `gm_txiki_loop_alive returned ${alive}`);
  if (rt !== 0) exp.gm_txiki_loop_turn(rt);
  const builtin = ctx !== 0 ? exp.gm_txiki_load_builtin(ctx, allocString('tjs:path')) : 0;
  expect(builtin !== 0, 'gm_txiki_load_builtin returned NULL for tjs:path');
  const missing = ctx !== 0 ? exp.gm_txiki_load_builtin(ctx, allocString('tjs:gm-no-such-module')) : 0;
  expect(missing === 0, `gm_txiki_load_builtin returned ${missing} for an unknown module`);
  if (rt !== 0) exp.gm_txiki_free(rt);
};

run()
  .catch((error) => failures.push(`the page threw: ${error.message}`))
  .then(() => {
    if (failures.length) {
      finish(`txiki-wasi-browser-check: ${failures.length} failure(s)\n- ${failures.join('\n- ')}${stderr ? `\nstderr: ${stderr}` : ''}`);
      return;
    }
    finish(`txiki-wasi-browser-check: ok (${wasmPath}: runtime created, context read, loop turned, tjs:path loaded through gm_txiki_load_builtin, unknown module refused, runtime freed)`);
  });
