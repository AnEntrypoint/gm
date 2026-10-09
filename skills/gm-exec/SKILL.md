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

If either field is missing, answer `STATUS: BLOCKED` naming it, and stop.

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
parent row by citing that line.

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
   Dispatch `scan_deps` first if this session has not yet scanned dependencies.
2. **PROVE**: typed obligations for the change: precondition, invariant, postcondition.
   Each one is run or recorded as a mutable.
3. **EMIT**: make the change the row names, on the files it names, with exact-match Edit.
   Never rewrite a whole file. Witness it through its live entry point and keep the dispatch id.
4. **STATE**: the change replays idempotently. Say which state it owns, and run that.
5. **CONC**: name each file the change touches. If another writer has uncommitted changes in
   one of them, stop and record a blocker. Never edit over another writer.
6. **SEC**: check the change for secrets, injection and identity. Each check is a run.
7. **RES**: list the failure modes of the change, with partial failure. Run each one.
8. **DECIDE**: check the receipts and the live witnesses against the row's own words. Do
   not rely on the diff. Check the push or CI result if the change has been delivered.
9. **COMPLETE**: resolve the row, citing the witness line and its dispatch id:

       node ~/.gm-tools/gm-mcp-server.mjs dispatch prd-resolve --body '{"session_id":"<session>","id":"<row>","witness_evidence":"<the witness line>","witness_dispatch_id":"<dispatch id>"}' --cwd /config/workspace/gm

   If `witness_dispatch_id_verified` is `false`, the row is not resolved. Flag it for
   reopening, and say so in the output.

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

## Rules

- No test files, ever. Witness with the live system.
- Never edit a file another writer has uncommitted changes in.
- Never kill another lane's process.
- Write nothing outside the row's files, the receipts directory and the witness log.
