# 16-DECIDE: JTBD-SPEND-VISIBILITY

Status: pending. Row NOT resolved. COMPLETE (17) not reached.

Reason: the acceptance is "per-walk spend split by phase". The script delivers dispatch count and median wall time per phase, but the phase source is absent: every dispatch in the records is "(no phase reported)". The witness above shows one bucket. Closing on that would overstate the row.

Witness: bash dispatch 1791820458835-500-52c4a6e909b42edf (session gm-track-SPEND), exit 0, output in 11-EMIT.md. Self-witness: cannot close this row; a witness from another session is required.

Open, filed: JTBD-SPEND-VISIBILITY-blocker-gm-track-SPEND (phase per dispatch); GM-MCP-LOG-DISPATCH-END-REPEAT-SUPPRESSED (gm-mcp/src/server-log.js); mutable JTBD-SPEND-PHASE-SOURCE.

Delivery: scripts/walk-spend.mjs and receipts 09 to 16 committed locally on main with explicit paths, not pushed (owner instruction: do not push). No pin or submodule change.
