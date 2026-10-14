---
name: gm-publish
description: "Final stage of resolving one PRD row: merges upstream, commits local work by explicit path, pushes to main, and reads CI. A CI failure loads gm-eliminate. Invoke only from gm-prd or gm-validate; do not load directly."
---

# gm-publish

Input: `row=<id>; session=<SESSION_ID>`. Output: `.gm/receipts/<row>/06-publish.md`.

1. Pull `main`. On `conflicted: true`, resolve in this turn (gm, collision rules).
2. Commit only the paths listed in `04-edit.md`, with `git_finalize {message, paths}`. Push with `git_push` to the full sha.
3. Read the pushed commit (`git_show`) and CI (`ci-status {sha}`). Pending or failing is not success.
4. CI green: `prd-resolve {"id":"<row>","witness_evidence":"<ci run>","witness_dispatch_id":"<id>"}`.
5. CI failing: record the failing job and load `gm-eliminate`.
   `Skill(skill="gm-eliminate", args="row=<id>; session=<SESSION_ID>")`
