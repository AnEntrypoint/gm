---
name: gm-orchestrate
description: "Main-thread pool loop for a gm walk that has advertised PRD rows or hops: fans out as many parallel graph workflows as the work allows, refills slots, and exits only at zero pending rows. Invoke only from gm; do not load directly. Hop rules are in gm-hop, PRD-row rules in gm-prd."
---

# gm-orchestrate

Pool and publish rules. Rationale: `docs/rationale.md`. Incidents: `docs/incidents.md`. Recovery: `docs/recovery.md`.

## Terms
- `ceiling`: N in a spawn refusal, a HOST limit on agents; not a throughput target, not a memory budget. `live`: ListAgents count. `floor` = min(2, ceiling). `shortfall` = live < floor with independent work open.

## Core loop
Repeat until a full pass adds no work:
1. **Roll out.** Write all planned work in one parallel pass, file-owned slices, published once per lane. Nothing built locally; CI is the build. Never pause for CI; read each sha's CI when it lands.
2. **Fix.** Fixes follow the rollout they repair, never overlap it. Read the run ledger and CI results; each broken run becomes a fix handoff to a fresh executor.
   - Discover before fixing: one subagent per failing job log, changed file group, and stub/TODO the rollout reported. Each returns located `path:line` and counts only; each finding becomes a row. Fix only once the sweep is complete.
   - Fan out by file ownership: one fix executor per independent file group, launched in one block; fixes sharing a file run in sequence in one executor. Limits: Lane budget.
   - Batch per lane: one commit per file group after all its fixes; never per finding.
3. **Plan.** End each pass by writing next improvements as PRD rows (`prd-add`) with file ownership and acceptance.
4. Repeat from 1 with the new rows.

Node traversal (gm-hop; graph `skills/dream-rsi/gm-graph.json`) is the source of new rows. It runs only when rows are exhausted (`prd-list {"status":"pending"}` = 0 for the pass), feeds step 3, never interrupts rollout or fix. Receipts are rows and re-enter this loop.

## Parallelism: graph workflows
- Default fan-out unit: a graph workflow (`Workflow` tool). Use as many as the open work needs; parallel where independent, sequential where a result feeds the next.
- One wave per run; a run never loops over waves. Each run takes at most 60 pending rows, resolves them with `gm-prd` agents (restart on connectivity error, at most 3 times), returns `{pending_before, resolved, blocked, failed, new_blockers}` and ends. The caller starts the next run. `pending_after > pending_before` halts new blockers until a merge pass closes duplicates.
- A run never exceeds 150 agents. Cap-hit or stalled runs are reported, never relaunched unchanged.
- Three graphs, each run to exhaustion:
  1. Row drain: `pipeline` over pending rows, one `gm-prd` per row, a `parallel` block per wave; until `prd-list {"status":"pending"}` = 0.
  2. Traversal: `pipeline` over every principle node in `skills/dream-rsi/gm-graph.json`, one `gm-hop` per node per surface, emitting rows; until every node has a receipt per surface.
  3. Audit: a completeness critic lists what drain and traversal missed; findings become rows for graph 1.
- Priority: drain before make. Pending rows ≥ 20: graph 1 takes every free slot. Pending rows < 20: graph 2 takes free slots (computer-science disciplines first) until pending reaches 20.
- Each traversal subagent nominates its successor from its own outward links, handing a one-line rhetoric; never a node outside its links.
- Repeat graphs 1-3 until a full cycle adds and resolves nothing. Stop only then.
- A wave resolving 0 rows with pending rows left is a stall: change the brief, rerun. Never stop on a stall alone.
- Ceiling, floor and Lane budget bound live subagents. Launch to the machine budget; a freed slot refills the same turn.

