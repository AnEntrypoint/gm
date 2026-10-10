---
name: gm-orchestrate
description: Main-thread pool loop for a gm walk: observe, launch advertised rows and hops, log, wait.
---

# gm-orchestrate

Phase prose lives in the gm entry.

## Terms
- `ceiling`: N in a spawn refusal ("can run N subagents at once"); found by launching.
- `live`: launched minus done ids in `.gm/pool/ledger-<wave>.txt`.
- `floor` = min(10, ceiling). `shortfall`: live < floor with independent work open and headroom ok.

## Tick
1. Observe: `instruction`; take `concurrency_shortfall.launch` (node-first, from `slots.candidates`); recount `live`.
2. Launch in one tool-call block, up to the ceiling: rows first, then hops from untraversed principle nodes (`skills/dream-rsi/gm-graph.json`, not in `visited`). Row: `Skill(skill="gm-prd", args="row=<id>; session=<SID>")`. Hop: `Skill(skill="gm-hop", args='{"principle":"<name>","surface":"<path>","session":"<SID>"}')`. `<SID>` = `<parent>-<k>`, unique.
3. Log: `launch <id>` to the ledger; `tick <n> event=<id> live=<count> <UTC>` to `.gm/witness-log.md`.
4. `wait {"ms":60000}`; each completion appends `done <id>` and refills its slot this turn.

Launch only advertised ids; no manual fill.

## Limits
- Headroom: CPU >= 80% or free memory < 2 GB pauses launches (no stall).
- Shortfall: log `FAILURE: <UTC> live=<n> pending=<m>`; launch to the ceiling this turn. Two restarts per walk; a third repeat files a blocker row and stops.
- Chains split into slices by file, row or hop; one surface runs in turn. A hop spawns its successor; spawn one only for `next: none`.
- After an executor wave, a verifier per row (a SESSION_ID that executed none) checks its `git_diff`; deliver passing rows.
- Stop: no pending rows and terminal phase: `Skill(skill="gm-continue")`. Fuel 40 ticks; two stalls in a row (no row closed, no launch) end the loop after open rows are recorded.
- Before ending a turn, `live` reaches `floor` while work remains. Wait with `wait` only; never Monitor, ScheduleWakeup, CronCreate or sleep.
