const assert = require('assert');

// Regression guard for the wasm buffer-bounds bug that broke EVERY plugkit verb once the .gm state
// grew large (witnessed: a >200KB prd.yml -> a big plugkit_alloc -> 'Start offset -N is outside the
// bounds of the buffer' on every dispatch, blocking the COMPLETE gate).
//
// ROOT CAUSE: a DETACHED ArrayBuffer. plugkit_alloc / dispatch grows the wasm linear memory, which
// detaches the previously-captured `instance.exports.memory.buffer` (byteLength -> 0). A
// `new Uint8Array(staleBuffer, ptr, len)` for a valid post-grow ptr then throws. The fix (decodeWasmResult
// + writeWasmInput in plugkit-wasm-wrapper.js) re-reads instance.exports.memory.buffer FRESH at the
// moment of every view, never reusing a buffer captured across a memory grow.

// 1. A WebAssembly.Memory grow DETACHES a captured buffer -> reading the stale one throws.
(function detachedBufferThrows() {
  const mem = new WebAssembly.Memory({ initial: 1, maximum: 100 });
  const ptr = 1000, len = 16;
  new Uint8Array(mem.buffer, ptr, len).set(new Uint8Array(len).fill(0x41));
  const staleBuffer = mem.buffer;
  mem.grow(50);   // detaches staleBuffer
  let threw = false;
  try { new Uint8Array(staleBuffer, ptr, len); } catch (_) { threw = true; }
  assert.ok(threw, 'a stale (pre-grow) buffer view must throw after a memory grow (the bug)');
})();

// 2. Re-reading memory.buffer FRESH after the grow reads correctly (the fix's invariant).
(function freshBufferReads() {
  const mem = new WebAssembly.Memory({ initial: 1, maximum: 100 });
  const ptr = 1000, len = 16;
  new Uint8Array(mem.buffer, ptr, len).set(new Uint8Array(len).fill(0x41));
  mem.grow(50);
  const fresh = mem.buffer;   // re-read after grow
  const v = new Uint8Array(fresh, ptr, len);
  assert.strictEqual(v[0], 0x41, 'a fresh (post-grow) buffer view reads the written bytes');
})();

// 3. The (ptr,len) i64 decode normalizes a signed return to the correct unsigned ptr/len.
(function decodeNormalizesSignedI64() {
  const decode = (result) => {
    const u = BigInt.asUintN(64, BigInt(result));
    return { ptr: Number(u & 0xffffffffn), len: Number(u >> 32n) };
  };
  const pack = (ptr, len) => (BigInt(len) << 32n) | (BigInt(ptr) & 0xffffffffn);
  // a large ptr with bit 31 set, delivered as a SIGNED i64 (negative BigInt)
  const signed = BigInt.asIntN(64, pack(0x88000000, 0x40));
  const d = decode(signed);
  assert.strictEqual(d.ptr, 0x88000000, 'ptr decodes unsigned even from a negative i64');
  assert.strictEqual(d.len, 0x40, 'len decodes correctly from the high word');
  assert.ok(d.ptr >= 0 && d.len >= 0, 'decoded ptr/len are never negative');
})();

// 4. The shipped wrapper actually contains the fix (no un-normalized result decode, has the helpers).
(function wrapperHasFix() {
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(__dirname, 'plugkit-wasm-wrapper.js'), 'utf8');
  assert.ok(src.includes('function decodeWasmResult'), 'decodeWasmResult helper present');
  assert.ok(src.includes('function writeWasmInput'), 'writeWasmInput helper present');
  // no live decode uses the raw `result & 0xffffffffn` (only the explanatory comment may mention it)
  const codeLines = src.split('\n').filter(l => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'));
  const raw = codeLines.filter(l => l.includes('result & 0xffffffffn') || l.includes('result >> 32n'));
  assert.strictEqual(raw.length, 0, `no raw (un-normalized) i64 decode remains in code; found: ${raw.join(' | ')}`);
})();

console.log('wasm-buffer-decode: all PASS');
