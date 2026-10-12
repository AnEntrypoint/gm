# 02 PROVE — gm-git-pull-refused-dirty-tree-blocks-served-recovery

- **Precondition**: a repo whose local HEAD is behind `origin/<branch>`, and a tracked file that is dirty.
  Constructed as a detached rs-plugkit worktree at `d549b578` (1 behind origin) with
  `crates/plugkit-core/src/wasm_dispatch/verbs/git.rs` dirtied by one appended byte
  (`1791673591728-500-2049734431b6174b`), state confirmed `1791673612321-0-a04f5909b3e1fb17`
  (branch HEAD, head_sha d549b578, modified 1, staged 0, untracked 0).
- **Invariant**: a pull must never clobber uncommitted work. Preserved by refusing on
  `incoming_changed_paths(cwd, branch) ∩ local_dirty_paths(cwd)`, never on dirt alone. W-E reports
  `preserved_dirty_worktree:true` and the pull touched only `crates/plugkit-core/Cargo.toml`.
- **Postcondition**: the committed sha is at the remote and the worktree dirt survives. W-E
  (`1791673664092-1-7cf6c3a97c70f0e9`): `pulled_to:437745777ace733d767f1312790440e32e59c283`,
  `repushed:true`, `remote_sha:437745777ace733d767f1312790440e32e59c283`,
  `preserved_dirty_worktree:true`, `dirty_before_pull:true`, `clash_free_pull:true`.

Runs:

| arm | binary | result |
| --- | --- | --- |
| dirty tree, behind origin | pre-fix | refused, blanket `skipped_reason`, `recovered:false` (`1791673133062-0-d409bcfa2152e3dc`) |
| `git_pull` on the same tree | pre-fix | git aborts, recovery unreachable (`1791673161682-1-a4a6bb4c80ab41b6`) |
| clean-tree step, then push | pre-fix | `recovered:true`, `pulled_to:4377457…`, `repushed:true` (`1791673225662-3-dfecb6c73a820c01`) |
| dirty tree, behind origin | 0.1.1573, `source_sha 4377457…` ⊃ `d549b578` | `recovered:true` with the tree still dirty (`1791673664092-1-7cf6c3a97c70f0e9`) |

The last two arms are the same request through two binaries; only the fixed one reaches the postcondition
without the clean-tree step. Build identity established by `health`
(`1791673384579-500-1fff8bd842446660`, crate 0.1.1573, source_sha 437745777ace733d767f1312790440e32e59c283).
