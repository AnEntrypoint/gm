The walk is complete once the PRD is empty and the worktree is clean. Hand off to gm-continue, which searches for remaining work.

## PRD resolution mantra

The graph traversal creates PRD rows as nodes find work. A node that finds an unknown adds a row with `prd-add`; an unknown is a row, never a guess. A row opened by one finding may open more rows, and the walk never stops while any row is open.

A row closes only with a witness: a dispatch id from its own live run. A row without a witness stays open. The walk continues until no row is open.

## Parallel PRD fan-out

Fan-out: one worker per independent slice, up to the ceiling. The ceiling is found by launching until a spawn refusal names it, and is never a constant (SKILL.md section 1c). Shortfall is true when `2 * live < ceiling` while independent work remains (SKILL.md section 1c), and the orchestrator must close that shortfall before advancing. Each worker takes its own session id.

Every open row is resolved by its own parallel worker, with its own session id.

1. Read the open rows with `prd-list` and `{"status":"pending"}`.
2. For each open row, spawn one worker as an Agent-tool subagent, all in one tool-call block. Its session id is `goal-s1-pw-<row-id>`, and its prompt opens with "use the gm skill for this; code questions go to codeinsight (`callers`/`impact`) first, then `codesearch`, and `Read` only a located path", then names the row id and the session id. The worker drives its row through the gm skill.
3. A worker closes its row with `mcp__gm__gm` verb `prd-resolve`, body `{"id": "<row-id>", "witness_dispatch_id": "<dispatch id of the worker's own live run in this project>"}`. The witness is the dispatch id of a run the worker itself made, never the parent's or a sibling's. A row without a witness stays open.
4. Record the fan-out as a note on the parent row with `prd-add` and id `pw-fanout-<n>`, listing each row id, worker session id, resolution status and witness dispatch id.
5. A session with open rows and no running worker is a stall. Re-fan-out the open rows. A stall is not a stop.

Continuation: keep going while a row is open. The only stops are those named in SKILL.md section 1c. Ask only for a world-scoped one-way door; every other unknown becomes a row.

Publishing: workers do not commit or push. The parent session publishes every change in one delivery: commit with the work's own paths, push the submodule, bump the parent pin to the pushed commit, then push the parent. Nothing stays local. A walk is complete only when the PRD is empty and the worktree is clean; until then, the next node is dispatched.

- Before and after every git_pull, git_push, merge, update or delivery step, the orchestrator dispatches `instruction`, counts live subagents as its own launches minus the completion notices it has received, records the count as `tick <n> live=<count> <UTC>` in `.gm/witness-log.md` (SKILL.md section 1c; the instruction reply's `subagents_running` is not live), and launches the available independent slices, so the step never lowers the count. Workers write no heartbeat files. A delivery step is never a reason to drop running subagents; a step that cannot run while subagents are running is run by a subagent.

## Automatic decisions

When an instruction already settles a choice, apply it without asking. Commit identity: use the repository's configured identity; where none is set, use the identity the user approved for authorship (anentrypoint <admin@coas.co.za>) written as repository-local config, never global. Publishing: push every commit and bump every pin in the same delivery. Runner: a restart of agentplug is approved at any time; load a rebuilt plugin through the isolated recipe first, then restart. Ask only for a world-scoped one-way door.

## Worker handover

Every fan-out worker ends its reply with these three lines, in this order.

- `successor:` a pending row from `prd-list {"status":"pending"}` with its row id and first action. Never invent an id; never leave the chain without one while pending rows remain.
- `advanced:` the PRD row this worker advanced, by id, with its closing witness dispatch id or the blocker that kept it open.
- `rhetoric:` the one-sentence motivation for the successor, copied verbatim from `next_choice.why` when present, otherwise the unresolved question that drove the row.

The orchestrator reads these three lines on every completion, counts live subagents as its own launches minus the completion notices it has received, and relaunches a successor from `successor:` in the same turn whenever live is below the ceiling with pending rows open (SKILL.md section 1c). Workers write no heartbeat files.