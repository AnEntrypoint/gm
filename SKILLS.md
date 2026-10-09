# SKILLS.md -- Skill Discovery

The skills shipped with this project live in `skills/<name>/SKILL.md`; the directories under `skills/` are the authoritative list. Each SKILL.md's `description` frontmatter names when to use it. Before starting, read the matching SKILL.md in full: its steps are the procedure and override prior assumptions. If several match, read each. Do not improvise a procedure a skill already defines. If none fits, proceed with general knowledge and say so.

| name | when to use |
|------|-------------|
| `gm` | Primary driver for any non-trivial engineering task; use it first, for the whole task. |
| `gm-continue` | Final handoff after a `gm` walk reaches `phase=COMPLETE` with `prd_pending_count=0`; searches for remaining work. |
| `wfgy-method` | Drift recovery for multi-step work: compare to the goal, weigh alternatives, checkpoint, bounded retry. |
| `polaris-protocol` | WFGY 5.0 Polaris root for complex, high-stakes or long-horizon work; dispatches its child skills. |
| `polaris-goal-compiler` | Compiles a goal into task atoms, gates and claim ceilings before execution. |
| `fifth-dimension-engine` | Lifts a target into higher problem-coordinates and returns structured routes; use after goal compilation. |
| `agent-memory` | TencentDB Agent Memory for cross-session, cross-framework team memory; distinct from this project's recall store. |
| `dream-rsi` | Propose-only strategy inference from Dream-RSI observation logs and gm-graph coverage; never deploys. |
