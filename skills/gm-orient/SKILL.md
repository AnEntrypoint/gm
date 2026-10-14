---
name: gm-orient
description: "First stage of resolving one PRD row: code search and code insight before any edit. Loads gm-unknowns next. Invoke only from gm-prd; do not load directly."
---

# gm-orient

Input: `row=<id>; session=<SESSION_ID>`. Output: a receipt at `.gm/receipts/<row>/01-orient.md`.

1. Read the row (`prd-list {"id":"<id>"}`). If it has no acceptance text, derive one: state the row's title as one checkable clause, then find the code it names (step 3). Write the derived acceptance into the receipt as `acceptance (derived)`, with the clause and its source. Never file a blocker for missing acceptance text.
2. `codeinsight` first: `callers` and `impact` on every symbol the row names.
3. `codesearch` in three modes and keep 3 live snippet lines per hit: top 20 BM25, top 20 vector, top 20 commits. Snippets come from the tree at query time. Nothing but embeddings and ids is stored.
4. Write the receipt: the cited files, the symbols, and every fact the row relies on.
5. Load the next stage: `Skill(skill="gm-unknowns", args="row=<id>; session=<SESSION_ID>")`.
