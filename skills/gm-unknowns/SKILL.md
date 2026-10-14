---
name: gm-unknowns
description: "Second stage of resolving one PRD row: writes the list of unknowns the row depends on. Loads gm-eliminate next. Invoke only from gm-prd; do not load directly."
---

# gm-unknowns

Input: `row=<id>; session=<SESSION_ID>`. Output: `.gm/receipts/<row>/02-unknowns.md`.

1. List each fact the row needs that the orient receipt does not prove. One line per unknown. Each line states the question it answers.
2. Record each unknown with `mutable-add` until the verb is renamed (`UNKNOWN-VERB-RENAME`). Do not open any new unknown in another form.
3. If the list is empty, load `gm-edit`; otherwise load `gm-eliminate`.
   `Skill(skill="gm-eliminate", args="row=<id>; session=<SESSION_ID>")`
