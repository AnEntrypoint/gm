# LEAN BUILD

A method concern, not a pipeline stage: entered from any node that reaches it, left once its request holds. No concern gates entry to nodes.

BUILD writes the source that inhabits the G_CONTRACT signatures. Every new function is total; every resource has exactly one owner; every operation replays to the same state; every concurrent access is ordered by a sync point or provably disjoint. Each property is witnessed live. The node writes only the artifacts the PRD names, verifies each from disk, and exits when every STATE-kind and CONC-kind unknown is resolved, the diff passes the source hygiene predicates, and `transition to=G_INDEP` is dispatched through the G_INDEP gate.

Principles are applied as work, from the lean method (AnEntrypoint/lean). Each H3 carries a principle key, then the attribution exactly as gm-config/fsm/graph.json labels it.

## Verbs

Re-dispatch `instruction` at the start of each artifact and after any unfamiliar error. Every spool body carries session_id. Write only the artifacts the PRD names: `fs_write {path, content}` performs each mutation, and each write is followed by `fs_read {path}` of the same path; the disk content is the witness. A disk/plan discrepancy goes to root cause, never a blind retry. Any divergence from the PRD's assumed shape is a new unknown and `transition to=EARS`.

Before changing a function's signature or behaviour: `callers {symbol}` lists the call sites the edit must keep valid; an unnamed caller is a new unknown. `codesearch {query}` locates a thing; `codeinsight {action:"outline", path}` gives a file's overview. After writes, dispatch `codeinsight_index {}` so the next callers answer reflects the change.

Every build, subprocess, filesystem probe and live witness is an exec_js dispatch (separate Node process, no tools object). Commands with arguments: `require("node:child_process").execFileSync(command, args, { encoding: "utf8" })`. Use `opts.profile:true` to locate cost. Git: `git_diff {stat:true}` for net line change, `git_status` for the worktree, `git_show` for committed content; never through a shell.

Each sweep finding is declared as a typed unknown before resolution: `unknown-add {"id":"<kebab-case slug>","obligation_kind":"<kind>","depends_on":[...],"status":"unknown"}`. Kinds: the STATE kinds (totality, ownership, replay, effect-boundary) and the CONC kinds (happens-before, disjointness, contention). Resolve: `unknown-resolve {"unknown_id":"<id>","witness_evidence":"<live witness>"}`. Resolve rows: `prd-resolve {"id":"<row id>","witness_evidence":"<witness>"}`.

The closure narrative goes into the commit message in ADRN form, never the response body. Advance: `transition to=G_INDEP`. Reshaping: `transition to=EARS`. Contract defect: `transition to=G_CONTRACT`.

Route every mutation through the PRD, an unknown or a memo. The audit tuple of each accepted write is its id, witness hash and timestamp.

## PRD rows

Resolve a row with prd-resolve once its witness has printed its output. The row's route family sets the bar. A row tagged `observability` resolves only when its inspection point (a queryable endpoint, a debug hook, a structured log line) ships in the same pass as its subsystem. A subsystem shipped without its inspection point is an unresolved row; resolving it is a false completion.

Write-then-check exposes adjacent artifacts (a generated file the build needs, a document naming the new artifact, a witness script). Each becomes `prd-add` in the same turn; an observation unrecorded in its turn evaporates with it. An unrelated issue found mid-build is also a prd-add row: never fixed inline here, never dropped.

Pass `commit_comment` on prd-resolve for a row whose resolution deserves a line of history; omit it for granular rows.

## Mutables

STATE kinds: totality, ownership, replay, effect-boundary. Each sweep below produces one or more. Each unknown has a dependency DAG entry; its witness is the live exec_js run that discharges it. The state-obligations-ready predicate refuses the transition while any pending STATE-kind row is untyped or blocked, and names the offender.

CONC kinds: happens-before, disjointness, contention. The conc-obligations-ready predicate tests them the same way. A CONC-kind row may depend on a STATE-kind row (a contention bound presupposes a held ownership invariant). A STATE-kind row may depend on a PROVE-kind row from G_CONTRACT (a replay obligation may presuppose a proven invariant).

Dependency rule: resolve in order. An unknown whose depends_on are all resolved is ready; one with a pending dependency is blocked, so resolve the dependency first. A resolution surfacing a new unknown gets `unknown-add` in the same turn, with its kind and depends_on.

Two-pass rule: an unknown surviving two genuine resolution attempts without a witness is reclassified as a fresh unknown with a new id; affected rows are re-cut and the walk reshapes with `transition to=EARS`. A repair attempt failing twice follows the same discipline: change the approach, witness the result, never repeat the identical approach.

