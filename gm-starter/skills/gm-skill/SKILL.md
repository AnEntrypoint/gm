---
name: gm-skill
description: AI-native software engineering harness. plugkit serves all instructions, state, guardrails via the spool.
allowed-tools: Skill, Read, Write, Bash(node *), Bash(bun *)
---

# gm — single entry point

The wasm artifact lives at `~/.claude/gm-tools/plugkit.wasm`; the spool watcher runs it.

## Boot the spool watcher (first turn only)

Check `.gm/exec-spool/.status.json`. If absent or `ts` > 15s old, run:

`node ~/.claude/gm-tools/plugkit-wasm-wrapper.js spool > /dev/null 2>&1 &`

Wait 2 seconds, verify `.status.json` is fresh. Then proceed with dispatch.

## Dispatch ABI

Write request body to `.gm/exec-spool/in/<verb>/<N>.txt`. Read response from `.gm/exec-spool/out/<verb>-<N>.json` for nested verbs, `.gm/exec-spool/out/<N>.json` for root verbs.

## The loop

Dispatch `instruction` (empty body for current phase; `phase=<NAME>` line, `{"phase":"<NAME>"}`, or a raw phase name to override). The response carries `{phase, instruction, mutables_pending, prd_pending_count, next_phase_hint}`. Follow the `instruction` prose imperatively — it is the operative guidance for this phase. Resolve every `mutables_pending` entry through `mutable-resolve` before transitioning; the gate will refuse otherwise. When the phase's exit condition is met, dispatch `transition` (body: a phase name from `EXECUTE`/`EMIT`/`VERIFY`/`COMPLETE`, or empty to auto-advance), then re-enter with the new phase. Stop when `next_phase_hint` is null or phase is `COMPLETE`.

## Orchestrator verbs

`instruction`, `transition`, `phase-status`, `mutable-resolve`, `memorize-fire`, `residual-scan`, `auto-recall`.

## Host verbs

`fs_read`, `fs_write`, `fs_stat`, `fs_readdir`, `kv_get`, `kv_put`, `kv_query`, `fetch`, `exec_js`, `env_get`, `recall`, `codesearch`, `memorize`, `health`, `status`, `wait`, `sleep`, `close`, `kill-port`, `forget`, `feedback`, `learn-status`, `learn-debug`, `learn-build`, `discipline`, `pause`, `runner`, `inference`, `browser`.

## Language verbs

`nodejs`, `python`, `bash`, `powershell`, `ssh`, `go`, `rust`, `c`, `cpp`, `java`, `deno` — write raw code as the request body.

### Browser

Dispatch `.gm/exec-spool/in/browser/<N>.txt` with raw JavaScript as the body. The wrapper spawns Chrome (managed profile at `<cwd>/.plugkit-browser-profile/`) and runs the JS via playwriter. Globals available inside the body: `page` (playwright Page), `snapshot` (accessibility snapshot), `screenshotWithAccessibilityLabels` (screenshot helper), `state` (per-session state object).

Special commands (body starts with `session `): `session new`, `session list`, `session close <id>` pass through to playwriter directly.

Chrome is detected from system install paths; profile dir is project-scoped so cookies/login persist per project. Add `.plugkit-browser-profile/` to your repo's `.gitignore` — the wrapper does this automatically.

Plugkit serves what prior skills (`gm:planning`, `gm:gm-execute`) used to serve, on demand, per phase. There is no other skill.
