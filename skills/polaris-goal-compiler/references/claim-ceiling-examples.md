# Claim Ceiling Examples in Polaris Goal Compiler

A **claim ceiling** limits how strongly the assistant may describe completion. If only one local step is done, the assistant may not claim the whole task is complete. If verification is missing, it may not claim verified readiness.

The point is not optimism or pessimism. It is that a local success should not be promoted into fake global completion.

## The core rule

| Claim word | What it may mean | What it must NOT mean |
|---|---|---|
| "Complete" | verified to work end-to-end | "looks finished" / prose exists |
| "Correct" | checked against requirements | "sounds right" |
| "Ready" | tested for the next stage | "looks polished" |
| "Verified" | a check actually ran and passed | a check was imagined |
| "Done" | closure record shows done + no open debt | the last visible step finished |

## Worked examples by context

### Coding repair

- Atom A03 "Repair structure" is finished and the file compiles.
- Claim ceiling: you may say "the structure is repaired and compiles." You may **not** yet say "the bug is fixed" until A04 (verify repair) passes.
- If A04 is still blocked, saying "fixed" is a ceiling violation — it promotes a local step to global completion.

### Documentation packaging

- You wrote the release note (A06) but A04 (verify repair) never ran.
- Claim ceiling: you may say "a draft release note exists." You may **not** say "release ready" — readiness requires the verification gate first.
- This is exactly the upstream failure mode: writing the announcement before the repair is verified.

### Research synthesis

- You have three candidate lemmas but open debt on the fourth.
- Claim ceiling: you may say "three of four lemmas supported." You may **not** say "the route is proven" while open debt remains.
- Open debt must stay visible, not be silently folded into a "done."

### Long multi-round planning

- Round 3 finished one atom; rounds 4-7 are blocked upstream.
- Claim ceiling: report round 3's closure record (done / missing / partial / unsafe). Do **not** summarize the whole plan as "on track" when blocked atoms are unresolved.
- A closure record is what keeps the partial state honest across rounds.

## How to use this file

When writing any completion claim during a compiled task, ask:

1. Which atom produced this result?
2. Did its verification gate actually pass (truth object met)?
3. Is there open debt or a partial/unsafe state I am skipping?
4. Am I describing the local atom, or quietly promoting it to the whole task?

If step 4 is "promoting," lower the claim to the atom's actual verified state. That is the claim ceiling doing its job.

See `../SKILL.md` for the full Goal Compiler workflow, and `skills/polaris-protocol/SKILL.md` for how claim ceilings fit the Polaris Protocol state machine.
