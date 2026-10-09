---
name: gm-exec
description: Self-contained gm PRD executor. Closes one PRD row through the nine stages (SPECIFY, PROVE, EMIT, STATE, CONC, SEC, RES, DECIDE, COMPLETE) in one run, with mutables collected and closed by code run on the project (JIT execution), process of elimination when a witness fails, a witness log, and delivery. Invoke with args "row=<id>; session=<SESSION_ID>".
---

# gm-exec

One run closes one PRD row. Everything the old gm flow required for execution is here, so
this run needs no other skill and spawns no other agent. Work the nine stages in order, in
this run. Each stage writes a receipt to `/config/workspace/gm/.gm/receipts/<row>/NN-<STAGE>.md`.
A stage that cannot be executed is a blocker on the row, and is never skipped.

## Arguments

- `row=<id>`: the PRD row to close.
- `session=<SESSION_ID>`: your SESSION_ID. Use it in every dispatch body.
- `mode=witness` (optional): a witness-only run. It closes a prose row that another session
  edited, and it edits nothing.

If either field is missing, answer `STATUS: BLOCKED` naming it, and stop.

## Witness mode

When `mode=witness` is set, run SPECIFY, PROVE, DECIDE and COMPLETE only. EMIT, STATE, SEC and RES
are not run, and this session edits no file. Witness the row's acceptance through the observable
surface it names: a verb reply, a served `instruction` response, or a `codesearch` readback of the
file. Each witness line states which surface it observed. A row whose served surface omits its
file is closed on the readback, and that line says so. `prd-resolve` runs only when the witness
dispatch id is verified: the dispatch ledger holds it with exit code 0, its verb is a witness verb
(`exec_js`, `codesearch`, `code_search`, `search`, `grep` or `rg`), and the session that dispatched it
differs from the resolving session.

## Harness

Dispatch every gm verb with the bundled CLI, from `/config/workspace/gm`:

    node ~/.gm-tools/gm-mcp-server.mjs dispatch <verb> --body '<json>' --cwd /config/workspace/gm

Keep the `dispatch_id` of every reply that you rely on. A claim without a dispatch id is not
in the system. A missing out-file means the dispatch has not finished: poll it, never
re-dispatch blindly. Read a row before writing it: `prd-add` on an existing id overwrites
its subject. Row ids are real: never invent one for a witness run.

Code questions: `codeinsight` (`callers`/`impact`) first, then `codesearch` with
`mode:"literal"`. `Read` only a located path. Never use raw `grep`, `find` or `git` in Bash.

## Witness: the audit primitive

A claim without `(id, hash, ts)` is not in the system. Every witness is a live run on this
project, read by you, with its dispatch id kept. A witness that fails with `EADDRINUSE` did
not run: identify the owning process before rerunning, and never kill another lane's process.

Witness outcomes are not PRD rows. Append one line per run to `/config/workspace/gm/.gm/witness-log.md`:
the witness, the exit code, the RESULT line, the timestamp, and the dispatch id. Close the
parent row by citing that line. Before each append, if the active log has 1000 or more lines,
rename it atomically (same directory) to `witness-log-<UTC yyyymmddThhmmssZ>.md` and append to a
fresh `witness-log.md`. If the rename finds no active log, another session rotated it first, so
append to the fresh file. Archives are never edited or deleted, because a resolved row cites a line
that stays in its archive. Any prune of the active log keeps every line that a resolved row cites.

A prose row (a change to a skill, instruction or served key) is witnessed by an observed change
in a verb reply or a served phase response, read by a session that did not edit the prose.
Reading back the text just written proves storage, not behavior, so the editing session cannot
close its own prose row. A code row has the same rule: its witness is dispatched by a session other
than the executor. `prd-resolve` refuses a witness whose dispatch session equals the resolving session
(`prd-resolve-self-witness`), so an executor's own witness never closes its row.

## Mutables and JIT execution

A mutable is an open question. Record every unknown the row raises as a mutable before you
act on it:

    node ~/.gm-tools/gm-mcp-server.mjs dispatch mutable-add --body '{"session_id":"<session>","id":"<row>-M<n>","question":"<question>"}' --cwd /config/workspace/gm

A mutable closes only when code run on this project answers it. That run's output is the
witness. Reading code is not an answer, and neither is a guess:

    node ~/.gm-tools/gm-mcp-server.mjs dispatch mutable-resolve --body '{"session_id":"<session>","id":"<row>-M<n>","answer":"<answer>","witness_dispatch_id":"<dispatch id of the run>"}' --cwd /config/workspace/gm

