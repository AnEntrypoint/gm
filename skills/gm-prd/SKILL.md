---
name: gm-prd
description: "Closes one PRD row through the gm stages: an executor edits and hands off, then verifier and CI lanes close it. Input: row=<id>; session=<SESSION_ID>; optional mode=witness. PRD-row rules are defined in this skill."
---

# gm-prd

One row, one session. Stages run in order, none a subagent; the orchestrator spawns the verifier and CI lanes after the executor's handoff. Each writes a create-only receipt `.gm/receipts/<row>/NN-<STAGE>.md`. A stage that cannot run becomes a blocker row `<row>-blocker-<session>` (`prd-add`), never a skip. Verbs: gm §1. PRD-resolution tracker, separate from node traversal (gm-orchestrate); a row is not a node and never changes the frontier count.

## Procedure
- A blocker is filed only after gm-eliminate ran a live JIT check on each open unknown and recorded its dispatch id. A missing fact, unresolved unknown or missing row file is not a blocker until those checks fail.
- CI builds are not blockers: a CI-only row pushes and reads the GitHub Actions run through `ci-status` (gm, CI).
- Owner decisions are not blockers: the owner approved every decision that progresses the goals; the row records the decision and runs it.
- Missing acceptance text is not a blocker: gm-orient derives it.
- Only a world-scoped one-way door remains a blocker without a check (gm §4).

The executor runs the edit stages only: gm-orient, gm-unknowns, gm-eliminate, gm-edit, then publish of its own commit (gm-publish steps 1-2). It then hands off and ends. Verification (gm-validate, PROVE, witness, DECIDE, COMPLETE) and the CI read (gm-publish steps 3-5) are separate lanes the orchestrator spawns per handoff, never inline (gm-orchestrate, Verification and CI lanes). Start with `Skill(skill="gm-orient", args="row=<id>; session=<SESSION_ID>")`. Stages 2, 8, 9 belong to the spawned verifier.

1. SPECIFY (orient): restate row and acceptance; codesearch with `literal` mode first for every exact string the row names (identifiers, paths, error text), then `dual` mode (top 20 BM25, top 20 vector, top 20 commits, 3 live snippet lines each; no snippet text stored); codeinsight first for any function the row touches. Check each cited line against the tree (absent: stale). Write unknowns with `mutable-add`.
1b. ELIMINATE: eliminate each unknown by a live JIT run; a run revealing a new unknown adds it and returns to ELIMINATE. EDIT starts only when no unknown is open.
1c. EDIT then VALIDATE: edit, then validate by JIT runs against acceptance. New unknown or failed check: ELIMINATE, then EDIT again. If the row asserts a cause, write its ACH matrix (`gm-config/prose/ach.md`) into this receipt: at least two hypotheses, evidence as dispatch ids, `C`/`I`/`N` cells, the leader, its probe.
2. PROVE: precondition, invariant, postcondition; run each. The leader's probe runs here first. A probe that does not separate the leader from the next hypothesis is a blocker row, not a pass.
3. EMIT: exact-match Edit only; witness through the live entry point; keep the dispatch id.
4. STATE: the change replays idempotently; name the state it owns.
5. CONC: list each touched file and other writers' hunks (`git_status` with paths).
6. SEC: secrets, injection, identity; each check is a run.
7. RES: failure modes, partial failure included; run each.
8. DECIDE: check receipts and live witnesses against the row's words, not the diff; check push or CI result.
9. COMPLETE: the verifier reports its witness; the orchestrator calls `prd-resolve {"id","witness_evidence","witness_dispatch_id"}` once `witness_dispatch_id_verified` and the CI lane is green for the same sha (gm-orchestrate, Verification and CI lanes). The witness must come from another session; self-witness is refused (`prd-resolve-self-witness`) and the row stays pending.

A verifier lane (`mode=witness`) edits nothing and runs PROVE and DECIDE on the handed-off sha and reports COMPLETE to the orchestrator (gm-orchestrate, Verification and CI lanes).

Delivery: publish this run's files via the Git API route (gm-orchestrate, Shared-tree publish); `git_finalize {message, paths}` only in a tree no other lane writes; then `ci-status` on the sha (gm, CI). A failed witness: causes become mutables; bisect by live runs; fix the survivor; witness again. No test files (gm §3). Never kill another lane's process (gm-orchestrate, Headroom and leases). Bisect uses a live re-run, a remote blob, or a `git archive` of a remote sha (gm, READ questions).

