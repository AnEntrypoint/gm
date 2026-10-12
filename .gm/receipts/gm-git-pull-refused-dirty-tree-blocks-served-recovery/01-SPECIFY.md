# 01 SPECIFY — gm-git-pull-refused-dirty-tree-blocks-served-recovery

Row: "gm `git_pull` refuses while tracked files are dirty (`.gm/prd.yml`, `skills/gm-orchestrate/SKILL.md`,
`skills/gm-prd/SKILL.md`), so an already-committed fix cannot be pushed and the served recovery (pull then
push) is unreachable. Acceptance: the served recovery path ends with the committed sha pushed -- either a
pull that does not require a clean tree, or a recovery that names the clean-tree step first."

Cited lines checked against the tree, not assumed:

- The three named files are c:/dev/gm lanes' dirt at the time the row was filed. None of them is the site of
  the refusal; they are the dirt that triggers it. Dirt owned by another lane cannot be cleaned by the lane
  that needs the push, which is why the acceptance allows a pull that tolerates dirt outside the incoming
  range.
- `git_pull` carries no clean-tree gate of its own. The refusal text observed live
  ("Your local changes to the following files would be overwritten by merge … Aborting",
  dispatch `1791673161682-1-a4a6bb4c80ab41b6`) is git's, not plugkit's, and it fires only over paths the
  merge would overwrite.
- The unreachable path is the served recovery: `pull_and_repush_remote_moved` (git.rs ~2772, reached from
  git.rs:1562). Its early return `!dirty.trim().is_empty() && !dirty_split.submodule_only()` refused before
  any pull, over all dirt, so "pull then push" could not run at all.

Acceptance restated as two sufficient branches, both to be delivered:

1. a pull that does not require a clean tree (refuse only where the incoming range touches local dirt);
2. otherwise, a refusal whose first recovery step names the clean-tree step over exactly those paths.

Unknowns at SPECIFY: whether the daemon's loaded wasm would carry the change this session (build lag), and
whether the clashing-path refusal arm would occur live. Both are recorded as mutables, not assumed.
