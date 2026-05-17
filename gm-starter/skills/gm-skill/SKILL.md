---
name: gm-skill
description: AI-native software engineering harness. plugkit serves all instructions, state, guardrails via the spool.
allowed-tools: Skill, Read, Write
---

# gm — single entry point

The wasm artifact lives at `~/.claude/gm-tools/plugkit.wasm`; the spool watcher runs it. If `.gm/exec-spool/.status.json` is stale or absent, bootstrap has not seeded the watcher yet — re-invoke the skill or start it manually (`node plugkit-wasm-wrapper.js spool &`).

## Dispatch ABI

Write request body to `.gm/exec-spool/in/<verb>/<N>.txt`. Read response from `.gm/exec-spool/out/<verb>-<N>.json` for nested verbs, `.gm/exec-spool/out/<N>.json` for root verbs.

## The loop

Dispatch `instruction` (empty body for current phase; `phase=<NAME>` line, `{"phase":"<NAME>"}`, or a raw phase name to override). The response carries `{phase, instruction, mutables_pending, prd_pending_count, next_phase_hint}`. Follow the `instruction` prose imperatively — it is the operative guidance for this phase. Resolve every `mutables_pending` entry through `mutable-resolve` before transitioning; the gate will refuse otherwise. When the phase's exit condition is met, dispatch `transition` (body: a phase name from `EXECUTE`/`EMIT`/`VERIFY`/`COMPLETE`, or empty to auto-advance), then re-enter with the new phase. Stop when `next_phase_hint` is null or phase is `COMPLETE`.

## Orchestrator verbs

`instruction`, `transition`, `phase-status`, `mutable-resolve`, `memorize-fire`, `residual-scan`, `auto-recall`.

## Host verbs

`fs_read`, `fs_write`, `fs_stat`, `fs_readdir`, `kv_get`, `kv_put`, `kv_query`, `fetch`, `exec_js`, `env_get`, `recall`, `codesearch`, `memorize`, `health`.

Plugkit serves what prior skills (`gm:planning`, `gm:gm-execute`) used to serve, on demand, per phase. There is no other skill.
