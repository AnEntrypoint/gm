# gm-orchestrate: incidents and measurements

Dated evidence behind the rules in `skills/gm-orchestrate/SKILL.md` and `skills/gm-hop/SKILL.md`. The rules themselves are imperatives in those files; this file keeps the measurements that justify them. Each entry names the rule it supports.

## Pool definitions

- **ceiling** (rule: the ceiling is found by launching): Measured 2026-10-10: ceiling 20; a spawn refusal is the measurement, never a sign that this walk over-subscribed.
- **floor** (rule: a dip is judged on the average): Measured 2026-10-13 in C:/dev/gm (SESSION_ID gm-2e-fa19b3): the pool sat at live 0 against floor 10 with 243 open rows, no tick had logged it, and `pool-observe` answered `floor_gate_denied`.
- **Recorded drops (lessons)**: a rule shadowed by a stale vendored prose file; heartbeats not refreshed during lock waits; free-text successors that were ineligible; GPU-lock timeouts ending runs; completions refilled in batches; browser, GPU or design successors nominated for a node-only pool; traversal started late; served rules not refreshed from gm-config; stuck background shells and Monitors holding the GPU lock. On 2026-10-09 live fell to 0 with 779 rows pending and candidates empty: refill from a pending-row scan in the same turn.

## Node-to-node payloads (rule: links come from edges, both kinds)

Measured 2026-10-12 on the published graph (154 nodes, 352 edges, 234 forward / 118 backreference): a forward-only payload would hide 118 of 352 edges and shrink the exits of real nodes -- `G_SWEEP` 7 -> 1, `RICE` 2 -> 1, `EARS` 2 -> 1. Every node has at least one link, so `links=0` on a launched node is always a derivation defect, never a graph fact.

## Observation and lane starvation

