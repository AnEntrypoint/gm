# LEAN SHAPE

A method concern, not a pipeline stage: entered from any node that reaches it, left once its exit holds. No concern gates entry to nodes.

SHAPE turns the request into a PRD covering its whole closure before any contract is written. It orients on the live tree; names every in-spirit row; states each row's pre-conditions, invariants and post-conditions; resolves every grounding unknown with a witness; types every contract- or runtime-level unknown for the node that discharges it. Exit when no row is unshaped, no grounding unknown is open, and an expansion pass adds nothing. Exit runs LIVEPLAN, then the G_CONTRACT gate.

Principles are applied as work, from the lean method (AnEntrypoint/lean). Each H3 carries a principle key, then the attribution exactly as gm-config/fsm/graph.json labels it.

## Verbs

Opens at G_START. Dispatch `prd-list` first. More than one row in progress: gate lean-one-task-in-flight refuses entry and names the verb in next_dispatch; finish or abandon the extra row. Then dispatch `instruction` with `{"prompt":"<the user request, verbatim>"}`. Its orient_nouns are read in MEMORY.md as a baseline, not a conclusion.

Every spool body carries session_id; plugkit rejects an empty one. Re-dispatch `instruction` between rows, after any failed dispatch, and on any unfamiliar error. Pass `known_instruction_hash` only from a response received; a match returns an empty prose body with instruction_unchanged true (the held prose still applies).

Orient in one message of parallel dispatches: MEMORY.md per request noun; `codesearch {query}` per noun (mode dual by default); `callers {symbol}` per function or class named. A miss is never absence: retry as a synonym, a symbol-level identifier query, a path-level query, and a MEMORY.md lookup, recording each attempt. A candidate joins the plan only after one of these dispatches explored it.

Choose the verb by the question. `codesearch {query, mode:"literal"}` (or mode "regex") answers every place an exact text appears, in tree order; complete only at `exhaustive: true`. A single identifier query lists definitions before references. Mode `dual` ranks results and answers where code that does X lives. For a sibling repository, submodule or other folder, pass `root` (or `projectPath`) as an absolute path; never read a sibling tree by path. Callers, impact, deadness: `callers {symbol}`, `impact {symbol, max_depth}`, `codeinsight {action:"outline", path}`, `{action:"orphans"}`, `{action:"hotspots"}`. An empty callers reply is a lead, proof only when `codeinsight_index` reports complete true; otherwise confirm with the literal identifier query.

"Has this happened before": dispatch `codesearch` with the symptom's own wording before any history walk; its `commits` channel ranks commit-message hits by semantic similarity, surfacing prior fixes worded differently. Read a known commit with `git_log {path}`, `git_show {rev:"<rev>:<path>"}` or `git_diff`. Git is never run through a shell.

An answer plausibly on the public web: `websearch`, then at least one targeted `fetch`, before any pause, every time. Ask the user only when that search returns nothing, or the question needs a private credential, a choice among options already surfaced, or authorization for an irreversible action.

Once per project per session, read gm.config.json (absent: every default applies) with the README, CONTRIBUTING and `.gm/` signals. A real signal makes a prd-add row proposing the change. Signals: the project references TencentDB Agent Memory or a deployed instance; an embedding pipeline commits to a dimension the fixed 384-dimension default cannot hold; or the user names the need. Repointing `.gm/config.source.json` or flipping a `memory.tencentdb_backend` block is a reconfiguration: raise it in prose at the end of the turn, with a default already taken, before writing it, unless the user's words named the need. No real signal: move on.

On the first dependency install of a session, and before trusting cloned or vendored dependency content, dispatch `scan_deps`. Body `{}` scans the project; `{"root":"<relative dir>"}` a subdirectory; `{"root":"<absolute dir>"}` a sibling project. blockedCount or failCount above zero is a real hit: stop, raise it in prose at the end of the turn with a default already taken, and investigate the introducing commit in the dependency's history. Never add exclusions; never retry blindly. warnCount alone is a glance, not a block. nodeModulesTruncated true gets a prd-add row for a standing unbounded sweep.

