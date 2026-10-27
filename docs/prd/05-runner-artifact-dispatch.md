# 05 Select the loader by artifact type in agentplug-runner

Builds on dual-loader decision in `docs/wasip3-loader-decision.md` (Decision, Option B): runner pick linker by artifact type, no reject core modules. Option A branch below rejected.

## Problem

After 04, runner must pick loader per artifact: component goes to component linker, core module goes to core linker. Choice depend on decision 01.

## Scope

- Detect artifact type from wasm binary, before instantiation.
- Option A from 01: reject core modules, named error.
- Option B from 01: route core modules to existing core linker.
- Keep runner self-update guard comparing build identity, not version string, per agentplug AGENTS.md.

## Acceptance

- Component artifact and core artifact each load through own path; each path has named error for other.

## Witness

Live dispatch of one verb per artifact type, with dispatch ids.