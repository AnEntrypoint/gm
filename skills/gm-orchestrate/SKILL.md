---
name: gm-orchestrate
description: Main-thread pool loop for a gm walk: observe, launch advertised rows and hops, log, wait, refill, exit. Owns every pool rule.
---

# gm-orchestrate

Owns the pool protocol. The gm entry and gm 1c name this skill and add no pool rule.

## Terms
- `ceiling`: N in a spawn refusal ("can run N subagents at once"). Found by launching, never a constant; hold at or just below it while work remains. `target` = ceiling.
- `live`: launched minus done ids in `.gm/pool/ledger-<wave>.txt`. Count of record: ListAgents, cross-checked against fresh `.gm/pool/*.live` (at most 5 min old). `slots.live` and `concurrency_shortfall.running` are not the count.
- `floor` = min(10, ceiling); before a refusal, min(10, the first full wave). The spawn ceiling is 20 until a refusal records another N. **Measured 2026-10-10: ceiling 20 (spawn refusal), and a full 20-wave lost 17 of 20 to `ECONNRESET` in one window while 3 survived -- so a saturated wave is not sustainable at this ceiling. Hold `target` at ceiling/2 (10) until `mass-drain` defect row closes; raise by 2 per clean window, never straight back to the ceiling.**
- `shortfall`: live < floor while independent work is open and headroom is ok.

## Tick
1. Observe: count live (ListAgents, `.live` files); dispatch `instruction`; take `concurrency_shortfall.launch` (node-first, from `slots.candidates`, at most 32). Empty while shortfall > 0 is a defect row.
2. Launch in one tool-call block, up to the ceiling. Rows first: `Skill(skill="gm-prd", args="row=<id>; session=<SID>")`. Then hops from untraversed principle nodes of `skills/dream-rsi/gm-graph.json` not in `visited`: `Skill(skill="gm-hop", args='{"principle":"<name>","surface":"<path>","session":"<SID>"}')`, depth 1 for a fresh chain. `<SID>` = `<parent>-<k>`, unique.
3. Log `launch <id>` to the ledger and `tick <n> event=<id> live=<count> <UTC>` to `.gm/witness-log.md`.
4. `wait {"ms":60000}` (integer, max 60000). Each completion appends `done <id>` and refills its slot this turn, before any other step.
5. Re-count live after each launch and each completion. Log the tick: live, ceiling, rows executing, hops running, outcomes since the last tick.

Launch only advertised ids; no manual fill. A slot stays empty only when no pending row and no untraversed node remain.

## Refill and successors
- Every completion: one replacement per freed slot in the same turn; never wait for a batch. Pass the completed worker's row, surface and session to its replacement. Read the live count after the refill.
- Successors come only from `slots.candidates` (node-first). A free-text nomination is advisory: read its acceptance text, then launch only if it is in candidates and node-only. Title-only nominations are checked before launch.
- A declined or colliding successor is replaced in the same turn by the next eligible candidate.
- A worker that ends at a blocker is not a replacement. Blocker rows are annotations, never candidates; a blocked worker records its blocker and still nominates a node-only successor.
- A hop spawns its own successor (gm-hop). The orchestrator spawns one only when a hop returns `next: none`.
- Node supply: when node candidates fall below twice the floor, start a traversal hop (it logs node-only rows and resolves none).
- Low row supply: dispatch hops that create rows (`prd-add`) before more resolvers. Pause row creation when rows resolve faster than the pool refills.
- Candidates empty while rows are pending: read open rows through exec_js over the `prd-list` result (last block per id, status not resolved); `prd-list` ignores limit and status. Log the empty list as a defect row.
- Each brief names its row from a text scan of `.gm/prd.yml` (pending = status not resolved) and its successor from a real pending row. If `prd-list` fails to parse, repair the state file before any launch.
- Open-PRD growth between checks is a failure: drain by dispatching gm-prd on open rows before any other step.
- A replacement wave launches only after the gate runtime is confirmed loaded (the status file reports the new plugkit); otherwise log a canary alarm and do not re-spawn.
- Executors need a row that names its file (gm-prd).

