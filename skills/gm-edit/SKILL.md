---
name: gm-edit
description: "Fourth stage of resolving one PRD row: makes the edit the eliminated unknowns allow. Loads gm-validate next. Invoke only from gm-prd; do not load directly."
---

# gm-edit

Input: `row=<id>; session=<SESSION_ID>`. Output: `.gm/receipts/<row>/04-edit.md` listing each changed path.

1. Refuse to start while any unknown is open. Load `gm-eliminate` instead.
2. Make exact-match edits only. Run `callers` on each changed symbol first.
3. If the edit exposes a new unknown, record it and load `gm-eliminate`; the edit is re-run after it closes.
4. When the edit is complete, load the `gm-validate` skill with `row=<id>; session=<SESSION_ID>`.

## Finish the work

- Finishing the requested work is the goal of every run of this skill. A run that stops with work left undone is incomplete.
- When an issue blocks a step (a failing check, a fault in a tool or service, a missing input, a network or environment fault), fix it in the same run: retry on a bounded or resumable route, use an alternate route to the same result, repair the fault where it originates, then continue the remaining work.
- Stop only when the requested work is complete, or when a step is still blocked after every route has been tried. Then report the blocked step, the routes tried, and the evidence for each.