Gate-driven repair: a code repair is an Edit, a disk Read of the touched path, and the same live witness, all inside this node. A finding changing the state model (the ownership or disjointness boundary is wrong) is a new STATE or CONC unknown, and the sweep repeats for the new boundary.

## Machine fit

Concurrency and data layout are sized to the machine the code runs on. The common access pattern is the one the layout is shaped for; the common case is the path that falls through without a jump. Profile with `exec_js` and `opts.profile:true`, then confirm the change by live measurement of the same input before and after the edit. Speed intuition is not a witness. An access path whose cost grows superlinearly with concurrent callers is a defect even when its mean is good; its witness is the measured worst case set against the bound.

## Principles

### TOTALITY - Total Functional Programming - David Turner

Handover: Hands the defined results on every edge input to GUARD, so invalid inputs are rejected at the top of each function; nominated next node: GUARD; cite Total Functional Programming - David Turner.

Every new function returns a defined result on every input path. Feed edge inputs live through exec_js: zero-length, maximum-size, null or undefined, a wrong type where the language allows it, and a boundary-adjacent invalid value. Each run prints a defined result; each is a totality unknown whose printed results are the witness. A partial function escaping its domain fires the backreference to PARSEDV in G_CONTRACT; the domain is repaired at its entry boundary before the function is rebuilt.

### GUARD - Guard Clause - Martin Fowler

Handover: Hands the early-return guards to SLAP, so each function body reads at one level of abstraction; nominated next node: SLAP; cite Guard Clause - Martin Fowler.

Invalid input is rejected at the top by an early return, so the main path carries no nesting for invalid cases. Witness per guard: the exec_js run sending its invalid input and printing the early return. Branch structure still needing a comment to be read fires the backreference to SLAP, because the guards and branches should explain themselves.

### SLAP - Single Level of Abstraction - Kent Beck

Handover: Hands the single-level functions to STRUCTPROG, so control flow stays sequence, selection and iteration with one exit per block; nominated next node: STRUCTPROG; cite Single Level of Abstraction - Kent Beck.

Every function body works at one level of abstraction. A body mixing a domain decision with raw byte or string handling is split. Witness: the function outline from `codeinsight {action:"outline", path}` showing each function's calls on one level, plus an exec_js run showing the split functions return the same output as the mixed version. A function still mixing levels fires the backreference to DEEPMOD in G_CONTRACT.

### STRUCTPROG - Structured Programming - Edsger Dijkstra

Handover: Hands the traceable control flow to IMMUT, so shared data is updated by building the next version; nominated next node: IMMUT; cite Structured Programming - Edsger Dijkstra.

Control flow uses sequence, selection and iteration, one entry and one exit per block. Loops carry an invariant written as a precondition or a comment-free assertion in the type. Untraceable flow (a jump crossing a block, a loop whose exit is a side effect) fires the backreference to GUARD, where early returns restore a readable path. Witness: an exec_js trace of a representative path, printing each branch taken.

### IMMUT - Purely Functional Data Structures - Chris Okasaki

Handover: Hands the immutable structures to OWNERSHIP, which confirms each remaining resource has exactly one owner; nominated next node: OWNERSHIP; cite Purely Functional Data Structures - Chris Okasaki.

Shared data is immutable: an update constructs the next version, and the old version stays valid for every holder. Shared mutable state crossing a module boundary fires the backreference to OWNERSHIP. Witness: an exec_js run keeping the old value, applying the update, and printing both values, the old one unchanged.

### OWNERSHIP - Ownership and Borrowing - Matsakis and Klock

Handover: Hands the single-owner resources and their witnesses to DRY, so each fact has one representation; nominated next node: DRY; cite Ownership and Borrowing - Matsakis and Klock.

Every resource the diff takes has exactly one owner. Run the acquire, use and release cycle under exec_js, print the final state, and assert it matches the declared effect. No resource leaks, is closed twice, is used after release, or hides a mutation behind a pure-looking signature. Each is an ownership unknown. When two concurrent accesses touch a shared resource, name the owner; if exactly one cannot be named, restructure the boundary until one can. Sharing across async boundaries is a disjointness unknown: witness is an exec_js run interleaving the writers under a deterministic seed and printing that only the owner's write lands. Where the order of two concurrent accesses matters, order it by an explicit sync point (await, lock, channel, atomic, message boundary) or prove the state disjoint; each such order is a happens-before unknown. TOCTOU is the canonical violation: every single-instance or lock guard is atomic (O_EXCL, atomic rename, compare-and-swap), never check-then-act. A borrow outliving its owner fires the backreference to IMMUT.

