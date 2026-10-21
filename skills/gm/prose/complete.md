The walk is complete once the PRD is empty and the worktree is clean. Hand off to gm-continue, which searches for remaining work.

## PRD resolution mantra

Nodes add rows as they find work: `prd-add` for each unknown, since an unknown is a row, never a guess. A row may open more rows. A row closes only with a witness, a dispatch id from its own live run; without one it stays open. The walk never stops while any row is open.

## Parallel PRD fan-out

One worker per independent slice, as many as the work allows. A shortfall (available independent slices not yet launched) must be closed before the orchestrator advances. The floor is min(10, ceiling): `REFILL_FLOOR` at `rs-plugkit/crates/plugkit-core/src/orchestrator/pool_slots/mod.rs:17`, capped by the ceiling. The ceiling is the spawn refusal limit, measured 20.

Every open row is resolved by its own parallel worker, with its own session id.

1. Read the open rows with `prd-list` and `{"status":"pending"}`.
2. For each open row, spawn one worker as an Agent-tool subagent, all in one tool-call block. Its session id is `goal-s1-pw-<row-id>`. Its prompt opens with "use the gm skill for this; code questions go to codeinsight (`callers`/`impact`) first, then `codesearch`, and `Read` only a located path", then names the row id and the session id. The worker drives its row through the gm skill.
3. A worker closes its row with `gm` verb `prd-resolve`, body `{"id": "<row-id>", "witness_evidence": "<string: file:line or exec output specific to this row>", "witness_dispatch_id": "<dispatch id of the worker's own live run in this project>"}`. The witness is the dispatch id of a run the worker itself made, never the parent's or a sibling's. A row without a witness stays open.
4. Record the fan-out as a note on the parent row with `prd-add` and id `pw-fanout-<n>`, listing each row id, worker session id, resolution status and witness dispatch id.
5. A session with open rows and no running worker is a stall. Re-fan-out the open rows. A stall is not a stop.

Never stop while a row is open. Ask only for a world-scoped one-way door; every other unknown becomes a row.

Publishing: workers do not commit or push. The parent session publishes every change in one delivery: commit with the work's own paths, push the submodule to its main, then push the parent. The parent gitlink tracks each submodule's main tip (bump-pins advances it). Nothing stays local. A walk is complete only when the PRD is empty and the worktree is clean; until then, the next node is dispatched.

- Before and after every git_pull, git_push, merge, update or delivery step, the orchestrator counts live subagents with ListAgents (the count of record), cross-checks the fresh `.gm/pool/*.live` heartbeats (at most 5 minutes old), dispatches `instruction`, and launches the available independent slices, so the step never lowers the count. Every worker writes its `.gm/pool/<session>.live` heartbeat on start, refreshes it at least every 5 minutes, and deletes it on finish. The same-turn refill holds the count at the ceiling. A delivery step is never a reason to drop running subagents; a step that cannot run while subagents are running is run by a subagent.

## Automatic decisions

When an instruction already settles a choice, apply it without asking. Commit identity: use the repository's configured identity; where none is set, use the identity lanmower <lanmower@users.noreply.github.com> written as repository-local config, never global. Publishing: push every commit and bump every pin in the same delivery. Runner: a restart of agentplug is approved at any time; load a rebuilt plugin through the isolated recipe first, then restart. Ask only for a world-scoped one-way door.

## Worker handover

Every fan-out worker ends its reply with these three lines, in this order.

- `successor:` a pending row from `prd-list {"status":"pending"}` with its row id and first action. Never invent an id; never leave the chain without one while pending rows remain.
- `advanced:` the PRD row this worker advanced, by id, with its closing witness dispatch id or the blocker that kept it open.
- `rhetoric:` the one-sentence motivation for the successor, copied verbatim from `next_choice.why` when present, otherwise the unresolved question that drove the row.

The orchestrator reads these three lines on every completion, counts live subagents with ListAgents and the fresh `.gm/pool/*.live` heartbeats, and relaunches one successor from `successor:` in the same turn per freed slot while pending rows are open and live is under the floor. While pending rows are open, live subagents must be at least the floor, and a shortfall is launched to the floor in the same message. No turn ends and no completion report is made while live is under the floor and independent slices remain. Pass the ListAgents count as `body.live` on every `pool-observe` and `transition` call, because with no fresh record the gate reports count_of_record absent and does not deny. Dip causes and counter-instructions: `skills/gm-orchestrate/SKILL.md`, "Never let the pool dip".
