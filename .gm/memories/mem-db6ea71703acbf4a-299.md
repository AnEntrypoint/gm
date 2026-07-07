---
key: mem-db6ea71703acbf4a-299
ns: default
created: 1782732491105
updated: 1782733366263
---

## Resolved mutable: rs-search-side-effects-idempotent

rs-search/src/wasm_host.rs:77-107 fusion_search is a pure query over the host-owned index: no kv_put, no mutation, no counter. Deterministic with stable tiebreak (results.sort_by ... then_with a.id.cmp(b.id)). Stateless -> f∘f≡f trivially.
