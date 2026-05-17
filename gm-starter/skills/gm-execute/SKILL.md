---
name: gm-execute
description: EXECUTE phase AND the foundational execution contract for every skill. Every spool dispatch run, every witnessed check, every code search, in every phase, follows this skill's discipline. Resolve all mutables via witnessed execution. Any new unknown triggers immediate snake back to planning — restart chain from PLAN.
allowed-tools: Skill, Read, Write
---

# gm-execute — EXECUTE phase

Dispatch via plugkit spool. Write `.gm/exec-spool/in/<verb>/<N>.txt` with the request body. Read response from `.gm/exec-spool/out/<N>.json`. Follow `nextSkill` field via `Skill()` immediately — no stop, no approval, no narration.

Verbs for this phase:
- `phase-status` — read current FSM state
- `transition` — advance phase
- `mutable-resolve` — mark mutable witnessed (auto-fires memorize)
- `memorize-fire` — explicit memorize dispatch
- Plus existing: `recall`, `codesearch`, `memorize`, `health`, all language stems

The plugkit orchestrator owns state. The skill is one line: dispatch and follow.

## Transition

Read `out/<N>.json::nextSkill`. Invoke `Skill(skill="gm:<nextSkill>")` immediately. End of skill.
