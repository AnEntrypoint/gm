# COMPLETE - gm-config-refresh-degraded-silent-nested-copy-cause

CAUSE (named path:line): C:/dev/gm/.gm/instructions/entry.md is served by tier1_project_vendored
(rs-plugkit/crates/plugkit-core/src/prose.rs:154, answered at prose.rs:163, tier loop
prose.rs:194-198) because .gm/instructions/.vendored.json is absent, so is_unedited_snapshot
(prose.rs:141-146) reports the file as edited. tier2 never reads
<root>/.gm/config-source-cache-default/prose/entry.md for this root, so every prose edit shipped
to gm-config is silently inert here while the reply still reports degraded=false.

Witness binding: dispatch 1791670064399-500-82db4a51e134d29a (session orch-main-r133-wit,
exit 0, RESULT: PASS), appended to .gm/witness-log.md (dispatch
1791670093171-500-7254b008f4855a5c).

STATED ASSUMPTION (the clause code cannot close): the literal artifact
.gm/config-source-cache-default/.gm/config-source-cache-default cannot be produced by the current
code -- normalize_project_root (config.rs:426-447) cuts such a root before any cache dir is
computed, on all three call sites. It is therefore attributed to a build predating that guard
(hypothesis (b), a clone issued with cwd inside the cache), and the clause is recorded as
assumed, not reproduced: the guard is the fix already in place, and a re-appearance would mean a
call site computing a cache dir without it.

Follow-up row filed in c:/dev/gm: gm-config-vendored-prose-shadows-config-cache -- the live cause
found here, still open as a defect (a vendored .gm/instructions/<key>.md with no .vendored.json
shadows gm-config for its whole project).

Parent: gm-config-refresh-degraded-silent is closed by this cause plus the assumption above.
