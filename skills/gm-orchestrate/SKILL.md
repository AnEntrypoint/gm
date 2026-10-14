---
name: gm-orchestrate
description: "Main-thread pool loop for a gm walk: observe, launch advertised rows and hops, log, wait, refill, exit. Invoke only from gm; do not load directly. Pool rules and shared-tree publish rules are defined here; hop rules are in gm-hop, PRD-row rules in gm-prd."
---

# gm-orchestrate

Pool and publish rules. Why: `docs/rationale.md`. Measurements: `docs/incidents.md`. Elsewhere: gm (policy, commit author, brick-wall opener), gm-hop (hop rules, bake re-bake), gm-prd (PRD-row rules).

## Terms
- `ceiling`: N in a spawn refusal ("can run N subagents at once"), found by launching. `target` = ceiling.
- `live`: ListAgents count, cross-checked with `.gm/pool/*.live` (max 5 min old). `slots.live` and ledger `live` are not the count.
- `floor` = min(10, ceiling). `shortfall`: live < floor while independent work is open and headroom ok.

## Floor
- Pending PRD rows open: keep live >= floor; launch shortfall to floor in the same message.
- Never end a turn or report completion while live < floor and independent slices remain.
- Pass ListAgents count as `body.live` on every `pool-observe` and `transition`. No fresh record: `count_of_record: absent`, no deny.
- `floor_gate_denied`: `body.live` < floor and `open_rows > 0`.
- Mass drain halves `target` for its incident window; the next clean completion batch restores the ceiling at once.

## Never let the pool dip
Live under ceiling with independent work open is a shortfall, every time; no cause licenses a smaller pool.
0. Judge the average at turn start; each tick logs `live` to `.gm/witness-log.md`. Dip = mean live under floor since last full refill, or a turn starting under floor with open rows. Log `FAILURE`, run tick 1 first, then causes 1-4 in order.
1. Lane stopped, nothing refilled it: one successor per freed slot, this turn, never batched. Session-killed lane frees its slot: relaunch `.gm/pool/<session>.next` or a pending row. Live 0, or under last ceiling with work open: spawn a full batch this turn.
2. Lane stood down over a "modified" file: one row is one lane. Compare the blob to REMOTE main (`branch_status`, or `git_diff` against remote tip) first; no comparison, take another slice.
3. Lane blocked on accelerated-browser lease or GPU lock: spawn node-only and non-GPU work meanwhile.
4. Brief died with `Prompt is too long`: relaunch COMPACT from the brief (row id, surface, session, one action). Never resume it.

## Tick
1. Observe: count live; dispatch `pool-observe {live:<integer>, held:[...]}` (0 is an integer; a boolean gives `count_of_record: absent`). Take `slots.launch` (node-first, from `slots.candidates`, max 32). Empty while shortfall > 0 is a defect row. `floor_gate_denied` at live under floor is the launch signal, never a retry. Briefs: `pool-brief {row, session, role}`, role `resolver` or `traversal`; missing any of the three answers `error_code: failed`.
2. Launch in one tool-call block, up to ceiling. Rows first: `Skill(skill="gm-prd", args="row=<id>; session=<SID>")`. Then one hop per untraversed principle node of `skills/dream-rsi/gm-graph.json` not in `visited`, as a NODE: `Skill(skill="gm-hop", args='{"node":{id,label,book,author,kind,advocate,links},"principle":"<id>","surface":"<path>","session":"<SID>","wave":"<wave>","depth":1,"rhetoric":""}')`. `<SID>` = `<parent>-<k>`, unique. A row or hop whose surface asserts a cause runs its ACH step (gm-hop step 3a, gm-prd SPECIFY) inside that same launch; the orchestrator does not start a fix before the matrix exists.
3. Log `launch <id>` to the ledger and `tick <n> event=<id> live=<count> <UTC>` to `.gm/witness-log.md`.
4. `wait {"ms":60000}`. Each `done <id>` refills its slot this turn, before any other step.
5. Re-count live after each launch and completion; log live, ceiling, rows executing, hops running, outcomes.

Launch only advertised ids. A slot stays empty only when no pending row and no untraversed node remain.

