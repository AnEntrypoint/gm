---
name: gm-publish
description: "Publish stage of one PRD row: merges upstream, commits local work by explicit path, pushes to main (executor), then a separate spawned CI lane reads ci-status for that sha. A CI failure returns to the orchestrator as a fix handoff. Invoke only from gm-prd or the orchestrator; do not load directly."
---

# gm-publish

Input: `row=<id>; session=<SESSION_ID>`. Output: `.gm/receipts/<row>/06-publish.md`.

1. Pull `main`. On `conflicted: true`, resolve in this turn (gm, collision rules).
2. Commit only the paths listed in `04-edit.md`, with `git_finalize {message, paths}`. Push with `git_push` to the full sha.
3. The executor stops here: it returns `STATUS: handoff <sha>` to the orchestrator.
4. The CI read is a separate lane the orchestrator spawns for that sha (`<parent>-c<k>`). It reads `git_show` and `ci-status {sha}`. Pending or failing is not success. It returns `STATUS: ci-green <sha>` when every job is green, or `STATUS: ci-red <sha> <job>` with the failing job's name and its log line.
5. On `ci-red`, the orchestrator spawns a fresh executor for the row with that sha and job as input. It does not load gm-eliminate inline here. Only the orchestrator calls `prd-resolve`, and only when a verifier and a CI lane both report green for the same sha.
