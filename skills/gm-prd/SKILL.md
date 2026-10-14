---
name: gm-prd
description: "Closes one PRD row through the nine gm stages in one run. Input: row=<id>; session=<SESSION_ID>; optional mode=witness. PRD-row rules are defined in this skill."
---

# gm-prd

One run, one row, one session. Stages run in order, none a subagent. Each writes a create-only receipt `.gm/receipts/<row>/NN-<STAGE>.md`. A stage that cannot run becomes a blocker row, `<row>-blocker-<session>` (`prd-add`), never a skip. Verbs: gm Section 1. This is the PRD-resolution tracker, separate from the node traversal (gm-orchestrate). The row's state is kept on its own receipts; it never changes the frontier count, and a row is not a node.

## Procedure
A blocker is filed only after gm-eliminate has run a live JIT check on each open unknown and recorded its dispatch id. A missing fact, an unresolved unknown or a missing row file is not a blocker until those checks have failed. Only these are blockers without a check: an owner decision, a CI-only build, or a world-scoped one-way door.

Stages run as separate skills, each loading the next: gm-orient, gm-unknowns, gm-eliminate, gm-edit, gm-validate, gm-publish. Start with `Skill(skill="gm-orient", args="row=<id>; session=<SESSION_ID>")`. The numbered list below is the stage contract each skill implements.

1. SPECIFY (orient): restate the row and acceptance; codesearch and codeinsight first (top 20 BM25, top 20 vector, top 20 commits, 3 live snippet lines each; no snippet text stored); check each cited line against the tree (absent: stale). Write the unknowns list with `mutable-add` until the verb is renamed (row `UNKNOWN-VERB-RENAME`).
1b. ELIMINATE: eliminate each unknown by a live JIT run; a run that reveals a new unknown adds it and goes back to ELIMINATE. EDIT starts only when no unknown is open.
1c. EDIT then VALIDATE: edit, then validate by JIT runs against the acceptance. A new unknown or failed check returns to ELIMINATE, then EDIT again. If the row asserts a cause, write its ACH matrix (`gm-config/prose/ach.md`) into this receipt: at least two hypotheses, evidence as dispatch ids, `C`/`I`/`N` cells, the leader, and its probe.
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
- A run never returns with its row pending and no blocker. The final line is `STATUS: resolved <witness dispatch id>` or `STATUS: blocked <blocker id>`. A blocked row stays pending with `blocked_by` in its text, and no duplicate row is filed for a fact an open row already names (Never leave a row open).
- A row closes only when its witness names the leader hypothesis from SPECIFY. A witness that matches a rejected hypothesis, or that matches every hypothesis, binds no row: file a mutable and keep the row pending.

## Witness economy
- **Browser last.** A witness that reaches for a browser states, in one line, which fact only a browser can supply. Default to gpu-free instrumentation against the real modules instead: in C:/dev/spoint a browser arm has dominated lane durations of 2-2.5 h, while a gpu-free witness answering the same class of question ran 267 ms, made 40 checks and published. A question the module graph can answer is not a browser question.
- **Cold start and reload are a budget, not free.** Reuse one warm session across every arm of a run; change a condition by mutating state in-page (`page.evaluate`), not by reloading the page. A receipt states how many cold starts and how many reloads it spent. A witness that cannot say paid more than it knows.
- **Mint the jit test the question needs; do not route the question through the suite.** At ELIMINATE and PROVE write the minimal instrument that separates the hypotheses in front of you: one file, one assertion per measurement. Reusing a general-purpose witness whose checks are about something else is a slower answer to a question it was not built to ask. After the run decide that instrument's fate -- pin it in the gate or delete it -- and never grow a general witness to answer one question.
- **A browser is not a licence to weaken the evidence.** When a browser IS required the discipline still binds: adapter pinned, `window.__rendererInfo` asserted, rAF proven off the 16.68 ms grid, contention bar enforced, and a contaminated run published as `RESULT: REFUSED` (exit 3) rather than as a figure. A cheap run whose number cannot be quoted costs more than no run.