- Measured 2026-10-11 in C:/dev/spoint (SESSION_ID orch-main): `error_code: dispatch_starved_waiting_for_serial_lane`, `executed: false`, `waited_ms: 120001`, `lane: state`, `lane_holder_task orch-main-r196-...`, `lane_waiters: 5`, `re_dispatch_safe: true`. (Rule: a starved observation is neither a stop nor a shortfall.)
- Serial-lane admission used to be a `notify_all` race. Measured 2026-10-11 in C:/dev/spoint: four orchestrator `git_commit` dispatches starved in a row at `waited_ms` 120000+ while `lane_waiters` climbed 4 -> 7. Admission is now FIFO by claim age (agentplug `ede5437948`, merged `3d7d4862`). (Rule: read `.dispatch-wait.json` before re-dispatching.)
- Re-dispatch by byte-identical body: a lane place is keyed on `lane_claim_identity` (verb plus body hash), so a re-dispatch keeps its place (agentplug `3c89ac67`, merged `2249822`). `resume_task` carries only the task id, which the lane never keys on. The starvation answer now carries `re_dispatch_keeps_lane_place: true`.
- A network-bound claim (`git_push`, `git_pull`, `git_fetch`) yields to a checkout-bound claim behind it for its first 120 s of waiting only (`LANE_NETWORK_YIELD_MS`, override `AGENTPLUG_LANE_NETWORK_YIELD_MS`), counted from the first arrival. Measured 2026-10-11 in C:/dev/spoint: a foreign session's `git_push` held the git lane for minutes while every hop's `git_commit` starved, each starvation naming a re-pushed `git_push` whose `claimed_running` stage age ran past 300 s (agentplug `c63097d222`, merged `02188c2`).
- Orphan reaping: measured 2026-10-11 in C:/dev/spoint: three `claimed_not_yet_tracked` rows at ~6.9e6 ms under a live daemon pid, with the project at 8/32 in flight. A ledger row THIS daemon wrote in an unowned state no longer proves ownership (agentplug `a46cabdd`, merged `2dc6f90`; reap floor 60 s, override `AGENTPLUG_MIN_ORPHAN_CLAIM_AGE_MS`).
- The publish: measured 2026-10-11 in C:/dev/spoint (SESSION_ID orch-main, ceiling 20): three consecutive orchestrator `git_commit {paths:[".gm/prd.yml","<dirty path>"]}` starved at `waited_ms` 120018/120012/120012 with `lane_waiters: 4` and a rotating `lane_holder_task`, so the two paths that blocked `git_pull` stayed dirty, the pull kept aborting with "Index was not unstashed", and every hop's commit in the wave stayed local. The lane was progressing, not wedged, so a fourth dispatch buys nothing except a fifth waiter.
- `max_chars` is not honoured by `pool-observe`: measured 2026-10-11, requests at 4000/3000/2500/2200/2000/1800 answered 9869/10190/10117/10084/9937/9940 chars with `reply_truncated: true`. Re-measured 2026-10-12 on `C:/dev/gm`: `pool-observe {max_chars: 3000}` answered `reply_chars: 15856`. Caveat: that re-measurement used gm-mcp bundle 0.2.35 while 0.2.37 was installed. Filed as gm rows `gm-pool-observe-starved-behind-state-lane-holders` and `gm-pool-observe-max-chars-ignored-reply-stays-10k`.
- Repeated saturated observations: measured 2026-10-11 in C:/dev/spoint (SESSION_ID orch-main, ceiling 20, live 20): ticks 158/159/160/170 returned 10057/10053/10070/10762 chars of identical content -- `launch: []`, `free_slots: 0`, every candidate `beyond_refill`, `launchable` 303 -> 353. The blocked route's "wait 60000 and re-dispatch" churned ~10 kB per minute of duplicate text on the state lane.
- Ledger inflation: measured 2026-10-11 in C:/dev/spoint (SESSION_ID orch-main): ledger `live` answered 145 while ListAgents showed exactly 20 running, because `gm-hop`/`gm-prd` agents mint successor sessions (`<parent>-subK`) that no ledger line records. Three `.live` markers stale by 5065/5960/2972 s were reaped and the next spawn was still refused at the 20-subagent ceiling. Filed as gm row `gm-pool-ledger-live-inflated-by-self-spawned-successors`.
- Parked successor: measured 2026-10-11: `orch-main-r249.next` relaunched as `orch-main-r264`, pool held 20 across the handoff.
- Receipt versus slot: measured 2026-10-11 in C:/dev/spoint (SESSION_ID orch-main, ceiling 20): three agents sent final receipts, the ledger reconciled to live=19, and four spawns across two blocks were still refused -- the harness keeps the slot until the agent exits.
- Git admission band: measured in the shared plugin pool: a single `git_push` blocked on a remote held a third of the admission band for 1417734 ms while every `codesearch`, `git_status` and `fs_write` in every project waited out its patience budget (120 s cheap, 180 s heavy) and was answered `dispatch_starved_waiting_for_admission`. From agentplug 0.1.318 an admission hold is a 60 s lease.

## Heartbeats

- Measured 2026-10-10: all 5 advertised slots named rows with a running worker and `live_heartbeats: 0`, so every advertised slot read as free and had to be hand-filtered. Confirmed the same day (`orch-main-r92`, `orch-main-r93`): briefs carrying the step took `live_heartbeats` 0 -> 2 with `live_rows` populated.
- Measured 2026-10-10: both advertised slots named rows held by live agents (`perf-dynamic-quality-governor-...u2`, `perf-foliage-one-frame-...u1`), first at `live_heartbeats: 0`, again at `live=18`.

## Node emission

- The emission rule is asserted, not assumed: `dream-rsi` Part B `nodes_verified` stays flat while `traversable_nodes` grows when a producer emits nothing (the exact signature the `emitted == 0` check catches).

## Briefs

- Measured 2026-10-10: three briefs named a source path that does not exist in c:/dev/gm -- one worker blocked on it and three more were mid-flight with a wrong path, each corrected by a mid-flight `SendMessage`.

## Mass API-error drain

