---
name: gm-validate
description: "Fifth stage of resolving one PRD row: validates the edit with live JIT runs against the acceptance. Failures return to gm-eliminate. Loads gm-publish when every check passes. Invoke only from gm-prd; do not load directly."
---

# gm-validate

Input: `row=<id>; session=<SESSION_ID>`. Output: `.gm/receipts/<row>/05-validate.md`.

1. Write one expected value per acceptance clause before running anything.
2. Run each check live. Record the dispatch id and the observed value. A check that matches its expected value passes.
3. Any failure or new unknown: record it, then load `gm-eliminate`. The loop returns through `gm-edit` and back here.
4. All checks pass: load `gm-publish`.
   `Skill(skill="gm-publish", args="row=<id>; session=<SESSION_ID>")`
