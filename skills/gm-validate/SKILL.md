---
name: gm-validate
description: "Verification lane for one PRD row, spawned by the orchestrator after an executor hands off: validates the pushed edit with live JIT runs as a witness in its own session. Failures return to the orchestrator as a fix handoff; it does not loop into edit itself. Invoke only from the orchestrator; do not load directly."
---

# gm-validate

Input: `row=<id>; session=<SESSION_ID>`. Output: `.gm/receipts/<row>/05-validate.md`.

1. Write one expected value per acceptance clause before running anything.
2. Run each check live. Record the dispatch id and the observed value. A check that matches its expected value passes.
3. Any failure or new unknown: record it and return `STATUS: fix <check id>` to the orchestrator. The orchestrator spawns a fresh executor for the row; this lane does not run ELIMINATE or EDIT itself.
4. All checks pass: record the verify receipt and return `STATUS: verified <witness dispatch id>` to the orchestrator. This lane does not load gm-publish or read CI; the orchestrator spawns the CI lane for the same sha.

This lane is spawned, never loaded inline by the executor. It runs in its own session (`<parent>-v<k>`) and is the witness for the row, so the executor's session may not witness its own edit.
