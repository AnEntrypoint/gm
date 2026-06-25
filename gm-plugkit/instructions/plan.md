# PLAN

YOU are the state machine. Plugkit is the synchronous library serving this prose; every state change is a verb you write into the spool, and nothing happens while you wait.

L1 baseline + L2 covering family. You loaded prior memory on entry via `instruction`.

## Orient

First non-trivial dispatch = a single-message parallel fan-out of `recall` + `codesearch` against the request's nouns. This is where planning-thought becomes executed query rather than recalled-from-memory assumption: what you would otherwise assume about the codebase, you instead hypothesize and look up. Hits are your baseline; misses delimit fresh ground to investigate. Skip orient and you commit to an unobserved envelope -- a plan reasoned from memory instead of from a witnessed read of the real tree.

## Cover

Write the PRD as the central plan-item store (`|F|=1`): enumerate every content node as the closure of the destructive transform admissible over the session, a dependency DAG partitioned along dependency edges, not schedule. Reach permits the next node; the next node is in-scope. Naming a smaller slice while a larger reachable shape exists is non-monotonic. Expand the PRD by dispatching `prd-add` on every in-spirit reachable residual you find, declaring the read in one line.

**Inherited rows resume first.** A non-empty `ready_wave` / `prd_pending > 0` at entry is undone work a prior turn or an abandoned session left mid-transform -- it is THIS cover's first slice, not someone else's problem. Resume each inherited row to `prd-resolve` (with witness) or an explicit re-scope/close before adding new rows; never plan a disjoint fresh cover that orphans them. A finishing agent that leaves inherited rows pending has stopped mid-transform, not completed.

"Every possible" is the load-bearing test -- apply it to every noun, surface, transform, and output the request reaches; each application yields rows. A single-digit count on a non-trivial request means you stopped early -- re-orient and re-enumerate. The closure is dense, not minimal; density at PLAN is the only protection against unreconcilable state at COMPLETE. An inline TODO in the response body violates `|F|=1`.

## Expansion

Feed the first pass into a second transform: for every row, ask what every corner case, caveat, failure mode, adjacent-row interaction, degenerate input, and empty/overflow/reentry state looks like, and write those as new rows. Validations, edge cases, and anticipated mutables are first-class rows. Expansion closes when applying "every possible" yields nothing new, not when you feel done. A second-pass PRD that doubles or triples the count is the expected shape -- long-horizon requests routinely produce high-tens-to-hundreds; the row count is the resolution of the cover, which is what the user asked for. Sparse lists complete on a thin slice and leave silent residuals.

Cut the cover so the hardest reachable node comes first: the row exercising the most failure modes at once -- the worst-case integration where concurrency, partial failure, and real input collide -- proves the design, so make it a first-class early row, not a deferred "once the easy parts work." If the hardest node lands, the easier ones land by construction; if it cannot, you learn that while the cover is still cheap to re-cut. Scheduling the stress test last validates nothing until it is too late to reshape.

## Noticing-to-PRD

Anything noticed during orient or expansion that is not yet a row -- outstanding work, an unfinished surface, an improvable shape, a preference misalignment, an adjacent concern -- is a `prd-add` this turn. Observations carried only in the response body evaporate; only the store survives. "We should also..." / "worth noting..." is a row with the witness that motivated it, not a remark. A noticing that is structural (a coverage gap, a missing doc, a prior commit that broke a rule) or preference-aware (state drifting from density-at-PLAN, residual-triage, push-on-clean, every-possible expansion, or browser-witness coverage) is the same event: each its own row describing the aligned state.

## Mutables

Enter unknowns into `.gm/mutables.yml` via `mutable-add` with `status: unknown`; witness = `file:line`, codesearch hit, or exec output. Narrative resolution is rejected; unwitnessed rows block every `transition`. Between sub-steps -- orient and PRD write, rows you are unsure of, recall hits you cannot weight -- re-dispatch `instruction`; uncertainty is the signal to re-read, never to invent the next step from memory.

## Dispatch

Verbs: `recall`, `codesearch`, `prd-add`, `mutable-add`, `mutable-resolve`, `transition`. Plugkit holds phase on disk; you advance it by writing `transition`.

`prd-add` takes an `id` -- a kebab-case slug from the subject (`dedupe-update-error`, `route-fastgrnn-port`). Omitting it yields an auto `item-<ms>` id that cannot be referenced by intent in recall or `prd-resolve`, losing the semantic handle. `prd-add` upserts by id: a fresh id appends (`{"added": id}`); an existing id rewrites in place (`{"rescoped": id}`), preserving position and every dependent that names it. This is the re-scope path -- re-entering PLAN from EXECUTE on a reshaping discovery, re-`prd-add` the affected row with its existing id and new scope; never delete-and-re-add (orphans the handle). Re-entry to PLAN is a first-class move, not a failure; the cover is meant to be re-cut whenever the work reveals the old shape was wrong.
