# LEAN SHAPE

This is a concern of the method, not a stage of a pipeline: it is entered from whichever node the work reaches it from, and left as soon as what it asks for holds. No concern gates entry to a set of nodes.

SHAPE turns the request into a PRD that covers the whole closure of the request before any contract is written. It orients on the live tree rather than on recalled memory, names every in-spirit row, states each row's pre-conditions, invariants and post-conditions, resolves every grounding unknown with a witness, and types every contract-level or runtime-level unknown for the node that will discharge it. The node exits when no row is unshaped, no grounding unknown is open, and an expansion pass over the rows adds nothing new. The exit runs LIVEPLAN, then the G_CONTRACT gate.

Principles in this node are applied as work, from the lean method (AnEntrypoint/lean). Each H3 below carries a principle key, then the attribution exactly as gm-config/fsm/graph.json labels it.

## Verbs

The node opens at the G_START gate. Dispatch `prd-list` first. When more than one row is in progress, the gate lean-one-task-in-flight refuses entry, and its response names the verb to dispatch next in next_dispatch. Finish or abandon the extra row, then continue. Next dispatch `instruction` with `{"prompt":"<the user request, verbatim>"}`. The response carries orient_nouns and recall_hits. Those hits are baseline for the orient step, not conclusions.

Every spool body carries session_id, and plugkit rejects an empty one. Re-dispatch `instruction` between rows, after any failed dispatch, and on any unfamiliar error. Pass `known_instruction_hash` only from a response you actually received. A match returns an empty prose body with instruction_unchanged true, which means the prose you already hold still applies.

Orient in one message of parallel dispatches: `recall` against each request noun, `codesearch {query}` against each noun (mode dual by default), and `callers {symbol}` for every function or class the request names. A miss is never accepted as absence. Rephrase it as a synonym, a symbol-level identifier query, a path-level query, and a `recall` against the same noun, and record each attempt. A candidate joins the plan only after at least one of these dispatches has explored it.

Choose the verb by the question. `codesearch {query, mode:"literal"}` (or mode "regex") answers every place an exact text appears, in tree order, and its reply is complete only when it says `exhaustive: true`. A single identifier query lists definitions before references. The default `dual` mode ranks results and answers where the code that does X lives. To search a sibling repository, submodule or any other folder, pass `root` (or `projectPath`) with an absolute path. A sibling tree is never read by path. For what calls a symbol, what breaks if it changes, or whether it is dead, dispatch `callers {symbol}`, `impact {symbol, max_depth}`, and `codeinsight {action:"outline", path}`, `{action:"orphans"}` or `{action:"hotspots"}`. An empty callers reply is a lead. It is proof only when `codeinsight_index` reports complete true; otherwise confirm it with the literal identifier query.

For a question of the form "has this happened before", dispatch `codesearch` with the symptom's own wording before any history walk. Its `commits` channel returns commit-message hits ranked by semantic similarity, which surfaces a prior fix worded differently from the current symptom. Read a known commit exactly with `git_log {path}`, `git_show {rev:"<rev>:<path>"}` or `git_diff`. Git is never run through a shell.

A question whose answer plausibly exists on the public web is answered by WebSearch followed by at least one targeted WebFetch, before any pause, every time. Ask the user only when that search returns nothing, or when the question needs a private credential, a choice among options already surfaced, or authorization for an irreversible action.

Once per project per session, read gm.config.json (absent means every default applies) together with the README, CONTRIBUTING and `.gm/` signals. A real signal makes a prd-add row proposing the change. The signals are: the project already references TencentDB Agent Memory or a deployed instance of it; an embedding pipeline commits to a dimension the fixed 384-dimension default cannot hold; or the user names the need. Repointing `.gm/config.source.json` or flipping a `memory.tencentdb_backend` block is a reconfiguration, so ask through AskUserQuestion before writing it unless the user's own words named the need. Without a real signal the check concludes that no reconfiguration is warranted and the node moves on.

On the first dependency install of a session, and before trusting freshly cloned or vendored dependency content, dispatch `scan_deps`. The body `{}` scans the whole project, `{"root":"<relative dir>"}` scans a subdirectory, and `{"root":"<absolute dir>"}` scans a sibling project. A blockedCount or failCount above zero is a real hit. Stop, ask the user through AskUserQuestion, and investigate the introducing commit through the dependency's own history. Never add exclusions and never retry blindly. A warnCount alone is a glance, not a block. nodeModulesTruncated true gets a prd-add row for a standing unbounded sweep.

