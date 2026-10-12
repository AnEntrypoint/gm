# 03 EMIT — gm-git-pull-refused-dirty-tree-blocks-served-recovery

## Change

`rs-plugkit/crates/plugkit-core/src/wasm_dispatch/verbs/git.rs`:

1. `pull_and_repush_remote_moved` no longer refuses on a dirty tree. It fetched
   `origin/<branch>`, then ran `pull_past_remote_moved`, whose own clash test already refuses
   only over `incoming_changed_paths(cwd, branch) ∩ local_dirty_paths(cwd)`. The blanket
   `!dirty.trim().is_empty() && !dirty_split.submodule_only()` early return is deleted, so dirt
   outside the incoming range no longer blocks the pull (acceptance branch 1: a pull that does
   not require a clean tree).
2. The clash computation moved into one definition, `pull_clashing_paths(cwd, branch)`, called
   by both `pull_past_remote_moved` (decision) and the refusal arms (reporting). No second copy.
3. `RemoteMovedPull::Blocked` and `RemoteMovedPull::Failed` arms now emit
   `clashing_paths` plus an ordered `recovery_steps` array whose step 1 is the clean-tree step
   (`git_status {"paths":[...]}` over exactly the clashing paths, commit or revert each in the
   lane owning it) and step 2 is `git_push {"rev":"HEAD"}`. `next_action_hint` now leads with
   that same clean-tree step (acceptance branch 2).
4. The `Landed` arm reports `dirty_before_pull` and `clash_free_pull`, so a pull that landed on
   a dirty tree is visible in the receipt instead of being inferred.

`skills/gm-prd/SKILL.md` Delivery rule now names the clean-tree step first, so a lane hitting
`remote_moved` on a dirty tree is instructed to clean its own paths before re-pushing even
before the rebuilt plugin lands.

## Witness expectations, written before the dispatches

- W-C `git_push {cwd:"C:/dev/gm/scratch-r180-wt", rev:"HEAD"}` on a detached worktree at
  `75472e56` (one commit behind `origin/main` `d549b578`) with `git.rs` dirty -- the row's own
  shape: an already-committed fix that cannot be pushed because the tree is dirty. Expected on a
  build carrying this change: `remote_moved:true`, `recovered:false`,
  `auto_recovery.clashing_paths == ["crates/plugkit-core/src/wasm_dispatch/verbs/git.rs"]`,
  `auto_recovery.recovery_steps[0].verb == "git_status"` with those paths (clean-tree step first),
  `recovery_steps[1].verb == "git_push"`. Expected on the pre-fix build: the blanket
  `skipped_reason` "worktree or index is not clean" with no `recovery_steps`. The two replies are
  distinguishable, so this one dispatch identifies which build the live daemon is running.
- W-D after the clean-tree step is taken (restore `git.rs` to its committed content so the clash
  empties), the same `git_push {rev:"HEAD"}` is expected to pull and republish: `recovered:true`,
  `pulled_to == "d549b578..."`, `repushed:true` -- the served recovery ending with the committed
  sha pushed.

- W-A `git_finalize {cwd:"C:/dev/gm/rs-plugkit", paths:["crates/plugkit-core/src/wasm_dispatch/verbs/git.rs"]}`
  expects `ok:true`, a new commit authored by lanmower whose parent is `75472e5623dd7bd3d995802e793f90be791ae626`,
  and the push landing; if `remote_moved` fires instead, the refusal must carry
  `auto_recovery.recovery_steps[0].verb == "git_status"` (pre-fix build: the blanket
  `skipped_reason` with no `recovery_steps`).
- W-B `git_finalize {cwd:"C:/dev/gm", paths:[<rs-plugkit pointer>, "skills/gm-prd/SKILL.md"]}`
  expects `ok:true` and the committed sha published; a `remote_moved` refusal on this tree
  (40 dirty paths owned by other lanes) is the row's symptom reproduced live.
