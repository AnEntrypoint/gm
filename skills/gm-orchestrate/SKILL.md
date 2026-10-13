---
name: gm-orchestrate
description: "Main-thread pool loop for a gm walk: observe, launch advertised rows and hops, log, wait, refill, exit. Invoke only from gm; do not load directly. Pool rules are defined here; hop rules are in gm-hop, PRD-row rules in gm-prd."
---

# gm-orchestrate

Owns the pool rules. Dated measurements behind each rule: `docs/incidents.md` (same folder). Other rule owners: gm (general policy, git publish, precedence), gm-hop (hop rules), gm-prd (PRD-row rules).

## Terms
- `ceiling`: N in a spawn refusal ("can run N subagents at once"). Found by launching, never a constant. Hold at or just below it while work remains. `target` = ceiling.
- `live`: launched minus done ids in `.gm/pool/ledger-<wave>.txt`. Count of record: ListAgents, cross-checked against fresh `.gm/pool/*.live` (at most 5 min old). `slots.live` and `concurrency_shortfall.running` are not the count. Ledger `live` is advisory once self-spawning agents are in the wave.
- `floor` = min(10, ceiling). `REFILL_FLOOR` is `rs-plugkit/crates/plugkit-core/src/orchestrator/pool_slots/mod.rs:17`, capped by the ceiling at `pool_slots/floor.rs:62` and `:89`.
- `shortfall`: live < floor while independent work is open and headroom is ok.

Floor rules:
- While pending PRD rows are open, live subagents must be at least the floor. Launch a shortfall to the floor in the same message.
- A turn does not end, and no completion report is made, while live is under the floor and independent slices remain.
- Pass the ListAgents count as `body.live` on every `pool-observe` and `transition` call. With no fresh record the gate reports count_of_record absent and does not deny.
- `floor_gate_denied` fires when `body.live` is under the floor and `open_rows > 0`.
- A mass drain halves `target` for its incident window only. The next clean completion batch restores `target` to the ceiling at once.

## Never let the pool dip

Live under the ceiling while independent work is open is a shortfall, every time. Every dip has one of four causes. Each has one counter-instruction, and none licenses a smaller pool.

0. **Judge the average, and check at turn start.** Every tick logs `live` to `.gm/witness-log.md`. A dip is a mean of live under the floor across the ticks since the last full refill, or a turn that begins with live under the floor and open rows. Either one logs `FAILURE` and runs tick 1 before any other step, then the four causes in order.
1. **A lane stopped and nothing refilled it.** One successor per freed slot, in the same turn as the notification, never batched or deferred. A lane killed by a session boundary is a freed slot too: relaunch its parked `.gm/pool/<session>.next` spec, or a pending row, in that turn. Live at 0, or under the last ceiling with work open: spawn a full batch in the same turn.
2. **A lane stood down over a file that "looks modified."** Compare the worktree blob to REMOTE main (`branch_status`, or `git_diff` against the remote tip) before standing down. With no way to compare, take another slice instead. Local HEAD lags remote main constantly.
3. **A lane blocked on a serialized resource.** The accelerated-browser lease and the GPU lock admit one holder each. One waiting lane never idles the rest of the pool: spawn the node-only and non-GPU work meanwhile.
4. **A brief grew until its agent died with `Prompt is too long`.** A brief carries row id, surface, session and one action, and nothing else. Relaunch a dead-long agent COMPACT from that brief. Never resume it, because a resumed agent carries the context that killed it.