Fan out only when the closure decomposes into independent slices, and launch each slice with the Agent tool. The subagent prompt opens with "use the gm skill for this; code questions go to codeinsight (callers/impact) first, then codesearch, and Read only a located path". It then carries the task, the terminal condition it serves (prd_pending_count 0 against the full discovered scope, not its slice), and its own session_id derived from the parent as `<parent_session_id>-sub<k>`. A parent never passes its own literal session id to a child. A shared recurring transform (a rename sweep, an API migration, or more than five applications of one pattern) first gets a mapping note drafted by one subagent and adversarially reviewed by a second. Only then do the parallel workers dispatch, each against that reviewed mapping.

Every turn in this node ends in a verb dispatch. A turn that ends in prose with no tool call stops the chain.

## PRD rows

Write a row the moment a need is spotted, one row per need, with `prd-add {"id":"<kebab-case slug>","title":"<one line>", ...}`. Always pass id explicitly. An id-less call that yields no usable text is hard-rejected. The row body carries a route-family tag, pre-conditions, invariants, post-conditions and a one-line witness plan. The seven route families select the quality rules that bind each row. `grounding` covers belief formation and every information-gathering row. `reasoning` covers a chain of inference in which each step is witnessable. `state` covers a durable mutation, which needs pre- and post-conditions. `execution` covers real services only, dispatched through exec_js with a fixed timeout, never a stub or mock. `boundary` covers reaching outside the tree (git, CI, a remote API, the user). `representation` covers how information is encoded (skill prose, memory shape, the PRD schema). `observability` requires a queryable inspection point shipped in the same pass as the subsystem it covers, and code alone never satisfies it.

A row without pre-conditions, invariants and post-conditions is not cut yet. State them concretely: what must hold on entry, what must hold across every reachable state the row touches, and what must hold on exit. "It works" and "handles the input correctly" are not statements. Push the representation decision into the row (the data shape, the invariant the type makes unrepresentable, the boundary between modules) so that the row admits one correct implementation and nothing else.

Never write wording that parks a need for an unnamed time, hands it to another session, or excludes it from the scope. A need is either a row now or it is not a need. The same holds for `prd-resolve`: witness_evidence names the command that ran and the output it printed, and it never says the work is parked, awaiting someone, or pending recovery. A transition note follows the same rule.

Expansion produces rows. The floor is the directly requested items. The closure adds every adjacent, implied, downstream, cleanup and hygiene item the request reaches. For each row, add rows for every corner case, caveat, failure mode, interaction with an adjacent row, degenerate input, and empty, overflow or re-entry state. Then run a second pass over the new rows. Stop when a pass yields nothing new, not when the pass feels complete. Expect the row count to grow two to three times over the first pass.

Every row also asks the architecture question. Is there a structural change (removing an obsolete mechanism, consolidating duplicated logic, replacing a bespoke implementation with a maintained one, fixing a wrong abstraction at its root) that makes this and every subsequent instance of the work cheaper? If so, that change is its own row beside the literal ask.

Run the jank sweep across the surfaces the request reaches: UI, client state, server state, the boundary between them, and anything else the request touches. Enumerate every immature, unfinished or half-wired edge, including rough and nearly finished work. Each finding is a row. Add a performance-measurement row and a security-review row wherever they apply. The sweep is exhaustive inside the reached surfaces and stays out of the rest of the tree.

Run the tell-tale sweep on any AI-written design element found anywhere: a boilerplate flourish, an over-hedged comment, a generic scaffold name. One sighting is never patched alone. It becomes rows: a full-codebase scan, a grouping of the findings, and one fix-and-verify row per group.

A row the agent adds on its own authority, reached only because it sits inside the request's closure, gets one line in the response body beside its prd-add: "adding <row id> because <reason>". One line per such row, with no running narration of the whole cover.

A bug, gap or hygiene issue outside this closure is still a prd-add row. It is never fixed inline during this node, and it is never dropped.

At entry, rows already open from an earlier run (prd_pending above zero, or listed in ready_wave) are undone work of the same walk. Resume each one to a witnessed prd-resolve, or to an explicit re-scope, before any fresh row is cut.

Cut the row that exercises the most failure modes at once first (concurrency, partial failure and real input together). The design is proven while reshaping is still cheap.

