# LEAN CONTRACT

This is a concern of the method, not a stage of a pipeline: it is entered from whichever node the work reaches it from, and left as soon as what it asks for holds. No concern gates entry to a set of nodes.

CONTRACT writes each row's contract into types, names, signatures and obligations before any implementation exists. Each row is a proof goal. Its stated pre-conditions, invariants and post-conditions become typed signatures wherever the type can express them, and each remaining obligation becomes a PROVE-kind mutable discharged by a live witness. The node replaces the former PROVE stage. It exits when every row's contract sits in its signatures, every contract-kind mutable is resolved and witnessed, and `transition to=TOTALITY` is dispatched.

Principles in this node are applied as work, from the lean method (AnEntrypoint/lean). Each H3 below carries a principle key, then the attribution exactly as gm-config/fsm/graph.json labels it.

## Verbs

Re-dispatch `instruction` between mutable resolutions, after any failed exec, and on any unfamiliar error. Pass `known_instruction_hash` only from a response you received. Every spool body carries session_id.

Before writing or changing a signature, dispatch `callers {symbol}` to list every call site the change must keep valid, and `impact {symbol, max_depth}` for what the symbol depends on. A caller the PRD did not name is a new unknown. It is typed and resolved before the signature changes, never improvised around. Read the module's interface with `codeinsight {action:"outline", path}`. Before creating a new name or type, find existing ones with `codesearch {query}` in mode dual, then confirm absence with mode literal, whose reply is complete only at `exhaustive: true`. Independent dispatches go out in one message.

Every build, subprocess and filesystem probe is an exec_js dispatch. exec_js runs in a separate Node process and has no tools object. Run a command with arguments through `require("node:child_process").execFileSync(command, args, { encoding: "utf8" })`. Examples are the compiler check for the touched crate or package, and `node --check` on a touched file. Do not run bash or PowerShell for these. Git is read with `git_show` and `git_diff` and written with the git_* verbs, never through a shell. For a resource-bound witness, run exec_js with `opts.profile:true`. The response's duration_ms is free, and the worst-N self-time lines locate the cost.

Resolve obligations with `mutable-resolve {"mutable_id":"<id>","witness_evidence":"<witness>"}`. For a resource-bound mutable, add `"measured_value":<number>` to the same body. Resolve rows with `prd-resolve {"id":"<row id>","witness_evidence":"<witness>","witness_dispatch_id":"<dispatch id of your own live run>"}`, with id at top level beside witness_evidence and never nested inside a string. A reply of deviation kind prd-resolve-unknown-id means the id missed. Read its hint field and re-dispatch corrected, never blind. Declare new obligations with `mutable-add {"id":"<kebab-case slug>","obligation_kind":"<kind>","depends_on":[...],"status":"unknown"}`.

Reshaping is `transition to=EARS`, dispatched in the same turn as the discovery, with the affected rows re-cut in place through prd-add on their existing ids. Advancing is `transition to=TOTALITY`.

Write each file in the CONTRACT artifacts only through `fs_write {path, content}`, then verify it with `fs_read {path}`. The disk content is the witness, not the tool's return.

Memorize through the rules in the Memorize section below.

## PRD rows

Every row carries its contract as a set of pre-conditions and post-conditions, with a one-line witness plan naming the exec_js run that exercises the real path. A row is resolved with `prd-resolve` only when every obligation it generated is resolved and its own witness has printed the output the stated shape requires. A row that cannot be resolved this way is not closed by prose.

When CONTRACT discovers a domain term, a module boundary or a contract obligation with no row, `prd-add` it that moment. A need is a row now or it is not a need. The same rule applies to any new mutable.

A rule the type cannot express becomes a precondition in the signature, and the row names that precondition. When a row's pre-conditions or invariants cannot be stated concretely, the row is not cut. Reshape with `transition to=EARS` rather than inventing the statement in G_CONTRACT.

Pass `commit_comment` on `prd-resolve` when the resolved contract encodes a rule that deserves one line of history. The next git_commit in the repository bundles that line into the commit message under "Resolved PRD rows". Omit it for rows too granular to earn a line.

## Mutables

This node owns the five PROVE kinds, and only these five: `precondition`, `invariant`, `postcondition`, `resource-bound` and `type-shape`. Each has a distinct witness, and a mutable of the wrong kind is re-typed before it is resolved.

