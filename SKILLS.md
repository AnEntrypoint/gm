# SKILLS.md -- Skill Discovery

## Purpose

The skills shipped with this project live in `skills/<name>/SKILL.md`. Before
starting a task, check this list and read the relevant skill's SKILL.md -- its
numbered steps (or prose) ARE the procedure to follow.

---

## Available skills

| name | when to use |
|------|-------------|
| `gm` | The primary driver for any non-trivial coding, refactoring, debugging, or multi-step engineering task. Use it first, for the whole task. |
| `gm-continue` | The mandatory final handoff after a `gm` walk reaches `phase=COMPLETE` with `prd_pending_count=0`. Searches for remaining work; reloads `gm` or `wfgy-method` if any exists. |
| `wfgy-method` | Drift-recovery discipline for multi-step work: compare each step to the goal, weigh alternatives before ambiguous decisions, checkpoint before risky steps, bounded-retry-then-surface. |
| `polaris-protocol` | WFGY 5.0 Polaris Protocol root: compile goals before execution, shoot problems into inspectable routes, control drift. Load first for complex/high-stakes/long-horizon work, then dispatch its children. |
| `polaris-goal-compiler` | Compiles a goal into task atoms, active/blocked work, verification gates, and claim ceilings before execution. |
| `fifth-dimension-engine` | WFGY 5.0's core problem-solving tool: lifts a target into higher problem-coordinates and returns structured routes. Use after the goal compiler. |

The authoritative list is the set of directories under `skills/`; each
`skills/<name>/SKILL.md` carries its own `description` frontmatter naming
exactly when to reach for it.

---

## Usage flow

```
1. Check the table above (or list skills/*/) for a skill matching the task
         ->
2. Read the matching SKILL.md's description frontmatter to confirm the fit
         ->
3. Read the full SKILL.md -- its steps ARE the procedure
         ->
4. Follow it to completion
```

---

## Rules

- **Discover first:** If you don't know which skill fits, read this list and
  the candidate SKILL.md before assuming -- don't improvise a procedure a
  skill already defines.
- **The SKILL.md is the source of truth:** Its steps override your prior
  assumptions about how to do the task.
- **Multiple skills:** If a task spans more than one, read each relevant
  SKILL.md.
- **No skill fits:** Proceed with general knowledge and say so.
