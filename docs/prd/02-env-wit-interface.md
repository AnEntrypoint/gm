# 02 Define the env ABI as a WIT interface

Builds on dual-loader decision in `docs/wasip3-loader-decision.md` (Rows this changes, PRD 02): WIT interface cover `env` imports for component only. Core path keep raw pointer ABI.

## Problem

Plugkit host imports use raw pointer and length pairs in `env` module,
declared in `rs-plugkit/crates/plugkit-core/src/code_index.rs`,
`rs-plugkit/crates/plugkit-core/src/embed.rs` and
`rs-plugkit/crates/plugkit-core/src/orchestrator/instructions/mod.rs`. Component host cannot read guest memory from import, so these signatures must become typed WIT values.

## Scope

- Write one WIT interface for 24 `env` functions declared in `rs-plugkit/crates/plugkit-core/src/wasm_dispatch/host_abi.rs` and other `env` extern blocks. Strings and bytes become `string` and `list<u8>`. Count is 24, not 27: slim wasip1 module import 23 of them.
- Keep function names as WIT names. Each raw signature stay, served by adapter `rs-plugkit/crates/plugkit-core/src/wasm_dispatch/wit_env.rs`, so call sites no change. Adapter chosen over rewriting every call site, because call sites about 130 in six files.
- Route `host_abi` calls through adapter under `wit-env` feature, in `rs-plugkit/crates/plugkit-core/src/wasm_dispatch/host_abi.rs`.

## Status

Landed on `rs-plugkit` `main` as `8105452c` (WIT file `rs-plugkit/crates/plugkit-core/wit/env.wit`, adapter `rs-plugkit/crates/plugkit-core/src/wasm_dispatch/wit_env.rs` behind `wit-env` feature, routing in `rs-plugkit/crates/plugkit-core/src/wasm_dispatch/host_abi.rs`), merged in `6099c00540`. `wit-env` build compiles for `wasm32-wasip1`. wit-env path has no runner witness until PRD 03 to 05 land. Extern blocks in `rs-plugkit/crates/plugkit-core/src/code_index.rs`, `rs-plugkit/crates/plugkit-core/src/embed.rs`, `rs-plugkit/crates/plugkit-core/src/orchestrator/instructions/mod.rs`, `rs-plugkit/crates/plugkit-core/src/pipeline.rs`, `rs-plugkit/crates/plugkit-core/src/shared_db.rs` and `rs-plugkit/crates/plugkit-core/src/vecns.rs` still declare raw `env` imports, not yet routed through adapter (filed as follow-up row).

## Acceptance

- Every current `env` import has one WIT function, same semantics.
- wasip1 release build still pass, or wasip1 path keep old ABI behind own cfg.

## Witness

`rs-plugkit` `release` CI green on pushed sha, including `publish / release`.