# 01 Decide the loader strategy for the wasip3 port

## Problem

plugkit guest built for wasm32-wasip3 link as core module. Import 27 flat `env` functions + WASI 0.3 interfaces (`wasi:cli`, `wasi:filesystem`, `wasi:clocks`, `wasi:random`). agentplug host load core modules only, link WASI preview 1. So cannot instantiate this artifact.

## Options

- A. Cut over direct. Guest become component, host load only component.
- B. Dual loader. Host keep load core `env` module during migration, load component alongside.

## Acceptance

- Decision record in `docs/` name option, reason, rows it change.
- Rows 02 to 07 cite this record.

## Witness

Record pushed, `doc-drift` CI job on that sha report success.