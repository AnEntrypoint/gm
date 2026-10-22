# LEAN CONTRACT

A method concern, not a pipeline stage: entered from any node that reaches it, left once its request holds. No concern gates entry to nodes.

CONTRACT writes each row's contract into types, names, signatures and obligations before any implementation exists. Each row is a proof goal: pre-conditions, invariants and post-conditions become typed signatures where the type can express them; each remaining obligation becomes a PROVE-kind mutable discharged by a live witness. This node replaces the former PROVE stage. Exit when every row's contract sits in its signatures, every contract-kind mutable is resolved and witnessed, and `transition to=TOTALITY` is dispatched.

Principles are applied as work, from the lean method (AnEntrypoint/lean). Each H3 carries a principle key, then the attribution exactly as gm-config/fsm/graph.json labels it.

## Verbs

Re-dispatch `instruction` between mutable resolutions, after a failed exec, and on any unfamiliar error. Pass `known_instruction_hash` only from a response received. Every spool body carries session_id.

Before changing a signature: `callers {symbol}` lists every call site the change must keep valid; `impact {symbol, max_depth}` shows what the symbol depends on. An unnamed caller is a new unknown, typed and resolved before the signature changes. Read a module's interface with `codeinsight {action:"outline", path}`. Before creating a name or type, `codesearch {query}` in mode dual finds existing ones; confirm absence with mode literal, complete only at `exhaustive: true`. Independent dispatches go out in one message.

Every build, subprocess and filesystem probe is an exec_js dispatch (separate Node process, no tools object). Commands with arguments: `require("node:child_process").execFileSync(command, args, { encoding: "utf8" })`, e.g. the compiler check for the touched crate or package, or `node --check` on a touched file. Never bash or PowerShell for these. Git is read with `git_show` and `git_diff`, written with the git_* verbs; never through a shell. For a resource-bound witness, run exec_js with `opts.profile:true`; duration_ms is free and the worst-N self-time lines locate the cost.

Resolve obligations: `unknown-resolve {"mutable_id":"<id>","witness_evidence":"<witness>"}`, plus `"measured_value":<number>` for a resource-bound mutable. Resolve rows: `prd-resolve {"id":"<row id>","witness_evidence":"<witness>","witness_dispatch_id":"<dispatch id of your own live run>"}`, id at top level, never nested in a string. Reply kind prd-resolve-unknown-id: read its hint and re-dispatch corrected, never blind. Declare obligations: `unknown-add {"id":"<kebab-case slug>","obligation_kind":"<kind>","depends_on":[...],"status":"unknown"}`.

Reshaping: `transition to=EARS` in the same turn as the discovery, with affected rows re-cut in place through prd-add on existing ids. Advancing: `transition to=TOTALITY`.

Write CONTRACT artifacts only through `fs_write {path, content}`, then verify with `fs_read {path}`; the disk content is the witness, not the tool's return.

Memorize per the Memorize section.

## PRD rows

Each row carries its contract as pre- and post-conditions, with a one-line witness plan naming the exec_js run that exercises the real path. `prd-resolve` only when every obligation the row generated is resolved and its own witness printed the required shape; otherwise the row is not closed by prose.

A domain term, module boundary or obligation with no row: `prd-add` it at that moment. A need is a row now or not a need. Same for any new mutable.

A rule the type cannot express becomes a precondition in the signature, named in the row. A row whose pre-conditions or invariants cannot be stated concretely is not cut: reshape with `transition to=EARS`, never invent the statement here.

Pass `commit_comment` on `prd-resolve` when the contract encodes a rule worth one line of history; the next git_commit bundles it under "Resolved PRD rows". Omit it for granular rows.

## Mutables

This node owns the five PROVE kinds, and only these: `precondition`, `invariant`, `postcondition`, `resource-bound`, `type-shape`. Each has a distinct witness; a mutable of the wrong kind is re-typed before resolution.

