---
name: gm-orchestrate
description: "Main-thread pool loop for a gm walk that has advertised PRD rows or hops: fans out as many parallel graph workflows as the work allows, refills slots, and exits only at zero pending rows. Invoke only from gm; do not load directly. Hop rules are in gm-hop, PRD-row rules in gm-prd."
---

# gm-orchestrate

Pool and publish rules. Shared rules (autonomy, git identity, CI read, collisions, exit): gm. Recovery: `docs/recovery.md`.

`ceiling` = the harness's live concurrent-subagent limit, read from its refusal message (`You can run N subagents at once`) or from the harness, never written into this skill. It is the only bound on concurrency: `free` = ceiling - live. `live` = the count of live subagents. `floor` = min(2, ceiling). `shortfall` = live < floor with independent work open.

## Standing pair (every run)
Every gm run (the `gm` prompt) executes the drain procedure below in its first turn, before any other fan-out, through gm verbs and the harness's own parallel workers (subagents or background tasks). No workflow file or harness-specific runner is needed. Where the harness has no parallel workers, the groups run in sequence through the same loop.

1. **Plan once.** List pending rows in pages of at most 50: `prd-list {"status":"pending","limit":50,"offset":N}` for N = 0, 50, 100, ... until a page returns fewer than 50 rows. Never request the whole list in one call: a full pending list exceeds the tool-result cap and the drain never starts. Group rows by the `[repo:] [group:]` prefix of their description; a row without a prefix forms its own group. Record the plan (units, row ids) with one append line per unit to `.gm/pool/plan-<run>.txt`. Units are split as the Launch loop states.
2. **Drain, in parallel.** Each unit works its rows in order. Launch at most `free` units in one block (Launch loop, rules 2 and 3). Queue the rest and launch each queued unit in the same turn a slot frees. A refusal ("Concurrent subagent limit reached") means wait for a slot: re-launch that item when a completion frees one, never retry in a loop, never drop it. Agents may edit the same file in parallel: each re-reads the file immediately before its edit and applies its change to the current state, never to a remembered copy. A dirty or diverged checkout is consolidated by the lane that owns it before the row's commit, never worked around. A bundle owns the rows it is given: ownership is never a blocker. Each row runs the gm-prd stages (orient through publish, then `prd-resolve` with a live witness). A row attempted in a run is not retried in that run. There is no blocked state: a row whose attempt ends without a witness keeps its work open, and the next launch does the missing step (edit, build, push, CI, or a live witness from another session). A row whose premise a live read refutes (the named symbol, file, job or sha is absent or already fixed) closes with `prd-resolve {"id":..., "resolution":"stale"}`. Its witness must come from a session other than the resolver's: file the refuting dispatch ids with `prd_witness_request`, then a verifier session runs `gm-prd` with `mode=witness` and resolves. A self-witness is refused (`prd-resolve-self-witness`): witness dispatches use a SESSION_ID distinct from the resolve call's (resolver `drain-<bundle>`, witness `verify-<row>`), and the witness dispatch id must appear in `.gm/exec-spool/.dispatch-ledger.json` before `prd-resolve` is called. A row is never parked: every round re-lists the open rows and every open row is attempted. A row whose fix lives in a submodule first moves that submodule to its remote `main` tip; a dirty or diverged submodule blocks the row with that fact named. Call shapes: `prd-block` takes `note`, `prd-resolve` takes `resolution` (no `note`); one row is read in full with `prd-list {"id":"<row id>","full":true}`.
3. **Validate per batch.** When a group's commits land, read `ci-status {sha}` for each pushed sha; a group closes its rows only after those reads. Do not wait for the whole drain. A red job goes back to the row that owns the failing file (`prd-add` fix row, taken by that row's lane). Validation never runs on uncommitted work.
4. **Close.** `prd-resolve` with the commit sha as witness. Then remove `.gm/prd/<id>.yml` and `.gm/receipts/<id>/` if they remain. The commit body carries `Row: <id>` on its own line, so the git log records each finished row. A commit stages only its own explicit paths and refuses when other paths are already staged, so it never sweeps in another lane's work. A commit that needs amending is amended once; if the amend does not return, re-read the commit (`git_show`) and never retry it in a loop.
5. **Re-plan.** After each round, repeat from step 1 with a fresh paged listing. Continue until the pending backlog is empty. A round that closes no row is a stall: change the brief or the blocker's route, then run the next round. A stall never ends the drain, and rows that could not close are retried in the next round.
6. **Rollout.** Traversal (gm-hop over `skills/dream-rsi/gm-graph.json`) and new-row finding run in free slots only while fewer than 20 rows are open. At 20 or more open rows they wait, and the drain has the slots.

