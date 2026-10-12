# SPECIFY - gm-config-refresh-degraded-silent-nested-copy-cause

Row (c:/dev/spoint PRD, open clause of gm-config-refresh-degraded-silent, filed by orch-main-r107):
find the cause of the silent degradation -- a nested copy of the config/prose tree (a second copy
inside the checkout that refresh reads instead of the top-level one), so a served-rule edit lands
in a file nothing reads.

Acceptance: reproduce the nested copy in a scratch project with a dispatch id cited in
.gm/witness-log.md, OR show the artifact unreachable with the current code and record the clause
as a stated assumption; then prd-resolve gm-config-refresh-degraded-silent.

Contract re-derived from the row's own words (not from the diff):
- probe = live execution only: write a sentinel into the TOP-LEVEL file, dispatch the refresh that
  serves it, observe whether the served text carries the sentinel;
- then locate the copy that won and name it path:line.

Cited lines checked against the tree, all present and none stale:
- rs-plugkit/crates/plugkit-core/src/prose.rs:154-167 tier1_project_vendored
- rs-plugkit/crates/plugkit-core/src/prose.rs:163 LocalOverride answer
- rs-plugkit/crates/plugkit-core/src/prose.rs:169-182 tier2_in_project_repo
- rs-plugkit/crates/plugkit-core/src/prose.rs:194-198 tier loop, tier1 first
- rs-plugkit/crates/plugkit-core/src/prose.rs:397-427 read_from_cache_root
- rs-plugkit/crates/plugkit-core/src/config.rs:426-447 normalize_project_root
- rs-plugkit/crates/plugkit-core/src/config_sync_native.rs:48-57 ensure_default_cache

Unknowns: none left open as mutables; the one unprovable clause (the literal nested path) is
recorded as a stated assumption in 06-COMPLETE.