Before that commit, apply the re-bake rule (gm-hop, Re-bake in the same commit). Output: STATUS, ROW, FILES, WITNESS, MUTABLES, DELIVERY.

## Rules
- Read a row before writing it. `prd-add` on an existing id is refused (`prd-add refused: id '<id>' already exists`) unless the body carries `overwrite:true`, which rescopes it. A witness blocker on an existing row is appended to its text with its subject kept. Never reuse the row's own id for a blocker.
- At SPECIFY the orchestrator dispatches `scan_deps` and logs its result as a PRD row (gm §1a).
- Row ids are real: read with `prd-list {"status":"pending"}` inside one `gm_codemode` body, which returns only the matching ids and subjects (never the full listing into context); never invent one for a witness run. Resolved rows leave `.gm/prd/` for `.gm/prd-log.jsonl`; ask for one with `prd-list {"id":"<id>"}` (reads the log) before concluding it never existed.
- A row is `.gm/prd/<id>.yml`, one file each, human-editable: edit it directly when that is the honest fix. A write is a compare-and-swap of that file alone; editing row A never touches row B.
- Witness outcomes are not PRD rows. Each run appends one line to `.gm/witness-log.md` (witness, exit code, RESULT line, UTC, dispatch id); the parent row closes with `prd-resolve` citing it. One output closes one row: `prd-resolve` refuses a witness output sha256 already bound (`prd-resolve-duplicate-witness`).
- `prd-resolve` binding: `witness_dispatch_id`, or all four of `witness_exit_code` (integer 0), `witness_output_sha256`, `witness_output_path`, `witness_ts`. Unbound body refused. `witness_dispatch_id_verified:false` is text evidence only: flag the row for reopening.
- A witness's default input path is never a machine-shaped literal (CI runs Linux; `C:/dev/...` is ENOENT there). A path inside the repo resolves from `path.dirname(fileURLToPath(import.meta.url))` or a root-relative join; a sibling-checkout path comes from a flag or env var (checkout-root env plus repo-relative suffix). When the target is ABSENT, print one SKIP/REFUSE line naming the label, resolved path, its source and how to configure it; exit 0 only with that loud SKIP line. Exit 0 without saying why is a fabricated pass and binds no row. An external optional asset is env/flag-overridable and prints the branch it exercises when absent.
- An executor needs a row that names its file. Re-scope a file-less row with `prd-add` under the same id first; an executor that finds no file files a blocker and never guesses.
- Commit author and trailers: gm, Autonomy. Pool and publish: gm-orchestrate.
- Stage receipts are the evidence. A worker's result is the stage reached, the receipt or blocker, files changed, and the successor.
- Before its final STATUS line, the executor closes its own Dream-RSI cycle: dispatch `dream-replay-cycle` with `{"session_id":"<session>"}` and record the dispatch id and status (`replayed` or `deferred`, with reason) in its receipt.
- An executor never returns with its row pending and no blocker. Final line: `STATUS: handoff <sha>` (edit pushed, verification and CI to spawn) or `STATUS: blocked <blocker id>`. Verifier: `STATUS: verified <witness dispatch id>` or `STATUS: fix <check id>`. CI lane: `STATUS: ci-green <sha>` or `STATUS: ci-red <sha> <job>`. The row resolves only when the orchestrator holds a verified and a ci-green for the same sha. A blocked row stays pending with `blocked_by` in its text; no duplicate row for a fact an open row names (gm-orchestrate, Never leave a row open).
- A reported cause is a claim until an instrument runs it: derive it from a run, never from reading the code. One instrument drew five successive proposed causes (`transparent` inheritance, then missing client file, then `side`, then un-cleared target, then instability), each refuted by the next run, because each was inferred rather than executed. ELIMINATE (1b) is where a cause comes from; EDIT starts only when no unknown is open.
- Localise the layer before theorising. An owner-visible symptom spans placement, draw, geometry and instrument. Test cheapest-layer-first and stop at the layer that moves. A "ridge with no grass" report: placement uniform, draws clean, and the seam step turned out to be an instrument artifact carrying slope, not a discontinuity. A second copy of the reading at another layer is not a localisation.
- Bisect before theorising. Where a number changed, bisect to the commit: a live re-run, a remote blob, or a `git archive` of a remote sha. One step attributed `terrain-quad-upload` went from 2054 to 6808 when `LOD_STEP` went from 3.6 to 7.2. A bisect is cheaper than a hypothesis.
- A row closes only when its witness names the SPECIFY leader hypothesis. A witness matching a rejected hypothesis, or every hypothesis, binds no row: file a mutable and keep the row pending.
- Premise before edit. A row's cited line numbers, functions and causes are hints from an earlier read. Before any EDIT: `git_pull` when a codesearch or codeinsight reply carries `stale_tree` (re-run the search after the pull), then re-read every cited function at the pulled tree. A premise the tree does not show (the named code path, branch or fallback is absent) is not a blocker and not a fix: record it in the receipt with the codesearch dispatch ids, close the row as `premise-absent` with that witness, and file any real neighbouring defect as its own row with `prd-add`. Never leave such a row pending with a note that the premise is missing.
- A narrowed defect keeps its own id. When the tree shows a different defect from the row's stated one, the executor files it as a new row naming the original id, never by rewriting the original's acceptance text to match what it found.

