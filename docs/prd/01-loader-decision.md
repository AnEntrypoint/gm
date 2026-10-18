# 01 Decide the loader strategy for the wasip3 port

## Problem

The plugkit guest built for wasm32-wasip3 links as a core module. It imports
27 flat `env` functions and WASI 0.3 interfaces (`wasi:cli`, `wasi:filesystem`,
`wasi:clocks`, `wasi:random`). The agentplug host loads core modules only and
links WASI preview 1, so it cannot instantiate this artifact.

## Options

- A. Cut over directly. The guest becomes a component and the host loads only components.
- B. Dual loader. The host keeps loading the core `env` module during migration and loads components alongside it.

## Acceptance

- A decision record in `docs/` names the option, its reason and the rows it changes.
- Rows 02 to 07 cite this record.

## Witness

The record is pushed, and the `doc-drift` CI job on that sha reports success.
