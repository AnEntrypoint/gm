---
name: gm-orchestrate
description: "Main-thread pool loop for a gm walk that has advertised PRD rows or hops: fans out as many parallel graph workflows as the work allows, refills slots, and exits only at zero pending rows. Invoke only from gm; do not load directly. Hop rules are in gm-hop, PRD-row rules in gm-prd."
---

# gm-orchestrate

Pool and publish rules. Shared rules (autonomy, git identity, CI read, collisions, exit): gm. Recovery: `docs/recovery.md`. Incidents: `docs/incidents.md`.

`ceiling` = host spawn limit (N in a refusal), not a throughput target or memory budget. `live` = ListAgents count. `floor` = min(2, ceiling). `shortfall` = live < floor with independent work open.

## Core loop
Repeat until a full pass adds no work:
1. **Roll out.** One parallel pass, file-owned slices, each lane published once. Nothing built locally.
2. **Fix.** Fixes follow the rollout they repair. Each broken run becomes a fix handoff to a fresh executor.
   - Sweep first: one subagent per failing job log, changed file group, stub/TODO. Each returns located `path:line` and counts only; each finding becomes a row. Fix only after the sweep completes.
   - One fix executor per independent file group, one block; fixes sharing a file run in sequence in one executor. One commit per group, never per finding.
3. **Plan.** End each pass with `prd-add` rows (file ownership, acceptance).
4. Repeat from 1.

Node traversal (gm-hop; `skills/dream-rsi/gm-graph.json`) feeds step 3 only when `prd-list {"status":"pending"}` = 0 for the pass. It never interrupts rollout or fix.

## Parallelism: graph workflows
- Fan-out unit: a `Workflow` graph. As many as open work needs; parallel where independent, sequential where a result feeds the next.
- One wave per run; a run never loops over waves. A run takes at most 60 pending rows, resolves them with `gm-prd` agents (restart on connectivity error, at most 3 times), returns `{pending_before, resolved, blocked, failed, new_blockers}` and ends. `pending_after > pending_before` halts new blockers until a merge pass closes duplicates.
- A run never exceeds 150 agents. Cap-hit or stalled runs are reported, never relaunched unchanged.
- Three graphs, each run to exhaustion:
  1. Row drain: `pipeline` over pending rows, one `gm-prd` per row, a `parallel` block per wave; until pending = 0.
  2. Traversal: `pipeline` over every principle node in `skills/dream-rsi/gm-graph.json`, one `gm-hop` per node per surface, emitting rows; until every node has a receipt per surface.
  3. Audit: a completeness critic; findings become rows for graph 1.
- Drain before make. Pending ≥ 20: graph 1 takes every free slot. Pending < 20: graph 2 takes free slots (computer-science disciplines first) until pending reaches 20.
- Repeat 1-3 until a full cycle adds and resolves nothing. A wave resolving 0 rows with pending rows left is a stall: change the brief, rerun. Never stop on a stall alone.
- Ceiling, floor and Lane budget bound live subagents. Refill a freed slot in the same turn.

## Write first, fix later
- A lane writes its full slice in one pass, publishes once, moves on. Correctness comes from CI logs in a later pass, never mid-write checks.
- No `cargo`, `go build`, `go vet`, `go test`, witness runs or local compile unless the user turns builds on. The lane reads `ci-status` for its sha on landing. A failing sha becomes a fix slice, never a pause.
- Writers are light; Lane budget bounds heavy lanes (builds, witness runs), not writers. Many writers may run when each owns separate files.
- File ownership before launch: each brief names its files. Two lanes never write one file. A shared manifest has one owner; others add only their own directory.
- Contracts before code: a producer publishes its contract doc as its own commit first; the consumer reads it from remote `main`.
- Use maintained libraries under permissive licences for solved problems. Pick the simplest correct path a lane finishes in one pass. Split a module across lanes only at a file boundary in the brief.
- Rewrites of published history: once, at the end, after every lane lands.

