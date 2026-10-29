---
name: gm-prd
description: "Closes one PRD row through the gm stages: an executor edits and hands off, then verifier and CI lanes close it. Input: row=<id>; session=<SESSION_ID>; optional mode=witness. PRD-row rules are defined in this skill."
exposed_when: prd:pending
---

# gm-prd

One row, one session. Stages run in order, none a subagent; the orchestrator spawns the verifier and CI lanes after handoff. Each writes a create-only receipt `.gm/receipts/<row>/NN-<STAGE>.md`. A refused stage re-reads the state the refusal names, fixes it, and retries once; only a stage still refused for the same cause becomes a blocker row `<row>-blocker-<session>` (`prd-add`) naming the external fact and clearing action. No skips. Verbs: gm section 1. This PRD tracker is separate from node traversal (gm-orchestrate): a row is not a node and never changes the frontier count.

## Procedure

- A blocker is filed only after ELIMINATE (1b) ran a live JIT check on each open unknown and recorded its dispatch id; a missing fact, unresolved unknown or missing row file is no blocker until those checks fail.
- CI builds are not blockers: a CI-only row pushes and reads the run through `ci-status` (gm, CI). Owner decisions are not blockers: the owner approved every progressing decision, so the row records it and runs it. Missing acceptance text is derived at SPECIFY. Only a world-scoped one-way door is a blocker without a check (gm section 4).

The executor runs the edit stages only: REFERENCES (0), SPECIFY (1), ELIMINATE (1b), EDIT then VALIDATE (1c), then publish of its own commit (Delivery), then hands off. Verification (PROVE, witness, DECIDE, COMPLETE) and the CI read (Delivery, steps 3-5) are separate lanes the orchestrator spawns per handoff, never inline (gm-orchestrate, Verification and CI lanes). Start at REFERENCES with `row=<id>; session=<SESSION_ID>`. Stages 2, 8, 9 belong to the verifier.

0. REFERENCES: the lane that files a row starts its `public_search` subagent from the brief in the `prd-add` reply, in the same turn. This stage waits for that subagent's `prd-references` call: re-read the row with `prd-list {"id":"<row id>","full":true}` and start SPECIFY once it carries a reference or a `none_because`. A row with neither stays pending.
1. SPECIFY (orient): restate row and acceptance; codesearch `literal` first for every exact string the row names (identifiers, paths, error text), then `dual` (top 20 BM25, top 20 vector, top 20 commits, 3 live snippet lines each; no snippet text stored); codeinsight first for any function the row touches. Check each cited line against the tree (absent: stale). Write unknowns with `unknown-add`.
1b. ELIMINATE: eliminate each unknown by a live JIT run; a run revealing a new unknown adds it and returns to ELIMINATE. EDIT starts only when no unknown is open.
1c. EDIT then VALIDATE: edit, then validate by JIT runs against acceptance. New unknown or failed check: ELIMINATE, then EDIT again. If the row asserts a cause, write its ACH matrix (`../gm/prose/ach.md`) into this receipt: at least two hypotheses, evidence as dispatch ids, `C`/`I`/`N` cells, the leader, its probe.
2. PROVE: precondition, invariant, postcondition; run each. The leader's probe runs first; a probe that does not separate the leader from the next hypothesis is a blocker row, not a pass.
3. EMIT: exact-line change only, written through `fs_write`; witness through the live entry point; keep the dispatch id.
4. STATE: the change replays idempotently; name the state it owns.
5. CONC: list each touched file and other writers' hunks (`git_status` with paths).
6. SEC: secrets, injection, identity; each check is a run.
7. RES: failure modes, partial failure included; run each.
8. DECIDE: check receipts and live witnesses against the row's words, not the diff; check push or CI result.
9. COMPLETE: the verifier reports its witness; the orchestrator calls `prd-resolve {"id","witness_evidence","witness_dispatch_id"}` once `witness_dispatch_id_verified` and the CI lane is green for the same sha (gm-orchestrate, Verification and CI lanes). A same-session witness is refused (`prd-resolve-self-witness`) and the row stays pending. The row also carries its stage 0 reference or `none_because`.

A verifier lane (`mode=witness`) edits nothing: it runs PROVE and DECIDE on the handoff sha and reports COMPLETE.

Delivery: publish via the Git API route (gm-orchestrate, Shared-tree publish); `git_finalize {message, paths}` only in a tree no other lane writes; then `ci-status` on the sha (gm, CI). Before that commit, apply gm-hop's re-bake rule. A failed witness: causes become unknowns; bisect by live runs; fix the survivor; witness again. Never kill another lane's process (gm-orchestrate, Headroom and leases). Remote reads: `gh api repos/<owner>/<repo>/git/trees/<sha>?recursive=1` (gm, READ questions).

Output: STATUS, ROW, FILES, WITNESS, MUTABLES, DELIVERY.

## Rules

