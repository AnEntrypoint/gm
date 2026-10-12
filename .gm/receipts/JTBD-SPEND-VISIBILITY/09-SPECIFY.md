# 09-SPECIFY: JTBD-SPEND-VISIBILITY (session gm-track-SPEND)

Row (prd-list {"id"}, dispatch 1791820089416-500-8cb3e8b7190afd19): "Job: see what a walk cost in tokens and dispatches". Done when: one verb reports per-walk spend split by phase and by re-entered phase, read from recorded dispatches.

Owner decision (this session, binding): per-walk spend is measured from gm's own records, not transcripts. Report dispatch count and wall time per phase, joined on dispatch id, from the gm spool records and the gm-mcp server log. Owned file: scripts/walk-spend.mjs only.

Cited lines: none in the row. Checked against the tree:
- Spool out records: /config/gm/.gm/exec-spool/out/<verb>-<session>-<pid>-<ms>-<seq>.json, each with dispatch_id (2271 files; all parse; all carry verb and dispatch_id).
- Server log: /config/.gm-tools/gm-mcp-server.log, dispatch-start/dispatch-end events with verb, ms, inflight; no dispatch id, no session. Writer: gm-mcp/src/server-log.js (appendDiagnostic).
- Prior run receipts 01-SPECIFY, 02-PROVE, 08-DECIDE (session gm-drain-JTBD-SPEND-VISIBILITY) stopped at a decision point on the token source. Owner chose the dispatch-count and wall-time scope above; those receipts are kept as they are (create-only).

Unknowns, recorded: phase per dispatch (mutable JTBD-SPEND-PHASE-SOURCE); server-log loss (blocker row GM-MCP-LOG-DISPATCH-END-REPEAT-SUPPRESSED).

Successor: PROVE.