## Heartbeat
- Every brief opens with: write `.gm/pool/<session>.live` on start, delete it on finish. A brief without this step is refused.
- **Empty heartbeats cost the pool its dedupe.** `slots.live_rows` and `live_heartbeats` are empty while no brief wrote its `.live` file, and `pool-observe` then advertises rows that live workers already hold -- measured 2026-10-10: all 5 advertised slots named rows with a running worker and `live_heartbeats: 0`, so every advertised slot read as free and had to be hand-filtered to avoid a second writer on one surface. A wave launched without the heartbeat step is a wave that cannot be de-duplicated.
- Format (session, row, start), the read-before-write check and the 5-minute refresh: `gm-config/prose/worker-rules.md` section 1. Refresh at any gm call, including during lock waits.

## Shortfall and FAILURE
- `shortfall` while work is open: log `FAILURE: <UTC> live=<n> pending=<m>` to `.gm/witness-log.md` (a log event, not a PRD row; prd_pending_count is unchanged), then launch to the target in the same turn. Count and timestamp are read at check time, never estimated.
- Two restarts per walk. A repeated shortfall means these rules are wrong: dispatch `instruction`, correct this skill, restart at tick 1. A third repeat files a blocker row (`<row>-blocker-<session>`, `prd-add`) and stops.
- Refill while rows are open: launch min(refill_needed, ceiling - live), with refill_needed = floor - live.
- Floor gate: `prd-resolve` and phase advance are denied (`floor_gate_denied`) while rows are open and the count of record is under the floor; the denial names pool-observe, slots.launch and refill_needed. Pass body.live to pool-observe on every call (kept 5 min in `.gm/pool/count-of-record.json`). With no fresh record there is no denial; the reply says `count_of_record: absent`.
- Recorded drops (lessons): a rule shadowed by a stale vendored prose file; heartbeats not refreshed during lock waits; free-text successors that were ineligible; GPU-lock timeouts ending runs; completions refilled in batches; browser, GPU or design successors nominated for a node-only pool; traversal started late; served rules not refreshed from gm-config; stuck background shells and Monitors holding the GPU lock. On 2026-10-09 live fell to 0 with 779 rows pending and candidates empty: refill from a scan of pending rows in the same turn. On 2026-10-10 a wave of 20 drained to 8 in one window by `ECONNRESET`, not by completion: the refill rule counted only launches and completions, so no rule fired. Mass API-error drain below is that fix.

## Mass API-error drain

A subagent that stops with `API Error: Connection dropped (ECONNRESET)` -- `ECONNREFUSED` ("Connection refused -- a firewall or proxy may be blocking it") -- or any `error type: server_error` -- neither completed nor hit a blocker: it lost its transport mid-run. Both spellings are one class (measured 2026-10-10: an `ECONNREFUSED` drop resumed by `SendMessage` and came back live). Its row stays open and its slot is free. This is the dominant way a saturated pool falls under the floor, and it is invisible to a rule that only counts launches and completions.

0. **One drop of many is not a drain.** A single failure while the rest of the wave stays live is a single drop: resume that one id (rule 1) in the same turn and keep launching; do NOT wait out a window and do NOT log it as a mass drain. A drain is N of the wave inside one window. Measured 2026-10-10: 1 of 18 dropped `ECONNREFUSED`, 17 held, the resume came back live and the wave grew to 19.