A row is admitted on witness, not cheapness. An unmeasured optimization claim is rejected in this node. A witnessed, correct change is admitted however expensive it is. The volume of the work never rejects a row.

When an existing row's statement changes, rewrite it with `prd-add` under its existing id. The reply is `rescoped`, and the row keeps its position and dependents. Never delete and re-add a row, because that orphans its handle.

State lives on disk as one file per row: `.gm/prd/<id>.yml` and `.gm/mutables/<id>.yml`, with resolved material moved into `.gm/prd-log.jsonl` and `.gm/mutables-log.jsonl`. A fresh session resumes the walk by listing those folders and reading that log, not by replaying memory.

## Mutables

P1 owns no obligation kind. Every P1 unknown is one of two things. A grounding unknown asks what exists, who calls it, what a service returns, or what a library version exposes. It is discharged inside P1: dispatch the codesearch, callers or recall that answers it, or exec_js against the real service, then resolve the mutable with that output before leaving the node. No grounding-shaped mutable crosses the transition open.

Any other unknown is a contract property or a runtime property. Record it with `mutable-add {"id":"<kebab-case slug>","status":"unknown","obligation_kind":"<kind>","depends_on":[...]}`, where the kind belongs to the node that will discharge it. A contract property (precondition, invariant, postcondition, resource-bound or type-shape) is typed for CONTRACT. A runtime-safety property (totality, ownership, replay or effect-boundary) or a concurrency property (happens-before, disjointness or contention) is typed for BUILD. The witness field names the codesearch hit, file:line or exec output that made the thing an unknown. An unwitnessed unknown blocks every transition.

`depends_on` lists the ids that must resolve first. mutable-add refuses an addition that would close a cycle, and the refusal names the cycle path. A mutable may depend on any row in the store regardless of the node that typed it.

Two-pass rule: a mutable that survives two genuine resolution attempts without a witness is not attempted a third time with the same approach. Reclassify it as a fresh, differently scoped unknown with a new id, re-cut the affected rows with prd-add on their existing ids, and stay in EARS. The reclassification is reshaping, not failure.

Surface divergence: a state that differs from the PRD's assumed shape becomes a new mutable, with its witness, and then resumes. A broken tool that blocks a witness channel becomes a mutable whose task is to make the channel reachable: fix the tool, replace it, or drive its lower-level interface directly. It is never parked as blocked by something external.

## Supply-chain scan

scan_deps detects the obfuscated dropper that appends a payload after a source file's real end: one very long, whitespace-padded line that resolves a remote address, fetches and decodes data, and evaluates or spawns the result. It runs two structural checks that survive a change of address, key or cipher. First, the byte size of a file is wildly out of proportion to its line count. Second, a run of four or more `\uXXXX` escapes decodes to an identifier-shaped name, which real code never writes for an ASCII identifier.

Dispatch `{}` on the first dependency install of a session and before trusting any freshly cloned or vendored node_modules. `{"root":"<relative dir>"}` limits the git-tracked half to a subdirectory. `{"root":"<absolute dir>"}` scans a sibling project, including its gitignored node_modules. A symlink or junction that leaves the root is not followed and is listed in symlinkEscapes. `{"full":true}` forces a complete walk for a one-off sweep after a suspicious install. Otherwise the per-package stamp in `.gm/exec-spool/.scan-deps-stamp.json` skips unchanged packages. A package with a failing or blocked finding is never stamped, so it is reported on every scan.

Read the reply by its counts. blockedCount above zero is evidence: the operating system or antivirus already blocked a read. failCount above zero is a structural hit. warnCount alone usually marks a legitimate minified bundle and gets a glance, never a block. nodeModulesTruncated true means part of the tree was not covered, and the walk adds a prd-add row for a standing unbounded sweep.

A failing or blocked hit is a one-way door. Record it as a PRD row, keep the walk running, and ask only when the hit is a world-scoped one-way door. Find the introducing commit in the dependency's own history, and confirm the last clean commit before proposing a pin, a revert or an exclusion. Never add an exclusion and never retry blindly. Several unrelated repositories under one account showing the same pattern point to a shared compromised credential, and that possibility is named to the user. A compromised default branch is repaired with git_revert, which keeps the bad commit visible. A history rewrite waits for an explicit request.

## Scope discovery to a fixed point

Discovery does not stop at the first plan. A closure that implies work outside the current rows is a scope expansion: prd-add the new rows in the same pass, derive their unknowns as mutables, and repeat. The walk leaves this node only after a full sweep adds zero rows and zero mutables. That fixed point is the criterion, not a step count and not a sense that coverage is enough.

