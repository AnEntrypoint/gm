---
name: gm-eliminate
description: "Third stage of resolving one PRD row: eliminates each unknown by a live JIT run, adding new unknowns found on the way. Loads gm-edit only when none is open. Invoke only from gm-prd; do not load directly."
---

# gm-eliminate

Input: `row=<id>; session=<SESSION_ID>`. Output: `.gm/receipts/<row>/03-eliminate.md`.

1. Take one open unknown. Write the expected value before the run. Derive the expected value from the row's contract, never from the code it checks.
2. Run a live JIT check against the real system. Record the dispatch id and the observed value.
3. Mark the unknown known when observed matches expected. If a run reveals a new unknown, record it with `mutable-add` and go on with it next.
4. Repeat until no unknown is open. Then load `gm-edit`.
   `Skill(skill="gm-edit", args="row=<id>; session=<SESSION_ID>")`
