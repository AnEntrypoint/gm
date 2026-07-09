---
name: gm
description: Plugkit-served instruction stream. Three-layer admission (witness, single-writer, direction) over every possible mutation; effort unbounded, never gated on cost. Closure on first emit; partial = non-monotonic.
allowed-tools: Skill, Read, Write, Bash(bun *), Bash(npx *)
---

# gm

**Dispatch gates stop mid-chain.** `phase != COMPLETE OR prd_pending_count > 0` means in-flight work remains. No tool calls = turn ends; prose-only turns stop. To continue: dispatch `instruction`, named spool verb, or `transition`. If uncertain what's next, dispatch `phase-status` to read current state, then proceed from there. `phase=COMPLETE AND prd_pending_count=0` = terminal; new work requires `{"prompt":"..."}` from user.

Phase state is in `.gm/exec-spool/.turn-summary.json` or plugkit responses: `phase` field. COMPLETE = terminal. PLAN/EXECUTE/EMIT/VERIFY/CONSOLIDATE = in-flight. Next action depends on phase and `prd_pending_count`.

PRD rows are in `.gm/prd.yml`. User input does not gate PRD additions during PLAN. `blockedBy: external` in mutable status means the blocker is outside this repo/session (another team's repo, unavailable credential, scheduled call). It does not apply to large/complex/contended work that's reachable this turn.

`instruction` dispatch returns prose describing the current phase and next steps. When uncertain about next action, dispatch `instruction`.

Verbs are written to `.gm/exec-spool/in/<verb>/<N>.txt` as JSON. Plugkit processes on read. Phase transitions are explicit `transition {to:"PHASE"}` dispatches. Phase state is in responses and `.gm/exec-spool/.turn-summary.json`; never assume phase from context.

Check `.gm/exec-spool/.turn-summary.json` at turn start. If `update_available` is set, dispatch `bun x gm-plugkit@latest spool` first. If `last_instruction_age_ms > long_gap_threshold_ms`, dispatch `instruction` before other verbs. Plugkit responses include `instruction` prose and `next_dispatch_hint` guiding which verb to dispatch next.

`.gm/constraints.md` contains design decisions for this project. `instruction` responses reference relevant constraints. If it doesn't exist, plugkit seeds it from bundled defaults.

When `phase=COMPLETE` and `prd_pending_count=0`, work is terminal. New prompts are processed as new sessions. Dispatching another `instruction` after terminal state records as `deviation.complete-chain-poll`.

Client file edits (`.html .js .jsx .ts .tsx .vue .svelte .mjs .css` or HTML-loaded) are tracked in `.turn-browser-edits.json`. `browser` dispatch witnesses them via `page.evaluate`. `transition to=COMPLETE` gate checks `.turn-browser-witnessed` coverage and refuses if any edit is unwitnessed, emitting `deviation.client-edit-no-witness`.

`browser` dispatch can expose state as `window.*` and read it via `page.evaluate`. This surface can both diagnose problems and witness correctness in the same dispatch.

Code/file/symbol lookup uses `codesearch` (`{"query":"..."}`) or `recall` (prior knowledge from memory). `codesearch` indexes the current working directory only. Sibling repos or known paths use `Read` or `exec_js` directly. Cross-repo queries return nothing by design.

Spool verbs are the primary interface: `codesearch`, `recall`, `fetch`, `exec_js`, `browser`, `memorize-fire`, git verbs (`git_status`, `git_log`, `git_diff`, `git_show`, `git_branch`, `git_add`, `git_commit`, `git_finalize`, `git_push`, `git_checkout`, `git_fetch`, `git_rm`, `git_revert`, `git_reset`). Git operations via Bash/PowerShell are recorded as `deviation.bash-git-bypass`. `git_finalize {message}` bundles add->commit->porcelain-gate->push in one dispatch.

Missing `.gm/exec-spool` on first use is normal. Boot the watcher before dispatching work.

Boot probe at session start, one Bash call:

```bash
cat .gm/exec-spool/.status.json 2>/dev/null; echo ---; cat .gm/exec-spool/.turn-summary.json 2>/dev/null; echo ---; date +%s%3N
```

`.turn-summary.json` fields: `phase`, `prd_pending`, `last_instruction_age_ms`, `long_gap_threshold_ms`, `update_available`, `deviations_30m`. If `update_available` is set, dispatch `bun x gm-plugkit@latest spool`. If `last_instruction_age_ms` exceeds `long_gap_threshold_ms`, dispatch `instruction` before other verbs. `.status.json` `ts` within 15s = watcher alive; gap > 15s = dead. Exception: if `busy_until` is in the future, watcher is handling a long verb (browser, chromium spawn).

```bash
bun x gm-plugkit@latest spool
```

(`npx -y gm-plugkit@latest spool` if no `bun`.) Atomic: daemonizes watcher, blocks until `.status.json` heartbeats fresh, returns only on serving (exit 0) or loud timeout. No `&`, no `sleep`, no re-`cat` -- returns, you write to `instruction/` directly. (Already-alive watcher returns at once.)

Verb dispatch: Write request to `.gm/exec-spool/in/<verb>/<N>.txt`, Read response from `.gm/exec-spool/out/<verb>-<N>.json` (or `out/<N>.json`), same tool-call block. If response file doesn't exist, check `.status.json` `ts` to see if watcher is alive. Missing response + stale `ts` = dead watcher, reboot and re-dispatch.

Dead-watcher recovery: check `.status.json` `ts`. If > 15s old AND no `busy_until` in future, dispatch `bun x gm-plugkit@latest spool` to reboot, then re-dispatch the original verb. If `busy_until` is set, the watcher is processing a long verb; wait instead of rebooting.

`browser` dispatch can surface state as `window.*` and read it via `page.evaluate`. `exec_js` responses include `duration_ms`. `browser` responses with `capture\n<script>` prefix auto-return `{result, debug:{console, pageErrors, network, performance}}`.

Spool input from PowerShell must be UTF-8 no-BOM (`-Encoding utf8` or `[System.IO.File]::WriteAllText`); UTF-16+BOM causes `spool.body-encoding-recoded`. First-turn body is `{"prompt":"<user request>"}` (derives orient_nouns + recall_hits); later turns may use `{}`. Batch independent dispatches: multiple `prd-add`, `prd-resolve`, `mutable-add`, `recall`+`codesearch`, or inspection `Read` calls in a single tool block. Avoid editing the same file twice in one block; collapse changes into a single Edit.

Tracked files touched = commit+push to origin before COMPLETE. Dirty tree blocks COMPLETE gate; fix via stage-commit or revert. `git_finalize` bundles add->commit->porcelain-gate->push in one dispatch.

VERIFY phase: dispatch `exec_js` or `browser` to validate EMIT changes.

PRD entries in `.gm/prd.yml`. Residuals from `git status --porcelain`: commit as real work, add to managed gitignore (transient runtime files), or revert (stale junk). `.gm/disciplines/` and new memorize-fire JSON are tracked. `.gm/witness/` and staleness markers go in managed gitignore.

`git push` only when `git status --porcelain` is empty. Dirty tree blocks CONSOLIDATE/COMPLETE gate. Prefer `git_push` verb over Bash git commands; git via Bash records as `deviation.bash-git-bypass`.

Phase transitions: PLAN -> EXECUTE (dispatch `transition {to:"EXECUTE"}`), EXECUTE -> EMIT -> VERIFY -> CONSOLIDATE -> COMPLETE. Each phase transition requires `transition` dispatch to plugkit. EXECUTE resolves mutables in `.gm/mutables.yml` before moving to EMIT. EMIT writes file changes. VERIFY validates via `exec_js`/`browser` dispatch. CONSOLIDATE pushes to origin via `git_finalize` or `git_push`. COMPLETE gate requires worktree clean, remote pushed, and mutables resolved.

Memory via `memorize-fire` dispatch stores in `.gm/rs-learn.db` and is retrieved via `recall` and `auto_recall`. `discipline-note {discipline, text}` writes `.gm/disciplines/<name>/policy.md`; `instruction` auto-surfaces policies from disciplines listed in `.gm/disciplines/enabled.txt`.

`auto_recall` attaches to `instruction` responses on turn entry. `memorize-prune {key}` or `memorize-prune {query}` deletes or reviews memory entries.

Subagent prompts should reference the gm skill and task specifics only, without restating verb names, spool paths, or protocol mechanics already supplied by invocation.
