# 12-STATE: JTBD-SPEND-VISIBILITY

Replay: the script only reads the spool out directory and the server log. Running it twice gives the same output (verified by the witness plus the earlier identical runs for gm-goal-1 at four tolerances). Writes nothing.

State owned: none by the script. Rows added by this run: JTBD-SPEND-VISIBILITY-blocker-gm-track-SPEND (phase source), GM-MCP-LOG-DISPATCH-END-REPEAT-SUPPRESSED (log loss, file gm-mcp/src/server-log.js:7-9,31-37). Mutable added: JTBD-SPEND-PHASE-SOURCE.
