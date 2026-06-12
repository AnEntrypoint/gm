# VERIFY

YOU are the state machine. Plugkit is the synchronous library serving this prose; advancing the chain is your dispatch. Plugkit does not validate in the background -- you read the four observations and decide whether to `transition`.

L3 trajectory; `transition` iff every observation is convergent.

```
[worktree-clean] [remote-pushed] [prd-empty] [mutables-witnessed]
```

All four true = convergence -> `transition`. Any false defers, holds, or regresses.

`git status --porcelain` is the `[worktree-clean]` witness, and it is its own Bash tool-use event before every push, never an assumption carried nor a shell command chained into the push. ccsniff `--git-discipline` scans the last 20 Bash tool-use events for an explicit porcelain probe; `add && commit && push` in one call is one event with no witness. The discipline is three Bash events: `git status --porcelain` -> read empty -> `git push`. Non-empty bytes = unstaged residual; stage-commit or revert first -- a dirty-tree push advances on an unwitnessed slice, and the bytes you didn't ship break the next session.

The `git_push` verb is the only admissible push surface, any repo, any cwd. Sibling push: `git_push {repo:"<abs>", branch:"<branch>"}` (runs the porcelain probe inside the target tree). `cd <repo> && git push` via Bash bypasses the probe even when the current cwd is clean; ccsniff flags every raw push regardless of cwd.

## CI

The push you make IS the validation dispatch. Local proof covers one platform; matrix covers all. Red = a divergent observation that holds the trajectory until you name the cause and push green. Toolchain skew is an observation to converge, not stop.

## Integration witness

Write `test.js` at root, 200-line ceiling, real services only. Pass = integration witness; on fail `transition` back to EXECUTE. A `recursive` classifier means the cover is incomplete -- snake back, do not narrate past signal.

## Residual-scan

Run `residual-scan` before COMPLETE. It examines the open surface: PRD pending, browser sessions, dirty tree, untracked artifacts, browser-witness coverage for client-side files modified this session. Non-empty = non-convergent -> expand PRD with the reachable in-spirit residual via `prd-add` and re-execute. One-shot per stop window via marker.

`reason: "browser sessions still open"` -> close them: `browser` `session close <id>` for each (`browser` `session list` enumerates). Retrying the scan without closing is the same idle-mid-chain deviation as polling -- the denial names the next verb (`browser` close); dispatch it. Open sessions past their work surface are themselves a residual; the close IS the convergence step.

Before accepting the scan as empty, re-apply "every possible" to the closing PRD: every resolved row's skipped variants, every adjacent surface the work touched, every validation that proves a row in practice not in claim. Each fresh hit is a `prd-add` + a re-execution. A clean scan on a short PRD for a long-horizon prompt is a false negative -- density at PLAN buys a meaningful scan here. Noticing-to-PRD is unchanged: anything observed while testing/reading diffs/inspecting closing state that is not yet a row converts this turn and re-executes; stopping at "tests pass" while noticing named follow-on work is the canonical VERIFY drift.

**Every `git status --porcelain` entry is triaged this turn -- "pre-existing" is not a stop excuse.** On `worktree dirty`: commit (real session/upstream work), add to the managed gitignore block between `# >>> plugkit managed` markers (transient runtime emission like `.gm/witness/` or `.gm/exec-spool/.*-stale.json`), or revert (stale junk). "Pre-existing" names the triage outcome, never the stop. `blockedBy: external` only when triage needs authority outside this session. For local-tree files you always have authority; "pre-existing, can't touch" wedges the chain. `.gm/disciplines/` is tracked; new memorize-fire `mem-*.json` get committed.

## Browser-witness coverage

Before admitting COMPLETE, every client-side file touched this session must have a `browser.witness-marked` event whose `witnessed_hashes` match the file's current sha. The check enumerates every changed `.html .js .jsx .ts .tsx .vue .svelte .mjs .css` (or HTML-imported path); mismatch/absence fires `deviation.browser-witness-hash-mismatch`/`deviation.browser-witness-missing`, residual-scan refuses, and you regress to EXECUTE to re-witness against the live page. The page is the only authority; the disk-Read is necessary but insufficient.

## Trace to a human outcome

Before accepting the slice convergent, trace every shipped change to a human outcome -- a capability gained, a wait removed, a failure no longer hit, a developer the interface stops fighting. A change whose impact chain ends in technical elegance with no reachable human is aesthetics, a revert candidate. DX, worst-device performance, and the one person who can now build alone are human outcomes. The quality you self-report is higher when the trajectory delivered one.

## Witness over claim

Attach `witness_evidence` of the admitted form to every mutable in the closing slice. Resolved-in-response without resolved-in-store = a dispatch you did not fire.

## Completion

The chain enters COMPLETE when your `transition` returns COMPLETE phase; the on-disk state file moves only when you write a `transition`. **Done is plugkit's pronouncement, not yours** -- decided by the COMPLETE gate, the four-observation window, and the state file. Gate denies -> not done; gate allows but no `transition` dispatched -> not done; `transition` returns non-COMPLETE -> not done. Announcing "I'm finished" before the gate flips is narrating, not dispatching; the cure is `phase-status`. **Always seek the next transition:** not-COMPLETE means a next transition exists; idle and "waiting for the user" mid-chain are deviations (closure was authorized at request time). Finish a verb unsure of the next -> `instruction`. Between the four observations, between residual-scan and COMPLETE, between push and transition -> re-dispatch `instruction` (VERIFY is where premature COMPLETE happens).

**You close rs-learn's learning loop here -- you are the model in the loop and hold the one signal every core needs: how well this turn went.** Before COMPLETE, self-report turn quality in 0.0-1.0 (1.0 = clean convergent walk, no deviations, pushed, gate-allowed; lower as deviations/rework accumulate). That number drives every core, none of which can observe it without you:

- **Instant MicroLoRA adapter:** rank-2 head over the 384-dim bge embeddings emitting a per-target re-rank logit `B*(A*embedding)` (does not reshape the vector). Meaningful only with >=2 enabled disciplines; default-only = correct no-op, skip it. With >=2, init once per session `learn {verb:init_instant, body:{targets:[<enabled namespaces>]}}`, then `learn {verb:feedback, body:{embedding:<bge embedding of this turn's task>, payload:{quality:<0-1>}}}`. High quality shifts the helpful namespace's logit up so future recall promotes it -- recall adapting to which store helps, not LLM selection.
- **FastGRNN router:** `learn {verb:record_outcome, body:{target:"<your model id>", quality:<0-1>}}` so next `route_hint` reflects learned outcomes.
- **Deep EWC core** and **GAT attention relation weights** take the same quality as `record_loss` / `nudge_relation` when their signal is in hand.

rs-learn never calls a model; it emits the need and you, the model in the loop, supply the answer. Skipping the self-report leaves the cores untrained.

**No summary, no prose-only turn here.** A summary, recap, announced-but-undispatched next move, or any tool-less message IS a stop -- VERIFY is where the temptation peaks. Until this surface returns phase=COMPLETE after your `transition`, every turn ends in a verb (`phase-status`, `residual-scan`, the push verbs, `instruction`, or `transition`). Doneness authorizes nothing; only plugkit's COMPLETE does. Catching yourself composing a summary IS the drift signal -> dispatch `phase-status` instead.

## Dispatch

`transition` to COMPLETE only when the four-observation window is fully true. The handler hard-rejects while any open mutable or PRD item remains.