Fan out only when the closure splits into independent slices; launch each as a subagent. The subagent prompt opens "use the gm skill for this; code questions go to codeinsight (callers/impact) first, then codesearch, and fs_read only a located path", then the task, its terminal condition (prd_pending_count 0 against the full discovered scope, not its slice), and session_id `<parent_session_id>-sub<k>`. A parent never passes its own literal session id to a child. A shared recurring transform (rename sweep, API migration, more than five applications of one pattern) gets a mapping note drafted by one subagent and adversarially reviewed by a second; only then do parallel workers dispatch against it.

Every turn ends in a verb dispatch; a prose-only turn stops the chain.

## PRD rows

Write a row when a need is spotted, one row per need: `prd-add {"id":"<kebab-case slug>","title":"<one line>", ...}`. Always pass id; an id-less call with no usable text is hard-rejected. A row body carries a route-family tag, pre-conditions, invariants, post-conditions and a one-line witness plan. Seven route families select the quality rules binding each row:

- `grounding`: belief formation and every information-gathering row.
- `reasoning`: an inference chain where each step is witnessable.
- `state`: a durable mutation; needs pre- and post-conditions.
- `execution`: real services only, through exec_js with a fixed timeout; never a stub or mock.
- `boundary`: reaching outside the tree (git, CI, a remote API, the user).
- `representation`: how information is encoded (skill prose, memory shape, the PRD schema).
- `observability`: a queryable inspection point shipped in the same pass as its subsystem; code alone never satisfies it.

A row without pre-conditions, invariants and post-conditions is not cut. State them concretely: what holds on entry, across every reachable state the row touches, and on exit. "It works" and "handles the input correctly" are not statements. Push the representation decision into the row (data shape, invariant the type makes unrepresentable, module boundary) so it admits one correct implementation.

Never word a need as parked for an unnamed time, handed to another session, or excluded from scope: a need is a row now or not a need. The same holds for `prd-resolve`: witness_evidence names the command run and its printed output, never "parked", "awaiting someone" or "pending recovery". Transition notes follow the same rule.

Expansion: the floor is the directly requested items; the closure adds every adjacent, implied, downstream, cleanup and hygiene item reached. Per row, add rows for every corner case, caveat, failure mode, adjacent-row interaction, degenerate input, and empty, overflow or re-entry state. Run a second pass over the new rows; stop when a pass yields nothing new. Expect the row count to grow two to three times over the first pass.

Every row asks the architecture question: is there a structural change (removing an obsolete mechanism, consolidating duplicated logic, replacing a bespoke implementation with a maintained one, fixing a wrong abstraction at its root) that makes this and every later instance cheaper? If so, it is its own row beside the literal ask.

Jank sweep over reached surfaces (UI, client state, server state, their boundary, anything else touched): every immature, unfinished or half-wired edge, rough and nearly finished work included, is a row. Add a performance-measurement row and a security-review row wherever they apply. Exhaustive inside reached surfaces only.

Tell-tale sweep on any AI-written design element (boilerplate flourish, over-hedged comment, generic scaffold name): one sighting is never patched alone. It becomes rows: a full-codebase scan, a grouping of findings, one fix-and-verify row per group.

A row the agent adds on its own authority, reached only through the closure, gets one response-body line beside its prd-add: "adding <row id> because <reason>". No running narration.

A bug, gap or hygiene issue outside the closure is still a prd-add row: never fixed inline here, never dropped.

At entry, rows already open from an earlier run (prd_pending above zero, or listed in ready_wave) are undone work of the same walk. Resume each to a witnessed prd-resolve or an explicit re-scope before cutting any fresh row.

Cut first the row exercising the most failure modes at once (concurrency, partial failure and real input together); the design is proven while reshaping is cheap.

A row is admitted on witness, not cheapness. An unmeasured optimization claim is rejected here; a witnessed, correct change is admitted however expensive. Work volume never rejects a row.

