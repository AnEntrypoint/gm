---
name: gm-orchestrate
description: "Main-thread pool loop for a gm walk that has advertised PRD rows or hops: fans out as many parallel graph workflows as the work allows, refills slots, and exits only at zero pending rows. Invoke only from gm; do not load directly. Hop rules are in gm-hop, PRD-row rules in gm-prd."
---

# gm-orchestrate

Pool and publish rules. Rationale: `docs/rationale.md`. Incidents: `docs/incidents.md`. Recovery: `docs/recovery.md`.

## Terms
- `ceiling`: N in a spawn refusal -- a HOST limit on how many agents may exist, never a throughput recommendation and never a memory budget. `live`: ListAgents count. `floor` = min(2, ceiling). `shortfall` = live < floor with independent work open.

## Core loop (the orchestrator's underlying workflow)
Every walk runs one loop, repeated until a full pass adds no work:
1. **Roll out.** Write everything planned in one pass, in parallel, file-owned slices, published once per lane. Nothing is built locally; CI is the build. Rollout never pauses for CI: the next slice starts as soon as the previous one is published, and each sha's CI is read when it lands.
2. **Fix.** Read the run ledger and the CI results. Every broken run becomes a fix handoff to a fresh executor, in parallel. Fixes come after the rollout that they repair, never during it.
   - **Discover before fixing.** Before the first fix, run a discovery sweep: one subagent per failing job log, per changed file group, and per stub or TODO the rollout reported. Each returns located `path:line` findings and counts only. Every finding becomes a row. Fixing starts only when the sweep is complete, so the fan-out is sized to the real list.
   - **Fan out by file ownership.** Each independent file group gets its own fix executor, launched in one block. Fixes that share a file run in sequence in one executor. Fan-out is limited by file ownership, not by a fixed count; the concurrency controller limits only heavy builds and witness runs (Lane budget).
   - **Batch per lane.** Each fix executor publishes one commit for its file group, after all of its fixes are written. It does not publish per finding.
3. **Plan.** Each pass ends with the next improvements written down as PRD rows (`prd-add`), with their file ownership and acceptance.
4. **Repeat** from step 1 with the new rows.

Node traversal (gm-hop, the graph in `skills/dream-rsi/gm-graph.json`) is the source of new PRD rows. It runs only when the rows are exhausted (`prd-list {"status":"pending"}` is 0 for the current pass), feeding step 3, and never interrupts a rollout or a fix. Traversal's receipts are rows, so they re-enter this loop like any other plan.

## Parallelism: graph workflows first
- Default unit of fan-out is a graph workflow (`Workflow` tool). Use as many as the open work needs, in parallel where independent, in sequence where a result feeds the next.
- One wave per run. A workflow run never loops over waves. Each run takes at most 60 pending rows, resolves them with `gm-prd` agents (each restarts on a connectivity error, at most 3 times), returns counts `{pending_before, resolved, blocked, failed, new_blockers}` and ends. The caller reads those counts and starts the next run. A run that ends with `pending_after > pending_before` halts new blockers until a merge pass closes the duplicates.
- A run never exceeds 150 agents. Cap-hit or stalled runs are reported, never relaunched unchanged.
- Three graphs, each run to exhaustion:
  1. Row drain: `pipeline` over every pending row, one `gm-prd` per row, a `parallel` block per wave, repeat until `prd-list {"status":"pending"}` is 0.
  2. Traversal: `pipeline` over every principle node in `skills/dream-rsi/gm-graph.json`, one `gm-hop` per node per surface, emitting new rows; repeat until every node has a receipt for each surface.
  3. Audit: a completeness critic lists what the drain and traversal missed; its findings become new rows for graph 1.
