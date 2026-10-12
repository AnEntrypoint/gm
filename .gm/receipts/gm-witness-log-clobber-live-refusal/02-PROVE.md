# 02-PROVE — gm-witness-log-clobber-live-refusal

Precondition: the running guest is built from rs-plugkit 732a4a83 or later.

- `health` (cwd c:/dev/gm, dispatch 1791670466112-500-e17cfcd4cf34acd3):
  `version: 0.1.1572`, `crate_version: 0.1.1572`,
  `source_sha: 75472e5623dd7bd3d995802e793f90be791ae626`,
  `loaded_module_is_compiled_version_above_not_project_pin: true`,
  `project_gm_json_pinned_version: 0.1.1290`.
- `fetch https://api.github.com/repos/AnEntrypoint/rs-plugkit/compare/732a4a83...75472e5623dd7bd3d995802e793f90be791ae626`
  (dispatch 1791670533431-500-93a33d9b9e21ad, status 200):
  `"status":"ahead", "ahead_by":13, "behind_by":0, "total_commits":13`,
  `merge_base.sha = 732a4a834413`. The 13 include `3b44f34e0fde` (the wasm build fix for
  this guard) and touch `crates/plugkit-core/src/wasm_dispatch/verbs.rs`.
  => the running guest's source is a strict descendant of 732a4a83. PRECONDITION HOLDS.

Invariant: `fs_write` on a `/.gm/witness-log.md` path never reaches `host_write`.
Observed in the refusal text itself: "A whole-file write here is never served".

Postcondition (live, whole-file writes to
`.gm/witness-out/witness-log-clobber-r156/.gm/witness-log.md`, 102 bytes on disk,
sha256 `0999613b88a081dfe8314fca29dd5bc2c91a183dc3fd0de03372b147c644cc6e`):

| # | session | offered | dispatch_id | error_code | bytes_on_disk | bytes_offered | shrinks |
|---|---------|---------|-------------|------------|---------------|---------------|---------|
| A | orch-main-r156 | 412 (create) | 1791670527172-500-f8c000239819e46c | append_only_rewrite_refused | 0 | 412 | false |
| B | orch-main-r156 | 8 | 1791670632551-500-63f40f813e8a26b4 | append_only_shrink_refused | 102 | 8 | true |
| C | orch-main-r156 | 10 | 1791670656359-500-21ee293a6005aa10 | append_only_shrink_refused | 102 | 10 | true |
| D | orch-main-r156-sub1 | 13 | 1791670802578-500-ec5be7a376558c19 | append_only_shrink_refused | 102 | 13 | true |

Byte-identity after every refusal: `fs_read` returns the same verbatim line and
`exec_js` sha256 stays `0999613b...cc6e` at 102 bytes (before 1791670605734, after
1791670675917, sub1 before 1791670782477, sub1 after <next>). The real
`C:/dev/gm/.gm/witness-log.md` was never written: 7780 bytes,
sha256 `b980b5ac9299197ef0303e8fb1b5c3c916535c7f9a68061e42e4df936b922fab`.

Note on my own expected line for dispatch B: I predicted `bytes_offered=9` and observed
8 -- my count of `"clobber\n"` was off by one, not the guest. Dispatch C re-ran with an
exactly-counted 10-byte payload and matched; dispatch D re-ran under a second session at
13 bytes and matched. POSTCONDITION HOLDS.
