---
name: gm-edit
description: "Fourth stage of resolving one PRD row: makes the edit the eliminated unknowns allow. Loads gm-validate next. Invoke only from gm-prd; do not load directly."
---

# gm-edit

Input: `row=<id>; session=<SESSION_ID>`. Output: `.gm/receipts/<row>/04-edit.md` listing each changed path.

1. Refuse to start while any unknown is open. Load `gm-eliminate` instead.
2. Make exact-match edits only. Run `callers` on each changed symbol first.
3. If the edit exposes a new unknown, record it and load `gm-eliminate`; the edit is re-run after it closes.
4. When the edit is complete, load `gm-validate`.
   `Skill(skill="gm-validate", args="row=<id>; session=<SESSION_ID>")`
