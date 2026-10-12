# RES - gm-config-refresh-degraded-silent-nested-copy-cause

Failure modes hit and handled, each by a live run:

1. fs_write {append:true} overwrote the target instead of appending (dispatch
   1791668912403-500-b9a7c8925e29fdec left prose/entry.md at 27 bytes). Detected by a fresh
   dispatch whose served hash did not move; repaired with git_checkout {paths:[prose/entry.md]}
   run with cwd inside the cache (dispatch 1791669130481-0-3015b30ccbdc9c92) and verified
   byte-identical to gm-config's copy. Mitigation for the rest of the run: append through exec_js.

2. A dispatch with mode=investigate_readonly serves a mode-specific wrapper, not the entry prose
   (hash 0ed1df06a6ba3938), so it cannot be compared against the on-disk copies. Mitigation: the
   comparison arms dispatch the plain full-prose surface with no mode.

3. Emptying the top-level file is not a valid sentinel arm: read_clean (prose.rs:294) returns None
   for empty text, so the tier falls through regardless. Mitigation: the probe is an appended
   sentinel, never a truncation.

4. A witness run under the row owner's own SESSION_ID is refused as a self-witness. Mitigation:
   the closing witness ran under session orch-main-r133-wit.

5. Probe residue left in a shared cache would poison every other lane's served prose. Mitigation:
   restore verified byte-identical (27412, 835c26e72da2a304), scratch dir removed.

Partial failure: if the restore had failed, the row would have been left open and a blocker row
filed naming the poisoned path; it did not fail.
