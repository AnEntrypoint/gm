const assert = require('assert');

(function detachedBufferThrows() {
  const mem = new WebAssembly.Memory({ initial: 1, maximum: 100 });
  const ptr = 1000, len = 16;
  new Uint8Array(mem.buffer, ptr, len).set(new Uint8Array(len).fill(0x41));
  const staleBuffer = mem.buffer;
  mem.grow(50);
  let threw = false;
  try { new Uint8Array(staleBuffer, ptr, len); } catch (_) { threw = true; }
  assert.ok(threw, 'a stale (pre-grow) buffer view must throw after a memory grow (the bug)');
})();

(function freshBufferReads() {
  const mem = new WebAssembly.Memory({ initial: 1, maximum: 100 });
  const ptr = 1000, len = 16;
  new Uint8Array(mem.buffer, ptr, len).set(new Uint8Array(len).fill(0x41));
  mem.grow(50);
  const fresh = mem.buffer;
  const v = new Uint8Array(fresh, ptr, len);
  assert.strictEqual(v[0], 0x41, 'a fresh (post-grow) buffer view reads the written bytes');
})();

(function decodeNormalizesSignedI64() {
  const decode = (result) => {
    const u = BigInt.asUintN(64, BigInt(result));
    return { ptr: Number(u & 0xffffffffn), len: Number(u >> 32n) };
  };
  const pack = (ptr, len) => (BigInt(len) << 32n) | (BigInt(ptr) & 0xffffffffn);
  const signed = BigInt.asIntN(64, pack(0x88000000, 0x40));
  const d = decode(signed);
  assert.strictEqual(d.ptr, 0x88000000, 'ptr decodes unsigned even from a negative i64');
  assert.strictEqual(d.len, 0x40, 'len decodes correctly from the high word');
  assert.ok(d.ptr >= 0 && d.len >= 0, 'decoded ptr/len are never negative');
})();

(function signedAllocPointerThrows() {
  const mem = new WebAssembly.Memory({ initial: 1, maximum: 4 });
  const trueOffset = 0x88000000;
  const signedReturn = trueOffset | 0;
  assert.ok(signedReturn < 0, 'a high-bit wasm i32 pointer is negative in JS (the trap)');
  let threwRaw = false;
  try { new Uint8Array(mem.buffer, signedReturn, 8); } catch (e) {
    threwRaw = /outside the bounds/.test(String(e.message));
  }
  assert.ok(threwRaw, 'the raw negative pointer reproduces the "outside the bounds" throw');
  assert.strictEqual(signedReturn >>> 0, trueOffset, '>>>0 recovers the true unsigned offset');
  assert.ok((signedReturn >>> 0) >= 0, 'the coerced offset is non-negative');
})();

(function wrapperHasFix() {
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(__dirname, 'plugkit-wasm-wrapper.js'), 'utf8');
  assert.ok(src.includes('function decodeWasmResult'), 'decodeWasmResult helper present');
  assert.ok(src.includes('function writeWasmInput'), 'writeWasmInput helper present');
  const codeLines = src.split('\n').filter(l => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'));
  const raw = codeLines.filter(l => l.includes('result & 0xffffffffn') || l.includes('result >> 32n'));
  assert.strictEqual(raw.length, 0, `no raw (un-normalized) i64 decode remains in code; found: ${raw.join(' | ')}`);
  assert.ok(/plugkit_alloc\(bytes\.length\)\s*>>>\s*0/.test(src), 'writeWasmInput/writeWasmBytes coerce the alloc pointer with >>>0');
  assert.ok(src.includes(':writeWasmInput') || /guardWasmRange\([^)]*writeWasm/.test(src), 'the alloc write is range-guarded');
})();

console.log('wasm-buffer-decode: all PASS');