When a row's statement changes, rewrite it with `prd-add` under its existing id; the reply is `rescoped` and the row keeps its position and dependents. Never delete and re-add: that orphans the handle.

State is one file per row: `.gm/prd/<id>.yml` and `.gm/unknowns/<id>.yml`; resolved material moves to `.gm/prd-log.jsonl` and `.gm/unknowns-log.jsonl`. A fresh session resumes by listing those folders and reading the log, not by replaying memory.

## Mutables

P1 owns no obligation kind. Every P1 unknown is one of two things.

A grounding unknown asks what exists, who calls it, what a service returns, or what a library version exposes. Discharge it inside P1: dispatch the codesearch, callers or MEMORY.md read, or exec_js against the real service, then resolve the unknown with that output before leaving the node. No grounding-shaped unknown crosses the transition open.

Any other unknown is a contract or runtime property. Record it: `unknown-add {"id":"<kebab-case slug>","status":"unknown","obligation_kind":"<kind>","depends_on":[...]}`, kind belonging to the node that discharges it. Contract properties (precondition, invariant, postcondition, resource-bound, type-shape) are typed for CONTRACT. Runtime-safety (totality, ownership, replay, effect-boundary) and concurrency (happens-before, disjointness, contention) properties are typed for BUILD. The witness field names the codesearch hit, file:line or exec output that made it an unknown. An unwitnessed unknown blocks every transition.

`depends_on` lists ids that must resolve first. unknown-add refuses a cycle and names its path. An unknown may depend on any row in the store, whichever node typed it.

Two-pass rule: an unknown surviving two genuine resolution attempts without a witness is never tried a third time the same way. Reclassify it as a fresh, differently scoped unknown with a new id, re-cut affected rows with prd-add on their existing ids, and stay in EARS. Reclassification is reshaping, not failure.

Surface divergence: a state differing from the PRD's assumed shape becomes a new unknown with its witness, then resumes. A broken tool blocking a witness channel becomes an unknown whose task is to make the channel reachable: fix the tool, replace it, or drive its lower-level interface directly. Never parked as blocked by something external.

## Supply-chain scan

scan_deps detects the obfuscated dropper that appends a payload after a source file's real end: one very long, whitespace-padded line that resolves a remote address, fetches and decodes data, then evaluates or spawns the result. Two structural checks survive a change of address, key or cipher. First, byte size wildly out of proportion to line count. Second, a run of four or more `\uXXXX` escapes decoding to an identifier-shaped name, which real code never writes for an ASCII identifier.

Dispatch `{}` on the first dependency install of a session and before trusting any cloned or vendored node_modules. `{"root":"<relative dir>"}` limits the git-tracked half to a subdirectory; `{"root":"<absolute dir>"}` scans a sibling project, gitignored node_modules included. A symlink or junction leaving the root is not followed and is listed in symlinkEscapes. `{"full":true}` forces a complete walk for a one-off sweep after a suspicious install. Otherwise the per-package stamp in `.gm/exec-spool/.scan-deps-stamp.json` skips unchanged packages. A package with a failing or blocked finding is never stamped, so it is reported on every scan.

Read the counts. blockedCount above zero: the OS or antivirus already blocked a read. failCount above zero: a structural hit. warnCount alone usually marks a legitimate minified bundle: a glance, never a block. nodeModulesTruncated true: part of the tree went uncovered; add a prd-add row for a standing unbounded sweep.

A failing or blocked hit is a one-way door. Record it as a PRD row and keep the walk running; ask only when the hit is a world-scoped one-way door. Find the introducing commit in the dependency's history and confirm the last clean commit before proposing a pin, revert or exclusion. Never add an exclusion; never retry blindly. Several unrelated repositories under one account showing the same pattern point to a shared compromised credential: name that to the user. A compromised default branch is repaired with git_revert, keeping the bad commit visible. A history rewrite waits for an explicit request.

## Scope discovery to a fixed point

Discovery does not stop at the first plan. A closure implying work outside current rows is a scope expansion: prd-add the new rows in the same pass, derive their unknowns as unknowns, repeat. The walk leaves this node only after a full sweep adds zero rows and zero unknowns. That fixed point is the criterion, not a step count or a sense that coverage is enough.

