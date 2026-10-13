---
name: gm-orchestrate
description: "Main-thread pool loop for a gm walk: observe, launch advertised rows and hops, log, wait, refill, exit. Invoke only from gm; do not load directly. Pool rules and shared-tree publish rules are defined here; hop rules are in gm-hop, PRD-row rules in gm-prd."
---

# gm-orchestrate

Owns the pool rules and the shared-tree publish rules. Rationale: `docs/rationale.md`. Dated measurements: `docs/incidents.md`. Other owners: gm (policy, commit author, brick-wall opener), gm-hop (hop rules, bake re-bake), gm-prd (PRD-row rules).

## Terms
- `ceiling`: N in a spawn refusal ("can run N subagents at once"), found by launching. `target` = ceiling.
- `live`: count of record is ListAgents, cross-checked against `.gm/pool/*.live` (max 5 min old). `slots.live` and ledger `live` are not the count.
- `floor` = min(10, ceiling). `shortfall`: live < floor while independent work is open and headroom is ok.

## Floor
- While pending PRD rows are open, keep live at least the floor; launch a shortfall to the floor in the same message.
- Do not end a turn or report completion while live < floor and independent slices remain.
- Pass the ListAgents count as `body.live` on every `pool-observe` and `transition`. With no fresh record the gate reports `count_of_record: absent` and does not deny.
- `floor_gate_denied` fires when `body.live` < floor and `open_rows > 0`.
- A mass drain halves `target` for its incident window only; the next clean completion batch restores the ceiling at once.

## Never let the pool dip
Live under the ceiling with independent work open is a shortfall, every time. Each cause has one counter-instruction; none licenses a smaller pool.
0. Judge the average and check at turn start: each tick logs `live` to `.gm/witness-log.md`. A dip is mean live under the floor since the last full refill, or a turn starting under the floor with open rows. Log `FAILURE`, run tick 1 first, then causes 1-4 in order.
1. Lane stopped, nothing refilled it: one successor per freed slot, this turn, never batched. A session-killed lane frees its slot too: relaunch its `.gm/pool/<session>.next` spec or a pending row. Live 0, or under the last ceiling with work open: spawn a full batch this turn.
2. Lane stood down over a "modified" file: one row is one lane. Compare the blob to REMOTE main (`branch_status`, or `git_diff` against the remote tip) first; with no comparison, take another slice.
3. Lane blocked on the accelerated-browser lease or GPU lock: spawn node-only and non-GPU work meanwhile.
4. Brief died with `Prompt is too long`: relaunch COMPACT from the brief (row id, surface, session, one action). Never resume it.

## Tick
1. Observe: count live; dispatch `pool-observe {live:<integer>, held:[...]}` (0 is an integer; a boolean gives `count_of_record: absent`). Take `slots.launch` (node-first, from `slots.candidates`, max 32). Empty while shortfall > 0 is a defect row. `floor_gate_denied` at live under floor is the launch signal, never a retry. Briefs come from `pool-brief {row, session, role}` (role `resolver` or `traversal`); a call missing any of the three answers `error_code: failed`.
2. Launch in one tool-call block, up to the ceiling. Rows first: `Skill(skill="gm-prd", args="row=<id>; session=<SID>")`. Then one hop per untraversed principle node of `skills/dream-rsi/gm-graph.json` not in `visited`, launched as a NODE: `Skill(skill="gm-hop", args='{"node":{id,label,book,author,kind,advocate,links},"principle":"<id>","surface":"<path>","session":"<SID>","wave":"<wave>","depth":1,"rhetoric":""}')`. `<SID>` = `<parent>-<k>`, unique.
3. Log `launch <id>` to the ledger and `tick <n> event=<id> live=<count> <UTC>` to `.gm/witness-log.md`.
4. `wait {"ms":60000}`. Each `done <id>` refills its slot this turn, before any other step.
5. Re-count live after each launch and completion; log live, ceiling, rows executing, hops running, outcomes.

Launch only advertised ids. A slot stays empty only when no pending row and no untraversed node remain.

**CI-only rows are not pool work.** A row whose witness needs a local cargo build is CI-only while the local cargo hook is in force (`gm-no-local-cargo-verified-by-ci`). Launching one into the pool spends a slot to reach EMIT and then block. Measured 2026-10-13 in C:/dev/gm (SESSION_ID gm-2e-fa19b3): the eight `SLAP-PLUGKIT-*` workers all ended blocked at SPECIFY or EMIT with no witness, and each row's cited line numbers were stale. The orchestrator skips such rows when they are advertised, files them to the CI lane as `<row>-ci-only`, and refills the slot from a non-cargo candidate. A row whose cited line no longer exists is also stale, and goes back to `prd-add` for re-scoping, not into a slot.

