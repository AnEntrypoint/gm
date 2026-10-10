# PROVE - gm-config-refresh-degraded-silent-nested-copy-cause

Precondition: a gm daemon serves prose for a project root; the top-level cache copy is
<root>/.gm/config-source-cache-default/prose/entry.md.
Invariant under test: the served entry prose is byte-prefixed by the copy that wins.
Postcondition: exactly one on-disk copy prefixes the served text, and it is named path:line.

Arm A baseline (dispatch 1791668714605-500-7e00e8830a1483a8): c:/dev/gm served instruction_hash
bd99536acc0f8d3b, fsm_graph.path C:/dev/gm/.gm/config-source-cache-default/fsm/graph.json.

Arm C (dispatch 1791668991927-500-74394b49e1d4496d): with the top-level cache file emptied, the
served hash was unchanged -- the top-level file is not re-read, but the empty-file case is
confounded (read_clean returns None on empty, prose.rs:294) so it is not the decisive arm.

Arm D control (dispatch 1791669394130-3-117a2632b0f43cc2): scratch root
C:/dev/gm-scratch-r133-nested, same cache tree copied in, prose/entry.md ending with
SENTINEL-R133-SCRATCH, no .gm/instructions/entry.md present. Served text (27930 chars) CARRIES
the sentinel => tier2 does read <root>/.gm/config-source-cache-default/prose/entry.md
(prose.rs:397-427) when tier1 falls through.

Arm G decisive (dispatch 1791669767756-500-b18c06acddb2fd8f): sentinel SENTINEL-R133-TOPFILE
written into C:/dev/gm/.gm/config-source-cache-default/prose/entry.md (27412 -> 27435, dispatch
1791669672553-500-639c5002be35cddc). Served text 22941 chars does NOT carry it.

Arm H comparison (dispatch 1791669857425-500-66ad35ddea571eba, 1791669866479-500-5775eee05b1b59e7):
servedStartsWithVendored=true (.gm/instructions/entry.md, 22192), servedStartsWithCache=false
(27435), cacheHasSentinel=true, servedHasSentinel=false.

Arm I nested reproduction (dispatch 1791669926560-1-1738c0b98a7c975e): config_resolve with cwd
INSIDE the cache resolved tier implicit_default_repo, degraded false, and created no nested cache
(dispatch 1791669937336-2-50a3271343350610 lists only dream-rsi, exec-spool, last-dispatch-ts).
normalize_project_root (config.rs:426-447) cuts a root inside /.gm/config-source-cache*; it is
applied at config.rs:636, config.rs:675 and config_sync_native.rs:50.

Witness (session orch-main-r133-wit, dispatch 1791670064399-500-82db4a51e134d29a, exit 0):
RESULT: PASS served entry prose is prefixed by .gm/instructions/entry.md (22192 chars) and not by
.ggm/config-source-cache-default/prose/entry.md (27435 chars); sentinel in served=false sentinel
in cache=true servedLen=22941.

VERDICT (the copy that won, path:line):
C:/dev/gm/.gm/instructions/entry.md, read by tier1_project_vendored at
rs-plugkit/crates/plugkit-core/src/prose.rs:154 and answered at
rs-plugkit/crates/plugkit-core/src/prose.rs:163, first in the tier loop at prose.rs:194-198.
It wins because .gm/instructions/.vendored.json is absent (fs_readdir dispatch
1791669768612-500-e22c3a5d2458be4f: complete.md, entry.md, fsm, gates, hooks, residual), so
is_unedited_snapshot (prose.rs:141-146) returns false and the tier never falls through to tier2.
