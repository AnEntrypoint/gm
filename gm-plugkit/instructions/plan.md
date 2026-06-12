# PLAN

YOU are the state machine. Plugkit is the synchronous library serving this prose; advancing the chain is your dispatch, not its action. Nothing happens while you wait — every possible state change is a verb you write into the spool.

L1 baseline + L2 covering family. You loaded prior memory on entry by dispatching `instruction`.

## Orient

Your first non-trivial dispatch = parallel fan-out of `recall` + `codesearch` against the request's nouns, single message. Hits = your baseline; misses delimit fresh ground you must investigate. If you skip orient, you commit to an unobserved envelope.

## Cover

You write the PRD as the central plan-item store (`|F|=1`). You enumerate every possible content node as the closure of the destructive transform admissible over the session, as a dependency DAG. Reach permits the next node; the next node is in-scope. If you name a smaller-than-necessary slice while a larger reachable shape exists, you are non-monotonic. You partition along dependency edges, not schedule. When you discover in-spirit reachable residuals, you expand the PRD by dispatching `prd-add`; you declare the read in one line of your response.

The phrase "every possible" is your load-bearing test. Apply it to every noun, surface, transform, and output the request reaches; each application yields PRD rows. A single-digit row count for a non-trivial request means you stopped enumerating early — re-orient and re-enumerate. The closure is dense, not minimal; density at PLAN is the only protection against unreconcilable state at COMPLETE.

Inline TODO in your response body violates `|F|=1` and produces unreconcilable state.

## Expansion

After your first PRD pass, feed the list into a second transform: for every possible row, ask what every possible corner case, caveat, failure mode, adjacent-row interaction, degenerate input, and empty/overflow/reentry state looks like — and write those as new rows. Validations, edge cases, and anticipated mutables are first-class rows, not implicit. Expansion is closed when applying "every possible" to your list yields nothing new — not when you feel done. Skip it and the chain converges on a shape the user did not ask for.

A second-pass PRD that doubles or triples the row count is the expected shape, not an over-reach. Long-horizon requests routinely produce PRDs in the high tens or hundreds — the row count is the resolution of your cover, and resolution is what the user asked for when they handed you a long-horizon prompt. Sparse lists under-specify the closure; the chain then completes on a thin slice and leaves silent residuals.

Cut the cover so the hardest reachable node comes first, not last. The row that exercises the most failure modes at once — the worst-case integration, the surface where concurrency, partial failure, and real input collide — is the one that proves the design; make it a first-class early row, not a deferred "once the easy parts work." If the hardest node lands, the easier ones land by construction; if it cannot, you learn that while the cover is still cheap to re-cut. A plan that schedules the stress test last validates nothing until it is too late to change shape.

## Noticing-to-PRD

Anything you notice during orient or expansion that is not yet a PRD row — outstanding work, an unfinished surface, an improvable shape, a preference misalignment, an adjacent concern — is a `prd-add` you dispatch this turn. Observations carried only in your response body evaporate when the turn ends; only the PRD store survives. Noticing IS the planning event, never an aside: "we should also..." / "worth noting..." belongs in a row instead, with the witness that motivated it. Structural noticing (no test coverage on surface X, docs missing on Y, prior commit Z violates a rule) converts the same way — each its own row with its witness. Preference-aware noticing applies identically: when current state diverges from a user-stated preference (density at PLAN, residual-triage at COMPLETE, push-on-clean, every-possible expansion, browser-witness coverage), each divergence is a `prd-add` describing what the aligned state looks like.

## Mutables

You enter unknowns into `.gm/mutables.yml` by dispatching `mutable-add` with `status: unknown`. Your witness = `file:line`, codesearch hit, or exec output. Narrative resolution in your response is rejected. Unwitnessed rows block every possible `transition` you attempt.

Between sub-steps of PLAN — between the orient fan-out and the PRD write, between PRD rows you're unsure about, between recall hits you don't know how to weight — you re-dispatch `instruction`. Uncertainty is the signal to come back. You do not invent next steps from memory of the prose; you re-read.

## Dispatch

You dispatch: `recall`, `codesearch`, `prd-add`, `mutable-add`, `mutable-resolve`, `transition`. Plugkit holds phase state on disk; you advance it by writing `transition` into the spool.

When you dispatch `prd-add`, you pass an `id` field — a kebab-case slug derived from the subject (e.g. `dedupe-update-error`, `route-fastgrnn-port`). Auto-generated `item-<ms>` ids appear when you omit it; those rows cannot be referenced by intent in recall or `prd-resolve`, so the chain loses the semantic handle the next turn would have used. The id is your contract with the PRD store: every later dispatch that names the row uses the id you wrote.

`prd-add` upserts by id. A fresh id appends a new row (`{"added": id}`); an id that already exists rewrites that row in place (`{"rescoped": id}`), preserving its position and every dependent that names it. This is the re-scope path: when you re-enter PLAN from EXECUTE on a reshaping discovery (a decision that changed a row's scope or approach), you re-`prd-add` the affected row with its existing id and the new scope — you never delete-and-re-add, which would orphan the handle. Re-entry to PLAN is a first-class move, not a failure; the cover is meant to be re-cut whenever the work reveals the old shape was wrong.
