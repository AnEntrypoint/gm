# Verification Gates in Polaris Goal Compiler

## What a Gate Is

A verification gate is a **check that must pass before moving to the next atom**. It prevents fake completion by requiring proof of actual readiness.

## Types of Gates

### Correctness Gate

"Does the output match what was asked for?"

- Atom: "Design the data model"
- Gate: "Does the model represent all required entities and relationships?"

### Completeness Gate

"Is it complete enough for downstream work?"

- Atom: "Research payment APIs"
- Gate: "Have we identified all APIs that meet our compliance requirements?"

### Assumption Validation Gate

"Are hidden assumptions actually true?"

- Atom: "Choose a database"
- Gate: "Have we verified it can handle our projected scale? That we can operate it?"

### Integration Gate

"Will this work with the next piece?"

- Atom: "Implement payment routing"
- Gate: "Does the routing interface match what the integration team designed?"

## Designing a Good Gate

For an atom:
1. **Ask**: What would make this atom "done"?
2. **Ask again**: How do we know it's actually done, not just "looks done"?
3. **That second answer is your gate.**

## Bad Gates

- "Complete" -- unmeasurable
- "Good enough" -- too vague
- "No obvious bugs" -- not verifiable
- Checking something trivial (wasting time)

## Gate Failure

If an atom fails its gate:
- **Do not move forward** -- you have incomplete work that looks complete
- **Return to the atom** -- what's actually missing?
- **Fix or redefine** -- either finish the work or redefine the atom scope

This is where fake completion gets caught.

See `POLARIS-SKILLS-GUIDE.md` for full integration.
