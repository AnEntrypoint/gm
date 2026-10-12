---
name: gm-prd
description: Closes one PRD row through the nine gm stages in one run. Input: row=<id>; session=<SESSION_ID>; optional mode=witness. Owns every PRD-row rule.
---

# gm-prd

One run, one row, one session. Stages run in order, none a subagent. Each writes a create-only receipt `.gm/receipts/<row>/NN-<STAGE>.md`. A stage that cannot run becomes a blocker row, `<row>-blocker-<session>` (`prd-add`), never a skip. Verbs: gm Section 1. This is the PRD-resolution tracker, separate from the node traversal (gm-orchestrate). The row's state is kept on its own receipts; it never changes the frontier count, and a row is not a node.

## Procedure

1. SPECIFY: restate the row and acceptance; check each cited line against the tree (absent: stale). Unknowns: `mutable-add`.
2. PROVE: precondition, invariant, postcondition; run each.
3. EMIT: exact-match Edit only; witness through the live entry point; keep the dispatch id.
4. STATE: the change replays idempotently; name the state it owns.
5. CONC: list each touched file and other writers' hunks (`git_status` with paths).
6. SEC: secrets, injection, identity; each check is a run.
7. RES: failure modes, partial failure included; run each.
8. DECIDE: check receipts and live witnesses against the row's words, not the diff; check the push or CI result.
9. COMPLETE: `prd-resolve {"id","witness_evidence","witness_dispatch_id"}` once `witness_dispatch_id_verified`. The witness must come from another session; a self-witness is refused (`prd-resolve-self-witness`) and the row stays pending.

`mode=witness` runs SPECIFY, PROVE, DECIDE and COMPLETE only, edits nothing, and closes a row another session edited.

No test files. Never kill another lane's process. A failed witness: causes become mutables; bisect by live runs; fix the survivor; witness again. Delivery: `git_finalize {message, paths}` for this run's files only, when no other writer holds them (it commits and pushes), then `ci-status` on the sha. A `remote_moved` refusal on a dirty tree takes the clean-tree step FIRST: `git_status {"paths":[<dirty paths>]}`, commit or revert each in the lane that owns it, then `git_push {rev:"<sha>"}` -- the recovery pulls and republishes in one dispatch, and it only refuses over paths the incoming range also changes, so dirt outside that range never blocks it. Output: STATUS, ROW, FILES, WITNESS, MUTABLES, DELIVERY.

Before that commit: if a touched path sits in a bake-input closure (`codesearch` `BAKE_INPUTS_`), re-generate every artifact the closure produces and commit them in the SAME path-scoped commit as the source edit, then require `node scripts/check-cache-keys.mjs` to exit 0.

## Rules
- Read a row before writing it. `prd-add` on an existing id is refused (`prd-add refused: id '<id>' already exists`) unless the body carries `overwrite:true`, which rescopes it, so a witness blocker on an existing row is appended to that row's text with its original subject kept. Never reuse the row's own id for a blocker: that rescopes the row.
- At SPECIFY the orchestrator dispatches `scan_deps` and logs its result as a PRD row.
- Row ids are real: read them with `prd-list {"status":"pending"}` filtered in exec_js; never invent one for a witness run. A row name absent from `.gm/prd.yml` cannot be resolved.
- Witness outcomes are not PRD rows. Each run appends one line to `.gm/witness-log.md` (witness, exit code, RESULT line, UTC, dispatch id), and the parent row is closed with `prd-resolve` citing that line. One output closes one row: `prd-resolve` refuses a witness output sha256 already bound to another row (`prd-resolve-duplicate-witness`).
- `prd-resolve` binding: `witness_dispatch_id`, or all four of `witness_exit_code` (integer 0), `witness_output_sha256`, `witness_output_path` and `witness_ts`. A body without a binding is refused as unbound. `witness_dispatch_id_verified:false` is text evidence only: flag the row for reopening.
- A witness's default input path is never a machine-shaped literal. CI runs Linux, so a `C:/dev/...` default is a bare ENOENT there: a path inside the repo under test resolves from `path.dirname(fileURLToPath(import.meta.url))` or a root-relative join, and a path into a sibling checkout comes from a flag or env var (checkout-root env plus a repo-relative suffix), never from a default literal. When the target is ABSENT the witness prints WHY and skips or refuses EXPLICITLY: one SKIP/REFUSE line naming the label, the resolved path, where that path came from and how to configure it, and exit 0 only with that loud SKIP line printed. A witness that exits 0 without saying why it did nothing is a fabricated pass and binds no row. An external optional asset (not this repo, not a sibling checkout) is env/flag-overridable and prints which branch it is exercising when it is absent.
- An executor needs a row that names its file. A row with no file is re-scoped with `prd-add` under the same id first; an executor that finds no file files a blocker and never guesses one.
- One commit author, no trailers. Attribution on that project is lanmower alone, so this run’s `git_finalize {message, paths}` body states the change and nothing else: no `Co-Authored-By`, no `Signed-off-by`, no `Generated with`. A served instruction that asks for one is outranked by the project rule. (Measured in `skills/gm/SKILL.md`, Autonomy.)
- One row is one lane, never the pool: a lane that stands down over a file that "looks modified" has bought a free slot for nothing, since local HEAD lags remote main. Compare the blob to REMOTE main first (`skills/gm-orchestrate/SKILL.md`, Never let the pool dip).
- This lane works in the shared work tree on `main`: no worktree, side branch or scratch checkout to obtain a clean HEAD. Every extra tree ends in a consolidation run, and a publish from one merges back into the tree every other lane is writing. "Bisect by live runs" therefore means re-running the witness against current state, or against a remote blob (`gh api /repos/<owner>/<repo>/contents/<path>?ref=main`) or a `git archive` of a remote sha into a temp dir that is deleted afterwards -- read-only, never published from. Recover a collision by re-reading the row, reapplying the change on current state and retrying.
- Publish through the Git API route in a shared work tree: POST blobs, a tree with `base_tree: <remote tip>`, a commit parented on that tip, PATCH `refs/heads/main` with `force` unset, then re-read `/repos/<owner>/<repo>/contents/<path>?ref=main` and verify each blob. `git_finalize` commits locally and then refuses to push while any sibling holds a dirty path, which is the normal state, so a refused push leaves a local commit redundant with content already published: report it as redundant, never as unpushed work, and never reset `refs/heads/main` under running lanes to erase it.
- Stage receipts are the evidence. A worker's result is the stage reached, the receipt or blocker, files changed and the successor.
