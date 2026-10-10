---
name: gm-hop
description: One traversal hop: a principle or book name and a surface path in, one receipt naming the next principle out. Owns every hop rule.
---

# gm-hop

Args: one JSON object `{"principle":"<node id, label or book>","surface":"<path>","session":"<SESSION_ID>","depth":<n>,"visited":[],"rhetoric":""}` (last three optional). A missing `principle`, `surface` or `session`, or a `principle` matching no principle node of `skills/dream-rsi/gm-graph.json` (id, label or book): `VERDICT: NOT-APPLICABLE`, no writes.

Verbs: gm Section 1. Code questions: callers and impact, then `codesearch` literal rooted at the surface. `Read` only located paths.

## Procedure
1. Argue `rhetoric`'s open question in one paragraph, or the principle's weakest claim if empty.
2. List its testable claims: one checkable sentence each, with its test.
3. `codesearch` every instance a claim governs on the surface; print cited lines; drop absent text.
4. Close what one exact-match Edit closes, if no other writer holds the file (`git_status` with paths). Witness it live and keep the dispatch id. Revert a change that has no live witness.
5. `prd-add` each other finding as `<principle>-<tag>-<n>` (tag = last six of your SESSION_ID), after `prd-list` shows the id is free (an existing id is overwritten). Retire or merge one stale row per row added.
6. Name the biggest need in one sentence.
7. Nominate the successor: a principle edge from this node, not in `visited`, that attacks the need. At `depth` 6 or more: `next: none, depth limit`. Otherwise spawn it with `Agent` running `Skill(skill="gm-hop", args='{...}')` at `depth+1`, `visited` plus this node, and `rhetoric` = your `next_choice.why` verbatim (three sentences max).

No witnessed change or verified row: `next: none`, with the reason.

## Rules
- A hop is one named principle from the book "lean" (AnEntrypoint/lean skills/lean/SKILL.md), applied as work to every instance in scope in one pass.
- A hop lists the real pending rows for its surface, records a one-line action per row, nominates its successor from that same list, and never invents an id.
- Every hop runs as its own subagent with its own SESSION_ID. The orchestrator never performs hop work inline; it dispatches the hop and reads its receipt.
- Motivation travels: `next_choice.why` goes verbatim to the next hop as `rhetoric`.
- Choose the next node by project fit and diversity. Never label edges forward or backward to the agent.
- Back-verify: traversal is unfinished until earlier applied nodes that a later change may affect are re-checked.
- Each confirmed node-only row is `prd-add`ed at once, never batched to the end of the hop. A hop with zero rows logged 15 minutes after its heartbeat start stops and returns a receipt: surfaces scanned, candidates checked, rows logged (0), reason.
- A hop creates PRDs; it never executes its own. Duplicate outcome rows (`outcome-hop-*`, `cpu-hop-outcome-*`) are merged into the base row, never added.
- The receipt names an executed witness (a command, a crawl result, a codesearch output). A receipt without one is refused.
- Instructions to agents: ultra-compact, meaning intact.

Receipt (120 words max):
```
VERDICT: HOLDS | VIOLATED | NOT-APPLICABLE
PRINCIPLE: <id>; SURFACE: <path>; WITNESS: <audit dispatch id>
CHANGED: <file, dispatch id> | none
ROWS: <n>: <ids>
NEED: <one sentence>
next: <id>; depth=<n+1> | none, <reason>
```