## Write first, fix later
- A lane writes its full slice in one pass, publishes once, moves on. Correctness comes from CI logs in a later pass, never mid-write checks.
- No local building: no `cargo`, `go build`, `go vet`, `go test`, witness runs or any local compile unless the user turns builds on. Lane reads `ci-status` for its sha on landing; fixes from the log as a new commit.
- Don't wait on CI between pushes. A failing sha becomes a fix slice, never a pause.
- Publish once per lane; batch fixes into one push.
- Writers are light, builds heavy: the Lane budget bounds concurrent builds and heavy lanes, not writers. Many writers may run when each owns separate files.
- File ownership before launch: name each lane's files in its brief. Two lanes never write one file. A shared manifest has one owner; others add only their own directory.
- Contracts before code: a producer lane publishes its contract doc as its own commit first; the consumer reads it from remote `main` and uses it as written.
- Use maintained libraries for solved problems (codecs, parsers, runtimes) under permissive licences. Hand-port only what has no suitable library.
- Pick the simplest correct path a lane finishes in one pass. Split a module across lanes only at a file boundary already in the brief.
- Rewrites of published history happen once, at the end, after every lane lands. Never mid-stream.

## Run ledger
- `.gm/pool/runs.jsonl`, one JSON line per run, append-only; the last line per `run` id is its state.
- Fields: `run` (`<parent>-<kind><k>`), `kind` (`exec`, `verify`, `ci`, `fix`, `hop`), `row` or `surface`, `sha` (full, when known), `state` (`launched`, `handoff`, `verified`, `ci-green`, `ci-red`, `fix`, `blocked`, `done`, `stale`), `session`, `started`, `updated` (UTC ISO-8601).
- Every transition writes a line in the same turn. Never rely on a lane's own log for state.
- Read it every tick before `pool-observe`. Outstanding = last state not `done`, `blocked` or `stale`. A row is closable only when its `verify` is `verified` and its `ci` is `ci-green` for the same `sha`.
- Reconcile: for each outstanding `ci` run, `ci-status {sha}` replaces the ledger conclusion. For each `exec`/`verify` run whose heartbeat `.gm/pool/<session>.live` is older than 5 minutes: mark `stale`, relaunch its row as a fresh run; never count stale as live.
- Pairing: a `handoff` with no following `verify` or `ci` run is a defect; spawn the missing lane this tick.
- Summaries are derived each tick (outstanding, closable, stale, red), never stored.

## Verification and CI lanes
- Executor ends `STATUS: handoff <sha>`. Orchestrator spawns, in the same turn and neither inside the executor: a verifier (`gm-validate` as `mode=witness`, session `<parent>-v<k>`) and a CI reader (`gm-publish` steps 3-5, session `<parent>-c<k>`).
- The verifier runs in a session other than the executor's. The CI reader is light; the verifier is heavy only when its witness is a build or run.
- `STATUS: fix` from a verifier or `STATUS: ci-red` from a CI reader spawns a fresh executor for the same row with the sha and failing check or job. It takes a slot; never run inline.
- Only the orchestrator calls `prd-resolve`, once a verifier and a CI reader both report green for the same sha. Each lane result is logged to `.gm/witness-log.md` with its session id.
- Verification and CI never block the pool: the reader is spawned, the executor's slot refills.

## Floor
- Pending rows open: keep live ≥ floor. Pass ListAgents count as `body.live` on every `pool-observe` and `transition`.
- `floor_gate_denied` (live < floor, `open_rows > 0`) is the launch signal, never a retry.

## Never let the pool dip
Live under ceiling with independent work open is a shortfall. Log `FAILURE: <UTC> live=<n> pending=<m>` to `.gm/witness-log.md`, then launch to target this turn. Causes:
1. Lane stopped: one successor per freed slot, never batched. Session killed: relaunch `.gm/pool/<session>.next` or a pending row.
2. Lane stood down on a modified file: compare the blob with remote `main` first; no comparison, take another slice.
3. Browser or GPU lock held: run node-only and non-GPU work meanwhile.
4. Brief hit `Prompt is too long`: relaunch compact (row, surface, session, one action). Never resume it.