### Launch loop (binds steps 1, 2 and 6)
1. **Units.** A unit is one file group's rows, at most N rows, with N set by the orchestrator for the run (never a fixed global number). Units in different file groups are independent and launch together. A unit is never a whole repo. Triage and drain units are per row or per small file group.
2. **Queue and launch.** Build the queue of units from the plan. Launch `min(free, queued units)` in one tool-call block. `free` comes from the harness: launch, and each refusal names the cap (`You can run N subagents at once`). A refused unit stays queued.
3. **Refill.** When any launched unit returns, launch the next queued unit in that same turn, without waiting for the other launched units. Units that touch disjoint files are never serialized. A turn never ends while the running count is below the cap and the queue holds a unit: refill first, then end the turn. Each refill re-lists the pending page (`prd-list` with `limit` 50) only when the queue runs low, so one listing feeds many refills.
4. **Measure.** Every launch and refill appends one line to `.gm/pool/launch-log.tsv`: `ts<TAB>event<TAB>unit<TAB>running_before<TAB>running_after<TAB>cap`, where `event` is `launch`, `refill` or `refused`, and `running_*` is the live count of subagents still running at that moment. The run's final message reports the peak `running_after` and the refill count, both read from this file. A run with no launch log has no concurrency evidence and is incomplete.
5. **Defect rule.** A non-empty queue with the running count below the cap is a defect: relaunch to the cap before any other action.
6. **Forbidden.** One agent for a repo's whole backlog; running repos one after another; holding a queued unit until another repo finishes; dropping a refused unit.
7. **Shared files.** Parallel edits to one file are allowed only when each agent re-reads that file right before its edit (step 2).
8. **Mark-and-launch atomicity.** A queue row is marked `launched` in the same tool-call block that starts its agent, and that agent's brief carries the exact queue id inline. A brief never says "await an id", "use the id below" or "pick the first pending row"; each brief is complete when it is sent. A row that cannot be launched in the block that marks it is returned to `pending` before the block ends. After a launch, the `launch-log.tsv` line names the same id the agent received.

Every run, however it ends, is followed by the `gm-continue` handoff (gm SKILL.md, Routing), which searches for remaining work and reloads gm when work remains.

### Resumable drain (queue file)
Durable state: `.gm/drain-list/queue.tsv`, one `id<TAB>state` line per row. The `id` is the PRD row's inner id (the `id:` field in `.gm/prd/<file>.yml`, read with `prd-list {"id":..., "full":true}`), never the file name, which can differ and never matches on lookup. States: `pending`, `launched`, `resolved`, `stale`, `real` (premise confirmed live, row still open), `unknown` (no witness obtained), `blocked` (has `blocker_notes`). Any session continues from this file. Where it conflicts with `prd-list`, `prd-list` wins.
1. **Session start.** Read the file. Each `launched` row came from a prior session: re-check it with `prd-list {"id":"<id>","cwd":"/workspace/gm"}` and set its state to the row's real state (closed resolved or stale, still open with notes, or `pending`). The `pending` rows are the queue.
2. **Launch.** Mark each unit's rows `launched` before its launch block, so a crash leaves a recoverable marker. Launch `min(free, queued)` units in one block, one unit per row or small file group. `free` is read live (Lane budget), never a number written here. A refused unit goes back to `pending`.
3. **Refill.** When any unit returns, record its outcome in the file in that same turn (one write per block, covering every outcome in it), then launch the next `pending` unit at once (Launch loop, rule 3).
4. **Blocked rows.** A `blocked` row is skipped only when this session re-checks its named blocker live and it still holds, with the dispatch id recorded. Otherwise it returns to `pending`.
5. **Validate.** After each committed batch, `ci-status {sha}` for every pushed sha, before the batch's rows move to `resolved`.
6. **Measure.** Count peak concurrent units and refills for the session; the final report carries both.
7. **Session end.** If any row is `pending`, the last step of the session is reading the `gm-continue` prompt. Never end with pending rows and nothing launched: relaunch to the cap first, or wait for a completion.