- precondition: holds on entry (input shape, caller invariant, resource availability).
- invariant: holds across every reachable state of a mutation sequence.
- postcondition: holds on exit (output shape, side-effect completeness).
- resource-bound: worst-case time, size or memory the path must not exceed; carries a numeric `bound` field.
- type-shape: the invalid state has no constructor, so the implementation inhabits the type rather than satisfying it at run time.

Every obligation is a node in one store-wide dependency DAG. `depends_on` lists the ids to resolve first; a dependency may cross nodes (a CONTRACT mutable on a P1 mutable, a BUILD mutable on a CONTRACT mutable). unknown-add rejects a cycle and names its path. Resolve in dependency order; a row whose depends_on are all resolved is ready. A row with an unresolved dependency is not reachable yet, so resolve the dependency first.

Composition: a row declares `supplies: "<description>"`, naming what its postcondition hands to a dependent row's precondition. Write the handoff into both rows' text.

The resource-bound check is mechanical: `unknown-resolve` accepts `measured_value`, and a value above `bound` is refused with both numbers named. The other four kinds rest on witness_evidence.

Mutable gate: drain every pending PROVE-kind mutable before leaving. Loop: `unknown-resolve` each ready row. A resolution surfacing a new unknown gets `unknown-add` at once (obligation_kind, depends_on) and is resolved in the same turn. On refusal, the mutables-all-resolved and mutables-all-typed predicates name the blocking row and reason; resolve it next.

Two-pass rule: a mutable surviving two genuine resolution attempts without a witness is reclassified as a fresh, differently scoped unknown with a new id; re-cut affected rows and dispatch `transition to=EARS`, since the reclassification shows the plan must reshape.

Always rearchitect immediately: an in-spirit architectural improvement found mid-node, clearly better and not merely different, is handled at once: dispatch `transition to=EARS` in the same turn and re-cut affected rows with prd-add on existing ids (handle and position kept). Sunk cost never justifies the worse design. Writing "this should be rearchitected" is the trigger for the transition; narrating it without dispatching strands the chain.

Surface divergence: a state differing from the PRD's assumed shape is a new mutable with its witness. A broken tool blocking a witness becomes a mutable to make the witness reachable: fix the tool, replace it, or drive its lower-level interface directly.

## Obligation witnesses admit no deferral

A resolution whose witness says deferred, pending the next session, awaiting recovery, or waiting for a user refresh is refused; the obligation stays open with the chain in G_CONTRACT. An obligation is discharged by a real answer with real evidence, or not at all. Write the witness by kind: name the kind discharged, the command, and its output.

## Principles

### UBIQ - Ubiquitous Language - Eric Evans

Handover: Hands the domain terms resolved to type names to CLEANNAME so new identifiers carry those terms; nominated next node: CLEANNAME; cite Ubiquitous Language - Eric Evans.

Take each domain term from the PRD rows and search the tree for it and its synonyms in dual mode, then literal mode. Where the term exists as a type or name, the row uses it; otherwise it becomes a type name in the signature. A domain term absent from the type fires the backreference to ILLEGAL: redraw the type so the term carries the rule, not a loose string.

### CLEANNAME - Intention-Revealing Names - Robert C. Martin

Handover: Hands intention-revealing names, once a literal codesearch shows no clash, to MILNER for type checking and to COMMENTSMELL for comment disposition; nominated next node: MILNER, COMMENTSMELL; cite Intention-Revealing Names - Robert C. Martin.

Name each new function, type and field for its domain-term meaning, not its mechanics. Before committing a name, a literal codesearch with `exhaustive: true` and no clash is the witness. A name that cannot carry the meaning fires the backreference to UBIQ.

### MILNER - Well-Typed Programs Cannot Go Wrong - Robin Milner

Handover: Hands the checker output and any stuck state the types admit to ILLEGAL, to make the invalid state unrepresentable; nominated next node: ILLEGAL; cite Well-Typed Programs Cannot Go Wrong - Robin Milner.

