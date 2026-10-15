# LEAN BUILD

This is a concern of the method, not a stage of a pipeline: it is entered from whichever node the work reaches it from, and left as soon as what it asks for holds. No concern gates entry to a set of nodes.

BUILD writes the source that inhabits the G_CONTRACT node's signatures. Every new function is total, every resource has exactly one owner, every operation replays to the same state, and every concurrent access is ordered by a sync point or provably disjoint. Each property is witnessed live. The node writes only the artifacts the PRD names, verifies each one from disk, and exits when every STATE-kind and CONC-kind mutable is resolved, the diff passes the source hygiene predicates, and `transition to=G_INDEP` is dispatched through the G_INDEP gate.

Principles in this node are applied as work, from the lean method (AnEntrypoint/lean). Each H3 below carries a principle key, then the attribution exactly as gm-config/fsm/graph.json labels it.

## Verbs

Re-dispatch `instruction` at the start of each artifact and after any unfamiliar error. Every spool body carries session_id. Write only the artifacts the PRD names. `fs_write {path, content}` performs the file mutation, and each write is followed by `fs_read {path}` of the same path, so the disk content is the witness. A discrepancy between the disk and the plan sends the walk to root cause, never to a blind retry. Any divergence from the PRD's assumed shape is a new mutable and a `transition to=EARS`.

Before changing a function's signature or behaviour, dispatch `callers {symbol}` to list the call sites the edit must keep valid. A caller the plan did not name is a new unknown. Use `codesearch {query}` for where a thing lives and `codeinsight {action:"outline", path}` for a file's overview. After writes, dispatch `codeinsight_index {}` so that the next callers answer reflects the change.

Every build, subprocess, filesystem probe and live witness is an exec_js dispatch. exec_js runs in a separate Node process with no tools object. Use `require("node:child_process").execFileSync(command, args, { encoding: "utf8" })` for commands with arguments. Use `opts.profile:true` to locate cost. Git is read with `git_diff {stat:true}` to measure the net line change, `git_status` for the worktree, and `git_show` for committed content. Git is never run through a shell.

Each sweep finding is declared as a typed mutable before it is resolved: `mutable-add {"id":"<kebab-case slug>","obligation_kind":"<kind>","depends_on":[...],"status":"unknown"}`. The kinds are the STATE kinds (totality, ownership, replay, effect-boundary) and the CONC kinds (happens-before, disjointness, contention). Resolve each with `mutable-resolve {"mutable_id":"<id>","witness_evidence":"<live witness>"}`. Resolve rows with `prd-resolve {"id":"<row id>","witness_evidence":"<witness>"}`.

Write the closure narrative to `memorize-fire` and, in ADRN, to the commit message. It never goes into the response body. Advance with `transition to=G_INDEP`. Reshaping goes to `transition to=EARS`, and a contract defect goes to `transition to=G_CONTRACT`.

Route every mutation through the PRD, a mutable, or a memo. The audit tuple of each accepted write is its id, its witness hash and its timestamp.

## PRD rows

Resolve a row with prd-resolve once its witness has printed its output. The row's route family selects the bar. A row tagged `observability` is resolved only when its inspection point (a queryable endpoint, a debug hook, a structured log line) ships in the same pass as the subsystem it covers. A subsystem shipped without its inspection point is an unresolved row, and resolving it is a false completion.

Write-then-check exposes adjacent artifacts: a generated file the build needs, a document that names the new artifact, a witness script. Each becomes `prd-add` in the same turn, because an observation not recorded in the turn it appears evaporates with the turn. An unrelated issue found mid-build is also a prd-add row, never fixed inline in this node and never dropped.

Pass `commit_comment` on prd-resolve for a row whose resolution deserves a line of history. Omit it for rows too granular to warrant one.

## Mutables

The STATE kinds are totality, ownership, replay and effect-boundary. Each sweep below produces one or more of them. Each mutable has a dependency DAG entry, and its witness is the live exec_js run that discharges it. The state-obligations-ready predicate refuses the transition while any pending STATE-kind row is untyped or blocked, and it names the offender.

The CONC kinds are happens-before, disjointness and contention. The conc-obligations-ready predicate applies the same test to them. A CONC-kind row may depend on a STATE-kind row, because a contention bound presupposes an ownership invariant that already holds. A STATE-kind row may depend on a PROVE-kind row from G_CONTRACT, because a replay obligation may presuppose a proven invariant.

Dependency rule: resolve in order. A mutable whose depends_on are all resolved is ready. A mutable whose dependency is pending is blocked, so resolve the dependency first. A resolution that surfaces a new unknown gets `mutable-add` in the same turn with its kind and depends_on.

Two-pass rule: a mutable that survives two genuine resolution attempts without a witness is reclassified as a fresh unknown with a new id, the affected rows are re-cut, and the walk reshapes with `transition to=EARS`. The same discipline holds for a repair attempt that fails twice: change the approach in the next attempt, witness the result, and do not repeat the identical approach.

