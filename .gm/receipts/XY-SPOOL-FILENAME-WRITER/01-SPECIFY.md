# 01 SPECIFY -- XY-SPOOL-FILENAME-WRITER

Row: "check: non-conforming spool filenames are answered, not prevented -- find the writer".
Stated request (commit 5b0c8db): a quarantined non-conforming spool request is answered spool_filename_rejected instead of dropped silently.
Acceptance: list the names of every quarantined request in .gm/exec-spool over recent runs and identify the client that wrote each.
Witness asked for: the grouped list of writers with their counts.

Lines cited against the tree (all present, none stale):
- agentplug/crates/agentplug-runner/src/daemon/claim_dispatch.rs:1145 sweep_unconsumable_spool_files(root) -- rename to in-quarantine/<verb>__<name>, answer spool_filename_rejected.
- is_spool_request_path tests the extension only (txt or the verb language extension), while the served error text claims a <session-id>-<local-counter> name shape.
- daemon.rs:3348 (orphan-recovery branch) and daemon.rs:3437 (cold_sweep_pending walk over every known root).
- main.rs:138-150 CLI sweep-spool <root>.
- gm-mcp/src/dispatch.js publishSpoolRequest stages .${task}.${process.pid}.${Date.now()}.tmp inside inDir.
- skills/gm/spool-adapter.md:15,17 -- the hand-written rule that told agents to stage a sibling temp inside in/<verb>/.

Unknowns: none left open; the sweep trigger (found during PROVE) was the one surprise and is recorded in 02.