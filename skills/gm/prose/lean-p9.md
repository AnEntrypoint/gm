# LEAN CONVERGENCE

This is a concern of the method, not a stage of a pipeline: it is entered from whichever node the work reaches it from, and left as soon as what it asks for holds. No concern gates entry to a set of nodes.

CONVERGENCE decides whether the sweep has reached its least fixed point. The sweep re-walks the whole artifact after the contract is recorded (G_DONE to G_SWEEP). Each sweep is checked for monotonic improvement, for regressions against earlier sweeps, for a variant that decreases, and for bounded retries. The node ends in exactly one of two lean terminals. G_FIXPOINT is reached when a sweep changed nothing. G_SURFACE is reached when the variant did not decrease, or when one condition fired twice with no new information; the ambiguity then belongs to a person and is not swept again. The walk stops only at node COMPLETE with prd_pending of zero, reached through `transition to=COMPLETE`, and the final dispatch of the turn is the `gm-continue` skill.

Principles in this node are applied as work, from the lean method (AnEntrypoint/lean). Each principle's book and attribution is the label in its H3 heading, taken from gm-config/fsm/graph.json.

## Verbs

A sweep begins with `node-status`, which reports the current node and `prd_pending`. Every sweep reads the open set with `mutable-list` and `prd-list` and records the counts. Measures are not saved as memory; they are re-derived from the ledger on each sweep. Re-run any witness the regression set names by its exact original dispatch: an `exec_js` run, a `codesearch` literal with its path scope, or a `callers` call. A proxy witness is not accepted in its place.

When a sweep's claim depends on a policy or strategy choice, the incumbent is replayed against each challenger with `dream-replay`, over the same recorded worlds. A cost is located with `exec_js` using `profile:true`, then confirmed by a live measurement. `codeinsight {action:"hotspots"}` and `{action:"orphans"}` answer the cleanup side of the sweep. Resolve each condition with `unknown-resolve {mutable_id, witness_evidence}` or `prd-resolve {id, witness_evidence}`; a resource-bound mutable resolves with a `measured_value` checked against its bound.

Before the walk stops, dispatch `residual-scan`. It refuses without its fired marker, and its denial names `residual-scan` as the next dispatch. `claim-audit` checks the claims the walk made. Then `transition to=COMPLETE`. A gate that is false is answered by the recovery verb it names (`git_finalize`, `residual-scan`, `claim-audit`, or the CI-watching verb), never by a bare retry of the transition.

Nothing in this node dispatches Glob, Grep, `find`, a shell `grep`, Bash git or PowerShell. Search goes through `codesearch`, `grep` and `codeinsight`. Git goes through the `git_*` verbs, and execution goes through `exec_js`.

## PRD rows

A condition a sweep finds open is a PRD row the moment it is found, added with `prd-add`. The row names the condition, the gate or measure it breaks, and the witness that closes it. Each row is closed only by `prd-resolve` with a witness re-run on the live tree. A need is a row now or it is not a need. No row or transition note in this node carries deferral wording (no phrase that pushes work to an unnamed time, another session or outside the scope) or hedges. A row that cannot close keeps its witness condition and its reason inside the row, and stays pending. The sweep does not close while a row is pending.

## Mutables

The variant is measured over the open mutables and open PRD rows. A condition in a sweep becomes a mutable with `unknown-add`, using the `obligation_kind` of the node that discharges it. This node owns no obligation kind. Set `depends_on` so resolution runs in dependency order: `unknown-resolve` refuses while a `depends_on` id is pending and names the blocking id. The sweep closure needs zero pending rows.

The two-pass rule is this node's bounded-retry rule. A mutable that survives two genuine resolution attempts without a witness is not attempted a third time under the same approach. It is re-added as a new mutable with a new id naming the gap, and the reclassification routes the walk to the G_CONTRACT gate. A condition that fires twice in a row with no new information is not re-added; it goes to G_SURFACE, where the ambiguity becomes an ADR row for a person. The gate-repeat escalation is a separate rule: an identical gate denial repeated up to `gate_repeat_escalate_threshold` (default 3) escalates, and the walk stops retrying that transition blind.