## Core loop
Repeat until a full pass adds no work:
1. **Drain concurrently.** Rollout lanes resolve, commit and publish open rows as they are filed.
2. **Validate after commit.** The test follow-up validates each committed batch and turns red jobs into fix rows on their file groups.
   - Sweep first: one subagent per failing job log, changed file group, stub/TODO. Each returns located `path:line` and counts only; each finding becomes a row. Fix only after the sweep completes.
   - One fix executor per independent file group; fixes sharing a file run in sequence in one executor. One commit per group, never per finding.
3. **Traverse when nearly drained.** At fewer than 20 open rows, graph hops fill free slots and file new rows. They run alongside steps 1 and 2.
4. Repeat from 1.

## Parallelism: graph workflows
- Fan-out unit: one subagent per row (`gm-prd`) or per hop (`gm-hop`), launched in one block up to `free`; the rest queue and launch as slots free. Rows of one file group run in sequence; groups run in parallel.
- Each round takes its listing in pages of at most 50 (Standing pair, step 1), never the whole pending list in one call. A round returns `{pending_before, resolved, blocked, failed, new_blockers, peak_parallel}` and the next round starts from a fresh listing. Refusals and stalls are answered by the next round, never by stopping. A group that resolves nothing is re-run once with its blockers split.
- `pending_after > pending_before` halts new blockers until a merge pass closes duplicates.
- No fixed run total: rows and the harness cap bound launches. A cap hit queues the launch and resumes it as slots free. A stalled run is re-briefed, never relaunched unchanged.
- Three loops, each run to exhaustion: (1) row drain, Standing pair steps 1-5, until pending = 0 or a round closes no row; (2) traversal, one `gm-hop` per principle node in `skills/dream-rsi/gm-graph.json` per surface, emitting rows, until every node has a receipt per surface, running only while fewer than 20 rows are open; (3) audit, a completeness critic whose findings become rows for loop 1.
- Drain before make. Pending >= 20: the drain takes every free slot. Pending < 20: traversal takes free slots (computer-science disciplines first) until pending reaches 20.
- Repeat 1-3 until a full cycle adds and resolves nothing. A round resolving 0 rows with pending rows left is a stall: change the brief, rerun. Never stop on a stall alone.
- Ceiling and floor bound live subagents (Lane budget). Refill a freed slot in the same turn.

