---
name: gm-orchestrate
description: "Main-thread pool loop for a gm walk that has advertised PRD rows or hops: fans out as many parallel graph workflows as the work allows, refills slots, and exits only at zero pending rows. Invoke only from gm; do not load directly. Hop rules are in gm-hop, PRD-row rules in gm-prd."
---

# gm-orchestrate

Pool and publish rules. Shared rules (autonomy, git identity, CI read, collisions, exit): gm. Recovery: `docs/recovery.md`. Incidents: `docs/incidents.md`.

`ceiling` = host spawn limit (N in a refusal), not a throughput target or memory budget. `live` = ListAgents count. `floor` = min(2, ceiling). `shortfall` = live < floor with independent work open.

## Standing pair (every run)
Every `/gm` run starts one Workflow, `skills/gm/workflows/standing-pair.js`, in its first turn, before any other fan-out. Three phases, in this order of precedence:
1. **Drain, concurrently.** Lenses file findings as PRD rows. One lane per file group resolves each row's unknowns with live runs, edits, commits by explicit path, pushes, and closes the row with a live witness. Rows drain as they are filed: each row starts editing the moment its finder reports, and rows on the same file group run in sequence while every other group runs in parallel. Concurrency is set by the open work, never by a fixed number: any free slot with work open is filled in the same turn. Nothing in this phase waits on CI or tests.
2. **Validate and fix, after commit.** Once a batch of rollout work is committed and pushed, the test and CI follow-up validates that batch: it reads `ci-status` for each pushed sha, debugs red jobs with `ci_log failed_only`, and fixes them on their file groups. Red jobs become rows the next drain takes. Validation never runs on uncommitted work.
3. **Traverse, when nearly drained.** When open rows fall under 20 and slots are free, node traversal (gm-hop over `skills/dream-rsi/gm-graph.json`) fills those slots, alongside phases 1 and 2. Each hop files its rows with `prd-add`. Traversal never takes a slot that drain or validation needs.
A row attempted in a run is not retried in that run; a blocked row is retried only after its blocker changes. A run that closes no row is stalled: the dominant blocker is written to `.gm/witness-log.md`, and the next run waits for that blocker to change. There is no agent-count cap. A run ends when no open row, no red sha and no unvisited node remains.

## Core loop
Repeat until a full pass adds no work:
1. **Drain concurrently.** Rollout lanes resolve, commit and publish open rows as they are filed.
2. **Validate after commit.** The test follow-up validates each committed batch and turns red jobs into fix rows on their file groups.
   - Sweep first: one subagent per failing job log, changed file group, stub/TODO. Each returns located `path:line` and counts only; each finding becomes a row. Fix only after the sweep completes.
   - One fix executor per independent file group; fixes sharing a file run in sequence in one executor. One commit per group, never per finding.
3. **Traverse when nearly drained.** At fewer than 20 open rows, graph hops fill free slots and file new rows. They run alongside steps 1 and 2.
4. Repeat from 1.

## Parallelism: graph workflows
- Fan-out unit: a `Workflow` graph. As many as open work needs; parallel where independent, sequential where a result feeds the next.
- Drainage strategy: drain the remaining PRDs in bounded slices, each slice run as its own dynamic `Workflow` graph. Take the first slice of at most 20 pending rows (`prd_list {status:"pending", limit:20}`), run one `gm-prd` per row, return `{pending_before, resolved, blocked, failed, new_blockers}`, then take the next slice from a fresh listing. Refusals and stalls are answered by the next slice, never by stopping. A slice that resolves nothing is re-run once with its blockers split, then the next slice starts.
- One wave per run, except the standing pair (Standing pair), which loops until its listing is empty. Any other run takes at most one slice (20 pending rows), resolves them with `gm-prd` agents (connectivity restarts per Connectivity restarts), returns `{pending_before, resolved, blocked, failed, new_blockers}` and ends. `pending_after > pending_before` halts new blockers until a merge pass closes duplicates.
- A run never exceeds 150 agents. Cap-hit or stalled runs are reported, never relaunched unchanged.
- Three graphs, each run to exhaustion:
  1. Row drain: `pipeline` over pending rows, one `gm-prd` per row, a `parallel` block per wave; until pending = 0.
  2. Traversal: `pipeline` over every principle node in `skills/dream-rsi/gm-graph.json`, one `gm-hop` per node per surface, emitting rows; until every node has a receipt per surface.
  3. Audit: a completeness critic; findings become rows for graph 1.
