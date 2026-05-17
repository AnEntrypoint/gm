---
name: gm
description: Orchestrator dispatching PLAN→EXECUTE→EMIT→VERIFY→UPDATE-DOCS skill chain; spool-driven task execution with session isolation
allowed-tools: Skill, Read, Write
end-to-end: true
---

# gm — ORCHESTRATOR phase

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
