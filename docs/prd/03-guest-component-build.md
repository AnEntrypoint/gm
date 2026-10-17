# 03 Build the plugkit guest as a wasip3 component

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

- `cargo build -p rs-plugkit --release --target wasm32-wasip3 --features slim` produces a component.
- The component exports `dispatch_verb`, `plugkit_alloc`, `plugkit_free` and `plugkit_version`.

## Witness

The component's export list and size, recorded from a live build log in the CI job from 06.