## Tick
1. Observe: `pool-observe {live, held}`. Take `slots.launch` (node-first, max 32). Empty under shortfall is a defect row.
2. Launch one block, up to ceiling. Rows: `Skill(skill="gm-prd", args="row=<id>; session=<SID>")`. Hops: `Skill(skill="gm-hop", args='{"node":{...},"principle":"<id>","surface":"<path>","session":"<SID>","wave":"<wave>","depth":1,"rhetoric":""}')`. `<SID>` = `<parent>-<k>`, unique. A cause-asserting row or hop runs its ACH step (gm-hop 3a, gm-prd SPECIFY) in the same launch.
3. Log `launch <id>` to `.gm/pool/ledger-<wave>.txt`; write a `launched` line to `.gm/pool/runs.jsonl`; log `tick <n> event=<id> live=<count> <UTC>` to `.gm/witness-log.md`.
4. `wait {"ms":60000}`. Each `done <id>` refills its slot this turn.
5. Re-count live after each launch and completion.

Launch only advertised ids. A slot stays empty only when no pending row and no untraversed node remain.

## Hop payloads
- A hop is an edge: nominate FROM the node it stands on TO a neighbour in `node.links`.
- Read `skills/dream-rsi/gm-graph.json` at launch. Never take counts from `node_count` or `edge_count`.
- `node`: `id`, `label`, `book`, `author`, `kind` from `nodes[]`. `advocate` = `"<author> - <book>"`, or bare `book` when `author` is `unattributed`.
- `links`: one `{to, guards}` per `edges[]` entry whose `from` is `node.id`, both kinds, sorted by `to`. `guards = []` when `condition` is null, else `[condition]`.
- Edge whose `to` is not in `nodes[]`: skip; `prd-add` `gm-graph-dangling-edge-<from>-<to>`.
- `links: []` nodes still launch; their receipt says `next: none`.
- Receipt `next:` outside `links` is not a child: log `nomination-not-from-links`; `prd-add` `gm-hop-nomination-not-from-links-<from>-<to>`.
- A hop launched with zero links, or a node with `links=0`, is a derivation defect.
- Witnesses are CI witnesses: the row's pushed sha, read through `ci-status`. A row needing a local compile is written with its CI run as witness, so its slot never waits on a local build.

## Refill and successors
- Each completion refills one slot this turn from `slots.candidates`. Blocker rows are never candidates; a worker ending at a blocker nominates a node-only successor.
- A hop spawns its own successor. The orchestrator spawns one only when a hop returns `next: none`.
- Candidates empty with rows pending: read `prd-list {status:"pending", limit:<n>}`; log the empty list as a defect row.
- Rows resolve faster than the pool refills: pause row-creating hops. Row supply low: run row-creating hops (`prd-add`) before more resolvers.
- Each completed hop writes `.gm/lean-walk/<node.id>.json`. Missing: `prd-add` `gm-lean-walk-node-emission-missing-<session>`; the node is not counted walked.
- Count of record is `emitted`: node files written this wave.

## Heartbeat
- Every brief first writes `.gm/pool/<session>.live` (three lines: `session`, `row`, `start` ISO-8601 UTC) and deletes it on finish. A hop's `row` line is its surface path; a surface-only heartbeat is reported as `malformed_heartbeats`.
- Before launch, skip any id held by a live row. Refresh at every gm call; older than 5 minutes = stale.

## Shortfall and FAILURE
- Two restarts per walk. Repeated shortfall means these rules are wrong: dispatch `instruction`, correct this skill, restart at tick 1.
- A third repeat files `<row>-blocker-<session>` and launches the blocker next wave.

