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

- Write one WIT interface for the 24 `env` functions declared in `host_abi.rs` and the other `env` extern blocks. Strings and bytes become `string` and `list<u8>`. The count is 24, not 27: the slim wasip1 module imports 23 of them.
- Keep the function names as WIT names. Each raw signature stays, served by an adapter in planned module `wasm_dispatch/wit_env.rs` (not yet created), so call sites do not change. The adapter is the choice over rewriting every call site, because the call sites are about 130 in six files.
- Route `host_abi` calls through the adapter under the `wit-env` feature, in `rs-plugkit/crates/plugkit-core/src/wasm_dispatch/host_abi.rs`.

## Status

The adapter and the WIT file are committed in `rs-plugkit` as `57c6098b` on its `main`, not pushed. The session cannot push to that repository.

## Acceptance

- Every current `env` import has one WIT function with the same semantics.
- The wasip1 release build still passes, or the wasip1 path keeps the old ABI behind its own cfg.

## Witness

`rs-plugkit` `release` CI green on the pushed sha, including `publish / release`.