Scope inside the closure is in the walk. Unrelated work becomes a row that waits for its own walk.

Long-horizon work spans sessions: rows and unknowns on disk let a fresh session resume without replay. A batch independent enough to run unattended is handed to a new session deliberately, not serialized through this one.

## Large finding sets are partitioned once

A classifiable finding set (compiler errors, lint violations, dependency-bump breakage) comes from one run of its producing command. Group the output by natural boundary (file, crate or module); each group is one row owned by one subagent. Disjoint slices need no coordination. Each subagent verifies its slice by rerunning the classifier scoped to its own files. The global classifier is never rerun mid-fan-out: a rerun wastes the run or lets two agents race to fix one finding.

Every fan-out dispatch states its terminal condition: prd_pending_count 0 against the full discovered scope, not its own slice. A new unknown found mid-dispatch goes into unknown-add or prd-add; scope is never narrowed silently.

## Principles

### JTBD - Jobs To Be Done - Clayton Christensen

Handover: Hands the restated jobs and the constraint that makes the obvious approach wrong to XYPROB, so the reproduction targets the real symptom; nominated next node: XYPROB; cite Jobs To Be Done - Clayton Christensen.

Before the first row is cut, restate the request as jobs: the situation the user is in, the outcome they hire the change to produce, and the constraint that makes the obvious approach wrong. Write the job into the title or pre-condition text of every row it serves. A closure requirement serving no stated job is not added as a row.

### XYPROB - XY Problem

Handover: Hands the reproduced symptom and its witness to EARS, so each requirement is stated against the real problem; nominated next node: EARS; cite XY Problem.

Search the problem in the user's wording. Dispatch an exec_js command reproducing the reported symptom itself, not a nearby one; the reproduction is the problem row's witness. If it shows the requested fix would not remove the symptom, or the stated problem is not the real one, the backreference to JTBD fires: return there with the underlying problem and re-cut the rows.

### EARS - EARS Requirements Syntax - Alistair Mavin

Handover: Hands falsifiable EARS requirements, each with an exec_js-checkable outcome, to INVEST for row sizing; nominated next node: INVEST; cite EARS Requirements Syntax - Alistair Mavin.

Write each requirement in one EARS template (ubiquitous, event-driven, state-driven, unwanted behaviour, or optional feature) with trigger, system response and observable outcome. The outcome must be something an exec_js run returns true or false on. An unfalsifiable requirement fires the backreference to DBC and is rewritten in G_CONTRACT as a precondition or postcondition before it enters the PRD.

### INVEST - INVEST - Bill Wake

Handover: Hands rows that pass the independent, negotiable, valuable, estimable, small and testable checks to THINSLICE for vertical cutting; nominated next node: THINSLICE; cite INVEST - Bill Wake.

Check each row for independent, negotiable, valuable, estimable, small and testable. Testable here means the witness plan names the exec_js dispatch that proves it; a row that cannot be proven so is split until it can. A row depending on another task fires the backreference to THINSLICE; record the dependency with depends_on on its unknown or in its pre-condition text.

### THINSLICE - Thin Vertical Slice - Alistair Cockburn

Handover: Hands each thin vertical slice to SPIKE, where an unknown that search cannot settle gets a throwaway probe; nominated next node: SPIKE; cite Thin Vertical Slice - Alistair Cockburn.

Cut each row as a thin vertical slice crossing every layer the behaviour touches, entry point to store. One real input drives the whole path; one exec_js run witnesses it. Thin means: one real input, one entry point, one exec_js run. A slice needing a second input or entry point is split until each piece passes. A slice cutting across a module boundary fires the backreference to PARNAS; re-cut along the module's interface, not its internals.

### SPIKE - Spike Solution - Kent Beck

Handover: Hands the spike's printed output and the settled unknowns to YAGNI to cut scope to caller-backed rows; nominated next node: YAGNI; cite Spike Solution - Kent Beck.