A precondition is what must hold on entry: input shape, caller invariant, resource availability. An invariant is what must hold across every reachable state of a mutation sequence. A postcondition is what must hold on exit: output shape and side-effect completeness. A resource-bound is a worst-case time, size or memory bound the path must not exceed, and it carries a numeric `bound` field. A type-shape is a data representation in which the invalid state has no constructor, so the implementation inhabits the type rather than merely satisfying it at run time.

Every obligation is a node in one dependency DAG. A mutable declares `depends_on` with the ids it requires resolved first. A dependency may cross node boundaries, since the DAG is store-wide: a CONTRACT mutable may depend on a P1 mutable, and a BUILD mutable may depend on a CONTRACT mutable. mutable-add rejects a cycle and names the cycle path. Resolve in dependency order. A row whose depends_on are all resolved is ready. A row with an unresolved dependency is not reachable yet, so resolve the dependency first.

Composition: a row declares `supplies: "<description>"` naming what its postcondition hands to a dependent row's precondition. The handoff is written into both rows' text, so a reader can trace how obligations chain.

The resource-bound check is mechanical. `mutable-resolve` accepts `measured_value`. When the value exceeds `bound`, the resolution is refused with both numbers named, so a prose claim alone cannot close it. The other four kinds have no equally cheap mechanical check and rest on witness_evidence.

Mutable gate: drain every pending PROVE-kind mutable before leaving the node. Loop: `mutable-resolve` each ready row. When one resolution surfaces a new unknown, `mutable-add` it immediately with its obligation_kind and depends_on, and resolve it in the same turn before advancing. When the transition refuses, the mutables-all-resolved and mutables-all-typed predicates name the blocking row and its reason. That row is resolved next.

Two-pass rule: a mutable that survives two genuine resolution attempts without a witness is reclassified as a fresh, differently scoped unknown with a new id. Re-cut the affected rows, and dispatch `transition to=EARS`, since the reclassification shows the plan must reshape.

Always rearchitect immediately: an in-spirit architectural improvement found mid-node, clearly better and not merely different, is handled at once. Dispatch `transition to=EARS` in the same turn, and re-cut the affected rows with prd-add on their existing ids, which keeps handle and position. Sunk cost in the old shape never justifies shipping the worse design. The urge to write "this should be rearchitected" is the trigger for the transition. Narrating it without dispatching the transition strands the chain on a stale plan.

Surface divergence: a state that differs from the PRD's assumed shape is a new mutable with its witness. A broken tool that blocks a witness is a mutable whose task is to make the witness reachable: fix the tool, replace it, or drive its lower-level interface directly.

## Obligation witnesses admit no deferral

A resolution whose witness says deferred, pending the next session, awaiting recovery, or waiting for a user refresh marks an open obligation as discharged. The resolution is refused, and the obligation stays open with the chain in G_CONTRACT. An obligation is discharged by a real answer with real evidence, or it is not discharged. A witness is written by kind, naming the kind discharged and the command and output that discharged it.

## Principles

### UBIQ - Ubiquitous Language - Eric Evans

Handover: Hands the domain terms resolved to type names to CLEANNAME so new identifiers carry those terms; nominated next node: CLEANNAME; cite Ubiquitous Language - Eric Evans.

Take each domain term from the PRD rows and search the tree for it in dual mode, then in literal mode, including its synonyms. Where the domain term already exists as a type or a name, the row uses that name. Where it does not, the term becomes a type name in the signature. A domain term absent from the type fires the backreference to ILLEGAL, and the type is redrawn so that the term carries the rule rather than a loose string.

### CLEANNAME - Intention-Revealing Names - Robert C. Martin

Handover: Hands intention-revealing names, once a literal codesearch shows no clash, to MILNER for type checking and to COMMENTSMELL for comment disposition; nominated next node: MILNER, COMMENTSMELL; cite Intention-Revealing Names - Robert C. Martin.

Name every new function, type and field for what it means in the domain term list, not for what it does mechanically. Before a name is committed, run a literal codesearch for it. A reply with `exhaustive: true` and no clash is the witness. A name that cannot carry the meaning fires the backreference to UBIQ.

### MILNER - Well-Typed Programs Cannot Go Wrong - Robin Milner

Handover: Hands the checker output and any stuck state the types admit to ILLEGAL, to make the invalid state unrepresentable; nominated next node: ILLEGAL; cite Well-Typed Programs Cannot Go Wrong - Robin Milner.