## Hop payloads
- A hop is an edge: nominate FROM the node it stands on TO a neighbour it links to.
- Source `skills/dream-rsi/gm-graph.json`, read at launch. Never take a count from `node_count` or `edge_count`.
- `node.id`, `label`, `book`, `author`, `kind` from `nodes[]`. No `phase`.
- `advocate` = `"<author> - <book>"`, or bare `book` when `author` is `unattributed`.
- `node.links`: one entry per `edges[]` entry with `from` = `node.id`, both kinds (`forward`, `backreference`).
- Link = `{to, guards}`; `guards = []` when `condition` null, else `[condition]`. Sort by `to`.
- Edge with `to` not in `nodes[]`: never in `links`; `prd-add` `gm-graph-dangling-edge-<from>-<to>`.
- `links: []` node is still launched; receipt says `next: none`.
- `principle` = `node.id`, still sent; `node` wins when both. `principle` without `node` is stale: gm-hop answers `VERDICT: NOT-APPLICABLE`.
- Ledger `launch` line carries `from=<id> links=<n>`. Receipt `next:` outside launched links is not a child: log `nomination-not-from-links <UTC> from=<id> next=<id>` to `.gm/witness-log.md`; `prd-add` `gm-hop-nomination-not-from-links-<from>-<to>`.
- Per wave count `link_hops` against `non_link_nominations`. Hop launched with `link_hops == 0`, or node with `links=0`, is a derivation defect.

**CI-only rows are not pool work.** A row whose witness needs a local cargo build (`gm-no-local-cargo-verified-by-ci`) is skipped when advertised and filed to the CI lane as `<row>-ci-only`; its slot refills from a non-cargo candidate.

## Refill and successors
- Each completion: one replacement per freed slot, this turn, passing the worker's row, surface, session; read live after.
- Rows open: refill to `ceiling - live`.
- Successors only from `slots.candidates`; free-text nomination launches only if in candidates and node-only. Check title-only nominations before launch.
- Declined or colliding successor: replace this turn with next eligible candidate.
- Worker ending at a blocker frees its slot like a closed row: refill that slot this turn from `slots.candidates`. Blocker rows are never candidates; it still nominates a node-only successor.
- A hop spawns its own successor (gm-hop); orchestrator spawns one only when a hop returns `next: none`.
- Node candidates below twice the floor: start a traversal hop (node-only rows, resolves none).
- Low row supply: dispatch row-creating hops (`prd-add`) before more resolvers. Pause row creation when rows resolve faster than the pool refills.
- Candidates empty, rows pending: read `prd-list {status:"pending", limit:<n>}` (`total` counts matches, `store_total` the file, `truncated` = window cut); fold repeated blocks of one id to last with `exec_js`; log the empty list as a defect row. Live 0 with rows pending and no candidates: refill from that scan this turn.
- Each brief names a real pending row (`prd-list` or `.gm/prd/<id>.yml`; pending = status not resolved). `prd-list` refuses: repair only the named row file, before any launch.
- Open-PRD growth between checks: drain by dispatching gm-prd on open rows before any other step.
- Replacement wave launches only after the gate runtime is confirmed loaded (status file reports the new plugkit); else log a canary alarm and do not re-spawn.
- Node emission: each hop writes `.gm/lean-walk/<node.id>.json`. On every completion the file must exist; if missing, `prd-add` `gm-lean-walk-node-emission-missing-<session>` and do not count the node as walked.
- Count of record is `emitted`: node files this wave wrote, read from the directory, never receipts. Completed hop with `emitted == 0` is a producer emitting nothing.
- Executors need a row that names its file (gm-prd).

## Heartbeat
- Every brief first writes `.gm/pool/<session>.live`: exactly three lines, `session: <session>`, `row: <row id>`, `start: <ISO-8601 UTC>`; deletes it on finish. A brief without this step is refused.
- Before launching, match each advertised id against live rows (ListAgents descriptions plus `.live` files); skip a match, take the next unheld candidate this turn.
- Format, read-before-write check, 5-minute refresh: `gm-config/prose/worker-rules.md` section 1. Refresh at every gm call, lock waits included.

