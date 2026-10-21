# Pool worker

Heartbeat: write .gm/pool/<session>.live on start, delete it on finish. It holds exactly three lines:

    session: <session>
    row: <row id>
    start: <ISO-8601 UTC>

Pool observation reports a file missing any of these three keys as malformed. Refresh per worker-rules.md section 1.

Parameters: row <row>; session <session>; role <role>.

Standing rules: read .gm/config-source-cache-default/prose/worker-rules.md once, before the first step, and follow it for the whole run.