- Drain before make. Pending ≥ 20: graph 1 takes every free slot. Pending < 20: graph 2 takes free slots (computer-science disciplines first) until pending reaches 20.
- Repeat 1-3 until a full cycle adds and resolves nothing. A wave resolving 0 rows with pending rows left is a stall: change the brief, rerun. Never stop on a stall alone.
- Ceiling and floor bound live subagents (Lane budget). Refill a freed slot in the same turn.

## Publish first, test concurrently
- Publish first: each rollout lane publishes its commit without waiting on CI or browser tests. Tests, CI and CD run in the concurrent test follow-up, never as a gate on rollout.
- Fix after commit: the test follow-up validates committed batches, groups failures by cause and file, and hands each group to the lane that owns that file, or to a new fix lane when no lane holds it. Only one writer per file group at a time.
- Witness: a rollout lane closes its own row with a live witness dispatch on its pushed sha. The test follow-up reads CI for that sha; a red job reopens the row with a `prd-add` fix row, which the next pass takes.
- No `cargo`, `go build`, `go vet`, `go test`, or local compile unless the user turns builds on. Check that setting first (gm config or served instruction); a local run is allowed when it is on. Witnesses are live dispatches, which never wait on CI. The test follow-up reads `ci-status` for each pushed sha. A failing sha becomes a fix slice, never a pause.
- Writers are light; writers are not limited. Only browser arms and per-run servers cause thrash (Lane budget). Many writers may run when each owns separate files.
- File ownership before launch: each brief names its files. Two lanes never write one file. A shared manifest has one owner; others add only their own directory.
- Contracts before code: a producer publishes its contract doc as its own commit first; the consumer reads it from remote `main`.
- Use maintained libraries under permissive licences for solved problems. Pick the simplest correct path a lane finishes in one pass. Split a module across lanes only at a file boundary in the brief.
- Rewrites of published history need the owner's approval (gm, Section 4). Lanes append; they never rewrite.

## Run ledger
- `.gm/pool/runs.jsonl`: one JSON line per run, append-only; the last line per `run` id is its state.
- Fields: `run` (`<parent>-<kind><k>`), `kind` (`exec`, `verify`, `ci`, `fix`, `hop`), `row` or `surface`, `sha` (full, when known), `state` (`launched`, `handoff`, `verified`, `ci-green`, `ci-red`, `fix`, `blocked`, `done`, `stale`), `session`, `started`, `updated` (UTC ISO-8601).
- Every transition writes its line in the same turn. Never rely on a lane's own log for state.
- Shared append logs (`.gm/pool/ledger-<wave>.txt`, `.gm/witness-log.md`, `.gm/lean-walk/new-nodes.jsonl`) have many writers: each line goes by `fs_write {"path":"<path>","content":"<line>\n","append":true}`. A whole-file write to these paths is refused (`append_only_rewrite_refused`), so a concurrent lane's line is never dropped.
- Each tick, before `pool-observe`: outstanding = last state not `done`, `blocked`, `stale`. Closable only when `verify` is `verified` and `ci` is `ci-green` for the same `sha`.
- Reconcile: outstanding `ci` run: `ci-status {sha}` replaces its conclusion. `exec`/`verify` run whose `.gm/pool/<session>.live` is older than 5 minutes is marked `stale`; relaunch its row fresh; never count stale as live.
- A `handoff` with no following `verify` or `ci` run is a defect: spawn the missing lane this tick.
- Summaries (outstanding, closable, stale, red) are derived each tick, never stored.