## Tick
1. Observe: count live (ListAgents, `.live` files). Dispatch `pool-observe {live:<integer count>, held:[...]}`. `live` is an integer, 0 included; a boolean leaves `count_of_record: absent`. Take `slots.launch` (node-first, from `slots.candidates`, at most 32). Empty while shortfall > 0 is a defect row. A `floor_gate_denied` refusal at live under the floor is the launch signal, never a retry. A brief for a row comes from `pool-brief {row, session, role}` (role `resolver` or `traversal`); a call missing any of the three answers `error_code: failed` and names them.
2. Launch in one tool-call block, up to the ceiling. Rows first: `Skill(skill="gm-prd", args="row=<id>; session=<SID>")`. Then hops, one per untraversed principle node of `skills/dream-rsi/gm-graph.json` not in `visited`. Launch each hop as a NODE, never as a bare name: `Skill(skill="gm-hop", args='{"node":{"id":"<id>","label":"<label>","book":"<book>","author":"<author>","kind":"<kind>","advocate":"<author> - <book>","links":[{"to":"<id>","guards":["<condition>"]}]},"principle":"<id>","surface":"<path>","session":"<SID>","wave":"<wave>","depth":1,"rhetoric":""}')`. Build `node.links` by the rule in Node-to-node hop payloads. `<SID>` = `<parent>-<k>`, unique.
3. Log `launch <id>` to the ledger and `tick <n> event=<id> live=<count> <UTC>` to `.gm/witness-log.md`.
4. `wait {"ms":60000}`. Each completion appends `done <id>` and refills its slot this turn, before any other step.
5. Re-count live after each launch and each completion. Log the tick: live, ceiling, rows executing, hops running, outcomes since the last tick.

Launch only advertised ids; no manual fill. A slot stays empty only when no pending row and no untraversed node remain.

## Node-to-node hop payloads

- A hop is an EDGE, not a discovery: nominate it FROM the node it stands on TO a named neighbour that node links to.
- `skills/dream-rsi/gm-graph.json` is the only source. Read it at launch time. `node_count`/`edge_count` in it are stale hand-written fields: never take a count from them.
- `node.id`, `node.label`, `node.book`, `node.author`, `node.kind` come from the `nodes[]` entry. A node carries no `phase`: the graph has no phases, and a hop is nominated along an edge, never into a bucket.
- `advocate` is `"<author> - <book>"` (the shape gm-hop step 0 expects). Use the bare `book` when `author` is `unattributed`.
- `node.links` has one entry per `edges[]` entry whose `from` equals `node.id`, of BOTH `kind`s: `forward` AND `backreference`. Keep the backreference exits: they are how a walk re-enters ground an earlier hop changed.
- Each link entry is `{to, guards}`. `guards = []` when `condition` is null, else `[condition]`. Sort links lexically by `to` (gm-hop requires that order). A link carries no direction, position or edge kind, so a hop cannot tell a re-entry from an advance. That is the point.
- An edge whose `to` is not an `id` in `nodes[]` is never put in `links`. Instead `prd-add` `gm-graph-dangling-edge-<from>-<to>`. Dropping it silently would leave a node whose only exit is invisible.
- A node with `links: []` is still launched, because the discipline runs. Its receipt says `next: none`.
- `principle` is still sent and equals `node.id`, for backward compatibility. `node` is authoritative whenever both are present. A payload with `principle` and no `node` is stale: gm-hop answers it `VERDICT: NOT-APPLICABLE` and writes nothing.
- The ledger `launch` line carries `from=<id> links=<n>`. Check every receipt's `next:` against the `links[].to` that hop was launched with. A `next:` outside that set was not nominated from a neighbour: do NOT build a child from it. Log `nomination-not-from-links <UTC> from=<id> next=<id>` to `.gm/witness-log.md` and `prd-add` `gm-hop-nomination-not-from-links-<from>-<to>`.
- Count `link_hops` (receipts whose `next:` is in the launched links) against `non_link_nominations` per wave. A wave that launched hops and reports `link_hops == 0` carried no links: treat it as a derivation defect.
- `links=0` on a launched node is always a derivation defect, never a graph fact.