## Shortfall and FAILURE
- Shortfall with work open: log `FAILURE: <UTC> live=<n> pending=<m>` to `.gm/witness-log.md`, launch to target this turn. Read count and time at check.
- Two restarts per walk. Repeated shortfall means these rules are wrong: dispatch `instruction`, correct this skill, restart at tick 1. A third repeat files `<row>-blocker-<session>` (`prd-add`) and relaunches that blocker as a row in the next launch; the walk never stops with rows open.

## Never leave a row open
- Exit requires `prd-list {"status":"pending"}` to return 0 rows. A stall, a blocked worker, a refused witness or a session that ends early never closes the walk.
- A row ends a run in one of two states only: `prd-resolve` with a witness, or `<row>-blocker-<session>` filed with the missing fact and the verb that would supply it. The original row stays pending with that blocker named in its text.
- Every blocker is launched in the next wave as its own row (node-first, same ceiling). A blocker that blocks again is split until one step remains; that step is then run, never parked.
- A worker that returns without a receipt or blocker is a defect: re-dispatch its row with the same session suffix plus `-r<n>`, once per wave.
- Floor gate denies `prd-resolve` and phase advance (`floor_gate_denied`) while rows are open and count of record is under floor; the denial names pool-observe, slots.launch, refill_needed. Pass `body.live` every call (kept 5 min in `.gm/pool/count-of-record.json`).

## Starvation
- `pool-observe` dropped at 120 s with `dispatch_starved_waiting_for_serial_lane` (`executed: false`, `re_dispatch_safe: true`) is neither stop nor shortfall: re-dispatch once this turn.
- Second starvation: count from ListAgents plus `.gm/pool/ledger-<wave>.txt`; launch from last non-starved `slots.candidates` or a `prd-list` scan via `exec_js`; log `lane-starved <UTC> live=<n>`.
- Before re-dispatching a starved verb, read `.gm/exec-spool/.dispatch-wait.json`: `lane_position`, `lane_holder_age_ms`, `lane_holder_task`, `lane_holder_verb`, `lane_waiters`.
- Position 1, or holder age near budget: re-dispatch now. Position above 1 behind a fresh holder: wait. Position not shrinking: slow holder.
- Re-dispatch verbatim: never `resume_task`; change no byte. Answer carries `re_dispatch_keeps_lane_place: true`.
- A waiting `git_push`, `git_pull` or `git_fetch` yields to a checkout-bound git verb behind it for its first 120 s only (`LANE_NETWORK_YIELD_MS`, override `AGENTPLUG_LANE_NETWORK_YIELD_MS`).
- Commit admitted ahead of fresh pushes: above position 1 with holder `claimed_running`, wait. A push that waited out its budget keeps its place: re-dispatch once, never queue more pushes behind it.
- `dispatch_orphaned` on a claim minutes old: re-dispatch a read-only verb at once. Before re-dispatching `git_commit`, `git_finalize`, `git_push` or `fs_write`, re-read real state (`git_status`, `fs_read`).
- Never preempt an executing holder.
- Publish is one git dispatch per wave. Two starvations end the attempt: `prd-add` a row naming the paths and both dispatch ids, then stop git dispatches until a completion drains the queue. Tip pushed once.
- Git verb waiting on the process-wide admission band: admission hold is a 60 s lease; read `admission_holds` in `.dispatch-wait.json`. Re-dispatch never helps.
- `live == ceiling` and `free_slots: 0`: no timer re-observation. `wait {"ms":60000}`, then re-observe on a freed slot or a heartbeat older than 600 s.
- Ledger `live` is inflated by self-spawned successors: take `live` from ListAgents. Never delete a `.live` file to manufacture a free slot.
- Parked `.gm/pool/<session>.next` spec is the first refill candidate: relaunch before any fresh surface; delete the parked file once relaunch is accepted.
- A receipt message is not a freed slot; an accepted spawn is. On refusal: park the spec, do non-spawn work, probe only after a completion notification (one per notification).
- `pool-observe` ignores `max_chars`: budget ~16 kB per observation, page `spill_file`, never re-dispatch for a shorter reply.