## Verification and CI lanes
- Executor ends `STATUS: handoff <sha>`. Orchestrator spawns, same turn, outside the executor: verifier (`gm-validate` as `mode=witness`, session `<parent>-v<k>`, a session other than the executor's) and CI reader (`gm-publish` steps 3-5, session `<parent>-c<k>`).
- `STATUS: fix` (verifier) or `STATUS: ci-red` (CI reader) starts a fresh executor for the same row with the sha and failing check or job. Takes a slot; never inline.
- The rollout lane that made the edit calls `prd-resolve` with its live witness. The test follow-up's CI read for that sha decides whether the row stays closed; a red job reopens it. Log each lane result to `.gm/witness-log.md` with its session id.
- Verification and CI never block the pool.

## Floor and dip
- Pending rows open: keep live ≥ floor. Pass ListAgents count as `body.live` on every `pool-observe` and `transition`.
- `floor_gate_denied` (live < floor, `open_rows > 0`, launchable rows advertised but not launched) is the launch signal, never a retry.
- `state: supply_exhausted` (ok, no error) on `pool-observe`: no open row is launchable and no traversal node is due. `held_rows` are running and are the only supply: wait for their completion, then re-observe. Never retry-loop.
- Live under ceiling with independent work open is a shortfall: log `FAILURE: <UTC> live=<n> pending=<m>` to `.gm/witness-log.md`, then launch to target this turn. Causes:
  1. Lane stopped: one successor per freed slot, never batched. Session killed: relaunch `.gm/pool/<session>.next` or a pending row.
  2. Lane stood down on a modified file: compare the blob with remote `main` first; no comparison, take another slice.
  3. Browser or GPU lock held: run node-only and non-GPU work meanwhile.
  4. `Prompt is too long`: relaunch compact (row, surface, session, one action). Never resume.

## Tick
1. `pool-observe {live, held}`. Take `slots.launch` (node-first, max 32). Empty under shortfall is a defect row, unless `state` is `supply_exhausted`.
2. Launch one block, up to ceiling. Rows: the `gm-prd` skill with `row=<id>; session=<SID>`. Hops: the `gm-hop` skill with `{"node":{...},"principle":"<id>","surface":"<path>","session":"<SID>","wave":"<wave>","depth":1,"rhetoric":""}`. `<SID>` = `<parent>-<k>`, unique. A cause-asserting row or hop runs its ACH step (gm-hop 3a, gm-prd SPECIFY) in the same launch.
3. Append (`fs_write` with `append:true`) `launch <id>` to `.gm/pool/ledger-<wave>.txt`, a `launched` line to `.gm/pool/runs.jsonl`, `tick <n> event=<id> live=<count> <UTC>` to `.gm/witness-log.md`.
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
- Each completed hop writes `.gm/lean-walk/<node.id>.<session>.json`. Missing: `prd-add` `gm-lean-walk-node-emission-missing-<session>`; not counted walked. Count of record is `emitted`.

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
- Convergence guard: pending rows rise two waves running: no new blockers; run only open blockers and rows until the count falls.
- A worker returning with no receipt or blocker is re-dispatched once per wave as `<session>-r<n>`. A connectivity-stopped worker is restarted (Connectivity restarts).
- `floor_gate_denied` on `prd-resolve` or phase advance: pass `body.live` and launch the denial's `slots.launch`.

## Decided work lands in the same turn
- A decision to do more work is executed in that turn. The orchestrator picks the most defensible default, records it as one line in `.gm/witness-log.md`, and runs it. Ending a turn with a decision waiting on the user is a defect.
- Only a Section 4 door (world-scoped, or one that reaches every session or production) is raised to the user, and it is raised as a final-message question while every other row keeps running. The orchestrator never blocks the whole pool on one.
- A live lock held by another lane (`store_busy`, `gm.db.lock` owner alive) is never killed or removed by the orchestrator. Default: retry the store call with `wait {"ms":60000}` up to 5 times. Still held after that: every affected row takes the store-free path (`codesearch` literal or filename, `Read` of located paths, `git_*` verbs), records the lock as its named fact, and is re-launched the moment the lock clears. No row waits idle on it.
- A row whose acceptance needs a live write to shared served state (a prose override, a store row, a witness that changes every session) is run against a disposable key the orchestrator names in its own brief, with the key recorded in the receipt. Only a Section 4 door is not defaulted this way.

## Starvation
- `pool-observe` dropped at 120 s with `dispatch_starved_waiting_for_serial_lane`: re-dispatch once, verbatim (never `resume_task`). First read `.gm/exec-spool/.dispatch-wait.json`: position 1 or holder near budget: re-dispatch now; behind a fresh holder: wait; not shrinking: slow holder.
- Commit ahead of push: wait. A push that waited out its budget keeps its place; re-dispatch once.
- `dispatch_orphaned` on a read-only verb: re-dispatch at once. Before re-dispatching `git_commit`, `git_finalize`, `git_push` or `fs_write`, re-read real state.
- Never preempt an executing holder. Never delete a `.live` file to free a slot, except the stopped worker's own claim under Connectivity restarts.
- Two starvations of one git verb: `prd-add` the paths and both dispatch ids, then stop git dispatches until a completion drains the queue.

## Connectivity restarts
- A subagent stopped by `ECONNRESET`, `ECONNREFUSED`, `server_error`, timeout or no response is restarted, never resumed, never a blocker. Fresh subagent, same row, session `<session>-r<n>`, same turn. Row stays open; slot stays held; never count it live.
- Claim release before restart: the stopped worker's `.gm/pool/<session>.live` is deleted by the orchestrator once its error reply is read (the error proves it stopped), so the Heartbeat skip rule does not hold the row for 5 minutes. The restart writes its own `.live` under `<session>-r<n>`. Exactly one `.live` per row at any time; no duplicate row is filed for the restart.
- `wait {"ms":30000}` between attempts while the error repeats. Log `restart <row> <n> <UTC>` to `.gm/witness-log.md`.
- Cap: at most 4 restarts per row (`<session>-r1` to `<session>-r4`). After the 4th failure, the row stops being restarted and files a blocker row naming the last error and its dispatch id, so a dead endpoint cannot hold a slot forever.
- Mass drop: `docs/recovery.md`, "Mass API-error drain".

## Headroom and leases
- Browser and server contention: Lane budget. A browser arm that cannot take the lease waits; node-only work continues. Log any wait with its cause and UTC; a wait does not end the turn.
- Rows needing an exclusive lock wait; the pool launches the rest. A timed-out lock wait is a failed run.
- One browser or GPU arm at a time, pool-wide; `gpulock` serialises the adapter only. One browser arm plus one node-only lane is fine; two browser arms are not. Lease held: take node-only work; never open a second browser.
- Browsers are CDP-driven and headful. Use the gm browser verbs (`crawl`, `chrome`; `skills/gm/docs/verbs.md`) only. Never install or download puppeteer, playwright, chromium or any browser package or binary, and never launch a headless browser (lightpanda, obrowser, `headless` launches are removed). A project's browser opens once and stays open: it closes only after 15 minutes with no lease holder or waiter, so runs never open and close it per call. Never touch the user's Chrome.
- EADDRINUSE: the witness did not run. Identify the owning process. Never kill another lane's process.
- Browser-last, minimal surface, cold-start and reload budgets, live witnesses in place of new test files, counted units, loud refusals: gm-prd, Witness economy.

## Lane budget (concurrency and thrash)
- Concurrency cap: 20 subagents (`ceiling`, the host spawn limit). It is not a throughput target and not a memory or thrash budget. Launch up to it while independent work is open.
- Thrash has two causes, and only these two:
  1. Multiple browser arms running at once. On 2026-10-14 several GPU browser arms ran together and the machine became unresponsive at roughly 10-16 lanes, needing a reboot.
  2. A new server plus bundle booted per run. Per-run servers leaked processes when a run hung.
- Target setup: one shared, HMR-capable dev server and client. Browser captures and probes attach to it and reuse it (page reload, or an HMR module edit). Never boot a new server and bundle per run.
- One browser arm at a time, pool-wide. Browser work queues behind `gpulock`. `gpulock` serialises the GPU adapter only: it does not serialise CPU, memory or disk, and it is not a machine-wide limit. Node-only and non-GPU work continues while an arm waits.
- A dropped connection is answered by restarting the lane (Connectivity restarts). Thrash is answered by fewer browser arms and shared servers. Neither is answered by a concurrency cap.
- No extra checkouts. the recursive tree listing `gh api repos/<owner>/<repo>/git/trees/<remote sha>?recursive=1`, read-only, is the sanctioned clean base (gm, READ questions).
- Publish on the first passing witness: time-box a lane to its witness, resolve, publish, keep going.

## Fan-out
- Independent slices (file, row, hop) launch in one block. Slices sharing a surface run in turn.
- Walk workers are gm-prd or gm-hop, never a fork. Each brief opens with the brick-wall opener and its own SESSION_ID (gm §1).
- Every brief reads the pending listing inside one `gm_codemode` body: `prd-list {"status":"pending"}` filtered in code to its own ids and subjects, returned as that list only. A brief never pulls the full listing into context.
- Verify a brief's source path (`codesearch {mode:"filename"}`) before launch. A wrong path is a blocked slot.
- `gm_processor_capacity` queues dispatches beyond it; it is not the subagent count.

## Shared-tree publish
One work tree, one git lane. Main only; no worktree, side branch or scratch checkout (gm, Autonomy).
- No extra checkouts. Clean base for measurement or bisect: `gh api repos/<owner>/<repo>/git/trees/<remote sha>?recursive=1` (gm, READ questions).
- A measurement taken in the shared work tree measures other lanes' uncommitted edits, not the project. Compare against remote `main` by content hash (`GET /contents/<path>?ref=main` (when its `content` is empty or the file is over 1 MB, fall back to `gh api /repos/<owner>/<repo>/git/blobs/<sha>` with the `sha` from that contents reply), or `gh api repos/<owner>/<repo>/git/trees/<remote sha>?recursive=1`) before calling a difference a regression; local HEAD lags remote and lies. Three false alarms in one day came from work-tree measurements: a "stale bake" whose two files were byte-identical to remote main, a bake pin whose inputs "were identical" and were not, and a 0.1506 m hover that reads 0.0000 m on main.
- Publish via the Git API: POST blobs; tree with `base_tree: <remote tip>`; commit parented on that tip; PATCH `refs/heads/main`, `force` unset; re-read each blob at `?ref=main` and verify it. Then read CI: wait up to 60 s for a `push`-event run on the full sha (`GET /repos/<o>/<r>/actions/runs?head_sha=<full sha>`). If none appears, `POST /repos/<o>/<r>/actions/workflows/<file>/dispatches` with `{"ref":"main"}` for each workflow that declares `workflow_dispatch` on gm main: bump-pins, contracts, discipline-tree, doc-drift, gh-pages, house-clean, link-check, npx-route, process-leak, skill-release (all ten; re-check the list if a workflow is added), then read the runs for that sha again. A dispatch-only run is never a witness for a row whose acceptance names a push-event run: it proves the workflow runs, not that the push triggered it. Such a row stays pending until a push-event run exists on the sha, or the sha is recorded as a residual naming the workflows with no push-event run. A sha with no run after that is a residual, not success. Witnessed case: agentplug a9007880 edited `release.yml` and got only `workflow_dispatch` runs, no `push` run.
- `git_finalize` refusing to push over a sibling's dirty path is redundant when its content is already published. Never reset `refs/heads/main` under running lanes.
- `remote_moved` on a dirty tree: `git_status {"paths":[...]}`, commit or revert each path in its owning lane, then `git_push {rev:"<sha>"}`.
- `remote_moved` plus conflicted `git_pull` (`conflicted: true`, `MERGE_HEAD` present): `git_merge_abort` only for a merge this lane opened (gm, Collisions); reapply each lane path on the current remote tip and publish it through the Git API (above). Never `git_reset` `refs/heads/main`. Confirm with `git_remote` and `ci-status`.
- Collision and commit identity: gm, Autonomy.

## Editing the skills
Skills under `skills/` are live on the next dispatch. Check `.git/MERGE_HEAD` first. Publish path-scoped, push the full sha, then `ci-status`. Steps: `docs/recovery.md`, "Editing the skills".

## Finish the work

- Finishing the requested work is the goal of every run of this skill. A run that stops with work left undone is incomplete.
- When an issue blocks a step (a failing check, a fault in a tool or service, a missing input, a network or environment fault), fix it in the same run: retry on a bounded or resumable route, use an alternate route to the same result, repair the fault where it originates, then continue the remaining work.
- Stop only when the requested work is complete, or when a step is still blocked after every route has been tried. Then report the blocked step, the routes tried, and the evidence for each.
