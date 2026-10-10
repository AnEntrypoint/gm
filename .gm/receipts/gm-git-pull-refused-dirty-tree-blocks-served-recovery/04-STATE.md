# 04 STATE — gm-git-pull-refused-dirty-tree-blocks-served-recovery

State owned: none persisted. The decision is derived at call time from two reads of the tree —
`incoming_changed_paths(cwd, branch)` (after `git fetch origin <branch>`) and `local_dirty_paths(cwd)` — and
their intersection, computed in one place (`pull_clashing_paths`) so the paths the gate decided on and the
paths the refusal reports cannot diverge.

Replay: idempotent. Dirtying and restoring `git.rs` in the scratch worktree and re-dispatching reproduces
the same classification each time, because nothing outside the tree is consulted. After a landed pull the
second `git_push` is a no-op: W-E reports `already_current:true`, output "Everything up-to-date",
`remote_advanced:false`, `pushed_commits.count:0` — re-running the recovery does not re-pull or re-push.

The two new `Landed` fields exist so the state is visible rather than inferred: `dirty_before_pull` records
that the pull ran on a dirty tree, `clash_free_pull` records that the incoming range moved none of the dirty
paths. Both are read from the tree at that moment; neither is cached across dispatches.

Scratch state created by this run (two detached worktrees under C:/dev/gm) was removed:
`1791673789858-500-5a25dc8a0fb55cc8`. No `.gm/` state was added apart from receipts and one witness-log line.
