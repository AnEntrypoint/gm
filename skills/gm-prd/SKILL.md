---
name: gm-prd
description: Closes one PRD row through the nine gm stages in one run. Input: row=<id>; session=<SESSION_ID>; optional mode=witness. Owns every PRD-row rule.
---

# gm-prd

One run, one row, one session. Stages run in order, none a subagent. Each writes a create-only receipt `.gm/receipts/<row>/NN-<STAGE>.md`. A stage that cannot run becomes a blocker row, `<row>-blocker-<session>` (`prd-add`), never a skip. Verbs: gm Section 1.

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

No test files. Never kill another lane's process. A failed witness: causes become mutables; bisect by live runs; fix the survivor; witness again. Delivery: `git_finalize {message, paths}` for this run's files only, when no other writer holds them (it commits and pushes), then `ci-status` on the sha. Output: STATUS, ROW, FILES, WITNESS, MUTABLES, DELIVERY.

## Rules
- Read a row before writing it. `prd-add` on an existing id overwrites its subject, so a witness blocker on an existing row is appended to that row's text with its original subject kept. Never reuse the row's own id for a blocker: that rescopes the row.
- At SPECIFY the orchestrator dispatches `scan_deps` and logs its result as a PRD row.
- Row ids are real: read them with `prd-list {"status":"pending"}` filtered in exec_js; never invent one for a witness run. A row name absent from `.gm/prd.yml` cannot be resolved.
- Witness outcomes are not PRD rows. Each run appends one line to `.gm/witness-log.md` (witness, exit code, RESULT line, UTC, dispatch id), and the parent row is closed with `prd-resolve` citing that line. One output closes one row: `prd-resolve` refuses a witness output sha256 already bound to another row (`prd-resolve-duplicate-witness`).
- `prd-resolve` binding: `witness_dispatch_id`, or all four of `witness_exit_code` (integer 0), `witness_output_sha256`, `witness_output_path` and `witness_ts`. A body without a binding is refused as unbound. `witness_dispatch_id_verified:false` is text evidence only: flag the row for reopening.
- An executor needs a row that names its file. A row with no file is re-scoped with `prd-add` under the same id first; an executor that finds no file files a blocker and never guesses one.
- Stage receipts are the evidence. A worker's result is the stage reached, the receipt or blocker, files changed and the successor.