## Publish first, test concurrently
- Publish first: each rollout lane publishes its commit without waiting on CI or browser tests. Tests, CI and CD run in the concurrent test follow-up, never as a gate on rollout.
- Fix after commit: the test follow-up validates committed batches, groups failures by cause and file, and hands each group to the lane that owns that file, or to a new fix lane when no lane holds it. Collisions in a shared file are repaired here, by validation after the batch commits; a red result goes back to the row that owns the failing file.
- Witness: a rollout lane closes its own row with a live witness dispatch on its pushed sha. The test follow-up reads CI for that sha; a red job reopens the row with a `prd-add` fix row, which the next pass takes.
- No `cargo`, `go build`, `go vet`, `go test`, or local compile unless the user turns builds on. Check that setting first (gm config or served instruction); a local run is allowed when it is on. Witnesses are live dispatches, which never wait on CI. The test follow-up reads `ci-status` for each pushed sha. A failing sha becomes a fix slice, never a pause.
- Writers are light; writers are not limited. Only browser arms and per-run servers cause thrash (Lane budget).
- Shared files: agents may edit the same file in parallel. Each re-reads the file immediately before its edit and applies its change to the current state, never to a remembered copy. Each brief names its files so the commit can stage exactly them.
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
- Pending rows open: keep live >= floor. Pass the live subagent count as `body.live` on every `pool-observe` and `transition`.
- `floor_gate_denied` (live < floor, `open_rows > 0`, launchable rows advertised but not launched) is the launch signal, never a retry.
- `state: supply_exhausted` (ok, no error) on `pool-observe`: no open row is launchable and no traversal node is due. `held_rows` are running and are the only supply: wait for their completion, then re-observe. Never retry-loop.
- Live under ceiling with independent work open is a shortfall: log `FAILURE: <UTC> live=<n> pending=<m>` to `.gm/witness-log.md`, then launch to target this turn. Causes:
  1. Lane stopped: one successor per freed slot, never batched. Session killed: relaunch `.gm/pool/<session>.next` or a pending row.
  2. Lane stood down on a modified file: compare the blob with remote `main` first; no comparison, take another slice.
  3. Browser or GPU lock held: run node-only and non-GPU work meanwhile.
  4. `Prompt is too long`: relaunch compact (row, surface, session, one action). Never resume.

## Tick
1. `pool-observe {live, held}`. Take `slots.launch`, at most `free`. Empty under shortfall is a defect row, unless `state` is `supply_exhausted`.
2. Launch one block of at most `free`; the rest of `slots.launch` queues. Rows: the `gm-prd` skill with `row=<id>; session=<SID>`. Hops: the `gm-hop` skill with `{"node":{...},"principle":"<id>","surface":"<path>","session":"<SID>","wave":"<wave>","depth":1,"rhetoric":""}`. `<SID>` = `<parent>-<k>`, unique. A cause-asserting row or hop runs its ACH step (gm-hop 3a, gm-prd SPECIFY) in the same launch.
3. Append (`fs_write` with `append:true`) `launch <id>` to `.gm/pool/ledger-<wave>.txt`, a `launched` line to `.gm/pool/runs.jsonl`, and `tick <n> event=<id> live=<count> <UTC>` to `.gm/witness-log.md`.
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
- Each completed hop writes `.gm/lean-walk/<node.id>.<session>.json` before its `subagent-end`, which refuses a `done` hop whose receipt is missing (`hop receipt missing`). A refused hop is re-dispatched once as `<session>-r<n>`; a receipt still missing after that files `prd-add` `gm-lean-walk-node-emission-missing-<session>` and the hop is not counted walked. Count of record is `emitted`.