JIT execution: answer each question with a live run at the moment you need it, through
`exec_js` for logic, `codesearch` for every definition and call site, and the row's named
verbs for behaviour. Test a claim with a run before you build on it. A claim you have not
run is a mutable.

A question no run can answer becomes a stated assumption, filed as a PRD row, and worked
on. Ask the user only for a world-scoped one-way door: irreversible, money, another
person, production, legal or safety. Never ask the user to choose between options that
make progress.

## The nine stages

1. **SPECIFY**: restate the row and its acceptance criteria, with the mutables it raises.
   Dispatch `scan_deps` first if this session has not yet scanned dependencies. Check each
   cited line and quote against the working tree. If the cited text is absent from the
   working tree and from HEAD, the premise is false: witness the absence with `codesearch`,
   and resolve the row as stale with that witness.
2. **PROVE**: typed obligations for the change: precondition, invariant, postcondition.
   Each one is run or recorded as a mutable.
3. **EMIT**: make the change the row names, on the files it names, with exact-match Edit.
   Never rewrite a whole file. Witness it through its live entry point and keep the dispatch id.
4. **STATE**: the change replays idempotently. Say which state it owns, and run that.
5. **CONC**: name each file the change touches, and list any other writer's uncommitted hunks
   in it (`git_status` with `paths`). Those hunks are not a stop: the edit is an exact-match
   replacement of text read in the current file, so it preserves them. Record the hunks in the
   receipt. Delivery of a shared file is the orchestrator's, below.
6. **SEC**: check the change for secrets, injection and identity. Each check is a run.
7. **RES**: list the failure modes of the change, with partial failure. Run each one.
8. **DECIDE**: check the receipts and the live witnesses against the row's own words. Do
   not rely on the diff. Check the push or CI result if the change has been delivered.
9. **COMPLETE**: resolve the row, citing the witness line and its dispatch id:

       node ~/.gm-tools/gm-mcp-server.mjs dispatch prd-resolve --body '{"session_id":"<session>","id":"<row>","witness_evidence":"<the witness line>","witness_dispatch_id":"<dispatch id>"}' --cwd /config/workspace/gm

   If `witness_dispatch_id_verified` is `false`, the row is not resolved. Flag it for
   reopening, and say so in the output. The resolving session must differ from the session that
   dispatched the witness. When this run is the executor, it stops at `STATUS: BLOCKED`, and a
   `mode=witness` run from another session resolves the row.

## Process of elimination: when a witness fails

A failed witness is a fact about the code. Work it out:

1. List every candidate cause as a mutable.
2. Eliminate candidates one at a time, each by a live run that rules it in or out.
3. Fix only the cause that survives, with the smallest change.
4. Witness again through the same entry point, and keep the dispatch id.

If every candidate is eliminated and the failure remains, the row is blocked. Name the last
open mutable in the receipt, and do not resolve.

## Delivery

When the change is complete and witnessed, commit only the files this run changed, with
`git_finalize {message, paths}`, and push. Run it only if no other writer has uncommitted
changes in those files (CONC). Otherwise leave the change uncommitted and name the files in
the output, so the orchestrator delivers it. The delivery is witnessed by the `git_finalize`
reply: commit sha and push result.

## Output

At most 100 words:

    STATUS: RESOLVED | BLOCKED
    ROW: <id>
    FILES: <changed files, or none>
    WITNESS: <the witness line, its dispatch id, and the witness-log line>
    MUTABLES: <open mutables, or none>
    DELIVERY: <commit sha and push result, or "left uncommitted: <files>">

## Invariants

An invariant is a rule with a check. A run that breaks one logs a FAILURE line in its receipt
and does not resolve its row.

- No test files, ever. Check: no path in the row's `git_status` or `git_diff` names a test file.
- Edits are exact-match only. Check: each `git_diff` hunk this run wrote replaces text the run
  read; a whole-file rewrite fails the check, and another writer's hunks remain in the diff.
- Never kill another lane's process. Check: the receipt names no kill command.
- Write nothing outside the row's files, the receipts directory and the witness log. Check:
  `git_status` with `paths` shows no change outside them.
- Receipts are create-only. Check: each stage receipt is made by an exclusive create that refuses
  an existing file; a session that finds the file present appends its own section under its own
  session heading, and no earlier session's section is replaced.
- A prose row is closed by an independent session. Check: the `session` that closes it is not the
  session whose `EMIT` edited the file.
