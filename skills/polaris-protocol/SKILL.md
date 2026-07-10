---
name: polaris-protocol
description: WFGY 5.0 Polaris Protocol — the active flagship route from onestardao/WFGY. A two-layer reasoning system that compiles goals before execution and shoots complex problems into inspectable routes, with drift control throughout. This skill is the tree root: load it first, then dispatch its child skills as explicit transitions — polaris-goal-compiler (compile), fifth-dimension-engine (shoot), wfgy-method (drift control). Use for any complex, multi-step, high-stakes, or long-horizon task where premature completion or goal drift is a risk.
license: MIT
compatibility: Portable protocol; upstream released the Goal Compiler ChatGPT-first (teaser) and the Fifth-Dimension Engine as the main product surface. This skill wraps both plus WFGY-Method drift control into one discoverable entry point for any assistant or agent that loads skills.
metadata:
  origin: onestardao-wfgy-5.0-polaris-protocol
  provenance: adapted-and-honest-reimplementation-not-verbatim
---

# WFGY 5.0 — Polaris Protocol (tree root)

Polaris is the active public route of WFGY 5.0. The **Fifth-Dimension Engine** is the current main product surface; the **Polaris Goal Compiler** is the first public protocol component. **WFGY-Method** supplies the drift-control discipline that keeps the whole system aligned with the original goal.

This skill is the **tree root**. It does not re-explain the children — it wires them into one state machine and tells you which child to dispatch at each step. Treat the three child skills as the transitions of the machine below.

## The tree

```
polaris-protocol  (this skill — root / entry)
├── polaris-goal-compiler   (COMPILE state)
├── fifth-dimension-engine  (SHOOT state)
└── wfgy-method             (DRIFT CONTROL — applies at every state)
```

Discoverable: each node is a standalone `SKILL.md` inside its own `skills/<skill-name>/` directory. This root is the entry point; the children are reached by explicit dispatch.

## The state machine

A skill tree can behave like a state machine. Each transition is an explicit skill dispatch (modeled on the `gm` skill's `transition`/`Skill(skill=...)` pattern): you do not narrate the next step, you **dispatch** it.

### States

| State | Meaning |
|---|---|
| `UNCOMPILED` | Raw human request, no structure yet. |
| `COMPILED` | Goal Compiler emitted task atoms, dependencies, verification gates, claim ceilings, and a closure-record template. |
| `SHOOTING` | A complex atom is being lifted by Fifth-Dimension Engine into a route. |
| `EXECUTING` | An atom (routine, or the result of a route) is being carried out. |
| `VERIFYING` | Output is checked against the atom's verification gate and against drift (ΔS, via WFGY-Method). |
| `CLOSED` | Claim ceiling met, closure record written, atom done. |

### Transitions (each is a dispatch)

```
UNCOMPILED --Skill(polaris-goal-compiler)--> COMPILED

COMPILED --complex atom? Skill(fifth-dimension-engine)--> SHOOTING
COMPILED --routine atom? execute directly---------------> EXECUTING

SHOOTING --inspect route, then carry it out-----------> EXECUTING

EXECUTING --Skill(wfgy-method) drift + gate check----> VERIFYING

VERIFYING --gate pass + claim ceiling honored--------> CLOSED
VERIFYING --gate fail / drift --> BBCR checkpoint ----> COMPILED (re-compile or re-shoot)

CLOSED --next atom------------------------------------> COMPILED
```

`wfgy-method` is not a single transition — it is the drift-control observer attached to **every** state. Before any step that could have drifted, dispatch it and read the result.

## Canonical syntax (pro-rata — use exactly this)

- **Compile first. Execute one active atom. Verify before unlock. Claim only what is supported.** (Goal Compiler)
- **shoot + [your problem]** — the Fifth-Dimension Engine interface.
- **ΔS = 1 − cos(I, G)** — drift between current state (I) and goal (G). Without a real embedding call, ΔS is a qualitative label ("ΔS looks high here"), never a computed decimal — unless a real `similarity` verb is available (see WFGY-Method).

"Compile first. Then shoot." is the spine of the whole protocol.

## How to run a task through the tree

1. You are at `UNCOMPILED`. Dispatch `Skill(skill="polaris-goal-compiler")`. It returns atoms, gates, and claim ceilings -> `COMPILED`.
2. For each active atom: ask "complex or routine?"
   - **Routine** -> execute directly -> `VERIFYING`.
   - **Complex** -> dispatch `Skill(skill="fifth-dimension-engine")` -> `SHOOTING` -> inspect the route -> `EXECUTING` -> `VERIFYING`.
3. At `VERIFYING`, dispatch `Skill(skill="wfgy-method")` to check drift and apply the atom's verification gate.
   - Pass + claim ceiling honored -> `CLOSED` -> next atom (back to `COMPILED`).
   - Fail or drift -> BBCR checkpoint, re-compile or re-shoot (back to `COMPILED`).
4. When all atoms are `CLOSED`, the task is done — and only then may you claim completion.

## What this tree is not

- It is not a single prompt. It is a set of skills you dispatch in sequence.
- It does not guarantee correctness. It makes fake completion and silent drift harder to hide.
- It does not replace verification, tests, sources, or expertise. The verification gate only makes verification *visible*.
- It does not claim to be the full private WFGY 5.0 engine. Goal Compiler and WFGY-Method are public protocol components; the Fifth-Dimension Engine is the current main public surface.

## Children (dispatch these)

- `polaris-goal-compiler` — compile the goal into atoms, gates, claim ceilings.
- `fifth-dimension-engine` — shoot a complex atom into a structured route.
- `wfgy-method` — hold drift control across every state.

For the full DAG, integration workflows, and mismatch detection, see `../POLARIS-SKILLS-GUIDE.md`.