## Principles

### FIXPOINT - Least Fixed Point - Kleene and Tarski

Handover: when the measures changed the sweep passes to MONOTONE, and when they are identical it passes to G_FIXPOINT; cite Least Fixed Point - Kleene and Tarski.

Nominated set: {MONOTONE, G_FIXPOINT}. Backreferences: none. Incoming: G_SWEEP (forward).

Fan-out: four independent measure reads run as parallel subagents, each under its own session id: (a) the current predicate of each gate, (b) the `mutable-list` and `prd-list` counts, (c) the `residual-scan` result and the tension count, (d) the context-spend measure. The parent joins the four records before the diff. Canary: a slice with no dispatch under its own session id did not run; a subagent that edited a file or dispatched a gate-changing verb did off-task work.

Each sweep recomputes the measures of the whole artifact: the current predicate of each lean gate, the open mutables, the open PRD rows, the `residual-scan` result, the tension count, and the context-spend measure. The sweep is recorded with its measures and its sha. A sweep that changed nothing is one whose measures equal the previous sweep's exactly; then the walk takes FIXPOINT to G_FIXPOINT. A change is routed to MONOTONE (the edge "the sweep produced a change"), and the sweep repeats after the change is witnessed. Witness: the two consecutive recorded measure sets, with the diff between them empty for G_FIXPOINT.

### MONOTONE - Monotonic Improvement Only

Handover: a measure that moved the wrong way passes to REGRESSGUARD for its regression re-run; cite Monotonic Improvement Only (heading has no author).

Nominated set: {REGRESSGUARD}. Backreferences: none. Incoming: FIXPOINT.

Fan-out: each challenger's `dream-replay` runs as its own parallel subagent over the same recorded worlds, under its own session id; the incumbent's replay runs in a separate slice of the same kind; the measure diff runs in the parent. Canary: a challenger or incumbent slice with no replay record did not run; a subagent that changed the scoring inputs or wrote a policy did off-task work.

A sweep's change is accepted only when every measure that improved stays improved and no fixed condition has been traded for a new one. The node compares each measure with the previous sweep's value. A measure that moved the wrong way takes the forward edge MONOTONE to REGRESSGUARD ("a measure moved the wrong way"). Where the change selects a policy or strategy, the incumbent is replayed with `dream-replay` against each challenger on the same recorded worlds. A challenger replaces the incumbent only with a strictly higher score over those worlds; a tie keeps the incumbent. Witness: the measure diff with no wrong-way entry, or the `dream-replay` scores of incumbent and challenger over the same world set.

### REGRESSGUARD - No Regression Across Sweeps

Handover: the regression set's re-run result passes to VARIANT, which checks that the open-condition count fell; cite No Regression Across Sweeps (heading has no author).

Nominated set: {VARIANT}. Backreferences: {INVARIANTRUN}. Incoming: MONOTONE.

Fan-out: each member of the regression set re-runs its exact original dispatch as its own parallel subagent under its own session id (one `exec_js` run, one `codesearch` literal with its path scope, or one `callers` call per slice). Canary: a member with no re-run output in the record did not run; a subagent that substituted a proxy witness or a different query did off-task work.

The node keeps a regression set: each condition an earlier sweep closed with a witness. Each sweep re-runs the exact witness for each member, using the original dispatch: the `exec_js` run, the literal search with its path scope, or the `callers` call. A member that fails again takes the backreference REGRESSGUARD to INVARIANTRUN ("an earlier sweep's gain was lost"), and the invariant is run over the call sequence that broke it. Witness: the recorded re-run output for every member; any failing member is named with its `file:line`.

### VARIANT - Well-Founded Variant - Robert Floyd