## Refill and successors
- Every completion: one replacement per freed slot in the same turn. Never wait for a batch. Pass the completed worker's row, surface and session to its replacement. Read the live count after the refill.
- Refill while rows are open: launch `ceiling - live`.
- Successors come only from `slots.candidates` (node-first). A free-text nomination is advisory: read its acceptance text, then launch only if it is in candidates and node-only. Check title-only nominations before launch.
- A declined or colliding successor is replaced in the same turn by the next eligible candidate.
- A worker that ends at a blocker is not a replacement. Blocker rows are annotations, never candidates. A blocked worker records its blocker and still nominates a node-only successor.
- A hop spawns its own successor (gm-hop). The orchestrator spawns one only when a hop returns `next: none`.
- Node supply: when node candidates fall below twice the floor, start a traversal hop. It logs node-only rows and resolves none.
- Low row supply: dispatch hops that create rows (`prd-add`) before more resolvers. Pause row creation when rows resolve faster than the pool refills.
- Candidates empty while rows are pending: read open rows with `prd-list {status:"pending", limit:<n>}`. `total` counts every match, `store_total` the file, `truncated` says the window was cut. Use `exec_js` over the result only to fold repeated blocks of one id to the last one. Log the empty list as a defect row.
- Each brief names its row from `prd-list {status:"pending"}` or a listing of `.gm/prd/` (one file per row, `<id>.yml`; pending = status not resolved). Its successor comes from a real pending row.
- If `prd-list` refuses, repair the named row file before any launch. A refusal names one file, and it is that file you repair, never a shared store.
- Open-PRD growth between checks is a failure: drain by dispatching gm-prd on open rows before any other step.
- A replacement wave launches only after the gate runtime is confirmed loaded (the status file reports the new plugkit). Otherwise log a canary alarm and do not re-spawn.
- **Node emission is asserted.** Each hop emits `.gm/lean-walk/<node.id>.json` (rule in gm-hop, Node emission). On every completion that file must exist for the node the hop was launched with. A completed hop with no file emitted no node: `prd-add` `gm-lean-walk-node-emission-missing-<session>` and do not count the node as walked.
- The count of record is `emitted`: the node files this wave's hops wrote, read from the directory, never from a receipt's claim. A wave of completed hops with `emitted == 0` is a producer that consumes surfaces and emits nothing.
- Executors need a row that names its file (gm-prd).

## Heartbeat
- Every brief opens by writing `.gm/pool/<session>.live` on start: exactly three lines, `session: <session>`, `row: <row id>`, `start: <ISO-8601 UTC>`. Delete it on finish. A brief without this step is refused.
- A wave launched without the heartbeat step cannot be de-duplicated. `slots.live_rows` and `live_heartbeats` are empty while no brief wrote its `.live` file.
- Before launching, match each advertised id against the live agents' rows (ListAgents descriptions plus the `.live` files). Skip a match and take the next unheld candidate in the same turn. An advertised-but-held row is two writers on one surface.
- Format (session, row, start), the read-before-write check and the 5-minute refresh: `gm-config/prose/worker-rules.md` section 1. Refresh at any gm call, including during lock waits.

## Shortfall and FAILURE
- `shortfall` while work is open: log `FAILURE: <UTC> live=<n> pending=<m>` to `.gm/witness-log.md`. It is a log event, not a PRD row, and prd_pending_count is unchanged. Then launch to the target in the same turn. Read count and timestamp at check time, never estimated.
- Two restarts per walk. A repeated shortfall means these rules are wrong: dispatch `instruction`, correct this skill, restart at tick 1. A third repeat files a blocker row (`<row>-blocker-<session>`, `prd-add`) and stops.
- Floor gate: `prd-resolve` and phase advance are denied (`floor_gate_denied`) while rows are open and the count of record is under the floor. The denial names pool-observe, slots.launch and refill_needed. Pass body.live to pool-observe on every call (kept 5 min in `.gm/pool/count-of-record.json`). With no fresh record there is no denial; the reply says `count_of_record: absent`.
- On live 0 with rows pending and candidates empty, refill from a pending-row scan in the same turn. Recorded drops are in `docs/incidents.md`.

## Observation and git-lane starvation (state lane)

