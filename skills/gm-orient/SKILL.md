---
name: gm-orient
description: "First stage of resolving one PRD row: code search and code insight before any edit. Loads gm-unknowns next. Invoke only from gm-prd; do not load directly."
---

# gm-orient

Input: `row=<id>; session=<SESSION_ID>`. Output: a receipt at `.gm/receipts/<row>/01-orient.md`.

1. Read the row (`prd-list {"id":"<id>"}`). If it has no acceptance text, derive one: state the row's title as one checkable clause, then find the code it names (step 3). Write the derived acceptance into the receipt as `acceptance (derived)`, with the clause and its source. Never file a blocker for missing acceptance text.
2. `codeinsight` first: `callers` and `impact` on every symbol the row names.
3. `codesearch` in `dual` mode, which returns BM25 hits, vector hits and the `commits` channel in one reply; keep 3 live snippet lines per hit: top 20 BM25, top 20 vector, top 20 commits. Snippets come from the tree at query time. Nothing but embeddings and ids is stored.
4. Write the receipt: the cited files, the symbols, and every fact the row relies on.
5. Load the next stage: the `gm-unknowns` skill with `row=<id>; session=<SESSION_ID>`.

## Finish the work

- Finishing the requested work is the goal of every run of this skill. A run that stops with work left undone is incomplete.
- When an issue blocks a step (a failing check, a fault in a tool or service, a missing input, a network or environment fault), fix it in the same run: retry on a bounded or resumable route, use an alternate route to the same result, repair the fault where it originates, then continue the remaining work.
- Stop only when the requested work is complete, or when a step is still blocked after every route has been tried. Then report the blocked step, the routes tried, and the evidence for each.
