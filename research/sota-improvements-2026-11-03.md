# SOTA improvements checked against gm-new, 2026-11-03

Source: the deep-research run wf_39a457d3-d90 (workflow deep-research, 19 sources, 69 claims, 25 verified by three votes: 8 confirmed, 17 refuted, 0 unverified, 101 agent calls, 0 errors). Each lever below was checked against gm-new's code, not the predecessor's, because the run mapped some levers onto the predecessor by mistake.

## Corrections to the run

- gm-new has no vector or RRF fusion. A grep of src for embed, vector, fts5 and rrf returns no match. The run said gm-new already has BM25 plus vector RRF; that came from the predecessor's configuration. gm-new's search is BM25 only.
- gm-new's gates use no model verdicts. A grep of src/gate.mjs for review and verdict returns no match. Finding 2 of the run is already in place.
- The commit gate runs ten checks in 608 ms on this checkout (run 2026-11-03-19-38-52-ff0729, actionSeq 15).

## Levers

1. Dependency-aware retrieval (medium confidence, vote 3-0 in the run). Witness: research/dep-recall/measure.cjs, run through run_code on gm-new src (run 2026-11-03-19-38-52-ff0729, actionSeq 104). Units are the 35 functions with cross-file callees; 15 duplicate names are excluded. Query is the function name. Plain search recall of callee-defining files: top 10 files 0.15, top 20 0.21, top 50 0.52. One-hop closure from the top 10 hits gives 0.97 when the anchors include the queried function, but that is partly by construction, since the queried function is one of its own anchors. With the queried function excluded from the anchors, closure gives 0.52 at about 5.2 extra files. Not adopted: the default search is unchanged. Open: natural-language queries and a file-budget-matched comparison (row unknown-dep-closure-natural).
2. Deterministic witnesses over model verifier approval (medium, 2-1). Already in place; see the corrections.
3. Fan-out gated on single-agent difficulty (medium, 2-1). The run found teams help only where a solo agent is weak. gm-new makes no model calls, so there is nothing to gate here. The contrary default is in the predecessor's AGENTS.md (its invariants 1 and 2, which keep every free slot draining rows). Changing that is the owner's decision and is not changed here.
4. Utility-based memory forgetting (medium, 2-1, self-reported). Not applicable: gm-new has no memory store to forget from. The predecessor's memory lives in its own memory directory.
5. Fusion tuning on a dependency-recall benchmark (low, 2-1). Not applicable yet: gm-new has no fusion knobs, and the tuning depends on lever 1.
6. Deterministic verifiers add little wall-clock time (medium, 2-1, one team, self-reported). The local witness is the 608 ms gate above.
7. Append-only memory extraction (low, 2-1, vendor blog). Not applicable: gm-new has no extraction step.

## Not evidenced

Token use per turn, CPU, RAM, SSD writes, debugging power and thrashing under parallel agents have no confirmed evidence. The run refuted, by vote alone and with no reasoning recorded, the MAST failure taxonomy claim (0-3), the CooperBench coordination penalty (0-3), the grep-versus-vector claim (0-3) and the Recall token claims (0-3). Those are excluded, not shown false, and the MAST and CooperBench claims bear directly on debugging and contention, so they need re-checking before anyone relies on either way.

## Decisions

- The search default is unchanged. Dependency closure is a candidate, to be built only after the natural-language witness beats plain search at a matched file budget.
- One open unknown row records that witness: unknown-dep-closure-natural.
- The fan-out default in the predecessor's AGENTS.md is left for the owner.