Handover: a sweep whose open-condition count did not fall passes to G_SURFACE and to BOUNDEDRETRY, and a count that fell lets the next sweep run; cite Well-Founded Variant - Robert Floyd.

Nominated set: {G_SURFACE, BOUNDEDRETRY}. Backreferences: none. Incoming: REGRESSGUARD (forward); HALTING (backreference).

Fan-out: the open mutables (`mutable-list`), the open PRD rows (`prd-list`) and the unresolved tension count run as three parallel subagents, each under its own session id; the parent sums them into the variant. Canary: a query with no record under its session id means that slice did not run; a subagent that resolved, added or closed a row did off-task work.

The variant is the count of open conditions: open mutables, open PRD rows and unresolved tension firings. The same query is taken on every sweep (`mutable-list`, `prd-list`, and the tension count from the sweep), and the count is recorded as a non-negative integer. The variant makes the loop terminate, so the node computes it rather than describing it in prose. A sweep that does not reduce it takes the forward edge VARIANT to BOUNDEDRETRY ("the open-condition count did not fall") and to G_SURFACE; a count that fell lets the next sweep run. Witness: the two recorded counts with the query that produced each.

### BOUNDEDRETRY - Bounded Retry, Then Surface

Handover: a condition that fired twice with no new information passes to G_SURFACE as an ADR row for a person; cite Bounded Retry, Then Surface (heading has no author).

Nominated set: {G_SURFACE}. Backreferences: none. Incoming: VARIANT (forward); RICE (backreference).

Fan-out: none. The two attempts on one mutable are sequential by construction, since the second depends on the first. Canary: an attempt count not taken from `mutable-list` means the count was assumed.

This is the two-pass rule as a principle. A mutable or PRD row that survives two genuine resolution attempts without a witness is not attempted a third time. It is re-added as a new row with a new id naming the gap, and its reclassification routes the walk to the G_CONTRACT gate. When the same condition fires twice with no new information, the forward edge BOUNDEDRETRY to G_SURFACE ("the same condition fired twice with no new information") is taken. G_SURFACE is a terminal. The ambiguity is recorded as an ADR row, which the graph routes through G_SURFACE to ADRN ("the ambiguity is human-owned"), and the sweep is not run again. Witness: the attempt count per mutable id from `mutable-list`, and for a surfaced condition the ADR row naming the decision a person must make.

### RICE - Rice's Theorem - Henry Gordon Rice

Handover: once every claim names a decider, the sweep passes to HALTING, since no analyser decides the property itself; cite Rice's Theorem - Henry Gordon Rice.

Nominated set: {HALTING}. Backreferences: {BOUNDEDRETRY}. Incoming: none.

Fan-out: each claim is checked against its decider as its own parallel subagent under its own session id (the type checker, the linter, a literal search with `exhaustive: true`, or a live `exec_js` witness). Canary: a claim with no decider record did not run its slice; a subagent that accepted a claim with no decider, or edited the claim text, did off-task work.

No analyser decides an arbitrary semantic property, so a sweep can confirm the absence of found defects but never the absence of defects. Each property the sweep claims is recorded with the decider that establishes it: the type checker, the linter, a literal search with `exhaustive: true`, or a live `exec_js` witness on the real artifact. A claim that no decider establishes and no live witness covers is not counted as closed; the backreference RICE to BOUNDEDRETRY ("no analyser decides the property") takes it. Witness: the claim list in which every entry names its decider; each unnamed claim is an open mutable.

### HALTING - Halting Problem - Alan Turing

Handover: once the termination bound and the variant are recorded, the sweep passes to LEHMAN to check that the environment still holds; cite Halting Problem - Alan Turing.

Nominated set: {LEHMAN}. Backreferences: {VARIANT}. Incoming: RICE (forward).

Fan-out: none. The termination argument is one sequential chain: the bound, then the variant, then the check that the bound was not the reason the count fell. Canary: a bound recorded without its matching variant record means the argument was not checked.

