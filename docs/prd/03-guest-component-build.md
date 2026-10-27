# 03 Build the plugkit guest as a wasip3 component

Build on dual-loader decision in `docs/wasip3-loader-decision.md` (Rows this changes, PRD 03): `wasm-component-ld` replace `rust-lld` override for component build only, absorb 4 stack and TLS intrinsics.

## Problem

wasip3 build link through `rust-lld` in `wasm-ld` mode, make core module. Override local, not in CI. Default `wasm-component-ld` path fail because `env` imports not WIT
interfaces.

## Scope

- Depend on 02 (WIT interface).
- Link with `wasm-component-ld` and WIT world. Remove `rust-lld` override.
- Keep getrandom custom backend in `rs-plugkit/.cargo/config.toml` for wasm32-wasip3. Symbol `__getrandom_v03_custom` in `rs-plugkit/crates/plugkit-core/src/embed.rs`.
- Keep `--features slim` for release build, as `rs-plugkit/AGENTS.md` require.

## Acceptance

- `cargo +nightly build -p rs-plugkit --release --target wasm32-wasip3 --features slim,wit-env` produce component importing `plugkit:env/host`.
- Component export typed `dispatch-verb` and `plugkit-version`. `plugkit_alloc` and `plugkit_free` not exported: typed `list<u8>` and `string` values owned by canonical ABI, so guest-allocated buffers not part of component contract.

## Measured

wit-env debug component links. Import `plugkit:env/host@0.1.0` and WASI 0.3 interfaces, export nothing yet. `wasm-component-ld` drop raw core exports world not declare.

## Witness

Component export list and size, recorded from live build log in CI job from 06.