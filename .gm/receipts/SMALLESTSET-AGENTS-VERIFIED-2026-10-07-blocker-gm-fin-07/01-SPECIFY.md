# SPECIFY: SMALLESTSET-AGENTS-VERIFIED-2026-10-07-blocker-gm-fin-07

Session: gm-drain-w2-415. Row: blocker filed by gm-fin-07 (subject: cited AGENTS.md lines 216-223 do not exist).

Acceptance: the cited line range must hold the Verified 2026-10-07 plugkit load-path block, or the row must close with a witness that the target is stale.

ACH (gm-config/prose/ach.md):
- H1 (leader): the cited block is absent from AGENTS.md; the row targets stale text. Evidence: codesearch literal "Verified 2026-10-07" over AGENTS.md, dispatch 1791965726230-500-e3af96feaf7af12b, exhaustive true, 0 matches in 134 lines. Prior witness 1791892638232-500-ee9bcfd7dd9e5581 (hit only docs/verified-incidents.md:123). Predicts: 0 hits in AGENTS.md. Cell: C.
- H2: the block exists under another heading in AGENTS.md. Evidence: codesearch "plugkit load" over docs/verified-incidents.md returned 0 hits (dispatch 1791965730812-500-1a407e00e8fd12bb), and the AGENTS.md scan above is exhaustive. Cell: I (refuted).
- H3: the block is in docs/verified-incidents.md lines 123-129 and the row is misaddressed. Evidence: prior witness 1791892638232-500-ee9bcfd7dd9e5581. Cell: C (true, but this is a re-scope, not a closure of the stated row).

Leader: H1. Probe: the exhaustive AGENTS.md scan above. The probe separates H1 from H2 (H2 predicted a hit in AGENTS.md, and there is none).

Decision (default, stated): the row's stated target is absent, so it is closed as obsolete. The re-scope to docs/verified-incidents.md is filed as a new row, not applied to this one, because it changes the target and the compaction it asks for is a separate edit.
