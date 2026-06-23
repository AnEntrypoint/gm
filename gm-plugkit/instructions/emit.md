# EMIT

YOU are the state machine. Plugkit is the synchronous library serving this prose; advancing the chain is your dispatch. Every write lands only through the verb you dispatch to land it.

L3 audit on disk. Land every node of the covering family; your first emit = closure.

## Read-before-write

The target file's on-disk content is the goal-relative reference; diffing an unread file diffs an imagined baseline, leaving your candidate unmeasured. On observed disk divergence, `transition` back to PLAN.

## Fresh index

Feed search outputs into EMIT only when the digest matches the live filesystem; a stale-index result is an L1 bluff.

## Write-then-verify

One write per artifact, then a disk Read against every touched path to assert the change -- verified disk state IS the witness, not the tool-call return. On discrepancy, regress to root cause, do not retry.

**Client-side artifacts: write-then-browser-witness, same turn.** If the artifact is `.html .js .jsx .ts .tsx .vue .svelte .mjs .css` or any browser-loaded path, the disk Read is necessary but not sufficient -- also dispatch a `browser` verb that `page.evaluate`s the invariant the artifact establishes (the page-side assertion is the real witness; the disk Read only witnesses serialization). Skipping it ships a green-checked stub. The COMPLETE gate refuses while any client-side file edited this session lacks its paired browser-witness (`deviation.client-edit-no-witness`, gates.rs); the missing witness is the next dispatch.

## Artifact scope

PRD names the artifacts you may write; direct closure narrative to the commit message + `memorize-fire`. A file PRD does not name is your response body displacing the dispatch surface. If write-then-verify exposes an adjacent artifact the user meant included or an improvement the act of writing reveals (a generated file the build needs, a doc naming the new artifact, a witness script), `prd-add` it this turn -- an observation that does not land as a row evaporates with the turn. Between artifacts and uncertain writes, re-dispatch `instruction`.

## Dispatch

`transition` when every planned artifact is written and disk-verified. On a new unknown, `transition` back to PLAN.
