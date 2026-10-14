---
name: gm-finish
description: "Drains every open PRD row in bounded slices through the six-stage chain, archives rows that cannot run, and publishes after each slice. Invoke when asked to finish all remaining work. Loads gm-orient per row."
---

# gm-finish

Goal: open PRD rows reach zero. Each slice is one workflow run.

1. Clean first. Archive title-only row files (no body, acceptance, witness or `blocked_by`) into `.gm/prd-superseded/`, with an index line for each id and a reason. Keep one blocker per base row; archive the rest.
2. Slice. Take up to 60 open base rows that have not been attempted in this cycle. One run per slice. Never more than 150 agents per run. Two slices may run side by side when they are disjoint.
3. Per row, load the chain: `Skill(skill="gm-orient", args="row=<id>; session=<SID>")`. Restart a subagent that stops on a connectivity error, for the same row, up to 3 times.
4. A row ends resolved (witness dispatch id) or blocked. A blocker is filed only after gm-eliminate has run a live check on each unknown and recorded its dispatch id. Owner decisions, CI-only builds and one-way doors are the only exceptions.
5. After each slice: commit `.gm/prd-log.jsonl` and the archive by explicit path, push to the full sha, read `ci-status`. Resolve a merge conflict in the same turn.
6. Next slice from the counts. Stop when pending is 0, or when a slice resolves nothing and every remaining row is an owner decision or a CI-only build. Report those rows by id.
