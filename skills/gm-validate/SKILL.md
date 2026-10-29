---
name: gm-validate
description: "Verification lane for one PRD row, spawned by the orchestrator after an executor hands off: validates the pushed edit with live JIT runs as a witness in its own session. Failures return to the orchestrator as a fix handoff; it does not loop into edit itself. Invoke only from the orchestrator; do not load directly."
exposed_when: prd:pending
---

# gm-validate

Input: `row=<id>; session=<SESSION_ID>`. Output: `.gm/receipts/<row>/05-validate.md`.

1. Write one expected value per acceptance clause before running anything.
2. Run each check live. Record the dispatch id and observed value. A check matching its expected value passes.
3. Any failure or new unknown: record it, return `STATUS: fix <check id>` to the orchestrator. The orchestrator spawns a fresh executor; this lane never runs ELIMINATE or EDIT itself.
4. All pass: record the verify receipt, return `STATUS: verified <witness dispatch id>`. This lane does not load gm-publish or read CI; the orchestrator spawns the CI lane for the same sha.

Spawned, never loaded inline by the executor. Runs in its own session (`<parent>-v<k>`) as the row's witness; the executor's session may not witness its own edit.

## Finish the work

- Finishing the requested work is the goal of every run of this skill. A run that stops with work left undone is incomplete.
- When an issue blocks a step (a failing check, a fault in a tool or service, a missing input, a network or environment fault), fix it in the same run: retry on a bounded or resumable route, use an alternate route to the same result, repair the fault where it originates, then continue the remaining work.
- Stop only when the requested work is complete, or when a step is still blocked after every route has been tried. Then report the blocked step, the routes tried, and the evidence for each.
