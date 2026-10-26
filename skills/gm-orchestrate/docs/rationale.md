# gm-orchestrate: rationale

Why the rules in `skills/gm-orchestrate/SKILL.md` are shaped the way they are. The rules are imperatives there; this file keeps the reasons. Dated measurements behind them are in `docs/verified-incidents.md`.

## Terms and floor
- The ceiling is found by launching because the harness's refusal text is the only source of truth; a constant drifts as the platform changes.
- Local HEAD lags remote main constantly, so a "modified" blob is compared against remote before a lane stands down.
- The floor is `min(2, ceiling)` because the refill floor in the runtime (`rs-plugkit/crates/plugkit-core/src/orchestrator/pool_slots/mod.rs`, capped by `rs-plugkit/crates/plugkit-core/src/orchestrator/pool_slots/floor.rs`) cannot exceed the ceiling.
- A dip is judged as a mean across ticks, because a single-tick reading hides the time spent under the floor.

## Node-to-node payloads
- Forward-only payloads hide the backreference exits. Those exits are how a walk re-enters ground an earlier hop changed, so both kinds are kept.
- A link carries no direction or edge kind on purpose: a hop must not be able to tell a re-entry from an advance.
- Graph counts in the file are hand-written and go stale, so counts are always derived, never copied.

## Starvation and the serial lane
- The state and git lanes run one dispatch at a time per project. A waiting push can hold every later commit, so pushes are kept to one per wave.
- A starved verb is re-dispatched byte-identical because the lane keys its place on the body hash; any change puts the verb at the back.
- The network-yield window exists so a push waiting behind a checkout-bound verb does not block the whole lane for minutes; it does not allow a second writer.
- Admission holds are leases (60 s), because a single blocked push once held a third of the process-wide admission band.

## Drains
- A resumed agent can re-drop, because resuming re-establishes the connection that was killed. Back-pressure therefore applies to resumes too.
- One drain is one event, so the count of record is read once after the window and not decremented per notification.

## Heartbeats and emission
- The `.live` file is the only way to de-duplicate a wave; without it two lanes can write the same surface.
- Emission is checked from the directory, not from receipts, because a receipt can claim an emission that never happened.

## Shared work tree and publish
- Lanes share one work tree on `main` because a second tree (worktree, side branch) would need a consolidation merge that writes back into the tree every other lane is editing.
- The Git API route exists because a local push in a shared tree is refused while any sibling holds a dirty path; the API route publishes the tip without touching the local index.
- A refused local push is reported as redundant, because the content is usually already published by a sibling. Calling it unpushed would prompt a reset that erases other lanes' commits.
- Bake re-generation is in the same commit as the source edit, because a later commit that moves the code again hides the failure from every hop after the first.

## Skill edits
- Skills are installed as junctions or symlinks, so an edit is live on the next dispatch; an edit made during a merge is discarded silently by the merge resolution.

## Moved out of SKILL.md during the trim
- Lane single-writer: the git lane admits one writer at a time; the network yield never passes the RUNNING holder.
- The git-lane publish carries every ancestor commit, so pushing the tip once is enough.
- Admission band is process-wide: a waiting git verb may be waiting on other projects' traffic, not its own lane.
- Walk workers are never forks because a fork inherits the parent conversation and breaks SESSION_ID isolation.
- A shortfall is a log event, not a PRD row, so `prd_pending_count` is unchanged by it.

## Headroom probes
- Windows: `Get-CimInstance Win32_Processor` (LoadPercentage) and `Get-CimInstance Win32_OperatingSystem` (FreePhysicalMemory).
- Linux: the `id` column of `vmstat 1 2` (idle, so CPU use is 100 minus it) and `MemAvailable` in `/proc/meminfo`.

## Headroom
- Headroom checks use CPU and free memory because launched agents consume both (browsers and runners); the thresholds are the ones the skill states, not a measured optimum.
- A headroom stop does not end the turn, because it is a resource condition, not a finished walk.
