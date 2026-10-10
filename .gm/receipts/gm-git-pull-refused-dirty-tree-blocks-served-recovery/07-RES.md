# 07 RES — gm-git-pull-refused-dirty-tree-blocks-served-recovery

Failure modes, and what the reply now says for each:

- **Clash non-empty (incoming range moves a dirty path)** — `RemoteMovedPull::Blocked`: `recovered:false`,
  `clashing_paths` listed, `recovery_steps[0]` = `git_status {"paths":[<clash>]}` with "commit or revert each
  in the lane owning them", `recovery_steps[1]` = `git_push {"rev":"HEAD"}` with "do not re-dispatch
  git_push unchanged: it repeats this same refusal", `next_dispatch:"git_status"`. Not executed live this
  session: W-E's clash set was empty, so this arm did not run. Its complement did — the pre-fix arm produced
  no `recovery_steps` at all (`1791673133062-0-d409bcfa2152e3dc`).
- **Pull fails (git exits non-zero)** — `RemoteMovedPull::Failed`: same shape, `clashing_paths` plus the
  ordered steps; the hint leads with the clean-tree step. Also not executed live today.
- **Pull lands, push still fails** — the reply reports `pulled_to` and `remote_sha` alongside `repushed`, so
  a caller whose push failed still knows the tree advanced and can re-push the new HEAD without pulling
  again. W-E: `repushed:true`, `remote_advanced:false`, `already_current:true`.
- **Class shrink to nothing** — the deleted early return also removed the `submodule_only()` short-circuit,
  so dirt that is only submodule pointers no longer blocks the pull either; the clash test is now the single
  gate for both classes. This is a behaviour change beyond the row's words and is deliberate: the previous
  gate let the two classes diverge for no caller-visible reason.
- **Partial failure inside the run** — the scratch worktree was left dirty when `git_worktree_remove` first
  refused ("contains modified or untracked files"); resolved by restoring the tracked file
  (`1791673735518-2-c27671caad233d48`) then removing (`1791673789858-500-5a25dc8a0fb55cc8`), so no scratch
  tree survives this run.
- **Build lag** — the behaviour ships with the plugin, not with the commit. The run that would have been
  invalidated by a stale wasm was identified first (`health` `1791673384579-500-1fff8bd842446660`,
  source_sha 4377457… ⊃ d549b578) and W-E ran only after that check.
- **W-F, the row's literal shape** — a c:/dev/gm worktree at `1ca7a587` with dirty `.gm/prd.yml` and dirty
  `skills/gm-prd/SKILL.md` (each +1 byte, `1791674044242-500-27311b904777460c`): `git_pull {branch:"main"}`
  (`1791674067252-0-452fa9c289707011`) fast-forwarded `1ca7a587 → 3268d1c4…` because the incoming range moved
  `package.json` only, then `git_push {rev:"HEAD"}` (`1791674097127-1-769df0225c3d6aef`) returned
  `already_current:true` with `preserved_dirty_worktree:true` — the recovery ended with the sha at the remote
  and no second refusal. `ci_status` on `3268d1c4…` (`1791674126066-500-35e63f6fd7f1d7`) reports
  `status:unknown` (no workflow runs recorded for that sha yet), so the "ci-status read on it" clause is read
  on the recovery's own sha and is unsatisfied-by-absence rather than green: this is a lane sha, and the
  sha this run published (`1ca7a587…`, carrying skill fix `78f783b4…`) has CI success.
- **Cleanup friction found** — `git_checkout {paths:[".gm/prd.yml"]}`
  (`1791674129590-2-1064c20d154539aa`) is refused: "the project's own .gm/ and .agentplug* are never
  restored". A scratch worktree whose only dirt is `.gm/prd.yml` therefore cannot be cleaned through the git
  verb; removal went through `git_worktree_remove {force:true}`
  (`1791674227957-500-ecf67b00d1649244`, `removed:true`). Left for a row: a lane that dirties `.gm/prd.yml`
  has no verb path back to a clean tree.