## Heartbeat
- Every brief first writes `.gm/pool/<session>.live` (`session`, `row`, `start` ISO-8601 UTC; a hop's `row` is its surface path) and deletes it on finish. A surface-only heartbeat is `malformed_heartbeats`.
- Skip any id held by a live row before launch. Older than 5 minutes = stale.
- A lane silent for 30 minutes must be checked by its output file size and a landed-commit check, then stopped and relaunched narrower if nothing has landed.

## Shortfall and FAILURE
- Two restarts per walk. Repeated shortfall means these rules are wrong: dispatch `instruction`, correct this skill, restart at tick 1.
- A third repeat files `<row>-blocker-<session>` and launches the blocker next wave.

## Never leave a row open
- A run ends as `prd-resolve` with a witness, or as blocked. Stalls, blocked workers, refused witnesses and ended sessions never close the walk.
- Every gm call in every brief passes `cwd: "<gm-root>"` (or the row's project root). A call without `cwd` reads another project: "row not found" or "pending 0" from a brief is a wrong-project defect, not a blocker. Re-check with `cwd` before any blocker is filed.
- A resolver runs every stage of its row in its one run (orient through publish, then prd-resolve). Stopping after one stage with the row open is a defect: re-dispatch the same row once as `<session>-r<n>` naming the stage reached, never a fresh orient.
- A blocked row keeps its id and names `blocked_by: <fact and verb>` in its text. File a new blocker row only when no open row names that fact. Counts are unique open rows.
- Blockers launch next wave. A blocker that blocks again is split until one step remains; that step runs. No blocker-of-blocker past one level.
- Convergence guard: pending rows rise two waves running: no new blockers; run only open blockers and rows until the count falls.
- A worker returning with no receipt or blocker is re-dispatched once per wave as `<session>-r<n>`. A connectivity-stopped worker is restarted (Connectivity restarts).
- `floor_gate_denied` on `prd-resolve` or phase advance: pass `body.live` and launch the denial's `slots.launch`.

## Decided work lands in the same turn
- A decision to do more work is executed in that turn. The orchestrator picks the most defensible default, records it as one line in `.gm/witness-log.md`, and runs it. Ending a turn with a decision waiting on the user is a defect.
- Only a Section 4 door (world-scoped, or one that reaches every session or production) is raised to the user, as a final-message question, while every other row keeps running. The orchestrator never blocks the whole pool on one.
- A live lock held by another lane (`store_busy`, `gm.db.lock` owner alive) is never killed or removed by the orchestrator. Default: retry the store call with `wait {"ms":60000}` up to 5 times. Still held after that: every affected row takes the store-free path (`codesearch` literal or filename, `fs_read` of located paths, `git_*` verbs), records the lock as its named fact, and is re-launched the moment the lock clears. No row waits idle on it.
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
- Browsers are CDP-driven and headful. Use the gm browser verbs (`browser`, `chrome`; `skills/gm/docs/verbs.md`) only. Never install or download puppeteer, playwright, chromium or any browser package or binary, and never launch a headless browser (lightpanda, obrowser, `headless` launches are removed). A project's browser opens once and stays open: it closes only after 15 minutes with no lease holder or waiter, so runs never open and close it per call. Never touch the user's Chrome.
- EADDRINUSE: the witness did not run. Identify the owning process. Never kill another lane's process.
- Browser-last, minimal surface, cold-start and reload budgets, live witnesses in place of new test files, counted units, loud refusals: gm-prd, Witness economy.

## Lane budget (concurrency and thrash)
- Use as many sessions as the work needs. There is no session budget: launch every independent slice, and refill each freed slot in the same turn. The harness's live limit (`ceiling`, read at run time) is the only ceiling; a refusal at that limit is a wait, never a stop. It is not a throughput target and not a memory or thrash budget.
- Thrash has two causes, and only these two:
  1. Multiple browser arms running at once. On 2026-10-14 several GPU browser arms ran together and the machine became unresponsive at roughly 10-16 lanes, needing a reboot.
  2. A new server plus bundle booted per run. Per-run servers leaked processes when a run hung.
- Target setup: one shared, HMR-capable dev server and client. Browser captures and probes attach to it and reuse it (page reload, or an HMR module edit). Never boot a new server and bundle per run.
- One browser arm at a time, pool-wide. Browser work queues behind `gpulock`. `gpulock` serialises the GPU adapter only: it does not serialise CPU, memory or disk, and it is not a machine-wide limit. Node-only and non-GPU work continues while an arm waits.
- A dropped connection is answered by restarting the lane (Connectivity restarts). Thrash is answered by fewer browser arms and shared servers. Neither is answered by a concurrency cap.
- No extra checkouts. The recursive tree listing `gh api repos/<owner>/<repo>/git/trees/<remote sha>?recursive=1`, read-only, is the sanctioned clean base (gm, READ questions).
- Publish on the first passing witness: time-box a lane to its witness, resolve, publish, keep going.

## Fan-out
- Independent slices (file, row, hop) launch in one block. Slices sharing a surface run in turn.
- Walk workers are gm-prd or gm-hop, never a fork. Each brief opens with the brick-wall opener and its own SESSION_ID (gm section 1).
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
The rule in `skills/gm/SKILL.md` (Finish the work) applies to every run of this skill unchanged.