## Never leave a row open
- Exit requires `prd-list {"status":"pending"}` = 0. Stalls, blocked workers, refused witnesses and ended sessions never close the walk.
- A run ends as `prd-resolve` with a witness, or as blocked. A blocked row keeps its id and names `blocked_by: <fact and verb>` in its text. File a new blocker row only when no open row names that fact. Counts are unique open rows.
- Blockers launch next wave. A blocker that blocks again is split until one step remains; that step runs. Blocker-of-blocker chains are never created past one level.
- Convergence guard: pending rows rise two waves running → no new blockers; run only open blockers and rows until the count falls.
- A worker returning with no receipt or blocker is re-dispatched once per wave as `<session>-r<n>`. A connectivity-stopped worker is restarted instead (Connectivity restarts).
- `floor_gate_denied` on `prd-resolve` or phase advance: pass `body.live` and launch the denial's `slots.launch`.

## Starvation
- `pool-observe` dropped at 120 s with `dispatch_starved_waiting_for_serial_lane`: re-dispatch once, verbatim (never `resume_task`).
- Before re-dispatch read `.gm/exec-spool/.dispatch-wait.json`. Position 1 or holder near budget: re-dispatch now. Behind a fresh holder: wait. Not shrinking: slow holder.
- Commit ahead of push: wait. A push that waited out its budget keeps its place; re-dispatch once.
- `dispatch_orphaned` on a read-only verb: re-dispatch at once. Before re-dispatching `git_commit`, `git_finalize`, `git_push` or `fs_write`, re-read real state.
- Never preempt an executing holder. Never delete a `.live` file to free a slot.
- Two starvations of one git verb: `prd-add` the paths and both dispatch ids, then stop git dispatches until a completion drains the queue.

## Connectivity restarts
- A subagent stopped by a network or API error (`ECONNRESET`, `ECONNREFUSED`, `server_error`, timeout, no response) is restarted, never resumed, never counted a blocker. Launch a fresh subagent for the same row, session `<session>-r<n>`, the same turn.
- `wait {"ms":30000}` between attempts when the error repeats; keep retrying while the network is intermittent. Log each attempt to `.gm/witness-log.md` as `restart <row> <n> <UTC>`.
- The row stays open and its slot stays held. Never count a dropped agent as live.
- Mass drop: `docs/recovery.md`, section "Mass API-error drain", same restart rule.

## Headroom and leases
- Pressure (Lane budget signals) lowers the heavy-lane target and pauses new heavy launches until the probe clears. Log cause, real count, UTC; a pause does not end the turn. Back off on the first pressure sample.
- Rows needing an exclusive lock wait; the pool launches the rest. A lock wait that times out is a failed run.
- One browser or GPU arm at a time, pool-wide. `gpulock` serialises the adapter only, not the machine. One browser arm plus one node-only lane is fine; two browser arms are not. Lease held: take node-only work (Never let the pool dip, cause 3); never open a second browser.
- Browsers are headful (`headless: false`). Each run closes its own; never touch the user's Chrome.
- EADDRINUSE: the witness did not run. Identify the owning process. Never kill another lane's process.
- Browser-last, cold-start, reload budgets, and minting a focused jit test: gm-prd, Witness economy.

## Lane budget (anti-thrashing)
- Two failure modes, opposite remedies; never conflate. A dropped link (`ECONNRESET`, `ECONNREFUSED`, `server_error`, timeout, no response) is the unreliable connection: RESTART the lane; lowering concurrency to stop a drain buys nothing and idles the pool. Machine thrashing (unresponsive host, memory pressure, lanes parked on a lease) is load: RUN LESS AT ONCE; restarting lanes into a thrashing machine makes it worse. A concurrency cap is never the answer to a drop; a restart is never the answer to thrash.
- Concurrency is discovered, not assumed. Heavy lanes (local build or witness run) are the controlled variable. `ceiling` (20) is the host spawn refusal limit, not a throughput target or memory budget.
  - Controller: start at target 2 heavy lanes. Every 3 minutes take one probe sample. A window with no pressure and at least one lane waiting for a slot raises target by 1, up to `ceiling`. Any pressure sample lowers it by 1 at once and blocks raising for 10 minutes. Target never exceeds what the probe has shown it can hold.
  - Pressure: free RAM under 2048 MB; commit charge over 90%; disk queue length over 2 sustained for 30 s; CPU over 90% sustained for 60 s while lanes wait; or a lane waiting on a lease over 10 minutes. A connectivity drop is never pressure. Only the probe decides.
  - Probe (Windows): `Get-CimInstance Win32_OperatingSystem` for `FreePhysicalMemory` and `FreeVirtualMemory`/`TotalVirtualMemorySize` (commit charge); `Get-Counter '\PhysicalDisk(_Total)\Current Disk Queue Length','\Processor(_Total)\% Processor Time' -SampleInterval 1 -MaxSamples 3`. Other platforms: equivalent counters, same five signals.
  - Record every change and sample to `.gm/pool/concurrency-curve.txt` (UTC, target, live, free MB, commit %, disk queue, CPU). Best level = held longest without pressure; keep probing upward.