Gate-driven repair: a finding that is a code repair is an Edit followed by a disk Read of the touched path and the same live witness, all inside this node. A finding that changes the state model (the ownership or disjointness boundary is wrong) is a new STATE or CONC mutable, and the sweep repeats for the new boundary.

## Machine fit

Concurrency and data layout are sized to the machine the code runs on. The common access pattern is the one the layout is shaped for, and the common case is the path that falls through without a jump. Profile with `exec_js` and `opts.profile:true` to locate the cost, then confirm the change by a live measurement of the same input before and after the edit. Intuition about speed is not a witness. An access path whose cost grows superlinearly with concurrent callers is a defect even when its mean is good. Its witness is the measured worst case set against the bound.

## Principles

### TOTALITY - Total Functional Programming - David Turner

Handover: Hands the defined results on every edge input to GUARD, so invalid inputs are rejected at the top of each function; nominated next node: GUARD; cite Total Functional Programming - David Turner.

Every new function returns a defined result on every input path. Feed the edge inputs live through exec_js: zero-length input, maximum-size input, null or undefined, a wrong type where the language allows it, and a boundary-adjacent invalid value. Each run prints a defined result. Each one is a totality mutable with its printed results as witness. A partial function that escaped its domain fires the backreference to PARSEDV in G_CONTRACT, and the domain is repaired at its entry boundary before the function is rebuilt.

### GUARD - Guard Clause - Martin Fowler

Handover: Hands the early-return guards to SLAP, so each function body reads at one level of abstraction; nominated next node: SLAP; cite Guard Clause - Martin Fowler.

Invalid input is rejected at the top of the function by an early return, so the main path carries no nesting for the invalid cases. Each guard is witnessed by the exec_js run that sends its invalid input and prints the early return. Branch structure that still needs a comment to be read fires the backreference to SLAP, because the guards and the branches should explain themselves.

### SLAP - Single Level of Abstraction - Kent Beck

Handover: Hands the single-level functions to STRUCTPROG, so control flow stays sequence, selection and iteration with one exit per block; nominated next node: STRUCTPROG; cite Single Level of Abstraction - Kent Beck.

Every function body works at one level of abstraction. A body that mixes a domain decision with raw byte or string handling is split so each function reads at one level. The witness is the function's outline from `codeinsight {action:"outline", path}` showing each function's calls on one level only, together with the exec_js run that shows the split functions return the same output as the mixed version did. A function that mixes abstraction levels after this fires the backreference to DEEPMOD in G_CONTRACT.

### STRUCTPROG - Structured Programming - Edsger Dijkstra

Handover: Hands the traceable control flow to IMMUT, so shared data is updated by building the next version; nominated next node: IMMUT; cite Structured Programming - Edsger Dijkstra.

Control flow uses sequence, selection and iteration with one entry and one exit per block. Loops carry an invariant that is written as a precondition or a comment-free assertion in the type. Untraceable control flow (a jump that crosses a block, a loop whose exit is a side effect) fires the backreference to GUARD, where the early returns restore a readable path. The witness is an exec_js trace of a representative path through the function, printing each branch it takes.

### IMMUT - Purely Functional Data Structures - Chris Okasaki

Handover: Hands the immutable structures to OWNERSHIP, which confirms each remaining resource has exactly one owner; nominated next node: OWNERSHIP; cite Purely Functional Data Structures - Chris Okasaki.

Data that is shared is immutable. A structure is updated by constructing the next version, and the old version stays valid for every holder. Shared mutable state that crossed a module boundary fires the backreference to OWNERSHIP. The witness is an exec_js run that keeps the old value, applies the update, and prints both values, showing the old one unchanged.

### OWNERSHIP - Ownership and Borrowing - Matsakis and Klock

Handover: Hands the single-owner resources and their witnesses to DRY, so each fact has one representation; nominated next node: DRY; cite Ownership and Borrowing - Matsakis and Klock.

Every resource the diff takes has exactly one owner. Exercise the acquire, use and release cycle under exec_js and print the final state, then assert that it matches the declared effect. No resource leaks, is closed twice, is used after release, or hides a mutation behind a pure-looking signature. Each one is an ownership mutable. When two concurrent accesses touch a shared resource, the owner is named. If exactly one owner cannot be named, the boundary is restructured until one can. Sharing across async boundaries is a disjointness mutable: the witness is an exec_js run that interleaves the writers under a deterministic seed and prints that only the owner's write lands. Where the order of two concurrent accesses matters, the access is ordered by an explicit sync point (await, lock, channel, atomic, message boundary) or the state is provably disjoint. Each such order is a happens-before mutable. TOCTOU is the canonical violation: every single-instance or lock guard is atomic (O_EXCL, atomic rename, compare-and-swap) and never check-then-act. A borrow that outlived its owner fires the backreference to IMMUT.