- Priority: drain before make. While pending rows exist, graph 1 takes every free slot. When pending rows fall under 20, graph 2 takes the free slots (computer-science disciplines first) until pending rows reach 20 again.
- Every traversal subagent nominates its successor from its own outward links, with a one-line rhetoric handed to the successor. It never nominates a node outside its links.
- Repeat graphs 1-3 until a full cycle adds no rows and resolves none. Stop only then.
- A wave that resolves 0 rows with pending rows left is a stall: change the brief, then rerun. Never stop on a stall alone.
- Ceiling and floor still bound live subagents, and the machine budget (Lane budget) bounds live below them. Launch to the machine budget; a freed slot refills in the same turn.

## Write first, fix later
- Write everything first, verify later. A lane's job is to produce its full slice of code in one pass, publish it once, and move on. Correctness is established from CI logs in a later pass, never by stopping to check mid-write.
- No local building. No `cargo`, `go build`, `go vet`, `go test`, witness runs or any local compile unless the user says builds are on. CI is the build. A lane publishes, reads `ci-status` for its sha when it lands, and fixes from the CI log as a new commit.
- Do not wait on CI between pushes. Start the next slice immediately, and read each sha's CI when it arrives. A failing sha becomes a fix slice, not a reason to pause the pool.
- Publish once per lane when its slice is written, not per change. Batch fixes into one push.
- Writers are light; builds are heavy. The adaptive concurrency controller (Lane budget) bounds concurrent builds and heavy lanes, not concurrent writers. Many writers may run at once when each owns separate files.
- File ownership before launch. Name each lane's files in its brief. Two lanes never write the same file. A shared manifest (a workspace file, a dependency list) has one owner, and everyone else adds only their own directory.
- Contracts before code. When one lane's output is another's input (a data layout, a public API), the producing lane publishes the contract doc first, as its own commit. The consuming lane reads that doc from remote `main` and uses it as written, never a guess.
- Use maintained libraries for solved problems (codecs, parsers, runtimes) under permissive licences. Hand-port only what has no suitable library. Hand-porting a solved problem is double work.
- Pick the simplest correct path that a lane can finish in one pass. Splitting a module into separate lanes is allowed only when the split boundary is a file boundary already in the brief.
- Rewrites of published history happen once, at the end, after every lane has landed. Never rewrite mid-stream: it changes every sha a lane is still reading.

## Run ledger (the orchestrator's record of outstanding runs)
- One file, `.gm/pool/runs.jsonl`, one JSON line per run. Every run gets a line when launched and a new line each time its state changes (append-only; the last line per `run` id is its state).
- Fields: `run` (unique: `<parent>-<kind><k>`), `kind` (`exec`, `verify`, `ci`, `fix`, `hop`), `row` or `surface`, `sha` (full, when known), `state` (`launched`, `handoff`, `verified`, `ci-green`, `ci-red`, `fix`, `blocked`, `done`, `stale`), `session`, `started` and `updated` (UTC ISO-8601).
- **Every transition writes a line, in the same turn.** The orchestrator never relies on a lane's own log to know its state.
- **Read it at every tick**, before `pool-observe`. Outstanding means: any run whose last state is not `done`, `blocked` or `stale`. A row is closable only when its `verify` run is `verified` and its `ci` run is `ci-green` for the same `sha`.
- **Reconcile against reality.** For each `ci` run still outstanding, read `ci-status {sha}`: a conclusion in the ledger is replaced by the live one. For each `exec`/`verify` run whose heartbeat (`.gm/pool/<session>.live`) is older than 5 minutes, mark it `stale` and relaunch its row as a fresh run; never count a stale run as live.
- **Pairing.** A `handoff` with no `verify` or `ci` run after it is a defect: spawn the missing lane this tick.
- **Summaries are derived, never stored.** Counts (outstanding, closable, stale, red) are computed from the ledger each tick, not kept as separate state that can drift.