- Read a row before writing it. `prd-add` on an existing id is refused (`prd-add refused: id '<id>' already exists`) unless the body carries `overwrite:true` (rescope). A witness blocker on an existing row is appended to its text, subject kept; never reuse the row's id for a blocker.
- At SPECIFY the orchestrator dispatches `scan_deps` and logs its result as a PRD row (gm section 1a).
- Row ids are real: read pending rows with `prd-list {"status":"pending"}` in one `gm_codemode` body; never invent one. Resolved rows live in `.gm/prd-log.jsonl`; `prd-list {"id":"<id>"}` reads the log before concluding a row never existed.
- A row is `.gm/prd/<id>.yml`, one file each, human-editable: edit it directly to correct it. A write is a compare-and-swap of that file alone.
- Witness outcomes are not PRD rows. Each run appends one line to `.gm/witness-log.md` (witness, exit code, RESULT line, UTC, dispatch id); the parent row closes with `prd-resolve` citing it. `prd-resolve` refuses a witness output sha256 already bound (`prd-resolve-duplicate-witness`): one output closes one row.
- `prd-resolve` binds `witness_dispatch_id`, or all four of `witness_exit_code` (integer 0), `witness_output_sha256`, `witness_output_path`, `witness_ts`; an unbound body is refused. `witness_dispatch_id_verified:false` is text evidence only: flag the row for reopening.
- A witness's default input path is never machine-shaped (CI runs Linux; `<checkout>/...` is ENOENT there). Resolve an in-repo path from `path.dirname(fileURLToPath(import.meta.url))` or a root-relative join; a sibling checkout comes from a flag or env var. When the target is ABSENT, print one SKIP/REFUSE line naming the label, resolved path, source and configuration, and exit 0 only then. Exit 0 without that reason is a fabricated pass and binds no row. An optional external asset is env/flag-overridable and prints the branch it exercises when absent.
- An executor needs a row that names its file. Re-scope a file-less row with `prd-add` under the same id first; an executor that finds no file files a blocker and never guesses.
- Commit author and trailers: gm, Autonomy. Pool and publish: gm-orchestrate.
- Stage receipts are the evidence: the stage reached, receipt or blocker, files changed, and successor. Before its final STATUS line, the executor closes its Dream-RSI cycle: dispatch `dream-replay-cycle` with `{"session_id":"<session>"}` (retry once if refused) and record its id and status (`replayed`, or `deferred` with the cause) in its receipt.
- An executor never returns with its row pending and no blocker. Final line: `STATUS: handoff <sha>` or `STATUS: blocked <blocker id>`. Verifier: `STATUS: verified <witness dispatch id>` or `STATUS: fix <check id>`. CI lane: `STATUS: ci-green <sha>` or `STATUS: ci-red <sha> <job>`. The row resolves only when the orchestrator holds a verified and a ci-green for the same sha. A blocked row stays pending with `blocked_by` in its text, and no duplicate row is filed for a fact an open row names (gm-orchestrate, Never leave a row open).
- A reported cause is a claim until an instrument runs it: derive it from a run, never from reading the code. Five successive causes (`transparent` inheritance, missing client file, `side`, un-cleared target, instability) were each refuted by the next run, having been inferred, not executed. ELIMINATE (1b) is where a cause comes from.
- Localise before theorising: a symptom spans placement, draw, geometry and instrument; test cheapest-layer-first and stop at the layer that moves. A second reading at another layer is no localisation.
- Bisect before theorising. Where a number changed, bisect to the commit (live re-run, remote blob, or remote tree listing). One step attributed to `terrain-quad-upload` went from 2054 to 6808 when `LOD_STEP` went from 3.6 to 7.2.
- A row closes only when its witness names the SPECIFY leader hypothesis. A witness matching a rejected hypothesis, or every hypothesis, binds no row: file an unknown and keep the row pending.
- Premise before edit. Cited lines, functions and causes are hints from an earlier read. Before any EDIT: `git_pull` when a codesearch or codeinsight reply carries `stale_tree` (then re-run the search), and re-read each cited function at the pulled tree. A premise the tree does not show (the named code path, branch or fallback is absent) is neither a blocker nor a fix: record it with the codesearch dispatch ids, close the row as `premise-absent` with that witness, and file any real neighbouring defect with `prd-add`.
- A narrowed defect keeps its own id: a different defect is a new row naming the original id, never a rewrite of the original's acceptance text.

## Witness economy

- Order: minimal surface, eliminate unknowns (1b), localise, bisect, measure on the committed tree, count units, refuse loudly, publish on the first passing witness.
- Minimal surface: test the smallest thing that separates the hypotheses, one module rather than the page. A full browser boot costs ~64 s on a real adapter and ~636 s on a software one; a gpu-free witness over the same module answered comparable questions in 267 ms and 29.5 s. Browser last: a witness that reaches for one states which fact only a browser supplies.
- Cold start and reload are a budget. Reuse one warm session across every arm; change conditions by mutating page state (`page.evaluate`), never by reloading. A receipt states its cold starts and reloads.
- No new test files, ever. Verify with a live witness: run the real module or a gm dispatch and print its result (dispatch id, exit code, output). The ELIMINATE and PROVE instrument is a command against the live system, never a committed test file; nothing is pinned into a gate.
- A browser never weakens evidence. When used: adapter pinned, `window.__rendererInfo` asserted, rAF proven off the 16.68 ms grid, contention bar enforced; a contaminated run prints `RESULT: REFUSED` (exit 3), not a figure.
- Shared machine: browser arms and leases follow gm-orchestrate (Headroom and leases, Lane budget). `gpulock` serialises the GPU adapter only, not CPU, memory or disk. Never open a browser while the lease is held. Compare against remote `main` by content hash, never local HEAD (gm-orchestrate, Shared-tree publish).
- Counted units beat timings on a contended box: a duration read under thrash is load. Count what the code does (draws, allocations, instances, files scanned, messages) and compare counts; a timing must clear the contention bar first.
- Every instrument is two-sided: force the condition and show the number moves before quoting it. In one day five guards could not fail (a `must` regex matching nothing, an assert that was a `console.log`, a swallowing catch, a NaN printed as 0, a zero-file audit that passed). A guard that cannot fail is decoration.
- Refuse loudly, never plausibly: an unquotable number prints `RESULT: FAIL` or `RESULT: REFUSED` with its diagnostic and exits non-zero. Record every refutation in the witness-log line or the receipt: one false alarm was refuted four times before it was re-raised.
- Time-box each lane to its witness and publish on the first passing one (gm-orchestrate, Lane budget).

## Finish the work

The rule in `../gm/SKILL.md` (Finish the work) applies to every row unchanged.
