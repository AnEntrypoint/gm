function guardWasmRange(buffer, ptr, len, where) {
  const total = buffer.byteLength;
  if (!Number.isInteger(ptr) || !Number.isInteger(len) || ptr < 0 || len < 0 || ptr + len > total) {
    throw new Error(`wasm-memory-read-out-of-bounds at ${where}: ptr=${ptr} len=${len} buffer=${total} -- corrupt (ptr,len) from wasm, refusing the read instead of crashing the dispatch loop`);
  }
}

function decodeWasmResult(instance, result, where) {
  const u = BigInt.asUintN(64, BigInt(result));
  const ptr = Number(u & 0xffffffffn);
  const len = Number(u >> 32n);
  if (ptr === 0 || len === 0) return '';
  const buffer = instance.exports.memory.buffer;
  guardWasmRange(buffer, ptr, len, where);
  const out = new TextDecoder().decode(new Uint8Array(buffer, ptr, len));
  try { instance.exports.plugkit_free(ptr, len); } catch (_) {}
  return out;
}

function writeWasmInput(instance, bytes, where) {
  if (bytes.length === 0) return 0;
  const ptr = instance.exports.plugkit_alloc(bytes.length) >>> 0;
  if (ptr === 0) throw new Error(`wasm-alloc-failed at ${where}: plugkit_alloc returned 0 (wasm OOM)`);
  guardWasmRange(instance.exports.memory.buffer, ptr, bytes.length, `${where}:writeWasmInput`);
  new Uint8Array(instance.exports.memory.buffer, ptr, bytes.length).set(bytes);
  return ptr;
}

function readWasmBytes(instance, ptr, len) {
  if (ptr === 0 || len === 0) return new Uint8Array(0);
  const buffer = instance.exports.memory.buffer;
  guardWasmRange(buffer, ptr, len, 'readWasmBytes');
  return new Uint8Array(buffer, ptr, len).slice();
}

function readWasmStr(instance, ptr, len) {
  if (ptr === 0 || len === 0) return '';
  const buffer = instance.exports.memory.buffer;
  guardWasmRange(buffer, ptr, len, 'readWasmStr');
  const bytes = new Uint8Array(buffer, ptr, len);
  return new TextDecoder('utf-8').decode(bytes);
}

function writeWasmBytes(instance, bytes) {
  if (bytes.length === 0) return 0n;
  const ptr = instance.exports.plugkit_alloc(bytes.length) >>> 0;
  if (ptr === 0) return 0n;
  guardWasmRange(instance.exports.memory.buffer, ptr, bytes.length, 'writeWasmBytes');
  new Uint8Array(instance.exports.memory.buffer, ptr, bytes.length).set(bytes);
  return (BigInt(ptr) & 0xffffffffn) | (BigInt(bytes.length) << 32n);
}

function writeWasmStr(instance, str) {
  if (!str) return 0n;
  return writeWasmBytes(instance, new TextEncoder().encode(str));
}

function writeWasmJson(instance, value) {
  return writeWasmStr(instance, JSON.stringify(value));
}

export {
  guardWasmRange,
  decodeWasmResult,
  writeWasmInput,
  readWasmBytes,
  readWasmStr,
  writeWasmBytes,
  writeWasmStr,
  writeWasmJson,
};