## Verification and CI lanes (spawned per handoff)
- An executor ends at `STATUS: handoff <sha>`. The orchestrator then spawns two lanes for that sha, in the same turn, neither inside the executor: a verifier (`gm-validate` as `mode=witness`, session `<parent>-v<k>`) and a CI reader (`gm-publish` steps 3-5, session `<parent>-c<k>`).
- The verifier is a witness, so it must run in a session other than the executor's. The CI reader is light (it reads `ci-status`, nothing else); the verifier counts as heavy only when its witness is a build or a run.
- `STATUS: fix` from a verifier, or `STATUS: ci-red` from a CI reader, spawns a fresh executor for the same row, carrying the sha and the failing check or job. It takes a slot like any row and is never run inline.
- Only the orchestrator calls `prd-resolve`, and only once a verifier and a CI reader both report green for the same sha. Each lane's result is logged to `.gm/witness-log.md` with its session id.
- Verification and CI never block the pool. A waiting CI run does not hold an executor or a heavy slot: the reader is spawned, the executor's slot refills, and the reader reports when its sha lands.

## Floor
- Pending rows open: keep live >= floor. Pass ListAgents count as `body.live` on every `pool-observe` and `transition`.
- `floor_gate_denied` (live < floor, `open_rows > 0`) is the launch signal, never a retry.

## Never let the pool dip
Live under ceiling with independent work open is a shortfall. Log `FAILURE: <UTC> live=<n> pending=<m>` to `.gm/witness-log.md`, then launch to target this turn. Causes, in order:
1. Lane stopped: one successor per freed slot, never batched. Session-killed lane: relaunch `.gm/pool/<session>.next` or a pending row.
2. Lane stood down on a modified file: compare the blob with remote `main` first; no comparison, take another slice.
3. Browser or GPU lock held: run node-only and non-GPU work meanwhile.
4. Brief hit `Prompt is too long`: relaunch compact (row, surface, session, one action). Never resume it.

## Tick
1. Observe: `pool-observe {live, held}`. Take `slots.launch` (node-first, max 32). Empty under shortfall is a defect row.
2. Launch one block, up to ceiling. Rows: `Skill(skill="gm-prd", args="row=<id>; session=<SID>")`. Hops: `Skill(skill="gm-hop", args='{"node":{...},"principle":"<id>","surface":"<path>","session":"<SID>","wave":"<wave>","depth":1,"rhetoric":""}')`. `<SID>` = `<parent>-<k>`, unique. A cause-asserting row or hop runs its ACH step (gm-hop 3a, gm-prd SPECIFY) in the same launch.
3. Log `launch <id>` to `.gm/pool/ledger-<wave>.txt`, write a `launched` line to `.gm/pool/runs.jsonl` (Run ledger), and log `tick <n> event=<id> live=<count> <UTC>` to `.gm/witness-log.md`.
4. `wait {"ms":60000}`. Each `done <id>` refills its slot this turn.
5. Re-count live after each launch and completion.

Launch only advertised ids. A slot stays empty only when no pending row and no untraversed node remain.

## Hop payloads
- A hop is an edge: nominate FROM the node it stands on TO a neighbour in `node.links`.
- Read `skills/dream-rsi/gm-graph.json` at launch. Never take counts from `node_count` or `edge_count`.
- `node`: `id`, `label`, `book`, `author`, `kind` from `nodes[]`. `advocate` = `"<author> - <book>"`, or bare `book` when `author` is `unattributed`.
- `links`: one `{to, guards}` per `edges[]` entry whose `from` is `node.id`, both kinds, sorted by `to`. `guards = []` when `condition` is null, else `[condition]`.
- Edge whose `to` is not in `nodes[]`: skip it; `prd-add` `gm-graph-dangling-edge-<from>-<to>`.
- `links: []` nodes are still launched; their receipt says `next: none`.
- Receipt `next:` outside `links` is not a child: log `nomination-not-from-links`, `prd-add` `gm-hop-nomination-not-from-links-<from>-<to>`.
- A hop launched with zero links, or a node with `links=0`, is a derivation defect.

**Witnesses are CI witnesses.** No witness needs a local build: the witness is the CI run for the row's pushed sha, read through `ci-status`. A row that would need a local compile is written with its witness as the CI run, so its slot never waits on a local build.