Scope found inside the request's closure is in the walk. Work unrelated to the closure becomes a row that waits for its own walk.

Long-horizon work spans sessions by design. The rows and mutables on disk let a fresh session's boot probe resume the walk without replay. Once a batch of rows is independent enough to run unattended, it is handed to a new session deliberately rather than serialized through this one.

## Large finding sets are partitioned once

A classifiable finding set (compiler errors, lint violations, the breakage from a dependency bump) comes from one run of its producing command. Group the output by its natural boundary (file, crate or module), and make each group one row owned by one subagent. Disjoint slices need no coordination. Each subagent verifies its slice by rerunning the classifier scoped to its own files. The global classifier is not rerun mid-fan-out, because a rerun wastes the run or lets two agents race to fix the same finding.

Every fan-out dispatch states its terminal condition: prd_pending_count 0 against the full discovered scope, not against its own slice. A dispatch that finds a new unknown feeds it into mutable-add or prd-add, and never narrows its scope silently.

## Principles

### JTBD - Jobs To Be Done - Clayton Christensen

Handover: Hands the restated jobs and the constraint that makes the obvious approach wrong to XYPROB, so the reproduction targets the real symptom; nominated next node: XYPROB; cite Jobs To Be Done - Clayton Christensen.

Before the first row is cut, restate the request as jobs: the situation the user is in, the outcome they hire the change to produce, and the constraint that makes the obvious approach wrong. Write the job into the title or the pre-condition text of every row it serves. A requirement inside the closure that serves no job the request states is not added as a row.

### XYPROB - XY Problem

Handover: Hands the reproduced symptom and its witness to EARS, so each requirement is stated against the real problem; nominated next node: EARS; cite XY Problem.

Search the problem in the wording the user used, and dispatch an exec_js command that reproduces the reported symptom itself, not a nearby one. The reproduction is the witness of the problem row. If the reproduction shows that the requested fix would not remove the symptom, or that the stated problem is not the real one, the backreference to JTBD fires. Return to JTBD with the underlying problem and re-cut the rows.

### EARS - EARS Requirements Syntax - Alistair Mavin

Handover: Hands falsifiable EARS requirements, each with an exec_js-checkable outcome, to INVEST for row sizing; nominated next node: INVEST; cite EARS Requirements Syntax - Alistair Mavin.

Write each requirement in one EARS template (ubiquitous, event-driven, state-driven, unwanted behaviour, or optional feature), with its trigger, its system response, and an observable outcome. Test falsifiability: the observable outcome must be something an exec_js run can return true or false on. A requirement that cannot be falsified fires the backreference to DBC. The requirement is then rewritten in G_CONTRACT as a precondition or postcondition before it enters the PRD.

### INVEST - INVEST - Bill Wake

Handover: Hands rows that pass the independent, negotiable, valuable, estimable, small and testable checks to THINSLICE for vertical cutting; nominated next node: THINSLICE; cite INVEST - Bill Wake.

Check each row for independent, negotiable, valuable, estimable, small and testable. Testable has a concrete meaning here: the row's witness plan names the exec_js dispatch that proves it. A row that cannot be proven that way is split until it can. A row that depends on another task fires the backreference to THINSLICE, and the dependency is recorded with depends_on on its mutable or in the row's pre-condition text.

### THINSLICE - Thin Vertical Slice - Alistair Cockburn

Handover: Hands each thin vertical slice to SPIKE, where an unknown that search cannot settle gets a throwaway probe; nominated next node: SPIKE; cite Thin Vertical Slice - Alistair Cockburn.

Cut each row as a thin vertical slice that crosses every layer the behaviour touches, from entry point to store. One real input then drives the whole path, and one exec_js run witnesses it. A slice is thin only when it passes that test: one real input, one entry point, one exec_js run. A slice that needs a second input or a second entry point is split until each piece passes. A slice that cuts across a module boundary fires the backreference to PARNAS. Re-cut it along the module's interface, not along its internals.

### SPIKE - Spike Solution - Kent Beck

Handover: Hands the spike's printed output and the settled unknowns to YAGNI to cut scope to caller-backed rows; nominated next node: YAGNI; cite Spike Solution - Kent Beck.

