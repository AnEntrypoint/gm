---
name: gm-skill
description: AI-native software engineering harness. plugkit owns all state and serves every instruction via the spool. The agent dispatches verbs; plugkit tracks phase, mutables, PRD, and recall.
allowed-tools: Skill, Read, Write, Bash(node *), Bash(bun *)
---

# gm — single entry point

The wasm artifact lives at `~/.claude/gm-tools/plugkit.wasm`; the spool watcher runs it. The watcher's own stdout/stderr is appended to `.gm/exec-spool/.watcher.log` — Read it to see plugkit's internal trace, dispatch timings, sweep actions, errors.

## Boot the spool watcher (first turn only)

Check `.gm/exec-spool/.status.json`. If absent or `ts` > 15s old:

`node ~/.claude/gm-tools/plugkit-wasm-wrapper.js spool > /dev/null 2>&1 &`

Wait 2 seconds, verify `.status.json` is fresh. Then proceed.

## Plugkit version updates

The watcher checks GitHub Releases every 5 minutes for a newer plugkit. If drift is detected, it writes `.gm/exec-spool/.update-available.json` with `{installed, latest, instruction, update_url}`; if no drift, the file is removed. Read this file at session start (and occasionally afterward); if present, kill the current watcher, run `bootstrapPlugkit({latest: true})` once to fetch the new wasm, then restart the watcher. Default bootstrap never hits the network — only `{latest: true}` fetches the newest binary.

## Dispatch ABI

Write request body to `.gm/exec-spool/in/<verb>/<N>.txt`. Read response from `.gm/exec-spool/out/<verb>-<N>.json` (nested verbs) or `out/<N>.json` (root verbs). Bodies are JSON, raw code, or a single phase name depending on the verb.

## Batch dispatch — never serial round-trips for independent verbs

The watcher processes verbs sequentially internally, but the agent's bottleneck is round-trip latency, not the watcher. **Write N inputs in one message via parallel Write tool calls, then read N outputs in one message via parallel Read calls.** A 5-verb batch is one agent turn, not five.

Example PLAN orient pack — 3 recalls + 3 codesearches in ONE message:
```
Write .gm/exec-spool/in/recall/1.txt        body: {"query":"<noun A>"}
Write .gm/exec-spool/in/recall/2.txt        body: {"query":"<noun B>"}
Write .gm/exec-spool/in/recall/3.txt        body: {"query":"<noun C>"}
Write .gm/exec-spool/in/codesearch/1.txt    body: {"query":"<phrase X>"}
Write .gm/exec-spool/in/codesearch/2.txt    body: {"query":"<phrase Y>"}
Write .gm/exec-spool/in/codesearch/3.txt    body: {"query":"<phrase Z>"}
```

Then in the NEXT message, all 6 Reads in parallel.

For dependent verbs (transition after instruction, prd-resolve after work), the agent must serialize — but only at the dependency boundary, not across independent dispatches.

## State lives in plugkit, not in conversation context

Never Read `.gm/prd.yml` or `.gm/mutables.yml` directly. Every `instruction` response carries the data you need:

```
{
  phase,               // current phase
  instruction,         // phase prose (the active discipline)
  prd_items: [...],    // full PRD items with id, subject, status, fields
  prd_pending_count,
  mutables_pending: [{id, claim, witness_method, witness_evidence, status}, ...],
  recall_hits: [...],  // auto-fired against phase + first pending PRD subject
  next_phase_hint
}
```

## Plugkit observability — read .watcher.log

The watcher writes its own stdout + stderr (plus the wasm cdylib's `println!`/`eprintln!`) to `.gm/exec-spool/.watcher.log`. Useful when:

- A dispatch returned an error you don't understand → tail the log for the stack
- A verb seems slow → log shows `[dispatch] ← verb=X ms=N`
- Sweep cleaned up something → log shows `[retention]` or `[stale-sweep]` lines
- Watcher boot issues → `--- watcher boot ... ---` markers

Read with `offset` to tail:
```
Read .gm/exec-spool/.watcher.log offset=<last-known-line>
```

The log is rotated at 10MB (older content moves to `.watcher.log.1`).

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