Contention is also bounded here. Every wait has a bound, every retry a cap, and every hot lock is held for the shortest section. A path whose cost grows superlinearly with concurrent callers is a defect even when its mean is good. The witness is an exec_js run with N concurrent callers, printing the worst case, with the bound and the measured worst case as the mutable's measured value.

### DRY - Don't Repeat Yourself - Hunt and Thomas

Handover: Hands the merged single definitions to KISS, so the simplest construction that satisfies the contract is written; nominated next node: KISS; cite Don't Repeat Yourself - Hunt and Thomas.

One fact has one representation. Before a new function is written, codesearch in literal mode for its behaviour's distinctive tokens finds the existing copy, and the reuse decision is recorded in the mutable's witness. Two representations of one fact fire the backreference to KOLMOGOROV, which belongs to the pressure node (P6). Two functions that mean the same thing are merged rather than kept side by side. The witness is the exhaustive codesearch reply showing one definition and its call sites.

### KISS - KISS - Kelly Johnson

Handover: Hands the simplest construction and its git_diff stat to the G_INDEP gate, which requires a verifier that has not read the implementation; nominated next node: G_INDEP; cite KISS - Kelly Johnson.

The simplest construction that satisfies the contract is written. A solution that exceeds its problem fires the backreference to YAGNI, and the surplus generality is removed, not supported. The net line change is measured with `git_diff {stat:true}`. A removal that leaves the behaviour witnessed is preferred to an addition with the same witness. The witness is the git_diff stat together with the exec_js run that proves the simpler form keeps the contract.

## Witness

Each obligation kind is discharged by a live exec_js run, same turn, and witness_evidence names the kind and the command. Totality is discharged by the edge-input runs printing a defined result each time. Ownership is discharged by the acquire, use and release cycle printing its final state. Replay is discharged by running the operation twice under exec_js and printing the state before and after each run, with a second run that changes nothing. Effect-boundary is discharged by a query run that prints the state unchanged, and a command run that returns only its status. Happens-before is discharged by interleaving two calls under a deterministic seed and printing that the outcome does not depend on the interleaving. Disjointness is discharged by naming the single writer and printing a concurrent run in which only that writer's write lands. Contention is discharged by the N-caller run with its measured worst case against the bound.

A sweep that depends on the interleaving that happened to occur is not a pass. Each sweep is run again under a different seed before it resolves. A happy-path-only run has not audited anything.

Before the node closes, three diff predicates must hold. no-synthetic-test-files: the working diff introduces no standing test file (*.test.*, *.spec.*, or a test, tests or __tests__ directory), as predicates.md:19 defines it. Verification is a live exec_js witness against real code, never a suite. no-graphical-symbols-in-diff: new lines contain no decorative non-ASCII glyph such as arrows, box drawing, stars, bullets, checks, crosses or emoji. no-admit-deferral-markers: new source lines contain no colon-form admit marker, no placeholder macro that panics or is unimplemented, and no phrase saying a path is not implemented. A marker stands in for a complete proof, so it is rejected. A failing predicate names the offending lines, and each one is fixed and re-witnessed in this node.

Idempotent-dispatch-replay-safe is checked against the audit tuples of the replays. A same-input replay that reached a different outcome is a violation, and it returns the walk to this node's replay mutable.

## Memorize

Memorize the decisions that a subsequent task would otherwise re-derive: the single owner of each resource, the owner name of each disjointness boundary, each measured contention bound with its run output, and each replay-safety result. Each is `memorize-fire` with a stable key and its witness inline. Do not memorize per-file edits, intermediate build output, or the diff itself, which lives in git. When a subsequent witnessed run contradicts a stored memo, prune it with `memorize-prune {"key":"<key>"}`.

## Transition

The exit is `transition to=G_INDEP`, the lean verification node, dispatched only when every STATE-kind and CONC-kind mutable is resolved and witnessed, every row is resolved, and the three diff predicates above hold. The state-obligations-ready and conc-obligations-ready predicates name any pending row they refuse, and that row is resolved next.

The edge from KISS runs through the G_INDEP gate, verifier has not read the implementation. The gate predicate is advisory and never refuses, so this node enforces the rule itself: the verifier is a fresh subagent with its own session_id, given only the contract text (the PRD rows and the signatures) and no reading of the implementation. A verifier that has read the code inherits its assumptions, and its verdict is discarded.

Feedback routes to the earliest capable node. A partial function that escaped its domain goes to G_CONTRACT through PARSEDV. A function that mixes abstraction levels goes to G_CONTRACT through DEEPMOD. A surplus generality goes to EARS through YAGNI. A reshaping discovery (the ownership or disjointness boundary is wrong, the spec assumed a shape that reality does not have) goes to `transition to=EARS`, with the affected rows re-cut in place by prd-add on their existing ids. A code repair stays in TOTALITY and is witnessed again in this node.

A transition refused with a next_dispatch is dispatched next, not narrated. Repeated identical refusals escalate at gate_repeat_escalate_threshold (default 3), and the named recovery verb is dispatched instead of the denied transition.