## Node-to-node hop payloads
- A hop is an edge: nominate FROM the node it stands on TO a neighbour that node links to.
- Source: `skills/dream-rsi/gm-graph.json`, read at launch. Never take a count from its `node_count` or `edge_count`.
- `node.id`, `label`, `book`, `author`, `kind` come from `nodes[]`. There is no `phase`.
- `advocate` is `"<author> - <book>"`, or the bare `book` when `author` is `unattributed`.
- `node.links`: one entry per `edges[]` entry with `from` = `node.id`, of both kinds (`forward` and `backreference`).
- Each link is `{to, guards}`; `guards = []` when `condition` is null, else `[condition]`. Sort links by `to`.
- An edge whose `to` is not in `nodes[]` is never in `links`; `prd-add` `gm-graph-dangling-edge-<from>-<to>` instead.
- A node with `links: []` is still launched; its receipt says `next: none`.
- `principle` equals `node.id` and is still sent; `node` wins when both are present. `principle` without `node` is stale: gm-hop answers `VERDICT: NOT-APPLICABLE`.
- The ledger `launch` line carries `from=<id> links=<n>`. A receipt `next:` outside the launched links is not a child: log `nomination-not-from-links <UTC> from=<id> next=<id>` to `.gm/witness-log.md` and `prd-add` `gm-hop-nomination-not-from-links-<from>-<to>`.
- Per wave count `link_hops` against `non_link_nominations`; hops launched with `link_hops == 0` is a derivation defect, and so is `links=0` on any launched node.

## Refill and successors
- Every completion: one replacement per freed slot, this turn, passing the completed worker's row, surface and session. Read live after the refill.
- While rows are open, refill to `ceiling - live`.
- Successors come only from `slots.candidates`; a free-text nomination launches only if it is in candidates and node-only. Check title-only nominations before launch.
- A declined or colliding successor is replaced this turn by the next eligible candidate.
- A worker ending at a blocker frees its slot exactly like a closed row: refill that slot this turn from `slots.candidates`. Blocker rows are annotations, never candidates; it still nominates a node-only successor. Measured 2026-10-13 in C:/dev/gm: 13 of 20 workers ended closed or blocked within nine minutes, and live fell to 7 because completions were recorded but not refilled.
- A hop spawns its own successor (gm-hop); the orchestrator spawns one only when a hop returns `next: none`.
- Node candidates below twice the floor: start a traversal hop (node-only rows, resolves none).
- Low row supply: dispatch row-creating hops (`prd-add`) before more resolvers. Pause row creation when rows resolve faster than the pool refills.
- Candidates empty with rows pending: read `prd-list {status:"pending", limit:<n>}` (`total` counts matches, `store_total` the file, `truncated` = window cut); fold repeated blocks of one id to the last with `exec_js`; log the empty list as a defect row. On live 0 with rows pending and candidates empty, refill from that scan this turn.
- Each brief names a real pending row (`prd-list`, or `.gm/prd/<id>.yml`; pending = status not resolved). If `prd-list` refuses, repair only the named row file, before any launch.
- Open-PRD growth between checks: drain by dispatching gm-prd on open rows before any other step.
- A replacement wave launches only after the gate runtime is confirmed loaded (status file reports the new plugkit); otherwise log a canary alarm and do not re-spawn.
- Node emission: each hop writes `.gm/lean-walk/<node.id>.json` (gm-hop, Node emission). On every completion that file must exist for the launched node; if missing, `prd-add` `gm-lean-walk-node-emission-missing-<session>` and do not count the node as walked.
- The count of record is `emitted`: node files this wave wrote, read from the directory, never from receipts. Completed hops with `emitted == 0` is a producer that emits nothing.
- Executors need a row that names its file (gm-prd).

## Heartbeat
- Every brief first writes `.gm/pool/<session>.live`: exactly three lines, `session: <session>`, `row: <row id>`, `start: <ISO-8601 UTC>`; deletes it on finish. A brief without this step is refused.
- Before launching, match each advertised id against live rows (ListAgents descriptions plus `.live` files); skip a match and take the next unheld candidate this turn.
- Format, read-before-write check and 5-minute refresh: `gm-config/prose/worker-rules.md` section 1. Refresh at every gm call, including during lock waits.

