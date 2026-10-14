# 02-PROVE: SPIKE-gm-goal-w3-SPIKE-1

Precondition: the row is pending in `.gm/prd/` (dispatch 1791959233844-500-96529961229e8193, count 1).

Leader probe (H1 vs H2 vs H3):
- Probe A, H2: regex `timebox|time-box|Time box|discards? the spike|spike.*discard` over `skills`. Dispatch 1791959318728-500-e38b1082168391b2. Result: 0 lines across 36 files. Note: the first pattern was an `|` alternation with a multi-term hint; a re-query `time.?box|discard|spike` over `skills/gm` (dispatch 1791959247620-500-debb6976ae0569e9) returned only two unrelated "discard" lines (git stash / merge text). H2 refuted.
- Probe B, H1 and H3: regex `time.?box|discard|throw away|timebox` over `gm-config` (dispatch 1791959311488-500-9e766a8e0fded2a6) returned `gm-config/prose/lean-p1.md:133` with "A spike is timeboxed to one exec_js dispatch and five minutes of wall clock" and "Spike code is never shipped", plus unrelated discard lines. H3 refuted (rule is not PRD-only).
- Literal `Time box` over the repo (dispatch 1791959261406-500-d269a19fd6b781a3): hits only in `.gm/prd-log.jsonl` (resolved SPIKE rows). Consistent with H1.

Leader: H1. The probe separates H1 from H2 (skills silent) and H3 (prose present outside the PRD log). Probe is not a blocker.

Exact text at `gm-config/prose/lean-p1.md:133` read directly (Read tool) to confirm the rule wording.
