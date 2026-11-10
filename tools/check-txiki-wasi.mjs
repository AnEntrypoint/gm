#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { WASI } from 'node:wasi';
import { resolve } from 'node:path';

const target = process.argv[2];
if (!target || !existsSync(target)) {
  console.log('txiki-wasi-check: skipped (no wasm given)');
  process.exit(0);
}

const started = Date.now();
const wasi = new WASI({ version: 'preview1', args: [], env: {}, preopens: {} });
const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
let stderr = '';
let instance;
const module = await WebAssembly.compile(readFileSync(resolve(target)));
const env = {};
for (const entry of WebAssembly.Module.imports(module)) {
  if (entry.module === 'env' && entry.kind === 'function') env[entry.name] = () => 0;
}
env.tjs_host_write = (fd, base, len) => {
  const text = Buffer.from(instance.exports.memory.buffer, base, len).toString('utf8');
  if (fd === 2) stderr += text;
};
instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport, env });
wasi.initialize(instance);
const exp = instance.exports;

const allocString = (text) => {
  const bytes = Buffer.from(`${text}\0`, 'utf8');
  const ptr = exp.malloc(bytes.length);
  new Uint8Array(exp.memory.buffer, ptr, bytes.length).set(bytes);
  return ptr;
};

const rt = exp.gm_txiki_new();
expect(rt !== 0, 'gm_txiki_new returned NULL');
const ctx = rt !== 0 ? exp.gm_txiki_context(rt) : 0;
expect(ctx !== 0, 'gm_txiki_context returned NULL');
const alive = rt !== 0 ? exp.gm_txiki_loop_alive(rt) : -1;
expect(alive === 0 || alive === 1, `gm_txiki_loop_alive returned ${alive}`);
if (rt !== 0) exp.gm_txiki_loop_turn(rt);
const namePtr = allocString('tjs:path');
const builtin = ctx !== 0 ? exp.gm_txiki_load_builtin(ctx, namePtr) : 0;
expect(builtin !== 0, 'gm_txiki_load_builtin returned NULL for tjs:path');
const missingPtr = allocString('tjs:gm-no-such-module');
const missing = ctx !== 0 ? exp.gm_txiki_load_builtin(ctx, missingPtr) : 0;
expect(missing === 0, `gm_txiki_load_builtin returned ${missing} for an unknown module`);
if (rt !== 0) exp.gm_txiki_free(rt);

const elapsed = Date.now() - started;
if (failures.length) {
  console.error(`txiki-wasi-check: ${failures.length} failure(s)\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`txiki-wasi-check: ok (${target}: runtime created, context read, loop turned, tjs:path loaded through gm_txiki_load_builtin, unknown module refused, runtime freed; ${elapsed} ms)`);
}
