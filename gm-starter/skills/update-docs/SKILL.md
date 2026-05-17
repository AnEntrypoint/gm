---
name: update-docs
description: UPDATE-DOCS phase. Refresh README.md, AGENTS.md, and docs/index.html to reflect changes made this session. Commits and pushes doc updates. Terminal phase — declares COMPLETE.
allowed-tools: Skill, Read, Write
---

# update-docs — UPDATE-DOCS phase

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
