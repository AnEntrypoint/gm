---
name: gm-orchestrate
description: "Main-thread pool loop for a gm walk that has advertised PRD rows or hops: fans out as many parallel graph workflows as the work allows, refills slots, and exits only at zero pending rows. Invoke only from gm; do not load directly. Hop rules are in gm-hop, PRD-row rules in gm-prd."
---

# gm-orchestrate

Pool and publish rules. Rationale: `docs/rationale.md`. Incidents: `docs/incidents.md`. Recovery: `docs/recovery.md`.

## Terms
- `ceiling`: N in a spawn refusal. `live`: ListAgents count. `floor` = min(10, ceiling). `shortfall` = live < floor with independent work open.

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
- Ceiling and floor still bound live subagents. Launch to ceiling; a freed slot refills in the same turn.

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
3. Log `launch <id>` to `.gm/pool/ledger-<wave>.txt` and `tick <n> event=<id> live=<count> <UTC>` to `.gm/witness-log.md`.
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

**CI-only rows are not pool work.** A row whose witness needs a local cargo build is filed as `<row>-ci-only`; its slot refills from a non-cargo candidate.

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
- CPU >= 80% or available memory < 2048 MB pauses launches. Log the cause with the real count and UTC; a pause does not end the turn.
- Rows that need an exclusive lock wait for it; the pool keeps launching the rest. A lock wait that times out is a failed run.
- GPU rows wait for the GPU lock; browser rows wait for the browser lease. Neither idles the pool.
- Browsers are headful (`headless: false`). Each run closes its own browser; never touch the user's Chrome.
- EADDRINUSE: the witness did not run. Identify the owning process. Never kill another lane's process.
- Browser-last, cold-start and reload budgets, and minting a focused jit test instead of routing through a suite: defined in gm-prd: Witness economy.

## Lane budget
- **A mass `ECONNRESET` drain is environmental, not a concurrency symptom.** The drops are a dropped connection: lanes have died at 5 and 6 concurrent as well as at 10, so lane count was not the variable. Never present a lane-count ceiling as the remedy, and never lower concurrency to stop a drain -- that buys nothing and idles the pool. The response is to **restart the affected lanes**: same row, resuming from the dead lane's last line so completed work is not redone. Mechanics (resume-by-id, one event per window, back-pressure, recurrence): `docs/recovery.md`, section "Mass API-error drain".
- **Publish on the first passing witness.** Time-box a lane to its witness: the observed failure mode is a lane that did the work, reached 140k-210k tokens and died without shipping it. Resolve the row, publish, then keep going. An unreliable connection makes this stricter, not looser: it bounds how much finished work one drop can destroy.

## Fan-out
- Independent slices (file, row, hop) launch in one block. Slices sharing a surface run in turn.
- Walk workers are gm-prd or gm-hop, never a fork. Each brief opens with gm's brick-wall opener and its own SESSION_ID.
- Verify a brief's source path exists (`codesearch {mode:"filename"}`) before launch. A wrong path is a blocked slot.
- `gm_processor_capacity` queues dispatches beyond it; it is not the subagent count.

## Shared-tree publish
Lanes share one work tree and one git lane. Work on `main` only: no worktree, side branch or scratch checkout.
- Publish through the Git API: POST blobs; a tree with `base_tree: <remote tip>`; a commit parented on that tip; PATCH `refs/heads/main` with `force` unset; re-read each blob at `?ref=main`.
- `git_finalize` that refuses to push because a sibling holds a dirty path is redundant when its content is already published. Never reset `refs/heads/main` under running lanes.
- `remote_moved` on a dirty tree: `git_status {"paths":[...]}`, commit or revert each path in its owning lane, then `git_push {rev:"<sha>"}`.
- `remote_moved` plus a conflicted `git_pull` (`conflicted: true`, `MERGE_HEAD` present): `git_merge_abort`, then `git_reset {ref:"origin/main", mode:"mixed"}` (the lane's local commit stays in the reflog and its files stay in the work tree), reapply each lane path on current state, then `git_finalize {message, paths}` for those paths only. It pushes the new sha; confirm with `git_remote` and `ci-status`.
- Collision: re-read the row or file, reapply on current state, retry.
- One commit author, no trailers (gm). Bake before commit (gm-hop).

## Editing the skills
Skills under `skills/` are live on the next dispatch. Check `.git/MERGE_HEAD` first. Publish path-scoped, push the full sha, then `ci-status`. Steps: `docs/recovery.md`, section "Editing the skills".
