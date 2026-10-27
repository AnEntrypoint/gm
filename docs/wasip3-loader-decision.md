# Decision: loader strategy for the wasip3 port

Records PRD 01 (`docs/prd/01-loader-decision.md`) and gm row `wasip3-decide-fallback`.
Rows 02 to 07 build on this record.

## Decision

Option B, dual loader. Agentplug host keep loading core `env` module that release ship, load wasip3 component alongside. Loader chosen per artifact by type (PRD 05). Option A (direct cutover) rejected.

## Evidence (verified 2026-10-18)

- Shipped artifact, `wasm32-wasip1` release build of `rs_plugkit.wasm`, is core module importing 23 `env` functions and 10 `wasi_snapshot_preview1` functions. `agentplug/crates/agentplug-host/src/imports.rs` defines all 23 `env` functions and links WASI through `wasmtime_wasi::p1::add_to_linker_sync`, so every installed runner load it today.
- `wasm32-wasip3` release build of `rs_plugkit.wasm` also core module (version word 1, not component layer). It imports 27 `env` functions, 7 `$root` functions and 16 `wasi:*@0.3.0` interfaces. The 4 `env` names it adds over wasip1 (`__wasm_get_stack_pointer`, `__wasm_set_stack_pointer`, `__wasm_get_tls_base`, `__wasm_set_tls_base`) are stack and TLS intrinsics that component linking satisfy and host not define. Other 23 match host's existing `env` set.
- `agentplug/crates` contain no `component::` linker; host only deserialize core modules (`agentplug/crates/agentplug-host/src/precompiled.rs`). `wasmtime` 46 with default features already carry component model, so component linker is addition, not dependency change.

## Reasons

- Option A leave every runner that receive new build unable to load its artifact, no fallback, while wasip3 output still unlinked core module no host can instantiate.
- `env` ABI not blocker: host already provide every real `env` function. Gap is component step (`wasm-component-ld`, PRD 03) and WASI 0.3 component linker (PRD 04). Option B let those land and be witnessed without changing artifact users run.

## Rows this changes

- PRD 02: WIT interface cover `env` imports for component only. Core path keep raw pointer ABI behind its own cfg.
- PRD 03: `wasm-component-ld` replace `rust-lld` override for component build only, which also absorb 4 stack and TLS intrinsics.
- PRD 04: component `Linker` sit next to core linker, neither replace other.
- PRD 05: runner select linker from artifact type (core version word 1 versus component layer). It not reject core modules.
- PRD 06 and 07: CI and live witness cover both paths.

## Cost

Two linkers and artifact-type check stay in runner until later cutover decided on its own record.