- `pool-observe` runs on the project's state serial lane, one dispatch at a time. Under a saturated pool it queues behind subagent writes and is dropped unexecuted at 120 s with `error_code: dispatch_starved_waiting_for_serial_lane`, `executed: false`, `re_dispatch_safe: true`.
- A starved observation is neither a stop nor a shortfall. Re-dispatch `pool-observe` once in the same turn.
- On a second starvation: take the count of record from ListAgents plus `.gm/pool/ledger-<wave>.txt`. Keep launching node-first candidates from the last non-starved `slots.candidates`, or from a pending-row scan through `exec_js` over `prd-list`. Log `lane-starved <UTC> live=<n>` and refill without waiting for the verb.
- Read `.gm/exec-spool/.dispatch-wait.json` before re-dispatching a starved verb. Every row carries `lane_position` (1-based; 1 = admitted the moment the holder releases), `lane_holder_age_ms`, `lane_holder_task`, `lane_holder_verb` and `lane_waiters`.
- Position 1, or a holder age near the budget: re-dispatch now. A position above 1 behind a fresh holder: wait, not retry. A position that does not shrink is a slow holder, not an unfair lane. A holder running a multi-thousand-path `git_finalize` or `git_push` legitimately holds the lane for minutes.
- Re-dispatch a starved verb verbatim, and never `resume_task` it. Change no byte of the body, not even a session-unique field, or the retry mints a new place at the back. The starvation answer carries `re_dispatch_keeps_lane_place: true`.
- A waiting `git_push`, `git_pull` or `git_fetch` yields the lane to a checkout-bound git verb behind it, for its first 120 s of waiting only (`LANE_NETWORK_YIELD_MS`, override `AGENTPLUG_LANE_NETWORK_YIELD_MS`). The lane stays single-writer: nobody passes the RUNNING holder.
- A commit queued behind fresh pushes may be admitted ahead of them. So "a push is queued ahead of me" does not mean "I wait for that push": read `lane_position` and `lane_holder_verb`. A position above 1 with the holder `claimed_running` means wait for the holder.
- A push that already waited out its budget keeps its place. A push starvation ends by re-dispatching once, never by queuing more pushes behind it.
- `dispatch_orphaned` for a claim minutes old is real news, not a sweeper race. Re-dispatch a read-only verb at once. Before any `git_commit`, `git_finalize`, `git_push` or `fs_write` re-dispatch, re-read the real state (`git_status`, `fs_read`), because the work can have applied before the daemon died.
- An executing holder is never preempted. Lane starvation ends by waiting or re-dispatching, never by expecting the holder to be cut short.
- **The publish is one git dispatch per wave.** Two starvations end the attempt. Read `lane_position` and `lane_holder_age_ms` first: position 1 behind an old holder, re-dispatch once. On a second starvation, `prd-add` a row naming the paths and both dispatch ids. Then stop dispatching git until a completion notification drains the queue. The tip is pushed once, by whichever git dispatch next reaches the lane, and it carries every ancestor commit.
- The admission band is process-wide, shared by every project the daemon serves. A git verb that waits is usually waiting on that band, not on the git lane. An admission hold is a 60 s lease: past it, a dispatcher that cannot get in takes the oldest over-age counter back. Read `admission_holds` in `.dispatch-wait.json` for holders and ages. Re-dispatching a verb stuck behind the band never helps.
- A repeated saturated observation is zero new information. While `live == ceiling` and `free_slots: 0`, do not re-dispatch `pool-observe` on a timer. `wait {"ms":60000}`, and re-observe when a completion frees a slot or a heartbeat ages past 600 s. The count of record meanwhile is ListAgents plus `.gm/pool/ledger-<wave>.txt`.
- The ledger `live` is inflated by self-spawned successors. Take `live` from ListAgents. Never delete a `.live` file to manufacture a free slot.
- A parked `.gm/pool/<session>.next` spec is the first refill candidate (dip cause 1). Relaunch it before any fresh surface on the next freed slot, and delete the parked file once the relaunch is accepted.
- A receipt message is not a freed slot. An accepted spawn is the only proof of one. On a refusal: park the spec, spend the turn on non-spawn work (the git wave, PRD rows, the witness log), and probe again only after a completion notification. At most one probe per notification.
- `max_chars` is not honoured by `pool-observe`. Budget ~16 kB per observation and never re-dispatch for a shorter reply. Page the `spill_file` instead.

