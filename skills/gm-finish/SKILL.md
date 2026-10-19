---
name: gm-finish
description: "Drains every open PRD row in bounded slices through the six-stage chain, archives rows that cannot run, and publishes after each slice. Invoke when asked to finish all remaining work. Loads gm-orient per row."
---

# gm-finish

Goal: open PRD rows reach zero. Each slice is one workflow run.

1. Clean first. Close each title-only row (no body, acceptance, witness or `blocked_by`) with `prd-resolve`, `witness_evidence` set to `superseded: <reason>`, so its chained `.gm/prd-log.jsonl` line records the reason. Move no files and write no index. Keep one blocker per base row; close the rest.
2. Slice. Take up to 60 open base rows that have not been attempted in this cycle. One run per slice. Never more than 150 agents per run. Live agents never exceed `gm_processor_capacity` (8 here): a larger pool only queues, and every queued dispatch waits on the spool. Two slices may run side by side only when their live agents together stay within that capacity.
2a. Before each slice, prune spool response files older than 1 hour (`.gm/exec-spool/out/*.json`). They are read once. Measure the file count before and after and record both in the slice receipt.
3. Per row, load the chain: the `gm-orient` skill with `row=<id>; session=<SID>`. Restart a subagent that stops on a connectivity error, for the same row, up to 3 times.
4. A row ends resolved (witness dispatch id) or blocked. A blocker is filed only after gm-eliminate has run a live check on each unknown and recorded its dispatch id. Owner decisions, CI-only builds and one-way doors are the only exceptions.
5. After each slice: commit `.gm/prd-log.jsonl` and the archive by explicit path, push to the full sha, read `ci-status`. Resolve a merge conflict in the same turn.
6. Next slice from the counts. Stop when pending is 0, or when a slice resolves nothing and every remaining row is an owner decision or a CI-only build. Report those rows by id.

## Finish the work

- Finishing the requested work is the goal of every run of this skill. A run that stops with work left undone is incomplete.
- When an issue blocks a step (a failing check, a fault in a tool or service, a missing input, a network or environment fault), fix it in the same run: retry on a bounded or resumable route, use an alternate route to the same result, repair the fault where it originates, then continue the remaining work.
- Stop only when the requested work is complete, or when a step is still blocked after every route has been tried. Then report the blocked step, the routes tried, and the evidence for each.