## Witness economy
- Flow, in order: minimal surface, run to eliminate unknowns (1b), localise the layer, bisect, measure on the committed tree, counted units, refuse loudly, publish on the first passing witness.
- Minimal surface organises the rest: test the smallest thing that separates the hypotheses: one module under node, if that answers it, not the page. A full browser boot costs ~64 s on a real adapter and ~636 s on a software one; a gpu-free witness over the same module answered comparable questions in 267 ms and 29.5 s. Instrumenting the whole app to measure one property is the wrong surface.
- Browser last. A witness reaching for a browser states in one line which fact only a browser can supply. Default to gpu-free instrumentation against the real modules. A question the module graph answers is not a browser question.
- Cold start and reload are a budget. Reuse one warm session across every arm of a run; change conditions by mutating page state (`page.evaluate`), never by reloading. A receipt states how many cold starts and reloads it spent; a witness that cannot say paid more than it knows.
- No new test files, ever. Verify a question with a live witness: run the real module or a gm dispatch and print its own result (dispatch id, exit code, output). The instrument at ELIMINATE and PROVE is a command against the live system, never a committed test file; nothing is pinned into a gate, and no general witness is grown to answer one question.
- A browser is no licence to weaken evidence. When required: adapter pinned, `window.__rendererInfo` asserted, rAF proven off the 16.68 ms grid, contention bar enforced; a contaminated run is published as `RESULT: REFUSED` (exit 3), not as a figure. A number that cannot be quoted costs more than no run.
- Clean base is `git archive`, never a second checkout. Compare by content hash against remote `main`, never local HEAD: gm-orchestrate, Shared-tree publish. Browser arms and leases: gm-orchestrate, Headroom and leases. One browser arm pool-wide; `gpulock` serialises the GPU adapter only, not CPU, memory or disk. Thrash causes and the shared-server setup: gm-orchestrate, Lane budget. Do not open a browser while the lease is held; take gpu-free instrumentation.
- Counted work units beat timings on a contended box: a duration read while lanes thrash is load, not the change. Count what the code does (draws, allocations, instances, files scanned, messages) and compare counts; a timing must clear the contention bar above first.
- Every instrument is two-sided: force the condition and show the number moves before quoting it. In one day five guards could not fail: a `must` regex that matched nothing, an assert that was a `console.log`, a swallowing catch, a NaN displacement that printed as 0, an audit that scanned zero files and passed. A guard that cannot fail is decoration.
- Refuse loudly, never plausibly: an unquotable number prints `RESULT: FAIL` or `RESULT: REFUSED` with its diagnostic and exits non-zero. No figure is better than a fabricated one. Write the refutation where the next lane reads it (the witness-log line, or the receipt): a cause refuted and not recorded gets re-chased: one false alarm was refuted four times before it was re-raised.
- A witness that ships is the lane's exit: time-box to the witness, publish on the first passing one (gm-orchestrate, Lane budget).

## Finish the work

- Finishing the requested work is the goal of every run of this skill. A run that stops with work left undone is incomplete.
- When an issue blocks a step (a failing check, a fault in a tool or service, a missing input, a network or environment fault), fix it in the same run: retry on a bounded or resumable route, use an alternate route to the same result, repair the fault where it originates, then continue the remaining work.
- Stop only when the requested work is complete, or when a step is still blocked after every route has been tried. Then report the blocked step, the routes tried, and the evidence for each.
