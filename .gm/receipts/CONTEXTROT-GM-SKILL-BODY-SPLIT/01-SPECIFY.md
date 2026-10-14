# SPECIFY: CONTEXTROT-GM-SKILL-BODY-SPLIT (session gm-drain-w1-54)

Row: split skills/gm/SKILL.md so a trigger loads only the section it needs.
Acceptance (row witness): (a) SKILL.md body bytes well below 28 KB; (b) each moved section reachable from the header by a named reference; (c) a gm trigger in a live dispatch still returns the routing instruction.

Stale-check against tree:
- Row cites 28,466 B. Live fs_stat skills/gm/SKILL.md = 22,588 B (dispatch 1791957373403-500-bc63b8e6c4af3da4). The cited baseline is stale; the split is partly landed.
- Header line 10 names docs/rationale.md, docs/verbs.md, spool-adapter.md, gm-orchestrate, gm-hop, gm-prd as references (Read of SKILL.md lines 1-60).
- Section files exist: skills/gm/docs/verbs.md (67,655 B), skills/gm/docs/rationale.md, skills/gm/spool-adapter.md (codesearch dispatch 1791957380960-500-928305d51026e661).
- git_status on the four paths: clean, branch main, head 4f15e356cd0b658c769cbf07786c9f6ea9daeb67 (dispatch 1791957423454-500-7b3ca1654e3ecf1d).
- Row file .gm/prd/<id>.yml is not present on disk; prd-list {"id"} reads it (dispatch 1791957369143-500-cfd187f57ce65fd5).

ACH (row asserts a cause: body size drives context rot):
- H1 (leader): SKILL.md body size above what a trigger needs; the remaining bulk is reachable through named references, so the split is complete and only the witness needs to bind. Evidence: fs_stat 22,588 B; header references present.
- H2: SKILL.md still carries large per-verb grammars that must move before rot is cut. Evidence: verb grammars already live in docs/verbs.md (line 22 onward); SKILL.md has no per-verb tables in the heading inventory (codesearch dispatch 1791957380960-500-928305d51026e661).
- Cells: H1 consistent with all evidence (C); H2 contradicted by the heading inventory (I for H2 on the verb-grammar claim).
- Leader: H1. Probe: fs_stat size plus live instruction dispatch (below). A probe that does not separate H1 from H2 would be a blocker; here H2 is refuted by the heading inventory, so the probe separates.

Open question recorded: "well below 28 KB" is not numeric. Default stated: a drop of more than 5 KB (22,588 is 5,878 B below 28,466, 20.6 percent). Recorded as a stated default, not a mutable.
