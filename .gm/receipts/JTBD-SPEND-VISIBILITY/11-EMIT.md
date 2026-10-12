# 11-EMIT: JTBD-SPEND-VISIBILITY

Change: scripts/walk-spend.mjs (new, the only file written). Usage: node scripts/walk-spend.mjs <session_id>. Env: GM_SPOOL_OUT, GM_MCP_LOG, GM_JOIN_TOL_MS.

Join rule as built: a spool record joins to a log dispatch-end with the same verb whose implied start (end ts minus ms) lies within the tolerance of the record's file-name ms stamp. The file-name ms equals the server's dispatch-start clock; dispatch_id's own prefix runs up to about 4 s later, so it is not used for timing.

Witness, live through the gm bash verb, dispatch 1791820458835-500-52c4a6e909b42edf (session gm-track-SPEND), exit 0:

    session: gm-goal-1
    spool records: 72   joined to server log: 34   tolerance: 1500 ms
    phase                      entries  dispatches     timed  median_wall_ms
    (no phase reported)              0          72        34            1061
    TOTAL                            0          72        34            1061

Other live runs (not witnessed by dispatch): gm-track-SPEND 5 records, 2 timed, median 6923 ms; gm-goal-hop-CHARTEST-1 34 records, 3 timed, median 307 ms; gm-track-1 53 records, 21 timed, median 959 ms.

Absent-input branch exercised live: GM_SPOOL_OUT=/nonexistent prints "SKIP: spool out directory ... nothing counted", exit 0.
Phase branch: not exercised with a non-mismatched phase (none exists in the records); the code path is present but unverified live.
