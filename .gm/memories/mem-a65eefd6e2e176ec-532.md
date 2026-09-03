---
key: mem-a65eefd6e2e176ec-532
ns: default
created: 1783425212425
updated: 1783425212471
---

## Resolved mutable: rs-learn-live-callsite-inventory

exec_js-9041: 22 total hits. Live rs_learn surface: LearnSession::new(SqlKv)+dispatch_json at memorize.rs:229-230, recall.rs:74-75, wasm_dispatch.rs:933-934+944-946; KvBackend impl wasm_dispatch.rs:877; dead Router at wasm_dispatch.rs:986-991. rs_search: tokenize (code_index.rs:659,704,711,731) + fusion (wasm_dispatch.rs:619-620). Port = reimplement dispatch_json memorize/recall/prune handlers in-tree; rslearn_vectors.rs/rssearch_vectors.rs already exist in rs-plugkit src.
