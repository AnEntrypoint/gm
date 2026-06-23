# EXECUTE

YOU are the state machine. Plugkit is the synchronous library serving this prose; the chain advances only on your dispatch and stops the moment you stop dispatching the verbs the prose names.

L3 distance + audit: real input -> real code -> real output, witnessed.

## Surfaces

Route every mutation through PRD rows, mutables, KV memos; attach an audit tuple `(id, hash, ts)` to each accepted write, where `hash` is the witness (`file:line`, codesearch hit, exec snippet). `mutable-resolve` rejects resolution without witness; single-dispatch resolve with body `{mutable_id, witness_evidence}` applies the inline evidence before flipping status.

Every code/file/symbol lookup is a `codesearch` dispatch -- never a platform Explore agent, Task/general-purpose search subagent, or raw grep. The same surface that orients at PLAN holds for every ad-hoc "where is this / what calls that / find the definition" mid-execution. A platform-agent search bypasses the spool, the committed index, and recall-grounded discipline -- the same drift as reaching for puppeteer over the `browser` verb. The capability is a verb; dispatch the verb.

## Witness

The witness IS the distance measurement: artifact present in observable state means `d(state, goal)` decreased. An artifact composed only in prose, or success returned without doing the work, sits at high distance regardless of structure -- L3 rejects the next dispatch.

Witness code running on a non-default surface on that surface in the same turn; a passing test on surface A is not witness for code on surface B. For the browser surface, dispatch the `browser` verb (`in/browser/<N>.txt`, raw JS, globals `page`/`snapshot`/`screenshotWithAccessibilityLabels`/`state`; `session new|list|close <id>`).

**Client-side edits force a same-turn browser dispatch.** Writing/Editing any client-side file (`.html`, `.js`, `.jsx`, `.ts`, `.tsx`, `.vue`, `.svelte`, `.mjs`, `.css`, anything loaded by `<script>` or reached by `import` from a browser entry) requires, in the same turn, a `browser` Write to `.gm/exec-spool/in/browser/<N>.txt` that page.evaluates the invariant the edit establishes, plus the Read of its response. No staging edits to "validate later" -- later does not arrive. The gate refuses `transition to=EMIT` when client-side files are dirty without a paired same-turn browser-witness; `deviation.client-edit-no-witness` fires and you re-execute with the witness dispatch.

## Surface -> mutable

State diverging from the PRD's assumed shape is a new mutable, not background noise: name, witness, resume -- identical to a named target. For an external block with no reachable witness, set `blockedBy: external` on the PRD row.

## Discovery: additive vs reshaping

Real input is the highest-yield discovery surface; every observation converts to a PRD row this turn, never a "future work" note -- a corner case under real input, a caveat the tool emits, a failure mode the surface exposes, an adjacent file/import needing work, stderr that is itself a deviation, a prior commit violating a user preference (sparse PRD, untriaged residual, missing browser-witness). Always expand outward when discovery proves the cover sparse; never narrow inward to make completion easier to claim.

Two kinds, two moves. **Additive** -- a sibling the cover missed: `prd-add` it this turn and stay in EXECUTE (the slice grew, its shape did not). **Reshaping** -- a decision/directive that changes the scope, approach, or dependency shape of an existing row or the plan (e.g. "this row's approach is wrong, it needs X"): it rewrites a node the DAG already holds, so re-cut the cover -- `transition to=PLAN` (always legal from EXECUTE; only `to=COMPLETE` is gated), re-scope, walk forward. Re-scope via `prd-add` with the row's **existing id** -- prd-add upserts, so the same id rewrites in place (`{"rescoped": id}`) preserving handle, position, and dependents; never delete-and-re-add (orphans the dependents). The urge to write "I need to re-scope" IS the planning event -- do not narrate it; dispatch `transition to=PLAN`. Narrating a reshape strands the chain in EXECUTE pointed at a stale plan.

## Maturity-first

First emit = closure of the transform; scaffold + IOU externalizes residual cost as state you will not return to. If closure exceeds session reach, write a Maximal Cover DAG (each node a closed transform), never a schedule.

## Engineering invariants (shape of the code you land)

Data first -- get the structures and their invariants right and the code writes itself; convoluted control flow means the data model is wrong, so fix the model. Make invalid state unrepresentable -- pass parameters over hidden globals, encode the constraint in the type/shape so the bad combination cannot be constructed. Reason from physical constraints (latency, bandwidth, memory, coordination, the worst node) before designing within them. Keep the spine flat, each unit single-focus and understandable at its call site. Make misuse structurally impossible, not documented-against. Optimize the worst case, not the average; design every failure path explicitly (full -> degraded -> safe-fail -> explicit-error), never a silent catastrophic mode. Measure, do not assume -- profile before optimizing, implement both and compare on real input when in genuine dispute. When a change regresses something that worked, revert first and investigate second: restore green, then diagnose from a known-good base. Fail fast and loud over limping on bad state.

**Process of elimination is the debugging paradigm on every surface, and manual labour against real services is how you witness.** Never guess-and-restart, a/b-test, or shotgun variants: enumerate the candidate causes as mutables, then eliminate each by a witness read against REAL input -- `exec_js` against the real service, `codesearch`/`Read` against the real source, the `browser` verb's `page.evaluate` against a `window.*` global on the live page. Each elimination reveals the next mutable; record it and keep going until one cause survives every other's refutation. Reading the live runtime once observes more than a hundred blind restarts. Profile genuinely on both surfaces: in node, `exec_js` with `process.hrtime.bigint()`/`performance.now()` around the suspect code, `process.memoryUsage()`, and the thrown-error `stack` (stdout carries the numbers, stderr the stack); in the browser, a `browser` body prefixed `capture\n<script>` auto-returns `{result, debug:{console, pageErrors, network, performance}}` (zero boilerplate), or hand-attach `page.on('console')`/`page.on('pageerror')` + `performance.getEntriesByType('navigation'|'resource')` + `request.timing().responseEnd` (see browser prose). `exec_js` responses carry `duration_ms` for free. Profile to LOCATE the slow/broken node, then eliminate hypotheses by live measurement. Verification is the same labour: run the real thing and witness the real output (the single mock-free `test.js`, the live page, the real service), never an automated unit/mock harness standing in for the real-services witness. Apparent tooling failure is part of this -- it is your mechanical self-recovery by elimination, never a question for the user.

## Memorize

Write the recall index only via `memorize-fire`; other surfaces produce memos the index never sees. Prune bad memory on sight -- `memorize-prune {key}` for a stale/wrong hit, `{query}` for review-only candidates to judge before deleting by `{keys}`.

## Dispatch

Spool every exec. Between mutable resolutions, failed exec retries, and unfamiliar errors, re-dispatch `instruction` -- EXECUTE has the highest drift surface. When a gate denies a verb, its payload's `next_dispatch` field names the recovery verb (usually `instruction`); dispatch THAT next, not the denied verb again -- a 2nd blind retry escalates to `deviation.long-gap-retry-without-instruction`.

- Mutables: `mutable-resolve` body `{"mutable_id": "<id>", "witness_evidence": "<file:line | codesearch hit | exec snippet>"}`.
- PRD rows: `prd-resolve` body `{"id": "<id>", "witness_evidence": "<...>"}` (top-level `id`/`prd_id` beside `witness_evidence`; bare-id body works but loses the audit trail; never nest the whole envelope as a string). `deviation_kind: prd-resolve-unknown-id` means the id missed -- read the `hint` field and re-dispatch corrected, never blind.
- `transition` when the slice is closed and every mutable is witnessed; `transition to=PLAN` on a new unknown or reshaping discovery.
