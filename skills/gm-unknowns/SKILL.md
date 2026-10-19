---
name: gm-unknowns
description: "Second stage of resolving one PRD row: writes the list of unknowns the row depends on. Loads gm-eliminate next. Invoke only from gm-prd; do not load directly."
---

# gm-unknowns

Input: `row=<id>; session=<SESSION_ID>`. Output: `.gm/receipts/<row>/02-unknowns.md`.

1. List each fact the row needs that the orient receipt does not prove. One line per unknown. Each line states the question it answers.
2. Record each unknown with `mutable-add`. Do not open any new unknown in another form.
3. If the list is empty, load `gm-edit`; otherwise load `gm-eliminate`.
   the `gm-eliminate` skill with `row=<id>; session=<SESSION_ID>`

## Finish the work

- Finishing the requested work is the goal of every run of this skill. A run that stops with work left undone is incomplete.
- When an issue blocks a step (a failing check, a fault in a tool or service, a missing input, a network or environment fault), fix it in the same run: retry on a bounded or resumable route, use an alternate route to the same result, repair the fault where it originates, then continue the remaining work.
- Stop only when the requested work is complete, or when a step is still blocked after every route has been tried. Then report the blocked step, the routes tried, and the evidence for each.
