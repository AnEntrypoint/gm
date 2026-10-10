# 05 CONC — gm-git-pull-refused-dirty-tree-blocks-served-recovery

Touched files:

- `rs-plugkit/crates/plugkit-core/src/wasm_dispatch/verbs/git.rs` — shared surface. The sibling row
  `gm-friction-git-pull-blocked-by-dirty-submodules` recorded that another lane's path-scoped commit of this
  file can carry my hunks with its own. This run committed it as
  `d549b57808c83d3f4f93c88cd1843889a1cecf47` (parent `75472e56…`, author lanmower) and pushed before any
  later lane could fold it into theirs; `git_log` (`1791673513525-500-14d19b8a4ad3578a`) shows the commit
  standing on its own with the intended subject.
- `skills/gm-prd/SKILL.md` line 24 — clobbered once by another lane between my edit and my commit (the file
  on disk reverted to the original Delivery sentence). Re-read, re-applied, and committed path-scoped
  immediately (`78f783b482746c3ec94b369f6dbf328cdc8f3de1`).
- `.gm/witness-log.md` — written by several lanes concurrently and guarded append-only. One line appended
  after re-reading the file (`1791673612321-0-a04f5909b3e1fb17` era read, utc 2026-10-10T23:09:51Z); the
  edit is an insertion after a unique anchor, so another lane's concurrent append cannot be lost and the
  file only grows.

Not touched: `.gm/prd.yml` (another lane owns it — row text says so; this run's only writes to PRD state go
through `prd-resolve`), `skills/gm-orchestrate/SKILL.md`, and every other lane's dirty path.

Concurrency evidence in the reply itself: the Blocked/Failed arms carry `live_lane_markers` so the caller is
pointed at the lane that owns the dirt instead of being told to clean a tree it does not own.
