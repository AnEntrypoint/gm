# Decision: loader strategy for the wasip3 port

Records PRD 01 (`docs/prd/01-loader-decision.md`) and gm row `wasip3-decide-fallback`.
Rows 02 to 07 build on this record.

## Decision

Option B, dual loader. The agentplug host keeps loading the core `env` module that
the release ships, and loads the wasip3 component alongside it. The loader is
chosen per artifact by type (PRD 05). Option A (direct cutover) is rejected.

## Evidence (verified 2026-10-18)

- The shipped artifact `rs-plugkit/target/wasm32-wasip1/release/rs_plugkit.wasm`
  is a core module importing 23 `env` functions and 10 `wasi_snapshot_preview1`
  functions. `agentplug/crates/agentplug-host/src/imports.rs` defines all 23 `env`
  functions and links WASI through `wasmtime_wasi::p1::add_to_linker_sync`, so
  every installed runner loads it today.
- The wasip3 build `rs-plugkit/target/wasm32-wasip3/release/rs_plugkit.wasm` is
  also a core module (version word 1, not a component layer). It imports 27 `env`
  functions, 7 `$root` functions and 16 `wasi:*@0.3.0` interfaces. The 4 `env`
  names it adds over wasip1 (`__wasm_get_stack_pointer`,
  `__wasm_set_stack_pointer`, `__wasm_get_tls_base`, `__wasm_set_tls_base`) are
  stack and TLS intrinsics that component linking satisfies and that the host
  does not define. The other 23 match the host's existing `env` set.
- `agentplug/crates` contains no `component::` linker; the host only
  deserializes core modules (`agentplug/crates/agentplug-host/src/precompiled.rs`).
  `wasmtime` 46 with default features already carries the component model, so a
  component linker is an addition, not a dependency change.

## Reasons

- Option A would leave every runner that receives the new build unable to load
  its artifact, with no fallback, while the wasip3 output is still an unlinked
  core module that no host can instantiate.
- The `env` ABI is not the blocker: the host already provides every real `env`
  function. The gap is the component step (`wasm-component-ld`, PRD 03) and a
  WASI 0.3 component linker (PRD 04). Option B lets those land and be witnessed
  without changing the artifact users run.

## Rows this changes

- PRD 02: the WIT interface covers the `env` imports for the component only. The
  core path keeps the raw pointer ABI behind its own cfg.
- PRD 03: `wasm-component-ld` replaces the `rust-lld` override for the component
  build only, which also absorbs the 4 stack and TLS intrinsics.
- PRD 04: the component `Linker` sits next to the core linker, and neither replaces
  the other.
- PRD 05: the runner selects the linker from the artifact type (core version word 1
  versus component layer). It does not reject core modules.
- PRD 06 and 07: CI and the live witness cover both paths.

## Cost

Two linkers and an artifact-type check stay in the runner until a later cutover is
decided on its own record.
