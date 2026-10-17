# 04 Link components in agentplug-host on wasmtime 46

## Problem

The agentplug host (submodule `agentplug`, pinned at c8af8e5b when this PRD
was written) runs guests as core modules. Its WASI hookup is WASI preview 1 only.
It cannot instantiate a wasip3 component or satisfy the WASI 0.3 imports.

## Scope

- Add a component `Linker` next to the core linker. Use `wasmtime 46` with the component model and async support.
- Wire the WASI 0.3 interfaces (`wasi:cli`, `wasi:filesystem`, `wasi:clocks`, `wasi:random`) through `wasmtime-wasi` 46.0.3, once its API is confirmed from the crate sources.
- Implement the 27 WIT `env` functions from 02 on the host side, reading and writing guest memory through the component's typed values.

## Open facts

- The `wasmtime-wasi` 46.0.3 WASI 0.3 API has not been read from source yet. The crate fetch stalled in this environment.

## Acceptance

- The host instantiates the component from 03 and calls one export.

## Witness

A live dispatch through agentplug-runner with its dispatch id, cited in the completion report.
