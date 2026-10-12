# 15-RES: JTBD-SPEND-VISIBILITY

Failure modes run live:
- Spool directory absent: prints SKIP line naming GM_SPOOL_OUT, exit 0. Run, verified.
- Session with no records: prints zero counts, exit 0. Run, verified (no-such-session).
- Server log absent: prints NOTE line, wall time shown as n/a. Code path present; not run live (log exists).
- Malformed spool JSON: file skipped silently. Code path only; no malformed file to exercise.

Partial failure, measured: the server log loses wall times. repeat-suppressed events on dispatch-end total 1251 against 561 written, so about 69 percent of dispatch-end events are dropped (cause: gm-mcp/src/server-log.js admitRecord, 60 s repeat window keyed on verb). Consequence: the median covers only the unsuppressed dispatches (34 of 72 for gm-goal-1). Reported as blocker row GM-MCP-LOG-DISPATCH-END-REPEAT-SUPPRESSED; the script does not hide it, it prints the joined count.

Phase partial failure: every dispatch is in "(no phase reported)" because all phase-status replies are session_mismatch. Reported as blocker row JTBD-SPEND-VISIBILITY-blocker-gm-track-SPEND.
