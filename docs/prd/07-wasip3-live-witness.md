# 07 Witness a wasip3 plugkit verb through agentplug-runner

Builds on dual-loader decision in `docs/wasip3-loader-decision.md` (Rows this changes, PRD 06 and 07): live witness covers both core module path and component path.

## Problem

`rs-plugkit/AGENTS.md` requires changed verb witnessed through real host with live dispatch. No wasip3 artifact dispatched yet.

## Scope

- Load wasip3 component from 03 through runner from 05.
- Dispatch one read-only verb, such as `health`, read reply.
- Confirm getrandom custom backend reached: dispatch must reach `host_random_fill` once.

## Acceptance

- Reply names plugkit version and non-error status.

## Witness

Dispatch id and reply text, pasted into completion report.