## Mass API-error drain
Trigger: `API Error: Connection dropped (ECONNRESET)`, `ECONNREFUSED` or `error type: server_error` = lost transport; row stays open, slot free. Both spellings are one class.
Steps 0-5 (single drop vs drain, resume by `SendMessage` to the dead id, one `FAILURE ... mass-econnreset-drain-<N>` event, half-wave refill and back-off `wait` schedule, ListAgents as count of record, third-drain `prd-add`): `docs/recovery.md`, section "Mass API-error drain". Never count a dropped agent as live.

## Shared-tree publish
Lanes share one work tree and git lane. Only definition of the publish route (gm-prd points here).
- Work on `main` in the shared tree: no worktree, side branch or scratch checkout. Every extra tree ends in a consolidation run.
- Publish via the Git API route: POST blobs; tree with `base_tree: <remote tip>`; commit parented on that tip; PATCH `refs/heads/main`, `force` unset; re-read `/repos/<owner>/<repo>/contents/<path>?ref=main` and verify each blob.
- `git_finalize` commits locally and refuses to push while a sibling holds a dirty path. Report that commit as redundant with content already published, never as unpushed. Never reset `refs/heads/main` under running lanes.
- `remote_moved` on a dirty tree: `git_status {"paths":[<dirty paths>]}`, commit or revert each in the owning lane, then `git_push {rev:"<sha>"}`. Recovery refuses only over paths the incoming range also changes.
- Collision: re-read the row or file, reapply the change on current state, retry.
- Commit author and trailers: gm (One commit author, no trailers). Bake before commit: gm-hop (Re-bake in the same commit).

## Editing the skills
Skills under `c:/dev/gm/skills/` are live on the next dispatch. Check `.git/MERGE_HEAD` first; path-scoped publish with `git_finalize {paths}` then `git_push {rev:<full sha>, allow_foreign_commits:true}` then `ci-status`; never `rev:"HEAD"`. Full steps E1-E5: `docs/recovery.md`, section "Editing the skills".

## Headroom and leases
- Before each launch: CPU >= 80% or available memory < 2048 MB pauses launches. Available = free MB + min(runner pid PrivateMemorySize64, `shared_store_recycle_limit_mb` in `.gm/exec-spool/.status.json`). Headroom stop does not end the turn; log cause with real count and UTC. Probes: `docs/rationale.md`.
- GPU rows wait for the GPU lock; browser rows wait for the shared browser lease. Neither idles the pool. Timed-out lock wait is a failed run.
- Background shell or Monitor silent 10 minutes before it holds a lock: stop it.
- Browsers are headful: `headless: false` on every Chromium launch; headless runs refused. Each run closes its own browser. Before a browser spawn, reap orphaned test Chrome (remote-debugging-port or crawl-profile command whose run ended); never touch the user's Chrome. No-engine `crawl` runs `cdp` (visible); `engine=lightpanda` only when a body asks; a `headless` line in a crawl body is refused.
- Store-lane: read-only verb `executed:false` after ~120 s: retry once, never loop.
- EADDRINUSE: a witness failing on a port in use did not run. Identify the owning process. Never kill another lane's process.

## Fan-out
- Default: parallel dispatch over independent slices (file, row or hop). Slices naming one surface run in turn; pairwise-disjoint slices launch in one block. A single focused mechanical edit stays single-session.
- Walk workers are gm-prd or gm-hop, never a fork.
- Each subagent prompt opens with gm's brick-wall opener and carries its own SESSION_ID; the brief restates no other verb names, spool paths, body shapes or phase mechanics.
- Verify a brief's source path exists (`codesearch {mode:"filename"}`) before launch, or tell the worker to locate it. Wrong path = blocked slot.
- `gm_processor_capacity` (4 here) queues dispatches beyond it; it is not the subagent count.
- Queue order: open PRD rows first (one subagent per row), then independent node slices. An early-ending subagent is re-dispatched with the same slice; the walk advances only when its slices have returned.
- Hops and executors share one pool; none opens a branch or worktree.