The sweep's termination is not established by running it longer. It is established by the variant (the backreference HALTING to VARIANT, "no analyser decides termination of the sweep"). Every iteration has a declared bound. Each exhaustive search carries `max_matches`, `max_files` or a `path` scope. Each indexing call carries its file limit. The sweep carries a maximum number of iterations. A sweep that hits a bound without a decreasing variant is routed to VARIANT and is not run again without a new condition. Witness: each sweep records the bound on each dispatch and the `exhaustive` value of each search; the variant record shows the bound was not the reason the count fell.

### LEHMAN - Lehman's Laws of Software Evolution - Meir Lehman

Handover: none; gm-config/fsm/graph.json has no forward edge from this node, only the backreference to G_START named in its prose; cite Lehman's Laws of Software Evolution - Meir Lehman.

Nominated set: none (no forward edge). Backreferences: {G_START}. Incoming: HALTING (forward).

Fan-out: each environment item's hash runs as a parallel subagent under its own session id: the dependency versions named in the manifest, the platforms in the CI matrix, the `callers` results for the changed symbols, and the tool and model versions in the project config. The parent compares each hash with its recorded baseline. Canary: an item with no hash record did not run; a subagent that rewrote a manifest or config value to match the baseline did off-task work.

A fixed point is provisional. It holds only while the environment it was reached in holds. The node records the environment as a list of items with a hash each: the dependency versions named in the manifest, the platforms in the CI matrix, the consumers `callers` returns for the changed symbols, and the tool and model versions in the project config. Each sweep compares the recorded hashes with the current ones. When any item changed, the backreference LEHMAN to G_START ("the environment changed under a converged system") is taken, and the walk re-enters with one task in flight. Witness: the environment record with its hashes, and the comparison result recorded on each sweep.

### KNUTHOPT - Premature Optimization - Donald Knuth

Handover: a measured optimization that reaches its floor passes to LOWERBOUND; cite Premature Optimization - Donald Knuth.

Nominated set: {LOWERBOUND}. Backreferences: {G_SWEEP}. Incoming: G_SWEEP (backreference).

Fan-out: each candidate hotspot runs its own parallel subagent under its own session id, which takes the `exec_js` profile (`profile:true`) and then the live measurement on the same input, in that order within the slice. Canary: a hotspot with a measurement and no profile did not run the profile step; a subagent that changed code outside its hotspot did off-task work.

An optimization is admitted only by a measurement. `exec_js` with `profile:true` returns the worst-N `file:line` self-time, which locates the cost. A live measurement of the change confirms the gain on the same input the profile used. A resource-bound mutable carries a numeric `bound`; `unknown-resolve` accepts a `measured_value` and refuses the resolution when the value exceeds the bound, naming both numbers. A budget that sits above its known floor fires the backreference G_SWEEP to KNUTHOPT ("a budget sits above its floor"). The profile either supports the floor or contradicts it; on contradiction the walk takes the backreference KNUTHOPT to G_SWEEP ("the profile contradicts the assumption"). Witness: the profile output and the `measured_value` with its bound, both recorded on the mutable.

### LOWERBOUND - Lower Bound Reached - information-theoretic argument

Handover: none; gm-config/fsm/graph.json has no forward edge from this node, only the backreference to G_FIXPOINT named in its prose; cite Lower Bound Reached - information-theoretic argument.

Nominated set: none (no forward edge). Backreferences: {G_FIXPOINT}. Incoming: KNUTHOPT (forward).

Fan-out: none. The floor argument and its measured value form one sequential claim, recorded once in the sweep record. Canary: a floor with no measured value is rejected and returns to KNUTHOPT, as the principle below already states.

