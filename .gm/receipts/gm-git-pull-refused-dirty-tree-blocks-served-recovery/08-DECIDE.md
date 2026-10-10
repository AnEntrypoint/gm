# 08 DECIDE — gm-git-pull-refused-dirty-tree-blocks-served-recovery

Row's words, checked against the receipts and the live runs, not against the diff.

Row: "gm `git_pull` refuses while tracked files are dirty (`.gm/prd.yml`, `skills/gm-orchestrate/SKILL.md`,
`skills/gm-prd/SKILL.md`), so an already-committed fix cannot be pushed and the served recovery (pull then
push) is unreachable. Acceptance: the served recovery path ends with the committed sha pushed -- either a
pull that does not require a clean tree, or a recovery that names the clean-tree step first."

## Where the refusal actually lives

Not in `git_pull`. `git_pull` has no clean-tree gate of its own; on a dirty tree git itself aborts
("Your local changes to the following files would be overwritten by merge"), which is correct and is not
what this row is about. The unreachable path was `pull_and_repush_remote_moved` (git.rs ~2772, reached from
git.rs:1562), whose blanket early return refused whenever ANY tracked file was dirty, before any pull was
attempted and regardless of whether the incoming range touched that file. That is what made "pull then
push" unreachable for an already-committed fix sitting behind a dirty tree.

## Live runs

| run | binary | body | observed | dispatch |
| --- | --- | --- | --- | --- |
| W-C | pre-fix (blanket gate) | `git_push {rev:"HEAD"}` on a rs-plugkit worktree at `75472e56` (behind origin) with `git.rs` dirty | `remote_moved:true`, `recovered:false`, `ok:false`, blanket `skipped_reason` "worktree or index is not clean, so a pull could clobber uncommitted changes -- refusing exactly as before. Dirty tracked files: crates/plugkit-core/src/wasm_dispatch/verbs/git.rs.", `dirty_submodule_only:false`, **no `recovery_steps`** | `1791673133062-0-d409bcfa2152e3dc` |
| W-C2 | pre-fix | `git_pull {branch:"main"}` on the same dirty worktree | `error_code:failed`, git's own "Your local changes … would be overwritten by merge … Aborting": the served recovery is unreachable while dirty, exactly the row's symptom | `1791673161682-1-a4a6bb4c80ab41b6` |
| W-D | pre-fix, after the clean-tree step (`git_checkout {paths:[git.rs]}`) | `git_push {rev:"HEAD"}` | `recovered:true`, `pull_via:"ff_only"`, `strict_fast_forward:true`, `pulled_to:"437745777ace733d767f1312790440e32e59c283"`, `repushed:true`, `incoming_commits` = [`d549b578…`, `4377457…`] | `1791673225662-3-dfecb6c73a820c01` |
| W-E | **0.1.1573, source_sha `4377457` ⊃ `d549b578`** | worktree at `d549b578`, `git.rs` dirty (one appended byte, `1791673591728-500-2049734431b6174b`; state confirmed `1791673612321-0-a04f5909b3e1fb17`), `git_push {rev:"HEAD"}` | `recovered:true`, `dirty_before_pull:true`, `clash_free_pull:true`, `pull_via:"ff_only"`, `pulled_to:"4377457…"`, `repushed:true`, `preserved_dirty_worktree:true`, `remote_sha:"4377457…"` | `1791673664092-1-7cf6c3a97c70f0e9` |
| W-F | same fixed build | **the row's literal shape**: c:/dev/gm worktree at `1ca7a587`, dirty `.gm/prd.yml` + dirty `skills/gm-prd/SKILL.md` (one appended byte each, `1791674044242-500-27311b904777460c`), served recovery run verbatim — `git_pull {branch:"main"}` then `git_push {rev:"HEAD"}` | pull `ok:true`, `head_before 1ca7a587` → `head_after 3268d1c48eda321a6eb53c0446277c73623f5a1b` (fast-forward; incoming moved `package.json` only, so no clash with either dirty path); push `ok:true`, `already_current:true`, "Everything up-to-date", `preserved_dirty_worktree:true`, `remote_sha 3268d1c4…` — the run ended with the sha at the remote, no second refusal; `ci_status` on that sha (`1791674126066-500-35e63f6fd7f1d7`) `status:unknown`, no runs recorded for it yet | `1791674067252-0-452fa9c289707011`, `1791674097127-1-769df0225c3d6aef` |

W-E is the acceptance, met on a dirty tree: the incoming range was one commit touching
`crates/plugkit-core/Cargo.toml`, so the clash set was empty, the pull ran under `--ff-only`, HEAD reached
`4377457` and the push completed with the worktree dirt still in place. The same request through the
pre-fix binary (W-C) is refused with no steps to follow. Same shape, two binaries, opposite outcomes.

## Acceptance, branch by branch

1. **A pull that does not require a clean tree** — implemented (the blanket early return is deleted;
   `pull_past_remote_moved`'s clash test is now the only gate) and **witnessed live** by W-E, with the two
   new `Landed` fields `dirty_before_pull:true` / `clash_free_pull:true` making the dirty-tree pull visible
   in the receipt instead of inferable.
2. **A recovery that names the clean-tree step first** — implemented: `RemoteMovedPull::Blocked` and
   `::Failed` now emit `clashing_paths` plus `recovery_steps` whose step 1 is
   `git_status {"paths":[<clash>]}` (commit or revert each in the lane named by `live_lane_markers`) and
   step 2 is `git_push {rev:"HEAD"}`, with the same sentence as `next_action_hint`. **Not executed live
   today**: W-E's clash set was empty, so both arms that carry `recovery_steps` were skipped (W-E and W-F both had empty
   clash sets). What is
   witnessed is their complement — W-C shows the pre-fix arm producing no `recovery_steps` at all — and the
   shared `pull_clashing_paths` helper is the single definition both the decision and the reporting use, so
   the paths reported are the paths the gate decided on. Stated, not papered over.

## Delivery

- rs-plugkit `d549b57808c83d3f4f93c88cd1843889a1cecf47` pushed; CI **success** on all four jobs
  (`native-check` run 38093248213 is the compile gate, plus `publish / plan`, `publish / bump`,
  `publish / release`).
- c:/dev/gm `78f783b482746c3ec94b369f6dbf328cdc8f3de1` (skill Delivery rule) plus merge
  `1ca7a587f1482dc305b8c23ace260159b1134da9` pushed; `remote_sha: 1ca7a587…`; `skill-release / release`
  success (`skill-release / release` run 38093618388, `doc-drift / scan` run 38093618357).
- Build lag, closed: `health` (`1791673384579-500-1fff8bd842446660`) reports `crate_version 0.1.1573`,
  `source_sha 437745777ace733d767f1312790440e32e59c283`, a descendant of `d549b578`, so the wasm the live
  daemon loads carries the change. The sibling row's "ships on the next release build" gap does not apply
  to this one; W-E ran against that build.

## Verdict

Acceptance met. Branch 1 implemented and witnessed live on the shipped build (W-E vs W-C). Branch 2
implemented, live evidence limited to its complement (W-C's step-less refusal). No residual condition that
blocks the row: the unreachable recovery is reachable, and the committed sha is at the remote.
