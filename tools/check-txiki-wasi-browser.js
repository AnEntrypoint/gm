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

const toPerformanceTime = (clockId, timeMs) => (clockId === 0 ? performance.now() + (timeMs - Date.now()) : timeMs);

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
    const view = memoryView();
    const clocks = [];
    const ready = [];
    for (let index = 0; index < subscriptions; index += 1) {
      const base = inPtr + index * 48;
      const userdata = view.getBigUint64(base, true);
      const tag = view.getUint8(base + 8);
      if (tag === 0) {
        const clockId = view.getUint32(base + 16, true);
        const timeout = Number(view.getBigUint64(base + 24, true)) / 1e6;
        const abstime = (view.getUint16(base + 40, true) & 1) === 1;
        clocks.push({ userdata, tag, at: abstime ? toPerformanceTime(clockId, timeout) : performance.now() + timeout });
      } else {
        ready.push({ userdata, tag });
      }
    }
    if (clocks.length && ready.length === 0) {
      const wakeAt = Math.min(...clocks.map((clock) => clock.at));
      while (performance.now() < wakeAt) continue;
    }
    const expired = clocks.filter((clock) => clock.at <= performance.now());
    const events = [...ready, ...expired];
    events.forEach((event, index) => {
      const base = outPtr + index * 32;
      view.setBigUint64(base, event.userdata, true);
      view.setUint16(base + 8, 0, true);
      view.setUint8(base + 10, event.tag);
      view.setBigUint64(base + 16, 0n, true);
    });
    view.setUint32(eventsPtr, events.length, true);
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

const readBinary = (url) => {
  const request = new XMLHttpRequest();
  request.open('GET', url, false);
  request.overrideMimeType('text/plain; charset=x-user-defined');
  request.send();
  if (request.status !== 0 && (request.status < 200 || request.status >= 300)) throw new Error(`fetch ${url} returned ${request.status}`);
  const text = request.responseText;
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
  return bytes;
};

const run = () => {
  const module = new WebAssembly.Module(readBinary(wasmUrl));
  const imports = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    const target = entry.module === 'env' ? (imports.env ??= {}) : (imports.wasi_snapshot_preview1 ??= {});
    if (entry.kind !== 'function') continue;
    target[entry.name] = implemented[entry.name] ?? (entry.module === 'env' ? () => 0 : () => ENOSYS);
  }
  instance = new WebAssembly.Instance(module, imports);
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

  const readCString = (pointer) => {
    const bytes = memoryBytes();
    let end = pointer;
    while (bytes[end] !== 0) end += 1;
    return new TextDecoder().decode(bytes.subarray(pointer, end));
  };
  const runBody = (body) => {
    const bodyPtr = allocString(body);
    const replyPtr = exp.gm_run_body(bodyPtr, 0);
    exp.free(bodyPtr);
    const text = readCString(replyPtr);
    exp.free(replyPtr);
    return JSON.parse(text);
  };

  const sum = runBody('return 1 + 2;');
  expect(sum.ok === true && sum.value === 3, `run_code returned ${JSON.stringify(sum)} for 1 + 2`);
  const timer = runBody('return (async () => { await new Promise((done) => setTimeout(done, 20)); return "timer"; })();');
  expect(timer.ok === true && timer.value === 'timer', `run_code returned ${JSON.stringify(timer)} for a 20 ms timer`);
  const stuck = runBody('for (;;) {}');
  expect(stuck.ok === false && String(stuck.error).includes('JavaScript deadline of 120000 ms'), `run_code returned ${JSON.stringify(stuck)} for a body that never returns`);
  return `run_code: 1 + 2 = ${sum.value}; a 20 ms timer settled as ${timer.value}; a body that never returns stopped with "${stuck.error}"`;
};

let runCodeLine = '';
try {
  runCodeLine = run();
} catch (error) {
  failures.push(`the page threw: ${error.message}`);
}
if (failures.length) {
  finish(`txiki-wasi-browser-check: ${failures.length} failure(s)\n- ${failures.join('\n- ')}${stderr ? `\nstderr: ${stderr}` : ''}`);
} else {
  finish(`txiki-wasi-browser-check: ok (${wasmPath}: runtime created, context read, loop turned, tjs:path loaded through gm_txiki_load_builtin, unknown module refused, runtime freed; ${runCodeLine})`);
}