Where search cannot settle an unknown, spike it: a throwaway exec_js probe against the real service, run with a named command that is red-capable, deterministic and fast. A spike is timeboxed to one exec_js dispatch and five minutes of wall clock; a spike that exceeds the box without settling the unknown fires the backreference to LIVEPLAN. The spike's printed output is the mutable's witness. Spike code is never shipped. If the unknown survives the spike, the backreference to LIVEPLAN fires and the plan is re-cut around the surviving unknown.

### YAGNI - YAGNI - Ron Jeffries

Handover: Hands the caller-backed row set to LIVEPLAN as the current task's live plan; nominated next node: LIVEPLAN; cite YAGNI - Ron Jeffries.

Every row's scope is the request's closure. A row that adds an option, an extension point or a generality is admitted only with a current caller named in its pre-condition text. Generality with one caller fires the backreference to TARPIT. That removal belongs to the pressure node (P6), so the plan carries only the caller-backed shape.

### LIVEPLAN - Live Plan, Current Task Only

Handover: Hands the live PRD rows to the G_CONTRACT gate, which admits only rows whose contract can be stated; nominated next node: G_CONTRACT; cite Live Plan, Current Task Only.

The PRD holds rows for this request only. Each completed row closes with prd-resolve and its witness, so the list shrinks as the task proceeds. When the plan outlives its task, the backreference to G_START fires: the finished task is closed before any new plan is opened. The node exits through LIVEPLAN into the G_CONTRACT gate.

## Witness

Each grounding unknown is discharged by a witness that names its source: a codesearch hit with path and line, a callers edge with the calling function and its line, a recall key with its text, or an exec_js output. A row is resolved by `prd-resolve` with witness_evidence that names the command run, its real output, and the file:line it touched. The words "verified", "looks correct", "checked" and "reviewed" alone are rejected as unwitnessed, and the transition refuses them. A row whose evidence is a web source names the URL and the quoted line from the WebFetch result. An expansion row is witnessed by the live exec_js run of its edge case, never by a file.

A finding delegated to a subagent, or recalled from memory, is a hypothesis. Before a row is built on it, one dispatch confirms the premise on the live tree: callers for a claimed zero-caller, codesearch for a claimed name, git_log for a claimed history. An overturned premise re-cuts the row with prd-add on the same id, and the row is never built on the wrong premise.

## Memorize

Memorize the decisions a subsequent task would otherwise re-derive: the config-fit conclusion, the scan_deps result for the project's dependency set, a module boundary the search exposed, and a rejected alternative together with the witness that rejected it. Each one is `memorize-fire` with a stable key and its witness inline. Do not memorize the search transcript, the raw recall hits, node progress, or the PRD rows, which already live on disk.

When instruction returns a recall hit that a witnessed codesearch contradicts, prune it with `memorize-prune {"key":"<key>"}`. Use `memorize-prune {"query":"<text>"}` to list review candidates, then delete the confirmed ones with `memorize-prune {"keys":[...]}`.

## Transition

Entry is gated by G_START. The gate lean-one-task-in-flight is blocking. Its refusal names a recovery verb in next_dispatch. A repeated identical refusal escalates at gate_repeat_escalate_threshold (default 3). Dispatch the named recovery verb, never the denied transition again.

Exit is `transition to=G_CONTRACT`, dispatched only when every row carries pre-conditions, invariants and post-conditions, every grounding unknown has a witness, every contract-kind mutable is typed, and the last expansion pass added zero rows. The exit path runs LIVEPLAN, then the G_CONTRACT gate (contract is the only durable description, advisory: it records the rule and never refuses), then UBIQ in G_CONTRACT. Before that transition no second durable description of the request exists. No design document is written, and no plan prose lives outside `.gm/prd/`, `.gm/mutables/` and their two commit logs. The rows and the types are the description.

Feedback inside the node: XYPROB routes back to JTBD, INVEST routes back to THINSLICE, and SPIKE routes back to LIVEPLAN. Each re-cuts rows in place with prd-add on existing ids, then continues the walk in this node. EARS routes to DBC, which is a backreference into G_CONTRACT carrying the row id, because DBC is the earliest node able to make the requirement falsifiable. The backreference from LIVEPLAN to G_START closes a finished task before a new plan opens.

Routing is to the earliest capable node. A discovery made in EARS stays in EARS unless it changes a contract or a runtime property, and it never sends the walk further back than the discovery requires.

Every turn ends in a verb dispatch. A transition refused with a next_dispatch is dispatched next, not narrated, and the denied transition is not retried blind.