## Shortfall and FAILURE
- Shortfall with work open: log `FAILURE: <UTC> live=<n> pending=<m>` to `.gm/witness-log.md`, then launch to target this turn. Read count and time at check time.
- Two restarts per walk. A repeated shortfall means these rules are wrong: dispatch `instruction`, correct this skill, restart at tick 1. A third repeat files `<row>-blocker-<session>` (`prd-add`) and stops.
- The floor gate denies `prd-resolve` and phase advance (`floor_gate_denied`) while rows are open and the count of record is under the floor; the denial names pool-observe, slots.launch and refill_needed. Pass `body.live` on every call (kept 5 min in `.gm/pool/count-of-record.json`).

## Observation and git-lane starvation
- `pool-observe` dropped at 120 s with `dispatch_starved_waiting_for_serial_lane` (`executed: false`, `re_dispatch_safe: true`) is neither a stop nor a shortfall: re-dispatch once this turn.
- On a second starvation: take the count from ListAgents plus `.gm/pool/ledger-<wave>.txt`; launch from the last non-starved `slots.candidates` or a `prd-list` scan via `exec_js`; log `lane-starved <UTC> live=<n>`.
- Before re-dispatching a starved verb, read `.gm/exec-spool/.dispatch-wait.json`: `lane_position`, `lane_holder_age_ms`, `lane_holder_task`, `lane_holder_verb`, `lane_waiters`.
- Position 1, or holder age near the budget: re-dispatch now. Position above 1 behind a fresh holder: wait. A position that does not shrink is a slow holder.
- Re-dispatch verbatim, never `resume_task`; change no byte of the body. The answer carries `re_dispatch_keeps_lane_place: true`.
- A waiting `git_push`, `git_pull` or `git_fetch` yields to a checkout-bound git verb behind it for its first 120 s of waiting only (`LANE_NETWORK_YIELD_MS`, override `AGENTPLUG_LANE_NETWORK_YIELD_MS`).
- A commit can be admitted ahead of fresh pushes: above position 1 with holder `claimed_running`, wait for the holder. A push that already waited out its budget keeps its place: re-dispatch once, never queue more pushes behind it.
- `dispatch_orphaned` on a claim minutes old: re-dispatch a read-only verb at once. Before re-dispatching `git_commit`, `git_finalize`, `git_push` or `fs_write`, re-read the real state (`git_status`, `fs_read`).
- Never preempt an executing holder.
- The publish is one git dispatch per wave. Two starvations end the attempt: `prd-add` a row naming the paths and both dispatch ids, then stop git dispatches until a completion drains the queue. The tip is pushed once.
- A git verb waiting on the process-wide admission band: an admission hold is a 60 s lease; read `admission_holds` in `.dispatch-wait.json`. Re-dispatch never helps there.
- While `live == ceiling` and `free_slots: 0`: no timer re-observation. `wait {"ms":60000}`, then re-observe on a freed slot or a heartbeat older than 600 s.
- Ledger `live` is inflated by self-spawned successors: take `live` from ListAgents. Never delete a `.live` file to manufacture a free slot.
- A parked `.gm/pool/<session>.next` spec is the first refill candidate: relaunch it before any fresh surface, and delete the parked file once the relaunch is accepted.
- A receipt message is not a freed slot; an accepted spawn is. On refusal: park the spec, spend the turn on non-spawn work, and probe again only after a completion notification (one probe per notification).
- `pool-observe` ignores `max_chars`: budget ~16 kB per observation, page the `spill_file`, and never re-dispatch for a shorter reply.

## Mass API-error drain
A subagent stopping with `API Error: Connection dropped (ECONNRESET)`, `ECONNREFUSED` or `error type: server_error` lost its transport: its row stays open and its slot is free. Both spellings are one class.
0. One drop while the rest of the wave stays live is a single drop: resume that id (rule 1) and keep launching. A drain is N of the wave inside one window.
1. `SendMessage` to the dead agent's own id, naming its row, project and SESSION_ID. Relaunch a fresh brief only when the resume is refused or the id is gone from ListAgents. Never resume an agent whose row already has a live fresh agent.
2. N notifications in one window is one event: log `FAILURE: <UTC> live=<n> pending=<m> event=mass-econnreset-drain-<N>` once, and refill to target this turn. The count of record is ListAgents, read once after the window; never decrement live per notification.
3. Refill in two half-waves separated by `wait {"ms":15000}`. Resume-by-id is not exempt from back-pressure. After a drain: `wait {"ms":60000}`, re-count, refill only if the count did not fall again. On recurrence: `1 x 15000`, then `2 x 60000`, then `5 x 60000`, logging interval and count. `wait` accepts `max_ms: 600000`, so a longer window is one call. Never launch into a window still dropping.
4. Never count a dropped agent as live; re-count with ListAgents after each notification and before the next launch block.
5. A third drain in one walk: `prd-add` `<row>-mass-drain-<session>` naming the wave size and interval, and hold waves at half the ceiling until it closes.

