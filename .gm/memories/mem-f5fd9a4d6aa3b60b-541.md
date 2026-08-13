---
key: mem-f5fd9a4d6aa3b60b-541
ns: default
created: 1783252212445
updated: 1783253892433
---

## Resolved mutable: mut-1783252110724

Confirmed via direct A/B: same ccsniff --bash-discipline command crashed the wasm exec_js host 2x (task 5-retry, task 14, both dying ~40s in) but completed cleanly via direct Bash in ~15-20s (894626 events/9973 files scanned, exit 0). Root cause is heavy-subprocess-inside-sandboxed-wasm-host, not the command itself. Fix location confirmed out of gm/rs-exec scope (rs-exec has zero subprocess capability per this session's rs-exec survey) -- belongs in gm-plugkit's JS host wrapper (rs-plugkit repo).