## Mass API-error drain

A subagent that stops with `API Error: Connection dropped (ECONNRESET)`, `ECONNREFUSED`, or `error type: server_error` neither completed nor hit a blocker: it lost its transport mid-run. Both spellings are one class. Its row stays open and its slot is free. This is the dominant way a saturated pool falls under the floor.

0. **One drop of many is not a drain.** A single failure while the rest of the wave stays live is a single drop: resume that one id (rule 1) in the same turn and keep launching. Do NOT wait out a window, and do NOT log it as a mass drain. A drain is N of the wave inside one window.
1. **Resume first, relaunch second.** `SendMessage` to the dead agent's own id, naming its row, project and SESSION_ID. Relaunch a fresh brief only when the resume is refused or the id is gone from ListAgents. Never resume an old agent whose row already has a live fresh agent: that is two writers on one surface.
2. **A drain is one event, not N refills.** N notifications of this class in one window is one drain. Log a single `FAILURE: <UTC> live=<n> pending=<m> event=mass-econnreset-drain-<N>` line, then refill to the target in the same turn. Do not decrement `live` once per notification. The count of record is ListAgents, read once after the window.
3. **Back-pressure, and the incident window.** Refill in two half-waves separated by one `wait {"ms":15000}`, never one block. Resume-by-id is NOT exempt from back-pressure. After any drain, wait out the window (`wait {"ms":60000}`), re-count with ListAgents, and refill only if the count did not fall again. On a recurrence, extend the wait (`1 x 15000`, then `2 x 60000`, then `5 x 60000`, back to back) and hold, logging the interval and the count. `wait` accepts up to `max_ms: 600000`: a longer window is ONE call (`wait {"ms":120000}`), never N consecutive 60000 calls. Never launch into a window that is still dropping.
4. **Never count a dropped agent as live.** Re-count with ListAgents after every notification and before the next launch block.
5. **A third drain in one walk** is not bad luck. File a defect row (`<row>-mass-drain-<session>`, `prd-add`) naming the wave size and the interval, and hold waves at half the ceiling until it closes.

## Editing the skills

The skills under `c:/dev/gm/skills/` change pool behaviour. They are installed as junctions or symlinks, so a local edit is live on the next dispatch and a push propagates it.

- Never edit a file while that repo is mid-merge. Check `.git/MERGE_HEAD` BEFORE the edit, never after. While it is set, merge resolution or `git merge --abort` restores the pre-merge tree and discards the edit with no error. If it is set, defer the edit (minutes, not a blocker), or abort a merge nobody owns.
- Re-read after any pull. After `git_pull` in `c:/dev/gm`, re-read every edited skill file and re-apply any clobbered hunk before continuing.
- Publish path-scoped: `git_finalize {paths:[...]}` naming only the edited skill files, then `git_push {rev:"<full sha of the tip>", allow_foreign_commits:true}`, then `ci-status` on the pushed sha. Never use `rev:"HEAD"`. Never publish while another lane holds gm's git (single-writer).
- Commit author and trailer rule: the gm skill's "One commit author, no trailers" rule applies to the tip this wave publishes.
- Every correction records the measurement that motivated it: date, verbatim error, counts. The next reader re-derives it instead of trusting it.

