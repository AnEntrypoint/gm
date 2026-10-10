---
name: gm-hop
description: One traversal hop: a principle or book name and a surface path in, one receipt naming the next principle out.
---

# gm-hop

Args: one JSON object `{"principle":"<node id, label or book>","surface":"<path>","session":"<SESSION_ID>","depth":<n>,"visited":[],"rhetoric":""}` (last three optional). A missing `principle`, `surface` or `session`, or a `principle` matching no principle node of `skills/dream-rsi/gm-graph.json` (id, label or book): `VERDICT: NOT-APPLICABLE`, no writes.

Verbs: gm Section 1. Code questions: callers and impact, then `codesearch` literal rooted at the surface. `Read` only located paths.

1. Argue `rhetoric`'s open question in one paragraph, or the principle's weakest claim if empty.
2. List its testable claims: one checkable sentence each, with its test.
3. `codesearch` every instance a claim governs on the surface; print cited lines; drop absent text.
4. Close what one exact-match Edit closes, if no other writer holds the file (`git_status` with paths). Witness it live; keep the dispatch id. Revert a change with no live witness.
5. `prd-add` each other finding as `<principle>-<tag>-<n>` (tag = last six of your SESSION_ID); `prd-list` the id first (an existing id is overwritten). Retire or merge one stale row per row added.
6. Name the biggest need in one sentence.
7. Nominate the successor: a principle edge from this node, not in `visited`, that attacks the need. At `depth` 6 or more: `next: none, depth limit`. Otherwise spawn it with `Agent` running `Skill(skill="gm-hop", args='{...}')` at `depth+1`, `visited` plus this node, and `rhetoric` = your `why` (three sentences max).

No witnessed change or verified row: `next: none`, with the reason.

Receipt (120 words max):
```
VERDICT: HOLDS | VIOLATED | NOT-APPLICABLE
PRINCIPLE: <id>; SURFACE: <path>; WITNESS: <audit dispatch id>
CHANGED: <file, dispatch id> | none
ROWS: <n>: <ids>
NEED: <one sentence>
next: <id>; depth=<n+1> | none, <reason>
```