- Measured 2026-10-10: 1 of 18 dropped `ECONNREFUSED`, 17 held, the resume came back live and the wave grew to 19.
- Confirmed 2026-10-10: a resumed agent closed its row and delivered a sha. `ECONNREFUSED` drop resumed by `SendMessage` came back live.
- Measured 2026-10-10: 5 of 9 resumed workers re-dropped inside 90 s, because a resume re-establishes the very connection the incident is killing. The earlier exemption of resume-by-id from back-pressure is refuted.
- The `wait` cap rose from 60000 on 2026-10-10 (SESSION_ID orch-main-r79, rs-plugkit `wait.rs` `MAX_WAIT_MS`). The older "max 60000" wording in earlier copies of this skill is superseded.

## Skill edits

- Measured 2026-10-10: a `wait` max_ms correction vanished while another lane pulled (row `gm-skill-edit-lost-to-mid-merge`).


## gm-hop (hop rules in skills/gm-hop/SKILL.md)

- Context budget (rule: a hop that dies with "Prompt is too long" is relaunched compact): measured 2026-10-11 in C:/dev/spoint (WADLER over its game app). The relaunch re-sent principle, surface, depth, `visited` and a three-sentence `rhetoric`, never the dead hop's transcript or a file body.
- Hop never dispatches gm-continue: measured 2026-10-11 in C:/dev/spoint (hop DBC over its terrain code). A finishing hop dispatched it, read `.turn-summary.json` (`phase: MILNER`, 4973 pending rows), found its premise unmet and spent its last turn writing an explanation instead of a receipt.
- Hop commits, does not push: measured 2026-10-11 in C:/dev/spoint (SESSION_ID orch-main, ceiling 20). The git serial lane runs one dispatch at a time per project, and each hop's own `git_push` queued behind it: 4 to 7 waiters, holders running past 300 s, orchestrator pushes starving at the 120 s cap with `dispatch_starved_waiting_for_serial_lane` and `re_dispatch_safe: true`.
- Hop does not pull: measured 2026-10-11 in C:/dev/spoint (SESSION_ID orch-main). A hop's `git_pull` met a worktree dirty with another lane's staged deletions and aborted with "Index was not unstashed", so one hop's pull strands every lane's staged work.
- Starved git verb, one re-dispatch: measured 2026-10-11 in C:/dev/spoint (SESSION_ID orch-main, ceiling 20). A hop's push that kept retrying held the git lane past 350 s with `lane_waiters` at 4 to 5, so every later git verb from every lane queued behind it and the orchestrator's own publish starved for wave after wave.
- At most two git verbs per hop: measured 2026-10-11 in C:/dev/spoint (SESSION_ID orch-main, ceiling 20). The queue held 4 to 8 waiters with holders past 300 s, so every `git_log`, `git_diff`, `git_show` or `branch_status` a hop sent was one more claim ahead of every other lane's commit.
- Re-bake in the same commit: measured 2026-10-11 in C:/dev/spoint (SESSION_ID orch-main). Three hops in a row committed a height-source edit without re-generating the shipped heightfield, so each hop's own tree was green while every push was red with "baked with height code version X, this tree bakes Y". Each later hop's commit moved the code again, so no hop ever saw the failure it inherited.
- Successor spawn parked: measured 2026-10-11 in C:/dev/spoint (SESSION_ID orch-main, ceiling 20). A hop's own successor spawn returned "Concurrent subagent limit reached", so the chain died at the ceiling while the pool stayed saturated. The parked spec was relaunched into the first freed slot, which is how the pool held 20 across the handoff.
- prd-add refusal names one row file: measured 2026-10-11 in C:/dev/spoint (hop WADLER over `src/sdk/chartState`). When every row lived in one `.gm/prd.yml`, `prd-add` answered an unparseable-line error at `prd.yml:245` three times in a row while a peer agent was editing its own row, because one lane's rewrite clobbered another's row. Since 2026-10-12 a row is its own file.
- Commit author and trailers: measured 2026-10-11 in C:/dev/spoint (SESSION_ID orch-main-gm-notrailers). Three published commits on `AnEntrypoint/spoint` main carried `Co-Authored-By: Claude Code <noreply@anthropic.com>` inside the author line `lanmower` (`f332304c6f` among them). The rule is defined in skills/gm/SKILL.md (Autonomy).