## Refill and successors
- Each completion refills one slot, this turn, from `slots.candidates`. Blocker rows are never candidates; a worker that ends at a blocker still nominates a node-only successor.
- A hop spawns its own successor. The orchestrator spawns one only when a hop returns `next: none`.
- Candidates empty with rows pending: read `prd-list {status:"pending", limit:<n>}`. Log the empty candidate list as a defect row.
- Rows resolve faster than the pool refills: pause row-creating hops. Row supply is low: run row-creating hops (`prd-add`) before more resolvers.
- Node emission: each completed hop writes `.gm/lean-walk/<node.id>.json`. Missing file: `prd-add` `gm-lean-walk-node-emission-missing-<session>` and do not count the node walked.
- Count of record is `emitted`: node files written this wave.

## Heartbeat
- Every brief first writes `.gm/pool/<session>.live` (three lines: `session`, `row`, `start` ISO-8601 UTC) and deletes it on finish. A hop has no row id, so its `row` line is its surface path (the `surface` in its payload); a surface-only heartbeat is reported as `malformed_heartbeats`.
- Before launch, skip any id already held by a live row. Refresh the file at every gm call; a file older than 5 minutes is stale.

## Shortfall and FAILURE
- Two restarts per walk. Repeated shortfall means these rules are wrong: dispatch `instruction`, correct this skill, restart at tick 1.
- A third repeat files `<row>-blocker-<session>` and launches the blocker next wave.

## Never leave a row open
- Exit requires `prd-list {"status":"pending"}` to return 0 rows. Stalls, blocked workers, refused witnesses and ended sessions never close the walk.
- A run ends as `prd-resolve` with a witness, or as blocked. Blocked rows are never duplicated: the row keeps its id and names `blocked_by: <fact and verb>` in its text. A new blocker row is filed only when no open row already names that fact. Counts are unique open rows, so a blocked row is counted once.
- Blockers launch next wave. A blocker that blocks again is split until one step remains; that step runs. Blocker-of-blocker chains are never created past one level.
- Convergence guard: if pending rows rise in two consecutive waves, launch no new blockers. Run only the open blockers and rows until the count falls.
- A worker that returns without a receipt or blocker is re-dispatched once per wave as `<session>-r<n>`. A worker stopped by a connectivity error is restarted instead (Connectivity restarts).
- `floor_gate_denied` on `prd-resolve` or phase advance: pass `body.live` and launch the denial's `slots.launch`.

## Starvation
- `pool-observe` dropped at 120 s with `dispatch_starved_waiting_for_serial_lane`: re-dispatch once, verbatim (never `resume_task`).
- Before re-dispatch, read `.gm/exec-spool/.dispatch-wait.json`. Position 1 or holder near budget: re-dispatch now. Behind a fresh holder: wait. Not shrinking: slow holder.
- Commit ahead of push: wait. A push that waited out its budget keeps its place; re-dispatch once.
- `dispatch_orphaned` on a read-only verb: re-dispatch at once. Before re-dispatching `git_commit`, `git_finalize`, `git_push` or `fs_write`, re-read real state.
- Never preempt an executing holder. Never delete a `.live` file to free a slot.
- Two starvations of one git verb: `prd-add` the paths and both dispatch ids, then stop git dispatches until a completion drains the queue.

## Connectivity restarts
- A subagent that stops on a network or API error (`ECONNRESET`, `ECONNREFUSED`, `server_error`, timeout, no response) is restarted, never resumed and never counted as a blocker. Launch a fresh subagent for the same row with session `<session>-r<n>`, in the same turn.
- Restart with `wait {"ms":30000}` between attempts when the error repeats; keep retrying while the network is intermittent. Each attempt is logged to `.gm/witness-log.md` as `restart <row> <n> <UTC>`.
- The row stays open and its slot stays held by the restart. Never count a dropped agent as live.
- A mass drop (many at once) follows `docs/recovery.md`, section "Mass API-error drain", with the same restart rule.