1. **Resume first, relaunch second.** `SendMessage` to the dead agent's own id, naming its row, project and SESSION_ID: the agent restarts with its work intact. Confirmed 2026-10-10 -- a resumed agent closed its row and delivered a sha. Relaunch a fresh brief only when the resume is refused or the id is gone from ListAgents. Never resume an old agent whose row already has a live fresh agent: that is two writers on one surface.
2. **A drain is one event, not N refills.** N notifications of this class in one window is one drain: log a single `FAILURE: <UTC> live=<n> pending=<m> event=mass-econnreset-drain-<N>` line, then refill to the target in the same turn. Do not decrement `live` once per notification and re-derive shortfall each time -- the count of record is ListAgents, read once after the window.
3. **Back-pressure, and the incident window.** Refill in two half-waves separated by one `wait {"ms":15000}`, never one block. **Resume-by-id is NOT exempt from this back-pressure** (measured 2026-10-10: 5 of 9 resumed workers re-dropped inside 90 s, because a resume re-establishes the very connection the incident is killing; the old exemption is refuted). After any drain, wait out the window before refilling: `wait {"ms":60000}`, re-count with ListAgents, and refill only if the count did not fall again during that wait. On a recurrence, extend the wait by repeating the verb (`1 x 15000`, then `2 x 60000`, then `5 x 60000` back to back) and hold, logging the interval and the count. **`wait` accepts up to `max_ms: 600000` (10 minutes), so a longer incident window is ONE call (`wait {"ms":120000}`), never N consecutive `wait {"ms":60000}` calls -- the cap rose from 60000 on 2026-10-10 (SESSION_ID orch-main-r79, rs-plugkit `wait.rs` `MAX_WAIT_MS`), and the refusals recorded above were measured under the old cap.** Never launch into a window that is still dropping: feeding an incident is not recovery.
4. **Never count a dropped agent as live.** Re-count with ListAgents after every notification and before the next launch block.
5. **A third drain in one walk** is not bad luck: file a defect row (`<row>-mass-drain-<session>`, `prd-add`) naming the wave size and the interval, and hold waves at half the ceiling until it closes.
6. **Never edit a file while that repo is mid-merge.** `git merge --abort` restores the pre-merge tree, so an edit made after the merge began is silently discarded. Check `.git/MERGE_HEAD` before editing, or abort first.

## Editing the skills (the instructivity lever)

The skills under `c:/dev/gm/skills/` are the lever that changes pool behaviour; they are installed as junctions/symlinks, so a local edit is live on the next dispatch and a push propagates it. Losing an edit there is losing the behaviour, silently.

- **Check `C:/dev/gm/.git/MERGE_HEAD` before the edit, never after.** While it is set the repo is mid-merge, and merge resolution or `git merge --abort` restores the pre-merge tree, so an edit made after the merge began is discarded with no error. Measured 2026-10-10: a `wait` max_ms correction vanished this way while another lane pulled (row `gm-skill-edit-lost-to-mid-merge`). If it is set, defer the edit -- minutes, not a blocker -- or abort a merge nobody owns.
- **Re-read after any pull.** Survival of a pull is not guaranteed: after `git_pull` in `c:/dev/gm`, re-read every edited skill file and re-apply any clobbered hunk before continuing.
- **Publish path-scoped:** `git_finalize {paths:[...]}` naming only the edited skill files, then `git_push {rev:"HEAD"}`, then `ci-status` on the pushed sha. Never publish while another lane holds gm's git (single-writer).
- Every correction records the measurement that motivated it -- date, verbatim error, counts -- so the next reader re-derives it instead of trusting it.

## Headroom and leases
- Before each launch: CPU >= 80% or available memory < 2048 MB pauses launches. Available = free MB + min(runner pid PrivateMemorySize64, shared_store_recycle_limit_mb in `.gm/exec-spool/.status.json`), the runner's recyclable store. A headroom stop is not a stall or a shortfall, and it does not end the turn. Log the cause with the real count and UTC (Windows: `Get-CimInstance Win32_Processor` LoadPercentage, `Get-CimInstance Win32_OperatingSystem` FreePhysicalMemory; Linux: the `id` column of `vmstat 1 2`, and `MemAvailable` in `/proc/meminfo`).
- GPU rows wait while another owner holds `.gpu-lock/owner.json` (`scripts/gpulock.mjs`); browser rows wait for the shared browser lease. A timed-out lock wait is a failed run, not a result. Node rows keep flowing meanwhile.
- Stop a background shell or Monitor that has printed nothing for 10 minutes, before it holds a lock.
- Browsers are headful: every Chromium launch uses `headless: false`; headless runs are refused. Each run closes the browser it opened. Before a browser-using spawn, reap orphaned test Chrome (a remote-debugging-port or crawl-profile command line whose run has ended); never touch the user's own Chrome. The no-engine `crawl` runs `cdp` (visible); `engine=lightpanda` runs only when a body asks for it; a `headless` line in a crawl body is refused. A shared Chrome closes with its last lease.
- Store-lane starvation: a read-only verb may return `executed:false` after about 120 s. Retry once, count the retry in the pool log, never loop.
- EADDRINUSE: a witness that fails on a port in use did not run. Identify the owning process; never kill another lane's process.