- Writers (text-only, publish without building) are not heavy and launch freely under Write first, fix later.
- Evidence 2026-10-14: ~10-16 concurrent lanes at 100k-270k tokens, several GPU browser arms, extra checkouts, and one shared tree with many lanes' uncommitted edits drove the machine unresponsive; reboot needed. These are controller signals, not a ceiling. Browser arms run one at a time pool-wide.
- Thrash is answered by fewer simultaneous lanes, never by a slower lane: do not stretch slices, add waits or serialize independent work; retire lanes. If live exceeds budget, let slots drain rather than launch.
- A mass `ECONNRESET` drain is environmental, not a concurrency symptom: lanes died at 5, 6 and 10 concurrent alike. Never present a lane-count ceiling as the remedy. Restart the affected lanes on the same row, resuming from the dead lane's last line. Mechanics: `docs/recovery.md`, "Mass API-error drain".
- Publish on the first passing witness: time-box a lane to its witness. Resolve, publish, then keep going. A lane working past its witness holds a large context for nothing.
- Other loads have one home: browser/GPU arms (Headroom and leases), extra checkouts (Shared-tree publish).

## Fan-out
- Independent slices (file, row, hop) launch in one block. Slices sharing a surface run in turn.
- Walk workers are gm-prd or gm-hop, never a fork. Each brief opens with the brick-wall opener and its own SESSION_ID.
- Verify a brief's source path exists (`codesearch {mode:"filename"}`) before launch. A wrong path is a blocked slot.
- `gm_processor_capacity` queues dispatches beyond it; it is not the subagent count.

## Shared-tree publish
One work tree, one git lane. Main only: no worktree, side branch or scratch checkout.
- No extra checkouts. A clean base for measurement or bisect: `git archive <remote sha>` into a temp dir, read-only, deleted after; never publish from it. Duplicated checkouts were part of the 2026-10-14 load (Lane budget).
- Publish via Git API: POST blobs; tree with `base_tree: <remote tip>`; commit parented on that tip; PATCH `refs/heads/main`, `force` unset; re-read each blob at `?ref=main`.
- `git_finalize` refusing to push over a sibling's dirty path is redundant when its content is already published. Never reset `refs/heads/main` under running lanes.
- `remote_moved` on a dirty tree: `git_status {"paths":[...]}`, commit or revert each path in its owning lane, then `git_push {rev:"<sha>"}`.
- `remote_moved` plus conflicted `git_pull` (`conflicted: true`, `MERGE_HEAD` present): `git_merge_abort`, then `git_reset {ref:"origin/main", mode:"mixed"}` (the local commit stays in reflog, files stay in the work tree); reapply each lane path on current state; then `git_finalize {message, paths}` for those paths only. Confirm with `git_remote` and `ci-status`.
- Collision: re-read the row or file, reapply on current state, retry.
- One commit author, no trailers (gm). Bake before commit (gm-hop).

## Editing the skills
Skills under `skills/` are live on the next dispatch. Check `.git/MERGE_HEAD` first. Publish path-scoped, push the full sha, then `ci-status`. Steps: `docs/recovery.md`, "Editing the skills".
