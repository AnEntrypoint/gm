---
name: gm-skill
description: AI-native software engineering harness. plugkit owns all state and serves every instruction via the spool. The agent dispatches verbs; plugkit tracks phase, mutables, PRD, and recall.
allowed-tools: Skill, Read, Write, Bash(node *), Bash(bun *)
---

# gm — single entry point

The wasm artifact lives at `~/.claude/gm-tools/plugkit.wasm`; the spool watcher runs it.

## Boot the spool watcher (first turn only)

Check `.gm/exec-spool/.status.json`. If absent or `ts` > 15s old:

`node ~/.claude/gm-tools/plugkit-wasm-wrapper.js spool > /dev/null 2>&1 &`

Wait 2 seconds, verify `.status.json` is fresh. Then proceed.

## Dispatch ABI

Write request body to `.gm/exec-spool/in/<verb>/<N>.txt`. Read response from `.gm/exec-spool/out/<verb>-<N>.json` (nested verbs) or `out/<N>.json` (root verbs). Bodies are JSON, raw code, or a single phase name depending on the verb.

## State lives in plugkit, not in conversation context

Never Read `.gm/prd.yml` or `.gm/mutables.yml` directly. Every `instruction` response carries the data you need:

```
{
  phase,               // current phase
  instruction,         // phase prose (the active discipline)
  prd_items: [...],    // full PRD items with id, subject, status, fields
  prd_pending_count,   // items not done|complete|completed
  mutables_pending: [{id, claim, witness_method, witness_evidence, status}, ...],
  recall_hits: [...],  // auto-fired against phase + first pending PRD subject
  next_phase_hint      // what to transition to next
}
```

## The loop

Dispatch `instruction` with empty body to get current-phase guidance + full state snapshot. Follow the `instruction` prose imperatively. Add PRD items via `prd-add` (JSON body), resolve via `prd-resolve` (id as body). Add mutables via `mutable-add`, resolve via `mutable-resolve` once `witness_evidence` is filled. Every resolve auto-fires `memorize-fire` so the evidence becomes recall-able.

Resolve every entry in `mutables_pending` before transitioning. When the phase's exit condition is met, dispatch `transition` with the next phase name (or empty for auto-advance). Each transition response embeds `recall_hits` automatically — relevant prior memos surface without you asking.

Stop when `next_phase_hint` is null or phase is `COMPLETE`.

## Orchestrator verbs

`instruction`, `transition`, `phase-status`, `prd-add`, `prd-resolve`, `prd-list`, `mutable-add`, `mutable-resolve`, `mutable-list`, `memorize-fire`, `residual-scan`, `auto-recall`.

## Host verbs

`fs_read`, `fs_write`, `fs_stat`, `fs_readdir`, `kv_get`, `kv_put`, `kv_query`, `fetch`, `exec_js`, `env_get`, `recall`, `codesearch`, `memorize`, `health`, `status`, `wait`, `sleep`, `close`, `kill-port`, `forget`, `feedback`, `learn-status`, `learn-debug`, `learn-build`, `discipline`, `pause`, `runner`, `inference`, `browser`.

## Language verbs

`nodejs`, `python`, `bash`, `powershell`, `ssh`, `go`, `rust`, `c`, `cpp`, `java`, `deno` — write raw code as the request body.

### Browser

Dispatch `.gm/exec-spool/in/browser/<N>.txt` with raw JavaScript as the body. The wrapper spawns Chrome (managed profile at `<cwd>/.plugkit-browser-profile/`) and runs the JS via playwriter. Globals available inside the body: `page` (playwright Page), `snapshot` (accessibility snapshot), `screenshotWithAccessibilityLabels` (screenshot helper), `state` (per-session state object).

Special commands (body starts with `session `): `session new`, `session list`, `session close <id>` pass through to playwriter directly.

Chrome is detected from system install paths; profile dir is project-scoped so cookies/login persist per project. The wrapper auto-adds `.plugkit-browser-profile/` to `.gitignore`.