## Run ledger
- `.gm/pool/runs.jsonl`: one JSON line per run, append-only; the last line per `run` id is its state.
- Fields: `run` (`<parent>-<kind><k>`), `kind` (`exec`, `verify`, `ci`, `fix`, `hop`), `row` or `surface`, `sha` (full, when known), `state` (`launched`, `handoff`, `verified`, `ci-green`, `ci-red`, `fix`, `blocked`, `done`, `stale`), `session`, `started`, `updated` (UTC ISO-8601).
- Every transition writes its line in the same turn. Never rely on a lane's own log for state.
- Each tick, before `pool-observe`: outstanding = last state not `done`, `blocked`, `stale`. Closable only when `verify` is `verified` and `ci` is `ci-green` for the same `sha`.
- Reconcile: outstanding `ci` run → `ci-status {sha}` replaces its conclusion. `exec`/`verify` run whose `.gm/pool/<session>.live` is older than 5 minutes → `stale`, relaunch its row fresh; never count stale as live.
- A `handoff` with no following `verify` or `ci` run is a defect: spawn the missing lane this tick.
- Summaries (outstanding, closable, stale, red) are derived each tick, never stored.

## Verification and CI lanes
- Executor ends `STATUS: handoff <sha>`. Orchestrator spawns, same turn, outside the executor: verifier (`gm-validate` as `mode=witness`, session `<parent>-v<k>`, a session other than the executor's) and CI reader (`gm-publish` steps 3-5, session `<parent>-c<k>`).
- `STATUS: fix` (verifier) or `STATUS: ci-red` (CI reader) → fresh executor for the same row with the sha and failing check or job. Takes a slot; never inline.
- Only the orchestrator calls `prd-resolve`, once verifier and CI reader both report green for the same sha. Log each lane result to `.gm/witness-log.md` with its session id.
- Verification and CI never block the pool.

## Floor and dip
- Pending rows open: keep live ≥ floor. Pass ListAgents count as `body.live` on every `pool-observe` and `transition`.
- `floor_gate_denied` (live < floor, `open_rows > 0`) is the launch signal, never a retry.
- Live under ceiling with independent work open is a shortfall: log `FAILURE: <UTC> live=<n> pending=<m>` to `.gm/witness-log.md`, then launch to target this turn. Causes:
  1. Lane stopped: one successor per freed slot, never batched. Session killed: relaunch `.gm/pool/<session>.next` or a pending row.
  2. Lane stood down on a modified file: compare the blob with remote `main` first; no comparison, take another slice.
  3. Browser or GPU lock held: run node-only and non-GPU work meanwhile.
  4. `Prompt is too long`: relaunch compact (row, surface, session, one action). Never resume.

## Tick
1. `pool-observe {live, held}`. Take `slots.launch` (node-first, max 32). Empty under shortfall is a defect row.
2. Launch one block, up to ceiling. Rows: `Skill(skill="gm-prd", args="row=<id>; session=<SID>")`. Hops: `Skill(skill="gm-hop", args='{"node":{...},"principle":"<id>","surface":"<path>","session":"<SID>","wave":"<wave>","depth":1,"rhetoric":""}')`. `<SID>` = `<parent>-<k>`, unique. A cause-asserting row or hop runs its ACH step (gm-hop 3a, gm-prd SPECIFY) in the same launch.
3. Log `launch <id>` to `.gm/pool/ledger-<wave>.txt`, a `launched` line to `.gm/pool/runs.jsonl`, `tick <n> event=<id> live=<count> <UTC>` to `.gm/witness-log.md`.
4. `wait {"ms":60000}`. Each `done <id>` refills its slot this turn. Re-count live after each launch and completion.

Launch only advertised ids. A slot stays empty only when no pending row and no untraversed node remain.

## Hop payloads
- A hop is an edge: nominate FROM its node TO a neighbour in `node.links`.
- Read `skills/dream-rsi/gm-graph.json` at launch. Never take counts from `node_count` or `edge_count`.
- `node`: `id`, `label`, `book`, `author`, `kind` from `nodes[]`. `advocate` = `"<author> - <book>"`, or bare `book` when `author` is `unattributed`.
- `links`: one `{to, guards}` per `edges[]` entry with `from` = `node.id`, both kinds, sorted by `to`. `guards = []` when `condition` is null, else `[condition]`.
- `to` not in `nodes[]`: skip; `prd-add` `gm-graph-dangling-edge-<from>-<to>`. `links: []` still launches; receipt says `next: none`. Zero links on launch is a derivation defect.
- Receipt `next:` outside `links`: log `nomination-not-from-links`; `prd-add` `gm-hop-nomination-not-from-links-<from>-<to>`.
- Witnesses are CI witnesses: the row's pushed sha, read through `ci-status`. A row needing a local compile is written with its CI run as witness.

## Refill and successors
- Each completion refills one slot this turn from `slots.candidates`. Blocker rows are never candidates; a worker ending at a blocker nominates a node-only successor.
- A hop spawns its own successor; the orchestrator spawns one only when a hop returns `next: none`.
- Candidates empty with rows pending: `prd-list {status:"pending", limit:<n>}`; log the empty list as a defect row.
- Rows resolve faster than the pool refills: pause row-creating hops. Row supply low: run row-creating hops before more resolvers.
- Each completed hop writes `.gm/lean-walk/<node.id>.json`. Missing: `prd-add` `gm-lean-walk-node-emission-missing-<session>`; not counted walked. Count of record is `emitted`.

## Heartbeat
- Every brief first writes `.gm/pool/<session>.live` (`session`, `row`, `start` ISO-8601 UTC; a hop's `row` is its surface path) and deletes it on finish. A surface-only heartbeat is `malformed_heartbeats`.
- Skip any id held by a live row before launch. Older than 5 minutes = stale.

## Shortfall and FAILURE
- Two restarts per walk. Repeated shortfall means these rules are wrong: dispatch `instruction`, correct this skill, restart at tick 1.
- A third repeat files `<row>-blocker-<session>` and launches the blocker next wave.

## Never leave a row open
- A run ends as `prd-resolve` with a witness, or as blocked. Stalls, blocked workers, refused witnesses and ended sessions never close the walk.
- Every gm call in every brief passes `cwd: "C:/dev/gm"` (or the row's project root). A call without `cwd` reads another project: "row not found" or "pending 0" from a brief is a wrong-project defect, not a blocker. Re-check with `cwd` before any blocker is filed.
- A resolver runs every stage of its row in its one run (orient through publish, then prd-resolve). Stopping after one stage with the row open is a defect: re-dispatch the same row once as `<session>-r<n>` naming the stage reached, never a fresh orient.
- A blocked row keeps its id and names `blocked_by: <fact and verb>` in its text. File a new blocker row only when no open row names that fact. Counts are unique open rows.
- Blockers launch next wave. A blocker that blocks again is split until one step remains; that step runs. No blocker-of-blocker past one level.
- Convergence guard: pending rows rise two waves running → no new blockers; run only open blockers and rows until the count falls.
- A worker returning with no receipt or blocker is re-dispatched once per wave as `<session>-r<n>`. A connectivity-stopped worker is restarted (Connectivity restarts).
- `floor_gate_denied` on `prd-resolve` or phase advance: pass `body.live` and launch the denial's `slots.launch`.

## Starvation
- `pool-observe` dropped at 120 s with `dispatch_starved_waiting_for_serial_lane`: re-dispatch once, verbatim (never `resume_task`). First read `.gm/exec-spool/.dispatch-wait.json`: position 1 or holder near budget → re-dispatch now; behind a fresh holder → wait; not shrinking → slow holder.
- Commit ahead of push: wait. A push that waited out its budget keeps its place; re-dispatch once.
- `dispatch_orphaned` on a read-only verb: re-dispatch at once. Before re-dispatching `git_commit`, `git_finalize`, `git_push` or `fs_write`, re-read real state.
- Never preempt an executing holder. Never delete a `.live` file to free a slot.
- Two starvations of one git verb: `prd-add` the paths and both dispatch ids, then stop git dispatches until a completion drains the queue.

## Connectivity restarts
- A subagent stopped by `ECONNRESET`, `ECONNREFUSED`, `server_error`, timeout or no response is restarted, never resumed, never a blocker. Fresh subagent, same row, session `<session>-r<n>`, same turn. Row stays open; slot stays held; never count it live.
- `wait {"ms":30000}` between attempts while the error repeats. Log `restart <row> <n> <UTC>` to `.gm/witness-log.md`.
- Mass drop: `docs/recovery.md`, "Mass API-error drain".

## Headroom and leases
- Pressure (Lane budget signals) lowers the heavy-lane target and pauses heavy launches until the probe clears. Log cause, real count, UTC; a pause does not end the turn. Back off on the first pressure sample.
- Rows needing an exclusive lock wait; the pool launches the rest. A timed-out lock wait is a failed run.
- One browser or GPU arm at a time, pool-wide; `gpulock` serialises the adapter only. One browser arm plus one node-only lane is fine; two browser arms are not. Lease held: take node-only work; never open a second browser.
- Browsers are headful (`headless: false`). Each run closes its own; never touch the user's Chrome.
- EADDRINUSE: the witness did not run. Identify the owning process. Never kill another lane's process.
- Browser-last, cold-start, reload budgets, focused jit tests: gm-prd, Witness economy.

## Lane budget (anti-thrashing)
- Two failure modes, opposite remedies. A dropped link (Connectivity restarts) → RESTART the lane; lowering concurrency to stop a drop idles the pool. Machine thrash (unresponsive host, memory pressure, lanes parked on a lease) → RUN LESS AT ONCE; restarting into thrash makes it worse. A concurrency cap is never the answer to a drop; a restart is never the answer to thrash.
- Heavy lanes (local build or witness run) are the controlled variable. `ceiling` (20) is a host refusal limit.
  - Controller: start at target 2 heavy lanes. Every 3 minutes take one probe sample. A window with no pressure and at least one lane waiting for a slot raises target by 1, up to `ceiling`. Any pressure sample lowers it by 1 at once and blocks raising for 10 minutes. Target never exceeds what the probe has held.
  - Pressure: free RAM under 2048 MB; commit charge over 90%; disk queue length over 2 for 30 s; CPU over 90% for 60 s while lanes wait; or a lane waiting on a lease over 10 minutes. A connectivity drop is never pressure. Only the probe decides.
  - Probe (Windows): `Get-CimInstance Win32_OperatingSystem` for `FreePhysicalMemory` and `FreeVirtualMemory`/`TotalVirtualMemorySize`; `Get-Counter '\PhysicalDisk(_Total)\Current Disk Queue Length','\Processor(_Total)\% Processor Time' -SampleInterval 1 -MaxSamples 3`. Other platforms: equivalent counters, same five signals.
  - Record every change and sample to `.gm/pool/concurrency-curve.txt` (UTC, target, live, free MB, commit %, disk queue, CPU). Best level = held longest without pressure.
- Writers are not heavy: launch freely under Write first, fix later.
- Thrash is answered by fewer simultaneous lanes, never slower lanes: no stretched slices, added waits or serialized independent work. Over budget: let slots drain rather than launch.
- A mass `ECONNRESET` drain is environmental: never present a lane-count ceiling as the remedy; restart the lanes on the same row.
- Publish on the first passing witness: time-box a lane to its witness, resolve, publish, keep going.

## Fan-out
- Independent slices (file, row, hop) launch in one block. Slices sharing a surface run in turn.
- Walk workers are gm-prd or gm-hop, never a fork. Each brief opens with the brick-wall opener and its own SESSION_ID (gm §1).
- Verify a brief's source path (`codesearch {mode:"filename"}`) before launch. A wrong path is a blocked slot.
- `gm_processor_capacity` queues dispatches beyond it; it is not the subagent count.

## Shared-tree publish
One work tree, one git lane. Main only; no worktree, side branch or scratch checkout (gm, Autonomy).
- No extra checkouts. Clean base for measurement or bisect: `git archive` (gm, READ questions).
- Publish via the Git API: POST blobs; tree with `base_tree: <remote tip>`; commit parented on that tip; PATCH `refs/heads/main`, `force` unset; re-read each blob at `?ref=main` and verify it.
- `git_finalize` refusing to push over a sibling's dirty path is redundant when its content is already published. Never reset `refs/heads/main` under running lanes.
- `remote_moved` on a dirty tree: `git_status {"paths":[...]}`, commit or revert each path in its owning lane, then `git_push {rev:"<sha>"}`.
- `remote_moved` plus conflicted `git_pull` (`conflicted: true`, `MERGE_HEAD` present): `git_merge_abort`, then `git_reset {ref:"origin/main", mode:"mixed"}` (local commit stays in reflog, files stay in the work tree); reapply each lane path on current state; then `git_finalize {message, paths}` for those paths only. Confirm with `git_remote` and `ci-status`.
- Collision and commit identity: gm, Autonomy.

## Editing the skills
Skills under `skills/` are live on the next dispatch. Check `.git/MERGE_HEAD` first. Publish path-scoped, push the full sha, then `ci-status`. Steps: `docs/recovery.md`, "Editing the skills".