A cost that sits at its floor is not improved further. The floor is the minimum the contract requires: the single owning copy of a fact, the minimal set of conditions a proof needs, the smallest size a measured artifact can reach. The node states the floor with its argument and the measured value that reaches it. The forward edge KNUTHOPT to LOWERBOUND takes the walk here once a floor is measured. The backreference LOWERBOUND to G_FIXPOINT ("the bound is already reached, stop here") is then taken, so the terminal stands. A floor claimed without a measured value is rejected and returns to KNUTHOPT. Witness: the measured value, the argument that names it as the floor, and the sweep record that accepts it.

## Witness

The node closes at one of its two terminals, and each has its own witness. G_FIXPOINT requires that the measure set of two consecutive sweeps is identical, that the regression set re-ran with every member passing, that `residual-scan` returned an empty result, and that `prd_pending` is zero. G_SURFACE requires the variant values of the last two sweeps, the condition that fired twice, and the ADR row that hands the decision to a person. A generic "converged", "complete" or "all good" is rejected. The terminal reached is the terminal recorded, and no other word stands in for it.

## Memory

A surfaced ambiguity is an unknown: record the decision a person must make as one flat file with frontmatter fields name, description and metadata.type (value unknown), with one line in MEMORY.md that points to it, so a resuming session does not sweep it again blind. The environment hashes of LEHMAN and the measure set of a fixed point with its sha are recorded in the commit that sets them, so a following comparison has its baseline. A memory the live tree contradicts is deleted with its MEMORY.md line. Not saved as memory: the sweep counts, which are re-derived from the ledger on each sweep; the PRD text, which lives in `.gm/prd/<id>.yml` per row and in `.gm/prd-log.jsonl` once resolved; and the gate states, which the gates report.

## Transition

The sweep is entered from G_DONE, which is reached only through its gate `lean-contract-recorded`. That gate refuses while a PRD row is open or the worktree is dirty. From G_SWEEP every backreference that fires is taken, and the walk re-walks from where it lands: G_START when a gate reopened, G_INDEP when a property was falsified, KNUTHOPT when a budget sits above its floor, G_NET when the artifact grew, SMALLESTSET when context spend rose per unit of change, and OUSTERHOUTC when a tension fired. The forward edge G_SWEEP to FIXPOINT starts the measure of this sweep. FIXPOINT leads to G_FIXPOINT when nothing changed, and G_FIXPOINT leads back to G_SWEEP when a subsequent sweep reopened a gate.

COMPLETE rule. The walk stops only when the chain reports node COMPLETE with `prd_pending` of zero. Reaching G_FIXPOINT or G_SURFACE is the lean terminal, and it is not the end of the chain by itself. Every turn that is not at COMPLETE with zero pending rows ends in a verb dispatch, never in a summary, a recap, or a sentence that names the next move without making it. A turn that wants to stop first dispatches `node-status`. If the node is not COMPLETE or rows are pending, the walk is in flight: dispatch `instruction` and keep walking. At G_FIXPOINT, dispatch `residual-scan`, then `transition to=COMPLETE`. The handler accepts the transition only when the closure set holds: prd-all-closed, mutables-all-resolved, worktree-clean, residual-scan-fired, ci-validated-fresh, submodules-clean, claim-audit-clean, no-hedge-language-in-diff and split-context-swept. When a closure gate is false, dispatch the recovery verb it names. When `transition to=COMPLETE` returns node COMPLETE, the last dispatch of the turn is the `gm-continue` skill. That skill checks for remaining work and either reloads gm or confirms the loop closed, and the turn ends only after it.

At G_SURFACE the walk does not sweep again. The ambiguity is recorded as an ADR row with `prd-add`, which names the decision a person must make. The turn then ends with the `gm-continue` skill dispatch, which confirms that the open row belongs to a person and does not reopen the sweep. A gate denial anywhere in this node names its `next_dispatch` in its reason. Dispatch that verb next. Repeated identical denials escalate at `gate_repeat_escalate_threshold` (default 3), and at that point the walk stops retrying the transition and dispatches the recovery the escalation names.
