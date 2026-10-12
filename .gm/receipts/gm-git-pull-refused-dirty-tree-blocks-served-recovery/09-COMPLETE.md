# 09 COMPLETE — gm-git-pull-refused-dirty-tree-blocks-served-recovery

STATUS: resolved. Acceptance met, both branches implemented, branch 1 witnessed live against the shipped
build.

ROW: `gm-git-pull-refused-dirty-tree-blocks-served-recovery`

FILES
- `rs-plugkit/crates/plugkit-core/src/wasm_dispatch/verbs/git.rs` — blanket dirty-tree early return deleted
  from `pull_and_repush_remote_moved`; `pull_clashing_paths(cwd, branch)` is the single clash definition used
  by both the decision (`pull_past_remote_moved`) and the refusal arms; `RemoteMovedPull::Blocked` and
  `::Failed` now emit `clashing_paths` + `recovery_steps` (step 1 `git_status {"paths":[<clash>]}`, step 2
  `git_push {"rev":"HEAD"}`) and lead `next_action_hint` with the clean-tree step; `Landed` gained
  `dirty_before_pull` and `clash_free_pull`.
- `skills/gm-prd/SKILL.md` line 24 — Delivery rule now names the clean-tree step first.

WITNESS
- Pre-fix repro `1791673133062-0-d409bcfa2152e3dc`: `ok:false`, blanket `skipped_reason`, no `recovery_steps`.
- `git_pull` on the same dirty tree `1791673161682-1-a4a6bb4c80ab41b6`: git aborts, recovery unreachable.
- Clean-tree step then push, pre-fix build `1791673225662-3-dfecb6c73a820c01`: `recovered:true`,
  `pulled_to:4377457…`, `repushed:true`.
- Fixed build (crate 0.1.1573, `source_sha 4377457…` ⊃ `d549b578`), dirty tree, no clash
  `1791673664092-1-7cf6c3a97c70f0e9`: `recovered:true`, `dirty_before_pull:true`, `clash_free_pull:true`,
  `pull_via:ff_only`, `pulled_to:437745777ace733d767f1312790440e32e59c283`, `repushed:true`,
  `preserved_dirty_worktree:true`. State set by `1791673591728-500-2049734431b6174b`, confirmed by
  `1791673612321-0-a04f5909b3e1fb17`; build identified by `1791673384579-500-1fff8bd842446660`.
- Witness line appended to `.gm/witness-log.md`, utc 2026-10-10T23:09:51Z. No test files written; the two
  scratch worktrees were removed (`1791673789858-500-5a25dc8a0fb55cc8`).

MUTABLES
- Closed: whether the recovery can pull a dirty tree (yes, unless the incoming range touches the dirty path);
  whether the live daemon yet runs a build containing `d549b578` (yes, crate 0.1.1573 / source_sha 4377457).
- Open, not a blocker: the `Blocked`/`Failed` arms carrying `recovery_steps` were not executed live today
  (W-E's clash set was empty); their content is verified by reading the tree, and their complement (a
  step-less refusal) is the pre-fix behaviour recorded in W-C.

DELIVERY
- rs-plugkit `d549b57808c83d3f4f93c88cd1843889a1cecf47`, pushed, CI success on `native-check` (run
  38093248213), `publish / plan`, `publish / bump`, `publish / release`.
- c:/dev/gm `78f783b482746c3ec94b369f6dbf328cdc8f3de1` + merge `1ca7a587f1482dc305b8c23ace260159b1134da9`,
  pushed, `remote_sha: 1ca7a587f1482dc305b8c23ace260159b1134da9`; `skill-release / release` success,
  `doc-drift / scan` pending.
