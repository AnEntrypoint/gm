---
key: mem-8cccbbc8f2059c7b-835
ns: default
created: 1784799917610
updated: 1784799917610
---

gm-method: rs-plugkit/crates/plugkit-core/src/browser_witness.rs hand-rolls SHA-256 instead of using the sha2 crate (already a dependency of the sibling agentplug-runner crate) because plugkit-core targets wasm32-wasip1 as a cdylib with an already-fragile candle/tokenizers/gemm dependency chain, and this repos cascade-only build discipline means a new dependency addition here cannot be locally build-verified before landing (only pushed CI witnesses the compile). The hash is used only for a non-adversarial content-addressed dedup key (browser-edit witness tracking), not a security boundary, so the existing small correct implementation is the lower-risk choice over an unverified new wasm32-wasip1 dependency edge. If cross-project embed/hash dependency consolidation is ever worth the risk, do it as its own CI-witnessed change.
