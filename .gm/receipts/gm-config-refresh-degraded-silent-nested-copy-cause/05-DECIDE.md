# DECIDE - gm-config-refresh-degraded-silent-nested-copy-cause

Checked against the row's words, not the diff.

"a second copy inside the checkout that refresh reads instead of the top-level one" -- CONFIRMED
live: the served text for c:/dev/gm is byte-prefixed by C:/dev/gm/.gm/instructions/entry.md
(22192 chars) and not by the top-level .gm/config-source-cache-default/prose/entry.md (27435).

"so a served-rule edit lands in a file nothing reads" -- CONFIRMED live: SENTINEL-R133-TOPFILE
written into the top-level file is absent from the served text, while the same-shaped probe in a
root with no vendored copy (arm D) IS served. The edit target is inert iff
.gm/instructions/<key>.md exists and .gm/instructions/.vendored.json does not record it as an
unedited snapshot (prose.rs:141-146, prose.rs:162).

"the nested copy reported at .gm/config-source-cache-default/.gm/config-source-cache-default" --
NOT the live cause and not reachable with the current code: normalize_project_root
(config.rs:426-447) cuts any root sitting inside /.gm/config-source-cache*, and it is applied on
every path that computes a cache dir (config.rs:636, config.rs:675, config_sync_native.rs:50).
Live: a dispatch whose cwd is inside the cache (1791669926560-1-1738c0b98a7c975e) created no
nested cache; the .gm directory it did create holds only dream-rsi, exec-spool and
last-dispatch-ts. Recorded as a stated assumption in 06-COMPLETE.

Degradation is silent because the instruction reply reports degraded=false on this path:
tier1 answers Outcome::LocalOverride, which resolve_with_degradation (prose.rs:102-112) maps to
None.
