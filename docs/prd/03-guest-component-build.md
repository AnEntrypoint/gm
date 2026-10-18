# 03 Build the plugkit guest as a wasip3 component

Builds on the dual-loader decision in `docs/wasip3-loader-decision.md` (Rows this changes, PRD 03): `wasm-component-ld` replaces the `rust-lld` override for the component build only and absorbs the 4 stack and TLS intrinsics.

## Problem

The wasip3 build currently links through `rust-lld` in `wasm-ld` mode, which
produces a core module. The override is local and is not in CI. The
default `wasm-component-ld` path fails because the `env` imports are not WIT
interfaces.

## Scope

- Depends on 02 (WIT interface).
- Link with `wasm-component-ld` and the WIT world. Remove the `rust-lld` override.
- Keep the getrandom custom backend in `rs-plugkit/.cargo/config.toml` for wasm32-wasip3. Its symbol is `__getrandom_v03_custom` in `rs-plugkit/crates/plugkit-core/src/embed.rs`.
- Keep `--features slim` for the release build, as `rs-plugkit/AGENTS.md` requires.

## Acceptance

- `cargo +nightly build -p rs-plugkit --release --target wasm32-wasip3 --features slim,wit-env` produces a component that imports `plugkit:env/host`.
- The component exports typed `dispatch-verb` and `plugkit-version`. `plugkit_alloc` and `plugkit_free` are not exported: typed `list<u8>` and `string` values are owned by the canonical ABI, so guest-allocated buffers are not part of the component contract.

## Measured

- The wit-env debug component links. It imports `plugkit:env/host@0.1.0` and the WASI 0.3 interfaces, and exports nothing yet. `wasm-component-ld` drops the raw core exports the world does not declare.

## Witness

The component's export list and size, recorded from a live build log in the CI job from 06.
