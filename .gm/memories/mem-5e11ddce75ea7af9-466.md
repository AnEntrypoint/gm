---
key: mem-5e11ddce75ea7af9-466
ns: default
created: 1782378903333
updated: 1782381217057
---

## Resolved mutable: rs-plugkit-sibling-present

Bash ls ../rs-plugkit -> SIBLING-PRESENT; src/orchestrator/instructions/{entry,plan,execute,emit,verify,update_docs,browser,mod}.rs present. sync-instruction-consts.mjs rsDir defaults to here/../../../rs-plugkit (from gm-plugkit/scripts/ == gm/../rs-plugkit), or RS_PLUGKIT_DIR. So sync-instruction-consts.mjs can write the .rs consts locally; rs-plugkit must then be committed+pushed to trigger cascade wasm rebuild.
