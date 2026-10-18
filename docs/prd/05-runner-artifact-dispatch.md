# 05 Select the loader by artifact type in agentplug-runner

Builds on the dual-loader decision in `docs/wasip3-loader-decision.md` (Decision, Option B): the runner selects the linker from the artifact type and does not reject core modules, so the Option A branch below is rejected.

## Problem

After 04, the runner must choose a loader per artifact: a component goes to the
component linker, and a core module goes to the core linker. The choice depends
on decision 01.

## Scope

- Detect the artifact type from the wasm binary, before instantiation.
- Option A from 01: reject core modules with a named error.
- Option B from 01: route core modules to the existing core linker.
- Keep the runner's self-update guard comparing build identity, not the version string, as the agentplug AGENTS.md requires.

## Acceptance

- A component artifact and a core artifact each load through their own path, and each path has a named error for the other.

## Witness

A live dispatch of one verb for each artifact type, with dispatch ids.