Run the type checker of the touched language over the contract through exec_js. For a Rust crate, run cargo check for the package. For a TypeScript or JavaScript file, run the checker on that file. The witness is the checker's printed output with its exit code. A stuck state the signature admits, meaning a case the types do not forbid and no clause covers, fires the backreference to ILLEGAL.

### ILLEGAL - Make Illegal States Unrepresentable - Yaron Minsky

Handover: Hands the type-shape representations that have no invalid constructor to PARSEDV for boundary parsing and to HUGHES for property reasoning; nominated next node: PARSEDV, HUGHES; cite Make Illegal States Unrepresentable - Yaron Minsky.

For each type-shape obligation, pick the representation in which the invalid state has no constructor. Use enums for alternatives, newtypes for units, non-empty collections where emptiness is invalid, and separate types for states whose transition order matters. The witness is either a compile rejection of an exec_js probe that tries to build the invalid state, or the absence of any constructor in `codeinsight {action:"outline"}`. A type that cannot express the rule fires the backreference to DBC, and the rule becomes a precondition in the signature.

### PARSEDV - Parse, Don't Validate - Alexis King

Handover: Hands the single parsed typed value at each entry boundary to WADLER, so the signature can be read as a theorem; nominated next node: WADLER; cite Parse, Don't Validate - Alexis King.

At each entry boundary, parse the raw input once into the typed representation, and pass only that type inward. A check that repeats in the interior fires the backreference to ILLEGAL, because the parsed type should carry the fact. The witness is an exec_js run that sends a malformed input through the real entry point, printing the parse failure at the boundary, and a second run that prints the typed value for a valid input.

### WADLER - Theorems for Free - Philip Wadler

Handover: Hands the written list of what each signature permits to DBC, which splits each row's contract into preconditions, invariants and postconditions; nominated next node: DBC; cite Theorems for Free - Philip Wadler.

Read each signature as a theorem about what the function may do, because its type restricts its possible behaviours. Write down what the signature permits. A signature that permits what the contract forbids fires the backreference to MILNER. The witness pairs that written list with a live exec_js run in which the post-condition is evaluated on the real outputs of the function.

### DBC - Design by Contract - Bertrand Meyer

Handover: Hands the three contract sets to CQS for query and command classification and to INDEPVER for an independent contract check; nominated next node: CQS, INDEPVER; cite Design by Contract - Bertrand Meyer.

For each row, state the contract as three sets. Preconditions are what the caller must establish. Invariants are what the module keeps true across every call. Postconditions are what the function guarantees on return. Each item becomes a mutable of the matching kind, or a type constraint when the type can express it. A contract that lives in prose instead of the signature fires the backreference to WADLER. The witnesses for each kind are described in the Witness section.

### CQS - Command-Query Separation - Bertrand Meyer

Handover: Hands the query and command classification to PARNAS, so each module's hidden decision is checked for leaks; nominated next node: PARNAS; cite Command-Query Separation - Bertrand Meyer.

Declare every new function as either a query (it returns a value and changes no state) or a command (it changes state and returns at most a status). Enforce the split in the signature: a query takes its receiver by shared reference, and a command takes it by exclusive reference or returns a status type. Use callers to find every site the classification affects. A query found to mutate state fires the backreference to DBC. The mutation becomes an effect-boundary mutable typed for BUILD, and BUILD witnesses the boundary live.

### PARNAS - Information Hiding - David Parnas

Handover: Hands each module's hidden decision and its leak count to DEEPMOD, which checks that each interface is small; nominated next node: DEEPMOD; cite Information Hiding - David Parnas.

Each module hides one design decision (a data layout, an algorithm, an external format) behind its interface. Run a literal codesearch for each internal name of the hidden decision. Every hit outside the module's own files is an interface leak to fix. The witness is an exhaustive reply with zero hits outside the module. A decision that no module hides fires the backreference to DEEPMOD.

### DEEPMOD - Deep Modules - John Ousterhout

Handover: Hands the deep modules with small interfaces to ACCEPTPORT, which checks that the core depends only on ports; nominated next node: ACCEPTPORT; cite Deep Modules - John Ousterhout.

A module's interface is small relative to what it hides. Count the public names from `codeinsight {action:"outline", path}` and compare them with the size of the body they hide. A module whose interface is nearly as large as its body is shallow, and it is merged or re-cut. The witness is the outline output and the body size from the same run. An interface that needs prose before it can be used fires the backreference to OUSTERHOUTC, a standing tension. The reason is recorded in the names and types of the code, not in a comment.

