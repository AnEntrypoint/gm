# 01-SPECIFY — gm-witness-log-clobber-live-refusal

Row (as assigned by the orchestrator, session orch-main-r156):
"against a guest built from `732a4a83` or later, a whole-file `fs_write` of a path
ending in `/.gm/witness-log.md` is refused with `error_code append_only_shrink_refused`
naming `bytes_on_disk` and `bytes_offered`, and the file is byte-identical afterwards."

## SPECIFY checks against the tree (live, this session)

- Row id absent from `C:/dev/gm/.gm/prd.yml`: `prd-list {"id":"gm-witness-log-clobber-live-refusal"}`
  -> `no PRD row with id gm-witness-log-clobber-live-refusal of the 234 rows in .gm/prd.yml`
  (dispatch 1791670416894-500-4b118794ecca944d). Row is filed by `prd-add` in this run;
  the acceptance text used is the orchestrator's, verbatim.
- `732a4a83` does not resolve in C:/dev/gm (`git_show` -> `git_show_rev_unresolved`) and
  resolves in `C:/dev/gm/rs-plugkit`: commit 732a4a83441352a0800f10e1d2f541d22c016ccb,
  "Merge branch 'main' of https://github.com/AnEntrypoint/rs-plugkit", 2026-10-10T21:42:24Z.
  So the "guest built from" threshold is an rs-plugkit commit, not a c:/dev/gm one.
- Guard source, located by `codesearch literal "append_only_shrink_refused"`
  (dispatch 1791670393826-500-d4b3b690c726cc6c):
  `rs-plugkit/crates/plugkit-core/src/wasm_dispatch/verbs.rs:207`
  `pub const ERR_CODE_APPEND_ONLY_SHRINK: &str = "append_only_shrink_refused";`
  plus `rs-plugkit/CHANGELOG.md` and `.../instructions/prose/entry.md`.
- Pre-existing resolved sibling row `gm-witness-log-clobber` (receipts dir, 09-COMPLETE.md)
  records the earlier fix; this row is its live-refusal witness, not a re-implementation.

## Scope decision

Guard is already shipped in the running guest (PROVE). No source edit, no commit of
source. This run is `mode=witness`: SPECIFY, PROVE, DECIDE, COMPLETE.