## Shared-tree publish
Pool lanes share one work tree and one git lane. This section is the only definition of the shared-tree publish route; gm-prd points here.
- Work on `main` in the shared work tree: no worktree, side branch or scratch checkout. Every extra tree ends in a consolidation run.
- Publish through the Git API route: POST blobs; a tree with `base_tree: <remote tip>`; a commit parented on that tip; PATCH `refs/heads/main` with `force` unset; re-read `/repos/<owner>/<repo>/contents/<path>?ref=main` and verify each blob.
- `git_finalize` commits locally and refuses to push while a sibling holds a dirty path. Report that commit as redundant with content already published, never as unpushed. Never reset `refs/heads/main` under running lanes.
- A `remote_moved` refusal on a dirty tree: `git_status {"paths":[<dirty paths>]}`, commit or revert each in the lane that owns it, then `git_push {rev:"<sha>"}`. The recovery refuses only over paths the incoming range also changes.
- Recover a collision by re-reading the row or file, reapplying the change on current state, and retrying.
- Commit author and trailers: defined in gm (One commit author, no trailers). Bake before commit: defined in gm-hop (Re-bake in the same commit).

## Editing the skills
Skills under `c:/dev/gm/skills/` are live on the next dispatch after any local edit.
- Check `.git/MERGE_HEAD` BEFORE editing; if set, defer the edit or abort a merge nobody owns.
- After `git_pull` in `c:/dev/gm`, re-read every edited skill and re-apply any clobbered hunk.
- Publish path-scoped: `git_finalize {paths:[...]}` naming only the edited skill files, then `git_push {rev:"<full sha of the tip>", allow_foreign_commits:true}`, then `ci-status` on the pushed sha. Never `rev:"HEAD"`; never publish while another lane holds gm's git.
- Every correction records the measurement that motivated it: date, verbatim error, counts.

## Headroom and leases
- Before each launch: CPU >= 80% or available memory < 2048 MB pauses launches. Available = free MB + min(runner pid PrivateMemorySize64, shared_store_recycle_limit_mb in `.gm/exec-spool/.status.json`). A headroom stop does not end the turn; log the cause with the real count and UTC. Probe commands: `docs/rationale.md`.
- GPU rows wait for the GPU lock; browser rows wait for the shared browser lease. Neither idles the pool. A timed-out lock wait is a failed run.
- Stop a background shell or Monitor silent for 10 minutes before it holds a lock.
- Browsers are headful: `headless: false` on every Chromium launch; headless runs are refused. Each run closes its own browser. Before a browser-using spawn, reap orphaned test Chrome (remote-debugging-port or crawl-profile command whose run ended); never touch the user's Chrome. No-engine `crawl` runs `cdp` (visible); `engine=lightpanda` runs only when a body asks; a `headless` line in a crawl body is refused.
- Store-lane starvation: a read-only verb may return `executed:false` after ~120 s. Retry once; never loop.
- EADDRINUSE: a witness that fails on a port in use did not run. Identify the owning process. Never kill another lane's process.

## Fan-out
- Default to parallel dispatch over independent slices (by file, row or hop). Slices naming one surface run in turn; pairwise-disjoint slices launch in one block. A single focused mechanical edit stays single-session.
- Walk workers are gm-prd or gm-hop, never a fork.
- Each subagent prompt opens with gm's brick-wall opener and carries its own SESSION_ID. The brief restates no other verb names, spool paths, body shapes or phase mechanics.
- Verify a brief's source path exists (`codesearch {mode:"filename"}`) before launch, or tell the worker to locate it. A wrong path is a blocked slot.
- `gm_processor_capacity` (4 on this build) queues dispatches beyond it; it is not the subagent count.
- Queue order: open PRD rows first (one subagent per row), then independent node slices. An early-ending subagent is re-dispatched with the same slice; the walk advances only when its slices have returned.
- Hops and executors share one pool; none opens a branch or worktree to avoid a collision.