### ACCEPTPORT - Ports and Adapters - Alistair Cockburn

Handover: Hands the core that has no adapter leak to TOTALITY for total functions and to CONTRACTTEST for contract checks; nominated next node: TOTALITY, CONTRACTTEST; cite Ports and Adapters - Alistair Cockburn.

Core logic depends only on ports, meaning the traits or interfaces it needs, and never on an adapter such as a database client, an HTTP framework or a process spawner. For each adapter's crate or package name, run a literal codesearch across the core module's files. Zero hits is the witness. An adapter that leaked into the core fires the backreference to PARNAS.

### COMMENTSMELL - A Comment Is a Deodorant for Bad Smells - Fowler and Beck

Handover: No forward edge leaves COMMENTSMELL in gm-config/fsm/graph.json, so no next node is nominated; its comment dispositions are its only output; nominated next node: none nominated; cite A Comment Is a Deodorant for Bad Smells - Fowler and Beck.

Prose written to explain code is a smell. Dispatch the gm verb `grep` with body `{"mode":"comments"}` scoped to the touched paths. Each comment is then dispositioned. A comment that states a constraint the code cannot express is kept, and it moves into a type or a precondition wherever the type can carry it. A comment that explains a mechanism is removed by renaming the mechanism. Prose needed to explain code fires the backreference to CLEANNAME. The witness is the comment sweep's output with each comment's disposition beside it.

## Witness

Each obligation kind has its own witness shape, and witness_evidence names the kind discharged and how.

A precondition is discharged by a guard at the entry boundary, plus an exec_js probe against the real boundary with an out-of-bound input. The printed rejection proves the guard fires.

An invariant is discharged by a mutation sequence run live in exec_js, where the property is printed after each step. Asserting it once at the end is rejected.

A postcondition is discharged by running the real path and printing its real output beside the stated shape.

A resource-bound is discharged by an exec_js run with `opts.profile:true` against an input sized at or past the bound. The measured value goes to `mutable-resolve` as measured_value.

A type-shape is discharged by showing that the invalid state has no constructor in the chosen representation. A runtime check that rejects the state after construction does not discharge it.

A generic witness such as "verified", "looks correct" or "reviewed" is rejected for every kind. Name the kind, the command, and the output.

Process of elimination is the debugging method on every surface. For a hard bug, name the loop before the first hypothesis: one exec_js command that drives the exact reported symptom, is deterministic, and is fast. Run it once, unmodified, before reading code for a theory. Each candidate cause is a mutable, eliminated by a real-input run, and each elimination reveals the next candidate. Iterate until one cause survives. Profile to locate the cost with `opts.profile:true`, then eliminate by live measurement, never by intuition.

## Memorize

Memorize the settled contract facts that a subsequent task would otherwise re-derive: the domain term to type name mapping, the module interface decisions, and each rejected representation with the witness that rejected it. Each is `memorize-fire` with a stable key and its witness inline.

When a contract change makes a stored memo stale, prune it with `memorize-prune {"key":"<key>"}`. Use `memorize-prune {"query":"<text>"}` to list the review candidates, then delete the confirmed ones with `{"keys":[...]}`.

Do not memorize the exec output in bulk, intermediate compiler errors, or the contract text itself, which already lives in the signatures.

## Transition

The exit is `transition to=TOTALITY`. The edge from ACCEPTPORT to TOTALITY carries no gate in the lean graph, so the node closes by its own rules: every PROVE-kind mutable resolved, every row's contract in its signatures, and every row's witness printed. A refusal from the compiled predicates names the blocking row, and that row is resolved next. The response's next_dispatch names the recovery verb, and that verb is dispatched next.

Feedback from TOTALITY returns to the node that owns the discovery. A partial function that escaped its domain fires the backreference from TOTALITY to PARSEDV, so the walk returns to PARSEDV in G_CONTRACT. A mixed abstraction level in a function fires the backreference from SLAP to DEEPMOD. An adapter that leaked into the core fires the backreference from ACCEPTPORT to PARNAS. Each is resolved in G_CONTRACT before BUILD resumes.

A discovery that reshapes the plan (the representation a row assumed does not exist in reality, or the rows' boundaries are wrong) is `transition to=EARS`. Route to the earliest capable node, and never further back than the discovery requires.

Every turn ends in a verb dispatch. A transition refused with a next_dispatch is dispatched next, not narrated.
