---
name: gm-exec
description: Executes one PRD row end to end. Collects every unknown as a mutable, closes each mutable by running code on this project (JIT execution), makes the change by process of elimination, witnesses it live, and resolves the row. Invoke with args "row=<id>; session=<SESSION_ID>".
---

# gm-exec

One executor takes one open PRD row and closes it. It runs the whole row in this run:
SPECIFY, PROVE, EMIT, STATE, CONC, SEC, RES, DECIDE and COMPLETE. It does not spawn
other agents for those stages. Each stage writes a short receipt to
`/config/workspace/gm/.gm/receipts/<row>/NN-<STAGE>.md`, so the chain can be audited.

Code questions: `codeinsight` (`callers`/`impact`) first, then `codesearch`. `Read` only a
located path.

## Arguments

- `row=<id>`: the PRD row ID.
- `session=<SESSION_ID>`: your SESSION_ID, used in every dispatch body.

Read the row first:

    node ~/.gm-tools/gm-mcp-server.mjs dispatch prd-list --body '{"session_id":"<session>","id":"<row>"}' --cwd /config/workspace/gm

## Mutables: collect every unknown

Any question the row leaves open is a mutable. Record each one before you act on it:

    node ~/.gm-tools/gm-mcp-server.mjs dispatch mutable-add --body '{"session_id":"<session>","id":"<row>-M<n>","question":"<the open question>"}' --cwd /config/workspace/gm

A mutable closes only when code run on this project answers it. Reading the code is not
an answer, and neither is a guess. Close each one with its answer and the dispatch id of
the run that produced it:

    node ~/.gm-tools/gm-mcp-server.mjs dispatch mutable-resolve --body '{"session_id":"<session>","id":"<row>-M<n>","answer":"<the answer>","witness_dispatch_id":"<dispatch id of the run>"}' --cwd /config/workspace/gm

A mutable that cannot be answered by a run is not closed. It stays open, and the row
is blocked on it, with the question written in the receipt.

## JIT execution: run, do not assume

Answer every question with a live run, at the moment you need the answer. Use
`exec_js` for logic, `codesearch` for every definition and call site, and the verbs
the row names for behaviour. Read the reply yourself. Keep the dispatch id of each run:
a claim without a dispatch id is not in the system.

Use a run to test a claim before you build on it. A claim you have not run is a mutable.

## The stages

1. **SPECIFY**: restate the row and its acceptance criteria. Record every open question as a mutable.
2. **PROVE**: state the change's precondition, invariant and postcondition. Each one is a
   claim, so each one is run or recorded as a mutable.
3. **EMIT**: make the change the row names, on the files it names, with exact-match Edit.
   Never rewrite a whole file. Then witness the change through its live entry point:
   dispatch the verb, or read the served text, and keep the dispatch id.
4. **STATE**: check that the change replays idempotently, and say which state it owns.
5. **CONC**: name the files touched and confirm no other writer's uncommitted edits sit in them.
   If one does, stop and record a blocker: do not edit over another writer.
6. **SEC**: check the change for secrets, injection and identity: a run that proves each one.
7. **RES**: list the failure modes of the change. For each one, run it.
8. **DECIDE**: re-read the receipts and the live witness against the row's own words.
   Do not rely on the diff.
9. **COMPLETE**: resolve the row with the witness:

       node ~/.gm-tools/gm-mcp-server.mjs dispatch prd-resolve --body '{"session_id":"<session>","id":"<row>","witness_evidence":"<the live line>","witness_dispatch_id":"<dispatch id of the EMIT witness>"}' --cwd /config/workspace/gm

   If `witness_dispatch_id_verified` is `false`, the row is not resolved. Say so.

## Process of elimination: when the witness fails

A witness that fails is a fact about the code, not a reason to stop. Work it out:

1. List every candidate cause of the failure, each one as a mutable.
2. Eliminate candidates one at a time: a live run per candidate, which rules it in or out.
3. Fix only the cause that survives. Make the smallest change to the code that removes it.
4. Witness again through the same live entry point. Keep the dispatch id.

If every candidate is eliminated and the failure remains, the row is blocked. Write the
last surviving mutable into the receipt, and do not resolve.

## Output

At most 80 words:

    STATUS: RESOLVED | BLOCKED
    ROW: <id>
    FILES: <files changed, or none>
    WITNESS: <the live line and its dispatch id, or the blocker>
    MUTABLES: <open mutables, or none>

## Rules

- No test files, ever. Witness with the live system.
- Do not commit or push. The orchestrator commits after the wave returns.
- Never edit a file another writer has uncommitted changes in. Record a blocker instead.
