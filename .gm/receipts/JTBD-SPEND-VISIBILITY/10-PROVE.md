# 10-PROVE: JTBD-SPEND-VISIBILITY

Precondition: spool out records and a server log exist and join. HOLDS. Spool: 2271 records, all parse. Log: 561 dispatch-end lines, readable. Join check: gm-goal-1 at tolerance 50, 300, 1500 and 10000 ms gives the same 34 of 72 joins, so matches are exact, not coincidental.

Precondition for the per-phase split: each dispatch is attributable to a phase. FAILED. All 31 phase-status replies on record carry session_mismatch:true: the walk state is owned by a live lease (gm-docs-skills-1), so no reported phase belongs to the requesting session. The one instruction reply with a phase line is a single record. Result: every dispatch lands in "(no phase reported)".

Invariant: a dispatch counted once, and a wall time taken only from a matched dispatch-end. HOLDS (count from spool files; time from matched log lines only; unmatched shown as untimed, never as zero).

Postcondition: script prints, per phase, entries, dispatches, timed, median wall ms. HOLDS for the shape; phase split is degenerate (one bucket) as stated above.
