---
name: gm-skill
description: Canonical universal harness — AI-native software engineering. Plugkit serves all instructions, state, guardrails on demand via the spool.
allowed-tools: Skill, Read, Write
---

# gm — single entry point

Plugkit owns every instruction, every phase transition, every guardrail. The skill body is the only thing the agent reads from disk; everything else flows from plugkit verbs.

## The loop

1. Write `.gm/exec-spool/in/instruction/<N>.txt` with empty body (or `phase=<override>` to force a phase). Read `.gm/exec-spool/out/<N>.json`.
2. The response contains `phase`, `instruction` (prose to follow), `mutables_pending`, `prd_pending_count`, `next_phase_hint`.
3. Follow the `instruction` body imperatively. Resolve mutables, execute work, dispatch other verbs (`recall`, `codesearch`, `memorize`, `mutable-resolve`, `transition`, all language stems) as the instruction directs.
4. When the phase's exit condition is met, dispatch `in/transition/<N>.txt` to advance. Then re-enter step 1 with the new phase.
5. Loop until `next_phase_hint` is null (phase=COMPLETE) — the chain is done.

No other skill exists. There is no `gm:planning`, no `gm:gm-execute`, no `gm:gm-emit`. Plugkit serves what those used to be, on demand, per phase.