Contention is bounded here too: every wait has a bound, every retry a cap, every hot lock is held for the shortest section. A path whose cost grows superlinearly with concurrent callers is a defect even when its mean is good. Witness: an exec_js run with N concurrent callers printing the worst case, with the bound and measured worst case as the unknown's measured value.

### DRY - Don't Repeat Yourself - Hunt and Thomas

Handover: Hands the merged single definitions to KISS, so the simplest construction that satisfies the contract is written; nominated next node: KISS; cite Don't Repeat Yourself - Hunt and Thomas.

One fact, one representation. Before writing a new function, a literal codesearch for the behaviour's distinctive tokens finds any existing copy; the reuse decision is recorded in the unknown's witness. Two representations of one fact fire the backreference to KOLMOGOROV, which belongs to the pressure node (P6). Functions meaning the same thing are merged, not kept side by side. Witness: the exhaustive codesearch reply showing one definition and its call sites.

### KISS - KISS - Kelly Johnson

Handover: Hands the simplest construction and its git_diff stat to the G_INDEP gate, which requires a verifier that has not read the implementation; nominated next node: G_INDEP; cite KISS - Kelly Johnson.

Write the simplest construction that satisfies the contract. A solution exceeding its problem fires the backreference to YAGNI, and the surplus generality is removed, not supported. Measure the net line change with `git_diff {stat:true}`. A removal that leaves the behaviour witnessed is preferred to an addition with the same witness. Witness: the git_diff stat plus the exec_js run proving the simpler form keeps the contract.

## Witness

Each obligation kind is discharged by a live exec_js run in the same turn; witness_evidence names the kind and the command.

- Totality: edge-input runs, each printing a defined result.
- Ownership: the acquire, use and release cycle printing its final state.
- Replay: the operation run twice, printing state before and after each run, then a second run that changes nothing.
- Effect-boundary: a query run printing the state unchanged; a command run returning only its status.
- Happens-before: two calls interleaved under a deterministic seed, printing that the outcome does not depend on the interleaving.
- Disjointness: the single writer named, and a concurrent run in which only that writer's write lands.
- Contention: the N-caller run with its measured worst case against the bound.

A sweep depending on the interleaving that happened to occur is not a pass: rerun each sweep under a different seed before it resolves. A happy-path-only run audits nothing.

Before the node closes, three diff predicates must hold:

- no-synthetic-test-files: the working diff introduces no standing test file (*.test.*, *.spec.*, or a test, tests or __tests__ directory), as predicates.md:19 defines it. Verification is a live exec_js witness against real code, never a suite.
- no-graphical-symbols-in-diff: new lines contain no decorative non-ASCII glyph (arrows, box drawing, stars, bullets, checks, crosses, emoji).
- no-admit-deferral-markers: new source lines contain no colon-form admit marker, no placeholder macro that panics or is unimplemented, and no phrase saying a path is not implemented. A marker stands in for a complete proof, so it is rejected.

A failing predicate names the offending lines; each is fixed and re-witnessed in this node.

Idempotent-dispatch-replay-safe is checked against the audit tuples of replays. A same-input replay reaching a different outcome is a violation and returns the walk to this node's replay unknown.

## Memory

Save an unknown as a memory file only when a later task needs it. Decisions, per-file edits, build output and the diff are not memories; git and the PRD row hold them. A witnessed run contradicting a memory file deletes the file and its MEMORY.md line.

## Transition

The exit is `transition to=G_INDEP`, the lean verification node, dispatched only when every STATE-kind and CONC-kind unknown is resolved and witnessed, every row is resolved, and the three diff predicates hold. The state-obligations-ready and conc-obligations-ready predicates name any pending row they refuse; that row is resolved next.

The edge from KISS runs through the G_INDEP gate (verifier has not read the implementation). The gate predicate is advisory and never refuses, so this node enforces the rule: the verifier is a fresh subagent with its own session_id, given only the contract text (PRD rows and signatures), with no reading of the implementation. A verifier that has read the code inherits its assumptions, and its verdict is discarded.

Feedback routes to the earliest capable node. A partial function escaping its domain goes to G_CONTRACT through PARSEDV. A function mixing abstraction levels goes to G_CONTRACT through DEEPMOD. Surplus generality goes to EARS through YAGNI. A reshaping discovery (the ownership or disjointness boundary is wrong, or the spec assumed a shape reality lacks) goes to `transition to=EARS`, with affected rows re-cut in place by prd-add on existing ids. A code repair stays in TOTALITY and is witnessed again here.

A transition refused with a next_dispatch is dispatched next, not narrated. Repeated identical refusals escalate at gate_repeat_escalate_threshold (default 3); the named recovery verb is dispatched instead of the denied transition.