## Fan-out
- Default to parallel dispatch when the closure decomposes into independent slices; split by file, row or hop. Slices naming one surface run in turn; pairwise-disjoint slices launch in one block. A single focused mechanical edit stays single-session; never a manufactured split.
- Walk workers are gm-prd or gm-hop, never a fork: a fork inherits the parent conversation and breaks SESSION_ID isolation.
- Each subagent's prompt opens with the brick-wall opener ("use the gm skill for this; code questions go to codeinsight (`callers`/`impact`) first, then `codesearch`, and `Read` only a located path") and carries its own SESSION_ID, never the parent's value: the daemon keys claims by `(verb, session_id-N)`. The brief restates no other verb names, spool paths, body shapes or phase mechanics: `Skill(skill="gm")` supplies those.
- **A brief that names a source path names one that exists.** Verify the path in the target project (`codesearch {mode:"filename"}`) before the launch, or tell the worker to locate it itself. Measured 2026-10-10: three briefs named `rs-plugkit/gm-plugin`, which does not exist in c:/dev/gm -- one worker blocked on it and three more were mid-flight with a wrong path, each corrected by a mid-flight `SendMessage`. A wrong path in a brief is not a typo, it is a blocked slot.
- `gm_processor_capacity` (4 on this build) queues dispatches beyond it; it is not the number of subagents to launch.
- Queue order: open PRD rows first (one subagent per row), then independent node slices. A subagent that ends early is re-dispatched with the same slice, never dropped. The walk advances only when its slices have returned.
- Hops and executors share one pool. No hop or executor opens a branch or worktree to avoid a collision; a collision is recovered by re-reading the row or file, reapplying the change on current state, and retrying.
- Before and after every git_pull, git_push, merge, update or delivery step: count live, dispatch `instruction`, and launch the available independent slices. A delivery step never lowers the count; a step that cannot run while subagents are live is run by a subagent.
- Served rule, open conflict: briefs come from the pool-brief verb, never from a Claude skill. The `Skill(...)` launch forms above are the gm 1c design. Until the owner decides, both stand as written.

## Exit and stalls
- A turn ends only at the terminal state with `prd_pending_count=0`, or at a world-scoped one-way door (the continuation invariant in the served prose). A headroom stop does not end a turn. Any other stop is a defect: dispatch the next verb in the same turn.
- No rows pending and phase terminal: `Skill(skill="gm-continue")`.
- Fuel: 40 ticks per walk. Two consecutive stalls (no row closed, no launch) end the loop after open rows are recorded. A headroom-stop tick is logged and is not a stall.
- Before ending a turn, live reaches the floor while work remains and headroom is ok.
- Wait only with `wait`; never Monitor, ScheduleWakeup, CronCreate, shell sleep or shell grep.
- No branches: all work stays on main; branch-creating verbs are refused.
- Saturate the pool: every free slot holds an executor or a hop. Find the ceiling at run time and hold it. A drain is failure: when live reaches 0, or falls under the last ceiling while work is open, spawn a full batch in the same turn.
- Keep the pool over-subscribed: keep a queue of ready rows and hops larger than the pool, and refill each completion from it.
- Traversal is non-linear and continuous; open rows and open mutables fill any slot a nomination does not.
- Canaries, checked on every refill: a subagent that closed without a change or a passing witness; a PRD listing empty while rows are pending; a free slot while ready work exists; traversal with no new evidence over a window. Fix the gm instructions or the dispatch path before the walk continues.
- Verifier wave: after each executor wave, one verifier per executed row, under a SESSION_ID that executed none of the rows, checks its `git_diff` against the row text. Deliver only passing rows.
