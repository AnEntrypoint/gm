---
key: mem-8cc5f3bcf27db97c-293
ns: default
created: 1783015068949
updated: 1783015975450
---

## Resolved mutable: edge-case-wasm-memory-uncaught-throw

gm-plugkit/plugkit-wasm-wrapper.js:1534 guardWasmRange throws Error on out-of-bounds. Called from 1554 (writeWasmInput) and 1578 (writeWasmBytes). Some calling contexts don't wrap in try-catch, so throw propagates and crashes watcher.
