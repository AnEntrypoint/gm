---
name: gm-prd
description: "Closes one PRD row through the nine gm stages in one run. Input: row=<id>; session=<SESSION_ID>; optional mode=witness. PRD-row rules are defined in this skill."
---

# gm-prd

One run, one row, one session. Stages run in order, none a subagent. Each writes a create-only receipt `.gm/receipts/<row>/NN-<STAGE>.md`. A stage that cannot run becomes a blocker row, `<row>-blocker-<session>` (`prd-add`), never a skip. Verbs: gm Section 1. This is the PRD-resolution tracker, separate from the node traversal (gm-orchestrate). The row's state is kept on its own receipts; it never changes the frontier count, and a row is not a node.

## Procedure

1. SPECIFY: restate the row and acceptance; check each cited line against the tree (absent: stale). Unknowns: `mutable-add`. If the row asserts a cause, write its ACH matrix (`gm-config/prose/ach.md`) into this receipt: at least two hypotheses, evidence as dispatch ids, `C`/`I`/`N` cells, the leader, and its probe.
2. PROVE: precondition, invariant, postcondition; run each. The leader's probe runs here first. A probe that does not separate the leader from the next hypothesis is a blocker row, not a pass.
3. EMIT: exact-match Edit only; witness through the live entry point; keep the dispatch id.
4. STATE: the change replays idempotently; name the state it owns.
5. CONC: list each touched file and other writers' hunks (`git_status` with paths).
6. SEC: secrets, injection, identity; each check is a run.
7. RES: failure modes, partial failure included; run each.
8. DECIDE: check receipts and live witnesses against the row's words, not the diff; check the push or CI result.
9. COMPLETE: `prd-resolve {"id","witness_evidence","witness_dispatch_id"}` once `witness_dispatch_id_verified`. The witness must come from another session; a self-witness is refused (`prd-resolve-self-witness`) and the row stays pending.

`mode=witness` runs SPECIFY, PROVE, DECIDE and COMPLETE only, edits nothing, and closes a row another session edited.

No test files. Never kill another lane's process: defined in gm-orchestrate: Headroom and leases (EADDRINUSE). A failed witness: causes become mutables; bisect by live runs; fix the survivor; witness again. Delivery: `git_finalize {message, paths}` for this run's files only, when no other writer holds them, then `ci-status` on the sha; publish mechanics, including the `remote_moved` recovery, are defined in gm-orchestrate: Shared-tree publish. Output: STATUS, ROW, FILES, WITNESS, MUTABLES, DELIVERY.

Before that commit, the bake-input re-bake rule is defined in gm-hop: Re-bake in the same commit.

## Rules
- Read a row before writing it. `prd-add` on an existing id is refused (`prd-add refused: id '<id>' already exists`) unless the body carries `overwrite:true`, which rescopes it, so a witness blocker on an existing row is appended to that row's text with its original subject kept. Never reuse the row's own id for a blocker: that rescopes the row.
- At SPECIFY the orchestrator dispatches `scan_deps` and logs its result as a PRD row.
- Row ids are real: read them with `prd-list {"status":"pending"}` filtered in exec_js; never invent one for a witness run. A row name absent from `.gm/prd/` cannot be resolved -- and one that was already resolved is absent from the folder on purpose, because `prd-resolve` moves it into `.gm/prd-log.jsonl`. Ask for it with `prd-list {"id":"<id>"}`, which reads the log, instead of concluding it never existed.
- A row is a file: `.gm/prd/<id>.yml`, one file per row, human-editable. Edit it directly when that is the honest fix; a write is a compare-and-swap of that file alone, so editing row A never touches row B. Resolved rows leave the folder for the append-only `.gm/prd-log.jsonl`.
- Witness outcomes are not PRD rows. Each run appends one line to `.gm/witness-log.md` (witness, exit code, RESULT line, UTC, dispatch id), and the parent row is closed with `prd-resolve` citing that line. One output closes one row: `prd-resolve` refuses a witness output sha256 already bound to another row (`prd-resolve-duplicate-witness`).
- `prd-resolve` binding: `witness_dispatch_id`, or all four of `witness_exit_code` (integer 0), `witness_output_sha256`, `witness_output_path` and `witness_ts`. A body without a binding is refused as unbound. `witness_dispatch_id_verified:false` is text evidence only: flag the row for reopening.
- A witness's default input path is never a machine-shaped literal. CI runs Linux, so a `C:/dev/...` default is a bare ENOENT there: a path inside the repo under test resolves from `path.dirname(fileURLToPath(import.meta.url))` or a root-relative join, and a path into a sibling checkout comes from a flag or env var (checkout-root env plus a repo-relative suffix), never from a default literal. When the target is ABSENT the witness prints WHY and skips or refuses EXPLICITLY: one SKIP/REFUSE line naming the label, the resolved path, where that path came from and how to configure it, and exit 0 only with that loud SKIP line printed. A witness that exits 0 without saying why it did nothing is a fabricated pass and binds no row. An external optional asset (not this repo, not a sibling checkout) is env/flag-overridable and prints which branch it is exercising when it is absent.
- An executor needs a row that names its file. A row with no file is re-scoped with `prd-add` under the same id first; an executor that finds no file files a blocker and never guesses one.
- Commit author and trailers: defined in gm: One commit author, no trailers.
- Never let the pool dip: defined in gm-orchestrate: Never let the pool dip.
- Shared work tree, Git API publish route, redundant-push reporting and collision recovery: defined in gm-orchestrate: Shared-tree publish. Bisect by live runs means re-running the witness against current state, or against a remote blob (`gh api /repos/<owner>/<repo>/contents/<path>?ref=main`) or a `git archive` of a remote sha into a temp dir that is deleted afterwards -- read-only, never published from.
- Stage receipts are the evidence. A worker's result is the stage reached, the receipt or blocker, files changed and the successor.
- A run never returns with its row pending and no blocker. The final line is `STATUS: resolved <witness dispatch id>` or `STATUS: blocked <blocker id>`. A blocked row stays pending, and its blocker is launched by gm-orchestrate in the next wave (Never leave a row open).
- A row closes only when its witness names the leader hypothesis from SPECIFY. A witness that matches a rejected hypothesis, or that matches every hypothesis, binds no row: file a mutable and keep the row pending.
