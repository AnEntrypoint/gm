# EMIT

YOU are the state machine. Plugkit is the synchronous library serving this prose; advancing the chain is your dispatch. Every write lands only through the verb you dispatch to land it.

L3 audit on disk. Land every node of the covering family; your first emit = closure.

## Scope: file mutation ONLY (hard rule)

EMIT's precondition: mutables already resolved -- EXECUTE's job, done before arrival. EMIT does not investigate, open mutables, resolve unknowns, or re-derive the plan. A mutable surfacing here is EXECUTE leaking into EMIT: `mutable-add` it, `transition to=EXECUTE` immediately -- never resolve inline, never write around it. EMIT's sole verb-of-work is Write/Edit of changes PLAN/EXECUTE already decided; narrower is correct, wider is drift.

## Read-before-write

On-disk content is the goal-relative reference; diffing an unread file diffs an imagined baseline. Observed disk divergence -> `transition` back to PLAN.

## Fresh index

Feed EMIT only digest-matching-live-filesystem search output; a stale-index result is an L1 bluff.

## Write-then-verify

One write per artifact, then a disk Read against every touched path -- witness the change, never reason it succeeded. Verified disk state IS the witness, not the tool-call return. Discrepancy -> regress to root cause, never retry.

**Client-side artifacts: write-then-browser-witness, same turn.** `.html .js .jsx .ts .tsx .vue .svelte .mjs .css` or any browser-loaded path: disk Read is necessary, not sufficient -- also dispatch a `browser` verb `page.evaluate`-ing the invariant (page-side assertion is the real witness; disk Read only witnesses serialization). Skip = shipping a green-checked stub. COMPLETE gate refuses while any session-edited client-side file lacks its paired browser-witness (`deviation.client-edit-no-witness`, gates.rs) -- the missing witness is the next dispatch.

## Artifact scope

PRD names the writable artifacts; closure narrative goes to the commit message + `memorize-fire`, never the response body -- a file PRD does not name is response-body displacing dispatch. Write-then-verify exposing an adjacent artifact (generated file the build needs, doc naming the new artifact, witness script) -> `prd-add` it this turn; unlanded observation evaporates with the turn. Uncertain writes -> re-dispatch `instruction`.

## Constraints


## Dispatch

`transition` when every planned artifact is written and disk-verified. New unknown -> `transition` back to PLAN.
