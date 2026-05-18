---
name: gm-skill
description: AI-native software engineering harness. plugkit owns all state and serves every instruction via the spool. The agent dispatches verbs; plugkit tracks phase, mutables, PRD, and recall.
allowed-tools: Skill, Read, Write, Bash(node *), Bash(bun *)
---

# gm — single entry point

Every turn begins with `instruction`. Write `.gm/exec-spool/in/instruction/<N>.txt` (empty body) and read the response — its `instruction` field is the active phase prose, its `prd_items` is the live work plan, its `mutables_pending` is what blocks the EMIT gate, its `recall_hits` is the prior memory already loaded for you. Follow that prose imperatively until the phase's exit condition is met, then `transition`. The user's request is the authorization; the PRD is the receipt; the chain runs PLAN → EXECUTE → EMIT → VERIFY → COMPLETE without re-asking between phases.

Direct Read/Edit/Bash before the first `instruction` dispatch is the failure mode this skill prevents. If you find yourself reaching for a tool to "just take a quick look", you have already dropped the loop — dispatch `instruction` first, then act on its prose.

Fix on Sight. Every unexpected output, broken neighbor, lockfile drift, suppressed error, or stale generated file surfaced during work becomes a PRD item the same turn and is executed before COMPLETE. Surprise is a new mutable, not noise to absorb. Stubs, mocks, placeholder returns, fixture-only paths, and "always succeeds" code paths are forbidden in shipped material; acceptance is real input through real code into real output, witnessed. Edits to code that runs in a browser require a live `browser` verb witness in the same turn — Browser Witness is non-negotiable.

Before any apparent stop, dispatch `residual-scan`. If it returns work that fits the spirit of the original ask and is reachable from this session, expand the PRD and execute; only residuals genuinely out-of-spirit or out-of-reach are name-and-stop. A turn that ends with uncommitted changes, an open PRD slice, or unresolved mutables has not actually stopped — it has stalled the chain.

The wasm artifact lives at `~/.claude/gm-tools/plugkit.wasm`; the spool watcher runs it. The watcher's own stdout/stderr is appended to `.gm/exec-spool/.watcher.log` — Read it to see plugkit's internal trace, dispatch timings, sweep actions, errors.

## Boot the spool watcher (first turn only)

Check `.gm/exec-spool/.status.json`. If absent or `ts` > 15s old, boot via the npm package — `bun x gm-plugkit@latest spool` fetches the freshest plugkit (wasm + wrapper), copies them into `~/.claude/gm-tools/`, then enters spool mode:

```
bun x gm-plugkit@latest spool > /dev/null 2>&1 &
```

If `bun` is not available, fall back to `npx -y gm-plugkit@latest spool > /dev/null 2>&1 &` or to the local wrapper if it's already installed: `node ~/.claude/gm-tools/plugkit-wasm-wrapper.js spool > /dev/null 2>&1 &`. The wrapper has a self-heal: if it detects a `LinkError` or missing wasm at instantiation, it re-runs bootstrap automatically and retries.

Wait 2 seconds, then verify boot:

- Read `.gm/exec-spool/.cli-status.json` — the launcher writes its phase here (`starting` → `bootstrapped` → `ready`). Present with `phase: "ready"` = good.
- Read `.gm/exec-spool/.status.json` — the watcher writes its heartbeat here every 5s. Fresh `ts` (within 15s) = watcher alive.
- If neither file exists or `.cli-status.json` is stuck at an earlier phase, read `.gm/exec-spool/.bootstrap-error.json` — the launcher writes `{error_phase, error_message, stack}` on any failure even when stdout/stderr were redirected to `/dev/null`. Also read `.gm/exec-spool/.watcher.log` for the post-spawn trace. Surface the error to the user; do not retry blindly.

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

Add PRD items via `prd-add` (JSON body), resolve via `prd-resolve` (id as body). Add mutables via `mutable-add`, resolve via `mutable-resolve` once `witness_evidence` is filled — narrative resolution is rejected; only file:line, codesearch hit, or exec output snippet counts. Every `mutable-resolve` auto-fires memorize so the witness becomes recall-able next session.

Resolve every entry in `mutables_pending` before transitioning. When the phase's exit condition is met, dispatch `transition` with the next phase name (or empty for auto-advance). Each transition response embeds `recall_hits` automatically — relevant prior memos surface without you asking.

Stop only when `phase` is `COMPLETE` AND `residual-scan` returns empty AND the worktree is clean AND CI is green. Any of those false means the chain has not finished.

## Orchestrator verbs

`instruction`, `transition`, `phase-status`, `prd-add`, `prd-resolve`, `prd-list`, `mutable-add`, `mutable-resolve`, `mutable-list`, `memorize-fire`, `residual-scan`, `auto-recall`.

## Host verbs

`fs_read`, `fs_write`, `fs_stat`, `fs_readdir`, `kv_get`, `kv_put`, `kv_query`, `fetch`, `exec_js`, `env_get`, `recall`, `codesearch`, `memorize`, `health`, `status`, `wait`, `sleep`, `close`, `kill-port`, `forget`, `feedback`, `learn-status`, `learn-debug`, `learn-build`, `discipline`, `pause`, `runner`, `inference`, `browser`.

## Language verbs

`nodejs`, `python`, `bash`, `powershell`, `ssh`, `go`, `rust`, `c`, `cpp`, `java`, `deno` — write raw code as the request body.

### Browser

The `browser` verb is the only sanctioned way to drive a live page. Do not reach for any other browser tool, library, or skill — the host owns the managed session and a parallel surface fragments witness state. Dispatch `.gm/exec-spool/in/browser/<N>.txt` with raw JavaScript as the body. The host runs Chrome under a project-scoped profile at `<cwd>/.gm/browser-profile/` (cookies/login persist per project) and exposes the body to four globals: `page` (the live page handle — `await page.goto(...)`, `await page.evaluate(...)`, etc.), `snapshot` (accessibility-tree snapshot), `screenshotWithAccessibilityLabels` (annotated screenshot helper), and `state` (a per-session object that persists across dispatches within the same session).

Special commands (body starts with `session `): `session new`, `session list`, `session close <id>` manage session lifecycle.

Required for any edit to code that runs in a browser — Browser Witness is non-negotiable. A `node test.js passes` does not substitute for a live `page.evaluate` asserting the invariant the edit was supposed to change.
