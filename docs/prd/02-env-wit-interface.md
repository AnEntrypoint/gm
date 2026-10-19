# 02 Define the env ABI as a WIT interface

Builds on the dual-loader decision in `docs/wasip3-loader-decision.md` (Rows this changes, PRD 02): the WIT interface covers the `env` imports for the component only, and the core path keeps the raw pointer ABI.

## Problem

Plugkit's host imports use raw pointer and length pairs in the `env` module,
declared in `rs-plugkit/crates/plugkit-core/src/code_index.rs`,
`rs-plugkit/crates/plugkit-core/src/embed.rs` and
`rs-plugkit/crates/plugkit-core/src/orchestrator/instructions/mod.rs`. A component
host cannot read guest memory from an import, so these signatures must become
typed WIT values.

## Scope

- Write one WIT interface for the 24 `env` functions declared in `rs-plugkit/crates/plugkit-core/src/wasm_dispatch/host_abi.rs` and the other `env` extern blocks. Strings and bytes become `string` and `list<u8>`. The count is 24, not 27: the slim wasip1 module imports 23 of them.
- Keep the function names as WIT names. Each raw signature stays, served by the adapter `rs-plugkit/crates/plugkit-core/src/wasm_dispatch/wit_env.rs`, so call sites do not change. The adapter is the choice over rewriting every call site, because the call sites are about 130 in six files.
- Route `host_abi` calls through the adapter under the `wit-env` feature, in `rs-plugkit/crates/plugkit-core/src/wasm_dispatch/host_abi.rs`.

## Status

Landed on `rs-plugkit` `main` as `8105452c` (the WIT file `rs-plugkit/crates/plugkit-core/wit/env.wit`, the adapter `rs-plugkit/crates/plugkit-core/src/wasm_dispatch/wit_env.rs` behind the `wit-env` feature, and the routing in `rs-plugkit/crates/plugkit-core/src/wasm_dispatch/host_abi.rs`), merged in `6099c00540`. The `wit-env` build compiles for `wasm32-wasip1`. The wit-env path has no runner witness until PRD 03 to 05 land. The extern blocks in `rs-plugkit/crates/plugkit-core/src/code_index.rs`, `rs-plugkit/crates/plugkit-core/src/embed.rs`, `rs-plugkit/crates/plugkit-core/src/orchestrator/instructions/mod.rs`, `rs-plugkit/crates/plugkit-core/src/pipeline.rs`, `rs-plugkit/crates/plugkit-core/src/shared_db.rs` and `rs-plugkit/crates/plugkit-core/src/vecns.rs` still declare raw `env` imports and are not yet routed through the adapter (filed as a follow-up row).

## Acceptance

- Every current `env` import has one WIT function with the same semantics.
- The wasip1 release build still passes, or the wasip1 path keeps the old ABI behind its own cfg.

## Witness

`rs-plugkit` `release` CI green on the pushed sha, including `publish / release`.