Run the touched language's checker over the contract through exec_js: cargo check for the package of a Rust crate; the checker on the file for TypeScript or JavaScript. Witness: the printed output and its exit code. A stuck state the signature admits, a case the types neither forbid nor cover, fires the backreference to ILLEGAL.

### ILLEGAL - Make Illegal States Unrepresentable - Yaron Minsky

Handover: Hands the type-shape representations that have no invalid constructor to PARSEDV for boundary parsing and to HUGHES for property reasoning; nominated next node: PARSEDV, HUGHES; cite Make Illegal States Unrepresentable - Yaron Minsky.

For each type-shape obligation, pick the representation with no constructor for the invalid state: enums for alternatives, newtypes for units, non-empty collections where emptiness is invalid, separate types where transition order matters. Witness: a compile rejection of an exec_js probe that builds the invalid state, or no constructor visible in `codeinsight {action:"outline"}`. A type that cannot express the rule fires the backreference to DBC; the rule becomes a precondition.

### PARSEDV - Parse, Don't Validate - Alexis King

Handover: Hands the single parsed typed value at each entry boundary to WADLER, so the signature can be read as a theorem; nominated next node: WADLER; cite Parse, Don't Validate - Alexis King.

Parse raw input once at each entry boundary into the typed representation; pass only that type inward. A check repeated in the interior fires the backreference to ILLEGAL, since the parsed type should carry the fact. Witness: an exec_js run sending malformed input through the real entry point and printing the boundary parse failure, and a second run printing the typed value for valid input.

### WADLER - Theorems for Free - Philip Wadler

Handover: Hands the written list of what each signature permits to DBC, which splits each row's contract into preconditions, invariants and postconditions; nominated next node: DBC; cite Theorems for Free - Philip Wadler.

Read each signature as a theorem about what the function may do, since its type restricts its behaviours. Write down what it permits. A signature permitting what the contract forbids fires the backreference to MILNER. Witness: that list paired with a live exec_js run evaluating the post-condition on the real outputs.

### DBC - Design by Contract - Bertrand Meyer

Handover: Hands the three contract sets to CQS for query and command classification and to INDEPVER for an independent contract check; nominated next node: CQS, INDEPVER; cite Design by Contract - Bertrand Meyer.

State each row's contract as three sets: preconditions (what the caller must establish), invariants (what the module keeps true across every call), postconditions (what the function guarantees on return). Each item becomes a mutable of the matching kind, or a type constraint where the type can express it. A contract living in prose fires the backreference to WADLER. Witnesses per kind: see Witness.

### CQS - Command-Query Separation - Bertrand Meyer

Handover: Hands the query and command classification to PARNAS, so each module's hidden decision is checked for leaks; nominated next node: PARNAS; cite Command-Query Separation - Bertrand Meyer.

Declare each new function a query (returns a value, changes no state) or a command (changes state, returns at most a status). Enforce it in the signature: a query takes its receiver by shared reference; a command takes it by exclusive reference or returns a status type. Use callers for every affected site. A query found to mutate state fires the backreference to DBC; the mutation becomes an effect-boundary mutable typed for BUILD, witnessed live there.

### PARNAS - Information Hiding - David Parnas

Handover: Hands each module's hidden decision and its leak count to DEEPMOD, which checks that each interface is small; nominated next node: DEEPMOD; cite Information Hiding - David Parnas.

Each module hides one design decision (data layout, algorithm, external format) behind its interface. Run a literal codesearch for each internal name of the hidden decision; every hit outside the module's own files is a leak to fix. Witness: an exhaustive reply with zero hits outside the module. A decision no module hides fires the backreference to DEEPMOD.

### DEEPMOD - Deep Modules - John Ousterhout

Handover: Hands the deep modules with small interfaces to ACCEPTPORT, which checks that the core depends only on ports; nominated next node: ACCEPTPORT; cite Deep Modules - John Ousterhout.

