# 02 Define the env ABI as a WIT interface

## Problem

Plugkit's host imports use raw pointer and length pairs in the `env` module,
declared in `rs-plugkit/crates/plugkit-core/src/code_index.rs`,
`rs-plugkit/crates/plugkit-core/src/embed.rs` and
`rs-plugkit/crates/plugkit-core/src/orchestrator/instructions/mod.rs`. A component
host cannot read guest memory from an import, so these signatures must become
typed WIT values.

## Scope

- Write one WIT interface for the 27 `env` functions. Strings and bytes become `string` and `list<u8>`.
- Keep the function names as WIT names, and map each Rust call site to the generated binding.
- Route `host_abi` calls through the generated bindings, in `rs-plugkit/crates/plugkit-core/src/wasm_dispatch/host_abi.rs`.

## Acceptance

- Every current `env` import has one WIT function with the same semantics.
- The wasip1 release build still passes, or the wasip1 path keeps the old ABI behind its own cfg.

## Witness

`rs-plugkit` `release` CI green on the pushed sha, including `publish / release`.