## Headroom and leases
- Before each launch: CPU >= 80% or available memory < 2048 MB pauses launches. Available = free MB + min(runner pid PrivateMemorySize64, shared_store_recycle_limit_mb in `.gm/exec-spool/.status.json`). A headroom stop is not a stall or a shortfall, and it does not end the turn. Log the cause with the real count and UTC. Windows: `Get-CimInstance Win32_Processor` LoadPercentage and `Get-CimInstance Win32_OperatingSystem` FreePhysicalMemory. Linux: the `id` column of `vmstat 1 2`, and `MemAvailable` in `/proc/meminfo`.
- GPU rows wait while another owner holds the GPU lock. Browser rows wait for the shared browser lease. That wait never idles the rest of the pool (dip cause 3). A timed-out lock wait is a failed run, not a result.
- Stop a background shell or Monitor that has printed nothing for 10 minutes, before it holds a lock.
- Browsers are headful: every Chromium launch uses `headless: false`, and headless runs are refused. Each run closes the browser it opened. Before a browser-using spawn, reap orphaned test Chrome (a remote-debugging-port or crawl-profile command line whose run has ended). Never touch the user's own Chrome. The no-engine `crawl` runs `cdp` (visible). `engine=lightpanda` runs only when a body asks for it. A `headless` line in a crawl body is refused. A shared Chrome closes with its last lease.
- Store-lane starvation: a read-only verb may return `executed:false` after about 120 s. Retry once, count the retry in the pool log, never loop.
- EADDRINUSE: a witness that fails on a port in use did not run. Identify the owning process. Never kill another lane's process.

## Fan-out
- Default to parallel dispatch when the closure decomposes into independent slices. Split by file, row or hop. Slices naming one surface run in turn. Pairwise-disjoint slices launch in one block. A single focused mechanical edit stays single-session; never a manufactured split.
- Walk workers are gm-prd or gm-hop, never a fork. A fork inherits the parent conversation and breaks SESSION_ID isolation.
- Each subagent prompt opens with the brick-wall opener defined in gm, and carries its own SESSION_ID, never the parent's value. The daemon keys claims by `(verb, session_id-N)`. The brief restates no other verb names, spool paths, body shapes or phase mechanics.
- A brief that names a source path names one that exists. Verify the path in the target project (`codesearch {mode:"filename"}`) before launch, or tell the worker to locate it itself. A wrong path in a brief is a blocked slot.
- `gm_processor_capacity` (4 on this build) queues dispatches beyond it. It is not the number of subagents to launch.
- Queue order: open PRD rows first (one subagent per row), then independent node slices. A subagent that ends early is re-dispatched with the same slice, never dropped. The walk advances only when its slices have returned.
- Hops and executors share one pool. No hop or executor opens a branch or worktree to avoid a collision. Recover a collision by re-reading the row or file, reapplying the change on current state, and retrying.
- Before and after every git_pull, git_push, merge, update or delivery step: count live, dispatch `instruction`, and launch the available independent slices. A delivery step never lowers the count. A step that cannot run while subagents are live is run by a subagent.
- Served rule, open conflict: briefs come from the pool-brief verb, never from a Claude skill. The `Skill(...)` launch forms above are the gm 1c design. Until the owner decides, both stand as written.

## Exit and stalls
- A turn ends only at the terminal state with `prd_pending_count=0`, or at a world-scoped one-way door (gm, Section 4). A headroom stop does not end a turn. Any other stop is a defect: dispatch the next verb in the same turn.
- No rows pending and phase terminal: `Skill(skill="gm-continue")`.
- Fuel: 40 ticks per walk. Two consecutive stalls (no row closed, no launch) end the loop after open rows are recorded. A headroom-stop tick is logged and is not a stall.
- Before ending a turn, live reaches the ceiling while work remains and headroom is ok.
- Wait only with `wait`. Never Monitor, ScheduleWakeup, CronCreate, shell sleep or shell grep.
- Saturate and stay saturated: every free slot holds an executor or a hop, and the ready queue of rows and hops stays larger than the pool. Traversal is non-linear and continuous. Open rows and open mutables fill any slot a nomination does not.
- Canaries, checked on every refill: a subagent that closed without a change or a passing witness; a PRD listing empty while rows are pending; traversal with no new evidence over a window. Fix the gm instructions or the dispatch path before the walk continues.
- Verifier wave: after each executor wave, one verifier per executed row, under a SESSION_ID that executed none of the rows, checks its `git_diff` against the row text. Deliver only passing rows.
