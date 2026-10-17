# Decision: loader strategy for the wasip3 port

Records PRD 01 (`docs/prd/01-loader-decision.md`). Rows 02 to 07 cite this record.

## Decision

Option B, dual loader. The agentplug host keeps loading the core `env` module that
the release ships, and loads the wasip3 component alongside it. The loader is
chosen per artifact by type (PRD 05).

## Reasons

- The release artifact is a wasip1 core module. Every installed runner loads it.
  Option A (cut over directly) would make every runner that receives the new
  build unable to load its artifact, with no fallback.
- The current build already shows why the component path cannot replace the core
  path yet. The wasip3 guest built with `--features slim` fails at link time with
  `failed to resolve import env::host_now_ms` and `module requires an import
  interface named env` (`rs-plugkit`, `cargo +nightly build -p rs-plugkit --release
  --target wasm32-wasip3 --features slim`). The `env` imports are not WIT
  interfaces, so the component cannot instantiate until PRD 02 lands.
- Option B lets PRD 02 to 07 land and be witnessed without changing the artifact
  that users run today.

## Rows this changes

- PRD 02: the WIT interface covers the `env` imports for the component only. The
  core path keeps the raw pointer ABI behind its own cfg.
- PRD 03: `wasm-component-ld` replaces the `rust-lld` override for the component
  build only.
- PRD 04: the component `Linker` sits next to the core linker, and neither replaces
  the other.
- PRD 05: the runner selects the linker from the artifact type. It does not reject
  core modules, so Option A's named rejection is not needed.
- PRD 06 and 07: CI and the live witness cover both paths.

## Cost

Two linkers and an artifact-type check stay in the runner until a later cutover is
decided on its own record.

## Witness

The failing build log above is the current witness. The record closes when the
`doc-drift` job on the pushed sha reports success.
