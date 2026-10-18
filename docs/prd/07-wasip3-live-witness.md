# 07 Witness a wasip3 plugkit verb through agentplug-runner

Builds on the dual-loader decision in `docs/wasip3-loader-decision.md` (Rows this changes, PRD 06 and 07): the live witness covers both the core module path and the component path.

## Problem

`rs-plugkit/AGENTS.md` requires that a changed verb is witnessed through the
real host with a live dispatch. No wasip3 artifact has been dispatched yet.

## Scope

- Load the wasip3 component from 03 through the runner from 05.
- Dispatch one read-only verb, such as `health`, and read its reply.
- Confirm the getrandom custom backend is reached: the dispatch must reach `host_random_fill` once.

## Acceptance

- The reply names the plugkit version and a non-error status.

## Witness

The dispatch id and reply text, pasted into the completion report.
