---
name: gm-eliminate
description: "Third stage of resolving one PRD row: eliminates each unknown by a live JIT run, adding new unknowns found on the way. Loads gm-edit only when none is open. Invoke only from gm-prd; do not load directly."
---

# gm-eliminate

Input: `row=<id>; session=<SESSION_ID>`. Output: `.gm/receipts/<row>/03-eliminate.md`.

1. Take one open unknown. Write the expected value before the run. Derive the expected value from the row's contract, never from the code it checks.
2. Run a live JIT check against the real system. Record the dispatch id and the observed value.
3. Mark the unknown known when observed matches expected. If a run reveals a new unknown, record it with `unknown-add` and go on with it next.
4. An unknown that a probe can answer is never handed to a blocker unprobed. If a check is refused, re-read the state the refusal names, fix it, and probe again. Record every dispatch id. Only a check refused for the same cause after that retry is filed as a blocker, with the external fact and the action that clears it.
5. Repeat until no unknown is open. Then load `gm-edit`.
   the `gm-edit` skill with `row=<id>; session=<SESSION_ID>`

## Finish the work

- Finishing the requested work is the goal of every run of this skill. A run that stops with work left undone is incomplete.
- When an issue blocks a step (a failing check, a fault in a tool or service, a missing input, a network or environment fault), fix it in the same run: retry on a bounded or resumable route, use an alternate route to the same result, repair the fault where it originates, then continue the remaining work.
- Stop only when the requested work is complete, or when a step is still blocked after every route has been tried. Then report the blocked step, the routes tried, and the evidence for each.