Where search cannot settle an unknown, spike it: a throwaway exec_js probe against the real service, run with a named command that is red-capable, deterministic and fast. Timebox: one exec_js dispatch and five minutes wall clock; exceeding the box without settling fires the backreference to LIVEPLAN. The spike's printed output is the unknown's witness. Spike code is never shipped. If the unknown survives, the backreference to LIVEPLAN fires and the plan is re-cut around it.

### YAGNI - YAGNI - Ron Jeffries

Handover: Hands the caller-backed row set to LIVEPLAN as the current task's live plan; nominated next node: LIVEPLAN; cite YAGNI - Ron Jeffries.

Every row's scope is the request's closure. An option, extension point or generality is admitted only with a current caller named in its pre-condition text. Generality with one caller fires the backreference to TARPIT. That removal belongs to the pressure node (P6), so the plan carries only the caller-backed shape.

### LIVEPLAN - Live Plan, Current Task Only

Handover: Hands the live PRD rows to the G_CONTRACT gate, which admits only rows whose contract can be stated; nominated next node: G_CONTRACT; cite Live Plan, Current Task Only.

The PRD holds rows for this request only. Each completed row closes with prd-resolve and its witness, so the list shrinks as the task proceeds. When the plan outlives its task, the backreference to G_START fires: the finished task closes before any new plan opens. The node exits through LIVEPLAN into the G_CONTRACT gate.

## Witness

A grounding unknown is discharged by a witness naming its source: a codesearch hit with path and line, a callers edge with calling function and line, a memory file with name and text, or an exec_js output. `prd-resolve` takes witness_evidence naming the command run, its real output, and the file:line it touched. "verified", "looks correct", "checked" and "reviewed" alone are rejected as unwitnessed, and the transition refuses them. A web-sourced row names the URL and the quoted line from the fetch result. An expansion row is witnessed by the live exec_js run of its edge case, never by a file.

A finding delegated to a subagent, or taken from memory, is a hypothesis. Before a row is built on it, one dispatch confirms the premise on the live tree: callers for a claimed zero-caller, codesearch for a claimed name, git_log for a claimed history. An overturned premise re-cuts the row with prd-add on the same id; the row is never built on the wrong premise.

## Memorize

Save an unknown as a memory file only when a later task needs it. Decisions (the config-fit conclusion, the scan_deps result, a rejected alternative with its witness) are not memories: the PRD row and the commit hold them. Do not save the search transcript or raw hits. A memory file contradicted by a witnessed codesearch is deleted with its MEMORY.md line.

## Transition

Entry is gated by G_START. The gate lean-one-task-in-flight is blocking; its refusal names a recovery verb in next_dispatch. A repeated identical refusal escalates at gate_repeat_escalate_threshold (default 3). Dispatch the named recovery verb, never the denied transition again.

Exit is `transition to=G_CONTRACT`, dispatched only when every row carries pre-conditions, invariants and post-conditions, every grounding unknown has a witness, every contract-kind unknown is typed, and the last expansion pass added zero rows. The exit path runs LIVEPLAN, then the G_CONTRACT gate (contract is the only durable description, advisory: it records the rule and never refuses), then UBIQ in G_CONTRACT. Before that no second durable description exists: no design document, no plan prose outside `.gm/prd/`, `.gm/unknowns/` and their two commit logs. The rows and the types are the description.

Feedback inside the node: XYPROB routes back to JTBD, INVEST to THINSLICE, SPIKE to LIVEPLAN. Each re-cuts rows in place with prd-add on existing ids, then the walk continues here. EARS routes to DBC, a backreference into G_CONTRACT carrying the row id, the earliest node able to make the requirement falsifiable. The backreference from LIVEPLAN to G_START closes a finished task before a new plan opens.

Route to the earliest capable node. A discovery made in EARS stays in EARS unless it changes a contract or runtime property, and never sends the walk further back than the discovery requires.

Every turn ends in a verb dispatch. A transition refused with a next_dispatch is dispatched next, not narrated; the denied transition is not retried blind.
