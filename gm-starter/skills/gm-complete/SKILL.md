---
name: gm-complete
description: VERIFY and COMPLETE phase. End-to-end system verification and git enforcement. Any new unknown triggers immediate snake back to planning — restart chain.
allowed-tools: Skill, Read, Write
---

# gm-complete — VERIFY phase

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
