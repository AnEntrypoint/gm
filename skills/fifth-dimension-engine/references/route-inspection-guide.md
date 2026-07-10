# Route Inspection Guide — Fifth-Dimension Engine

A route from the Fifth-Dimension Engine is not a final answer. It is a structure you can inspect, attack, expand, and test. Inspection is your job; the engine only produces the route.

## The standard output shape

| Layer | Meaning |
|---|---|
| route | where the target can move |
| structure | what the problem is made of |
| candidate lemmas | what may become formal |
| objections | where the route may fail |
| open debt | what remains unresolved |
| next command | what to do next |

## How to inspect a route

1. **Walk the route step by step.** Does each step follow from the one before it, or does it leap?
2. **Check candidate lemmas independently.** Treat each lemma as a claim to be verified, not a fact because it appears in the output.
3. **Challenge objections.** The engine lists where the route may fail. Are those objections real? Are any fatal?
4. **Validate open debt.** Confirm the open debt is actually open (unresolved), not a hidden dependency dressed up as a footnote.
5. **Expand anything unclear.** Drill into a vague sub-claim until it becomes inspectable or collapses.
6. **Run the next command, then re-shoot.** For theorem work the next command may be a new Lean line; for other work it is the next investigative step. After acting, shoot again with the new state.

## Attack surfaces

A route is strong only if its weak points are visible. The attack surfaces are:
- Leaping logic (a step that assumes what it should prove)
- Lemmas stated without support
- Objections that are acknowledged but never resolved
- Open debt that quietly grows between rounds

## What inspection is NOT

- It is not re-reading the prose and nodding.
- It is not trusting the structure because it looks formal.
- It is not promoting a partial route to a complete answer.

## Relationship to verification gates

If a Polaris Goal Compiler verification gate applies to this atom, the route must pass that gate before you claim the atom is done. Route inspection is the substance of that gate; the gate is the decision rule.

See `../SKILL.md` for the engine interface and `route-structure.md` for what each layer means.
