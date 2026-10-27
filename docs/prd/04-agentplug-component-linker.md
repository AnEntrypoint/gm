# 04 Link components in agentplug-host on wasmtime 46

Builds on dual-loader decision in `docs/wasip3-loader-decision.md` (Rows this changes, PRD 04): component `Linker` sit next to core linker, neither replace other.

## Problem

agentplug host (submodule `agentplug`, pinned at c8af8e5b when this PRD
was written) run guests as core modules. WASI hookup WASI preview 1 only.
Cannot instantiate wasip3 component or satisfy WASI 0.3 imports.

## Scope

- Add component `Linker` next to core linker. Use `wasmtime 46` with component model and async support.
- Wire WASI 0.3 interfaces (`wasi:cli`, `wasi:filesystem`, `wasi:clocks`, `wasi:random`) through `wasmtime-wasi` 46.0.3, once API confirmed from crate sources.
- Implement 27 WIT `env` functions from 02 on host side, read and write guest memory through component's typed values.

## Open facts

- `wasmtime-wasi` 46.0.3 WASI 0.3 API not read from source yet. Crate fetch stalled in this environment.

## Acceptance

- Host instantiate component from 03 and call one export.

## Witness

Live dispatch through agentplug-runner with its dispatch id, cited in completion report.