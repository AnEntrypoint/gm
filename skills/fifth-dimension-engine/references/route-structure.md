# Route Structure in Fifth-Dimension Engine

## What a Route Is

A route is the **output of the Fifth-Dimension Engine** — a structured, inspectable answer to a complex problem.

Instead of a flat statement like "Yes, do this" or "The answer is X," the engine produces:

```
Route:       The core strategy or path
Structure:   Decomposition into sub-problems
Lemmas:      Candidate supporting proofs or evidence
Objections:  What could be wrong with this route
Open Debt:   What remains unresolved
Next:        What to do next (for iteration)
```

## Example: Life Decision Route

**Input**: "Should I leave my job to start a company?"

**Output Route**:
```
Route: 
  Yes, but time the exit correctly and secure funding first.

Structure:
  1. Assess market opportunity (is there a real market?)
  2. Assess personal readiness (skills, network, risk tolerance)
  3. Assess financial readiness (runway, equity, savings)
  4. Plan the exit (timing, knowledge transfer, network preservation)

Lemmas:
  - Founders with technical skills + funding + market timing succeed 40% more often
  - First-time founders without network succeed <5% of the time
  - Having 18 months of runway increases long-term success 60%

Objections:
  - Market might be smaller than expected (validate with customers first)
  - You might not be ready for founder stress (talk to founders who've failed)
  - Economic conditions could deteriorate (watch funding trends)

Open Debt:
  - Specific market size unknown (need to validate)
  - Your personal risk tolerance unclear (need to model scenarios)
  - Specific funding sources not identified (need to map potential investors)

Next:
  - Spend 2 weeks validating market with 20+ potential customers
  - Then reassess using these validation results
```

## Why Routes Matter

A route is:
- **Inspectable**: You can see the reasoning, not just the conclusion
- **Attackable**: You can challenge each part independently
- **Expandable**: You can dig deeper on open debt
- **Verifiable**: You can check each lemma independently

A flat answer is:
- Opaque (you have to trust it)
- Hard to debug (if it's wrong, what went wrong?)
- Hard to improve (you can't extend it)

## Route Types by Problem Class

| Problem | Route Type |
|---|---|
| Theorem | Proof structure with lemmas, open questions |
| Strategy | Decision tree with tradeoffs and assumptions |
| Design | Architecture with component roles and interactions |
| Repair | Root cause with fix path and side-effect checks |
| Research | Research kernel with hypothesis and validation steps |

See `POLARIS-SKILLS-GUIDE.md` for full integration.
