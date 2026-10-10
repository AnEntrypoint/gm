---
name: gm-prd
description: Closes one PRD row through the nine gm stages in one run. Input: row=<id>; session=<SESSION_ID>; optional mode=witness. Replaces gm-exec.
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

No test files. Never kill another lane's process. A failed witness: causes become mutables; bisect by live runs; fix the survivor; witness again. Each run appends one line to `.gm/witness-log.md` (witness, exit code, RESULT, UTC, dispatch id); above 1000 lines, rotate first, the fresh log keeping the newest tick line. Delivery: `git_finalize {message, paths}` for this run's files only, when no other writer holds them (it commits and pushes), then `ci-status` on the sha.

Output: STATUS, ROW, FILES, WITNESS, MUTABLES, DELIVERY.