Interface size must be small relative to what it hides. Count public names from `codeinsight {action:"outline", path}` and compare with the hidden body's size. An interface nearly as large as its body is shallow and is merged or re-cut. Witness: the outline output and the body size from the same run. An interface needing prose before use fires the backreference to OUSTERHOUTC, a standing tension; the reason lives in the names and types, not a comment.

### ACCEPTPORT - Ports and Adapters - Alistair Cockburn

Handover: Hands the core that has no adapter leak to TOTALITY for total functions and to CONTRACTTEST for contract checks; nominated next node: TOTALITY, CONTRACTTEST; cite Ports and Adapters - Alistair Cockburn.

Core logic depends only on ports (the traits or interfaces it needs), never on an adapter such as a database client, HTTP framework or process spawner. For each adapter's crate or package name, a literal codesearch across the core module's files; zero hits is the witness. An adapter leaking into the core fires the backreference to PARNAS.

### COMMENTSMELL - A Comment Is a Deodorant for Bad Smells - Fowler and Beck

Handover: No forward edge leaves COMMENTSMELL in gm-config/fsm/graph.json, so no next node is nominated; its comment dispositions are its only output; nominated next node: none nominated; cite A Comment Is a Deodorant for Bad Smells - Fowler and Beck.

Prose written to explain code is a smell. Dispatch the gm verb `grep` with body `{"mode":"comments"}` scoped to the touched paths, and disposition each comment. A comment stating a constraint the code cannot express is kept, moving into a type or precondition where the type can carry it. A comment explaining a mechanism is removed by renaming the mechanism. Prose needed to explain code fires the backreference to CLEANNAME. Witness: the sweep output with each disposition beside its comment.

## Witness

Each obligation kind has its own witness; witness_evidence names the kind and how it was discharged.

- precondition: a guard at the entry boundary, plus an exec_js probe at the real boundary with an out-of-bound input; the printed rejection proves the guard fires.
- invariant: a mutation sequence run live in exec_js, printing the property after each step. Asserting it once at the end is rejected.
- postcondition: the real path run, its real output printed beside the stated shape.
- resource-bound: exec_js with `opts.profile:true` on an input sized at or past the bound; the measured value goes to `unknown-resolve` as measured_value.
- type-shape: the invalid state has no constructor in the chosen representation. A runtime check rejecting it after construction does not discharge it.

"verified", "looks correct" and "reviewed" are rejected for every kind. Name the kind, the command, and the output.

Process of elimination is the debugging method on every surface. For a hard bug, name the loop first: one deterministic, fast exec_js command driving the exact reported symptom, run once unmodified before reading code for a theory. Each candidate cause is a mutable eliminated by a real-input run; each elimination reveals the next candidate. Iterate until one survives. Locate cost with `opts.profile:true`, then eliminate by live measurement, never intuition.

## Memory

Save an unknown as a memory file only when a later task needs it. Settled contract facts, rejected representations, exec output, intermediate compiler errors and contract text are not memories; the signatures and the PRD row hold them. A contract change that makes a memory file stale deletes the file and its MEMORY.md line.

## Transition

The exit is `transition to=TOTALITY`. The ACCEPTPORT to TOTALITY edge has no gate in the lean graph, so the node closes by its own rules: every PROVE-kind mutable resolved, every row's contract in its signatures, every row's witness printed. A refusal from the compiled predicates names the blocking row, resolved next; the response's next_dispatch names the recovery verb, dispatched next.

Feedback from TOTALITY returns to the node owning the discovery: a partial function escaping its domain fires the backreference from TOTALITY to PARSEDV; a mixed abstraction level fires the backreference from SLAP to DEEPMOD; an adapter leaking into the core fires the backreference from ACCEPTPORT to PARNAS. Each is resolved in G_CONTRACT before BUILD resumes.

A discovery that reshapes the plan (a row's assumed representation does not exist, or row boundaries are wrong) is `transition to=EARS`. Route to the earliest capable node, never further back than the discovery requires.

Every turn ends in a verb dispatch. A transition refused with a next_dispatch is dispatched next, not narrated.
