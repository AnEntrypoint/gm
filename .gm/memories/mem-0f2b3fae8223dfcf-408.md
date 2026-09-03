---
key: mem-0f2b3fae8223dfcf-408
ns: default
created: 1782381114682
updated: 1782381217056
---

gm wrapper ESM rule (drained from AGENTS.md): plugkit-wasm-wrapper.js is an ESM module; every node builtin must be imported at module scope, never via inline require(). An inline require() throws silently under bun's ESM loader (require is not defined), taking the wrapper dark with no error surfaced. This is the bun-ESM single-platform mechanism behind the 'wrapper require not defined under bun' incident.
