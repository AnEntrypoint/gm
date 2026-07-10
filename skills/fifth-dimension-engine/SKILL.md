---
name: fifth-dimension-engine
description: WFGY 5.0's core problem-solving tool. Lifts targets into higher problem-coordinates and returns structured routes (proof paths, strategy kernels, research structures, repair paths, positioning routes). Theorem work to everyday decisions. Use after Goal Compiler to execute the compiled problem specification.
license: MIT
compatibility: Portable "shoot + [problem]" command; works wherever an assistant can run a natural-language prompt. Upstream ships it as the current main product surface of WFGY 5.0 Polaris Protocol.
metadata:
  origin: onestardao-wfgy-5.0-polaris-protocol
  provenance: adapted-and-honest-reimplementation-not-verbatim
---

# Fifth-Dimension Engine

WFGY 5.0's core problem-solving tool. Lifts a target into a higher problem-coordinate, then returns a route that can be inspected, attacked, expanded, and tested.

**Before you decide, shoot first.**

## What This Is

The Fifth-Dimension Engine does not just answer. It transforms a target into a route.

| Input | Engine Action |
|---|---|
| Theorem | Produces proof-route structure |
| Frontier problem | Produces research kernel |
| Strange theme | Produces mathematical skeleton |
| Life decision | Produces route map |
| Product idea | Produces positioning route |
| Engineering failure | Produces repair path |
| Meme or absurd target | Produces hidden structure |

The output is not a direct answer. It is a **route**: an inspectable, attackable, expandable structure you can verify, challenge, and refine.

## When to Use

Use this skill when you have:
- A well-specified problem (use Goal Compiler first if unclear)
- A target worth spending time on (trivial problems don't need shooting)
- An appetite for structured reasoning (prefer depth over speed)

Use **especially** for:
- Theorem work (formal proofs, mathematical problems)
- Strategic decisions (career, startup, major choices)
- Research questions (turning ideas into research kernels)
- Engineering failures (root cause analysis, repair paths)
- Product/positioning work (audience, launch strategy)
- Mixed-theme problems (combining unrelated ideas into research)

## How to Use

### Basic Command

```
shoot + [your problem]
```

### The Engine Returns

A structured route containing:

- **Route**: The core strategy or path forward
- **Structure**: Decomposition into sub-problems
- **Candidate Lemmas**: Supporting proofs, insights, or evidence
- **Objections**: What could go wrong, counterarguments
- **Open Debt**: What remains unresolved
- **Next Command**: What to do next (for theorem work: a new Lean line; for other work: next investigative step)

### Why This Matters

Instead of:
- A flat answer (right or wrong, you can't inspect it)

You get:
- A *structure* you can examine
- Sub-claims you can verify independently
- Attack surfaces (where to challenge it)
- Expansion points (where to dig deeper)
- Clear open questions (what's not yet resolved)

## Interaction with Other Skills

### With Polaris Goal Compiler

- **Goal Compiler** specifies and atomizes the problem
- **Fifth-Dimension Engine** produces the route
- **Goal Compiler's verification gates** validate the engine's output

**Integration**: After Goal Compiler breaks work into atoms, use the engine on each atom that requires structured reasoning.

**Workflow**:
1. Goal Compiler compiles the problem into task atoms
2. For each atom, ask: "Do I need to shoot this, or is it routine?"
3. If routine: execute directly
4. If complex: shoot it with Fifth-Dimension Engine
5. Use Goal Compiler's verification gate to check the output
6. Move to next atom

### With WFGY-Method (Drift Control)

- **Fifth-Dimension Engine** produces structured reasoning
- **WFGY-Method** keeps that reasoning aligned with the original goal

**Integration**: While the engine explores the route, WFGY-Method checks: "Are we still solving the original problem, or have we drifted into a different one?"

Use the engine for *depth*, WFGY-Method for *direction*.

## Modes

### Theorem and Formal Work

Shoot a theorem or formal problem; the engine returns a proof-route structure that can be checked against a formal verification standard.

### Mixing Themes

Give the engine two unrelated themes and let it find the mathematical skeleton underneath them:

```
shoot + [theme 1] + [theme 2]
```

See `references/research-kernel-extraction.md` for how mixed themes become research kernels.

### Everyday Problems

The same engine works on ordinary decisions, work problems, product questions, and engineering failures — any well-specified target benefits from being shot into a route rather than answered directly.

## Verification

The engine output is inspectable, which means verifiable. See `references/route-inspection-guide.md` for how to inspect, attack, and verify a route.

**This is not:** a black box. You can (and should) inspect, attack, and refine.

## What This Is Not

This skill does not:
- Specify the problem (that's Goal Compiler)
- Control drift during execution (that's WFGY-Method)
- Produce a final answer (it produces a route, which you then verify and decide on)
- Guarantee the route is correct (inspection and verification are your job)
- Claim every shoot becomes a final theorem (a shoot creates a structured route; final proof, empirical truth, or real-world correctness depends on verification, review, formalization, or testing)

## References

See `references/` directory for:
- `route-structure.md` — what a route is and how it is structured
- `research-kernel-extraction.md` — turning ideas into research kernels
- `route-inspection-guide.md` — how to verify and attack a route
- `skills/polaris-protocol/SKILL.md` — the Polaris Protocol tree root and state machine