## Headroom and leases
- Pressure (Lane budget, the controller's signals) lowers the heavy-lane target and pauses new heavy launches until the probe clears. Log the cause with the real count and UTC; a pause does not end the turn. A thrashed host is only recoverable by reboot, so the controller backs off on the first pressure sample, not after the thrash.
- Rows that need an exclusive lock wait for it; the pool keeps launching the rest. A lock wait that times out is a failed run.
- **One browser or GPU arm at a time, pool-wide.** `gpulock` serialises the ADAPTER only -- never CPU, memory or disk -- so N headless Chromes still contend; serialising the adapter is not serialising the machine, and reading it as machine-wide serialisation is the error that put several GPU arms in flight at once on 2026-10-14. Observed: one lane held the browser lease continuously while others waited 600 s and never got a browser. One browser arm plus one node-only/gpu-free lane is fine; two browser arms are not. Lease held: take node-only work (Never let the pool dip, cause 3), never open a second browser.
- Browsers are headful (`headless: false`). Each run closes its own browser; never touch the user's Chrome.
- EADDRINUSE: the witness did not run. Identify the owning process. Never kill another lane's process.
- Browser-last, cold-start and reload budgets, and minting a focused jit test instead of routing through a suite: defined in gm-prd: Witness economy.

## Lane budget (anti-thrashing)
- **Two failure modes with opposite remedies; never conflate them.** A dropped link (`ECONNRESET`, `ECONNREFUSED`, `server_error`, timeout, no response) is the unreliable connection: the remedy is to RESTART the lane, and lowering concurrency to stop a drain buys nothing and idles the pool. Machine thrashing -- an unresponsive host, memory pressure, lanes parked on a lease -- is load: the remedy is to RUN LESS AT ONCE, and restarting lanes into a thrashing machine makes it worse. A concurrency cap is never the answer to a connection drop, and a restart is never the answer to thrash.
- **Concurrency is discovered, not assumed.** Heavy lanes (a local build or a witness run) are a controlled variable. GM finds the highest level this machine sustains and holds it there. `ceiling` (20) is the host's spawn refusal limit, not a throughput target and not a memory budget.
  - **Controller.** Start at a target of 2 heavy lanes. Every 3 minutes, take one probe sample (below). A window with no pressure and at least one lane waiting for a slot raises the target by 1, up to `ceiling`. Any pressure sample lowers it by 1 at once and blocks raising it again for 10 minutes. The target never exceeds what the probe has shown it can hold.
  - **Pressure** is any of: free RAM under 2048 MB; commit charge over 90%; disk queue length over 2 sustained for 30 s; CPU over 90% sustained for 60 s while lanes wait; or a lane waiting on a lease for over 10 minutes. A connectivity drop is never pressure (Connectivity restarts). Only the probe decides.
  - **Probe (Windows):** `Get-CimInstance Win32_OperatingSystem` for `FreePhysicalMemory` and `FreeVirtualMemory`/`TotalVirtualMemorySize` (commit charge), and `Get-Counter '\PhysicalDisk(_Total)\Current Disk Queue Length','\Processor(_Total)\% Processor Time' -SampleInterval 1 -MaxSamples 3`. Other platforms use their equivalent counters; the same five signals apply.
  - **Record the curve.** Every change and sample goes to `.gm/pool/concurrency-curve.txt` (UTC, target, live, free MB, commit %, disk queue, CPU). The best level is the one held longest without pressure, and the walk keeps probing upward toward the next level.
  - Writers (text-only lanes that publish without building) are not heavy and do not count toward the target; they launch freely under Write first, fix later. On 2026-10-14 a C:/dev/spoint walk ran ~10-16 concurrent lanes at 100k-270k tokens each, and the machine became unresponsive from thrashing and needed a reboot. The load that did it: many large contexts at once; several GPU browser arms at once; several extra checkouts, each duplicating `node_modules` junctions and disk I/O and each ending in a consolidation run; and one shared work tree carrying many lanes' uncommitted edits, so every read and publish churned. The 2026-10-14 figures are evidence for the controller's pressure signals, not a ceiling: the controller finds the level that stays clear of them. A browser arm still runs one at a time pool-wide (Headroom and leases).
- **Thrash is answered by fewer simultaneous lanes, never by a slower lane.** Do not stretch a lane's slice, do not add waits and do not serialize work that was independent to stay under budget: retire lanes. If live exceeds the budget, let slots drain to it rather than launching.
- **A mass `ECONNRESET` drain is environmental, not a concurrency symptom.** The drops are a dropped connection: lanes have died at 5 and 6 concurrent as well as at 10, so lane count was not the variable. Never present a lane-count ceiling as the remedy, and never lower concurrency to stop a drain -- that buys nothing and idles the pool. The response is to **restart the affected lanes**: same row, resuming from the dead lane's last line so completed work is not redone. Mechanics (resume-by-id, one event per window, back-pressure, recurrence): `docs/recovery.md`, section "Mass API-error drain".
- **Publish on the first passing witness.** Time-box a lane to its witness: the observed failure mode is a lane that did the work, reached 140k-210k tokens and died without shipping it. Resolve the row, publish, then keep going. An unreliable connection makes this stricter, not looser: it bounds how much finished work one drop can destroy. It is also the anti-thrashing rule: a resolved and published lane is memory the machine gets back, while a lane working past its witness holds a large context for nothing.
- The other two loads have one home each and are not restated here: browser/GPU arms (Headroom and leases), extra checkouts (Shared-tree publish).

## Fan-out
- Independent slices (file, row, hop) launch in one block. Slices sharing a surface run in turn.
- Walk workers are gm-prd or gm-hop, never a fork. Each brief opens with gm's brick-wall opener and its own SESSION_ID.
- Verify a brief's source path exists (`codesearch {mode:"filename"}`) before launch. A wrong path is a blocked slot.
- `gm_processor_capacity` queues dispatches beyond it; it is not the subagent count.

## Shared-tree publish
Lanes share one work tree and one git lane. Work on `main` only: no worktree, side branch or scratch checkout.
- **No extra checkouts.** A clean base for measurement or bisect is `git archive <remote sha>` into a temp dir, used read-only and deleted afterwards -- never a second full checkout, worktree or clone, and never publish from it. A second checkout duplicates `node_modules` junctions and disk I/O and ends in a consolidation run; several of them were part of the load that took the machine down on 2026-10-14 (Lane budget).
- Publish through the Git API: POST blobs; a tree with `base_tree: <remote tip>`; a commit parented on that tip; PATCH `refs/heads/main` with `force` unset; re-read each blob at `?ref=main`.
- `git_finalize` that refuses to push because a sibling holds a dirty path is redundant when its content is already published. Never reset `refs/heads/main` under running lanes.
- `remote_moved` on a dirty tree: `git_status {"paths":[...]}`, commit or revert each path in its owning lane, then `git_push {rev:"<sha>"}`.
- `remote_moved` plus a conflicted `git_pull` (`conflicted: true`, `MERGE_HEAD` present): `git_merge_abort`, then `git_reset {ref:"origin/main", mode:"mixed"}` (the lane's local commit stays in the reflog and its files stay in the work tree), reapply each lane path on current state, then `git_finalize {message, paths}` for those paths only. It pushes the new sha; confirm with `git_remote` and `ci-status`.
- Collision: re-read the row or file, reapply on current state, retry.
- One commit author, no trailers (gm). Bake before commit (gm-hop).

## Editing the skills
Skills under `skills/` are live on the next dispatch. Check `.git/MERGE_HEAD` first. Publish path-scoped, push the full sha, then `ci-status`. Steps: `docs/recovery.md`, section "Editing the skills".
