# LEAN CONTEXT ECONOMY

This is a concern of the method, not a stage of a pipeline: it is entered from whichever node the work reaches it from, and left as soon as what it asks for holds. No concern gates entry to a set of nodes.

CONTEXT ECONOMY keeps the tokens spent per unit of change low. It applies at every node of the walk, not at one point in it. Its job is to make the main thread hold only the signal the current change needs: the instruction prose it is using, the search output it actually read, the recall hits it verified against the live tree, the tool definitions it dispatches, and the subagent replies it reduced to a conclusion plus a witness. The node is entered whenever a backreference fires into it (the sweep condition "context spend rose per unit of change", or a retrieval that returned approximate matches). It exits when the measured spend per unit of change has stopped rising and the walk returns to the node whose work it measured. The exit condition is a sweep in which no context-spend measure rose.

Principles in this node are applied as work, from the lean method (AnEntrypoint/lean). Each principle's book and attribution is the label in its H3 heading, taken from gm-config/fsm/graph.json.

## Verbs

Every search in this node is a verb dispatch. A structural question goes to the call-graph verbs first. Before a function changes, dispatch `callers {symbol}` to list every call site the edit must keep valid, and `impact {symbol, max_depth}` to list what the symbol depends on. A where-is question goes to `codesearch {query}`. The default mode is `dual`, which ranks code by BM25 plus vector similarity. The `literal` and `regex` modes are exhaustive and return every match with path and line in tree order, so use them for "every place this exact text appears". An identifier-shaped query is answered by the exhaustive symbol mode automatically. The `filename` mode matches paths only. Read the `exhaustive` field of every search result before trusting it: `true` means the search is finished, and `false` names the bound or skip rule that fired. Bound every exhaustive search with `path`, `path_glob`, `max_matches` or `max_files`.

For file overviews and cleanup sweeps, dispatch `codeinsight {action:"outline", path}`, `{action:"find", symbol}`, `{action:"orphans"}`, `{action:"hotspots"}` or `{action:"impact", symbol, direction:"callers"}`. Run `codeinsight_index {}` before trusting a call-graph reply. An empty `callers` reply is proof of absence only when the index reports `complete: true`. Otherwise confirm it with an exhaustive `codesearch` identifier query. A question of the form "has this already happened" goes to `codesearch` with the symptom as the query, because its `commits` field returns prior fixes by meaning. Only after a commit has been named does the walk use `git_log` or `git_show` to read its exact content.

Context is loaded through `instruction`. Dispatch `instruction` with the prompt when a node begins and whenever the held prose may be stale. Pass `known_instruction_hash` set to the `instruction_hash` of the most recent response this session actually received. A match returns `instruction` empty with `instruction_unchanged: true`, and the prose already held stays in force. A mismatch or omission returns the full prose. Assert only a hash read off a received response, never one from bookkeeping. Recall goes through `recall {query}`, which returns compact hits with key, score, title and a 200-character preview. Expand one hit with `recall {key}`. A hit is a lead and is re-witnessed on the live tree before the walk acts on it.

Fanned-out work goes to subagents. Each subagent gets its own SESSION_ID, derived from the parent id plus an index (`<parent_session_id>-sub<k>`), and never the parent's literal value. Its prompt opens with the instruction to use the gm skill, to route code questions to `callers` and `impact` first and then `codesearch`, and to `Read` only a located path, followed by the task content. The reply is a conclusion, the located paths, and a witness. Raw output does not come back into the parent.

Transitions leave this node only as the backreference edges and the transition named under Transition below, always as `transition to=<NODE>`. Nothing in this node dispatches Glob, Grep, `find`, `grep` from a shell, Bash git, or PowerShell. Git goes through the `git_*` verbs and execution goes through `exec_js`.

## PRD rows

A need spotted in this node becomes a PRD row at the moment it is spotted, dispatched with `prd-add` before any other dispatch that acts on it. Typical rows here: a tool definition loaded on every turn and never dispatched (TOOLBUDGET), a recall hit the live tree contradicts (MEMTOOL), a prose file that restates another file (NODUPEDOC), a subagent that returned raw output (SUBAGENT), an exact string paraphrased away (OBSCOMPRESS). Each row names the need, the witness condition that closes it, and the file or verb it touches. A rejected `prd-add` body is re-dispatched with the fields its rejection names, never retried blind.

A need is either a row now or it is not a need. A row or a transition note in this node never carries deferral wording: no phrase that pushes the work to an unnamed time, to another session, or outside the scope, and no hedge. A row that cannot close in the current pass keeps its witness condition and its reason inside the row, and stays pending in the PRD. It is never reworded to look finished.

## Mutables

A mutable in this node is an open question about context spend, with a witness that would settle it. It is added with `mutable-add`. P7, P8 and P9 own no obligation kind of their own. An open item here is therefore added with the `obligation_kind` of the node that discharges it: a question that changes a contract shape takes `precondition` or `type-shape`, and an observable output a consumer depends on takes `postcondition`. The kind names the owner, and the item is resolved in that owner's node. The sweep closure needs zero pending rows, because the edge from G_DONE to G_SWEEP is gated by `lean-contract-recorded`, which refuses while any `.gm/prd/` row is open or the worktree is dirty.

Set `depends_on` to the ids of mutables this one needs resolved first. `mutable-add` refuses a cycle and names the full cycle path. Resolve a mutable with `mutable-resolve {mutable_id, witness_evidence}`, where the evidence is a `file:line`, a `codesearch` hit or an `exec_js` snippet. A prose claim is not evidence. Surface-to-mutable applies here too: state that diverges from the PRD's assumed shape becomes a new mutable with its name, its witness and its resume step. A witness that cannot be reached because a tool is broken makes a mutable to repair or replace the tool, then the witness is taken.

The two-pass rule applies. A mutable that survives two genuine resolution attempts without landing a witness is not attempted a third time under the same approach. It is re-added with `mutable-add` as a new row with a new id, naming the gap the attempts revealed. That reclassification is grounds for a backreference to the G_CONTRACT node, so the shape is reworked around what the attempts showed. A delegated or recalled claim is a hypothesis until it is re-witnessed. A claim that a symbol has no callers, or that a file is junk, is checked with `callers` and `codesearch` on the live tree before the mutable resolves.

## Principles

### SMALLESTSET - The Smallest Set of High-Signal Tokens

Handover: the measured before-and-after byte count of held prose and search output passes to CONTEXTROT, which moves cut context into a fresh subagent once reasoning degrades; cite The Smallest Set of High-Signal Tokens.

Fan-out: three independent measurements run as parallel subagents: the instruction prose bytes (`goal-s1-d7-sub1`), the recall hit bytes (`goal-s1-d7-sub2`) and the search output and tool definition counts (`goal-s1-d7-sub3`). Each returns a byte count and a witness. Canary: a measurement absent from the node record means its slice did not run; a subagent that edits prose or dispatches a transition has gone off-task.

Nominations (set): {CONTEXTROT}. Backreferences in from {G_SWEEP, GREPFIRST}; out to {G_START, COMPACT}.

Before the first dispatch of a node pass, measure what the main thread holds: the bytes of the instruction prose in hand, the recall hits in hand, the search output in hand, and the loaded tool definitions. Keep an item only when the next dispatch needs it. Cut the prose by re-dispatching `instruction` with `known_instruction_hash` instead of re-reading the full text. Bound search output with `codesearch` `literal` plus `path` and `max_matches`. Read a file only by a located path, and only the range that the located line needs. The witness is a before-and-after byte count recorded in the node. The sweep's backreference "context spend rose per unit of change" fires into this node when that count rises against the change it served.

### CONTEXTROT - Context Rot - Hong et al.

Handover: a degraded long session is handed to a fresh subagent that returns only located paths and a witness, so the rework check that follows counts only dispatches it can see; cite Context Rot - Hong et al.

Fan-out: each path the subagent returned is re-checked as its own parallel slice (`goal-s1-d7-sub<k>`, one per path), returning a conclusion and a witness. Canary: a path with no re-check reply means its slice did not run; a re-check that reads a whole file rather than the located line has gone off-task.

Nominations (set): {REWORK}. Backreferences in from {}; out to {SUBAGENT}.

When a long session's reasoning degrades (a dispatch misreads a file read earlier, or a gate denial names something absent from the held prose), the cause is the filled window and not the model. The walk moves the work to a fresh subagent with its own SESSION_ID, and the parent receives only the located paths and the witness. The backreference CONTEXTROT to SUBAGENT ("quality fell as the window filled") is taken at that point. Witness: every path the subagent returns is re-checked with `codesearch` or `Read` on the live tree before the parent acts on it.

### REWORK - Rework Loops Dominate Token Spend

Handover: a repeated artifact stops the loop and the affected rows are rescoped in place, so the walk passes the bodies it actually loaded to PROGDISC for disclosure review; cite Rework Loops Dominate Token Spend.

Fan-out: none. The dispatch count and the rescope of rows write the row's own file under `.gm/prd/`, and each row file has one owner, so rescopes of two different rows never contend; the count runs in one session. Canary: a `rescoped` reply absent for a repeated row means the rescope did not run.

Nominations (set): {PROGDISC}. Backreferences in from {}; out to {G_INDEP}.

Count the dispatches in the node that repeat earlier work: a resolve retried with the same witness, an edit undone and redone, a search re-run with the same query. When the same artifact is repeated for a second time, stop iterating. Rearchitect immediately: an in-spirit improvement that the walk has just recognised is an immediate transition to G_CONTRACT in this turn, with the affected rows re-added through `prd-add` using their existing id, which rescopes them in place and keeps their position and dependents. Narrating "I should rearchitect this" without dispatching the transition strands the chain on a stale plan. The backreference REWORK to G_INDEP ("iteration, not generation, spent the budget") routes the verification to a verifier that works from the contract in a separate context. Witness: the dispatch count before and after, and the `rescoped` reply naming the row id.

### PROGDISC - Progressive Disclosure via SKILL.md

Handover: the recorded list of loaded skill bodies passes to HEADERONLY to test each header's trigger, and the bodies a named QA check needs pass to AGENTQA; cite Progressive Disclosure via SKILL.md.

Fan-out: each loaded skill body is an independent slice: one subagent per skill (`goal-s1-d7-sub<k>`) reports its reached and unreached sections. Canary: a loaded skill absent from the recorded list means its slice did not run; a subagent that loads a body the walk did not need has gone off-task.

Nominations (set): {HEADERONLY, AGENTQA}. Backreferences in from {TOOLBUDGET, CTXEXPLODE}; out to {}.

Headers load at session start and bodies load when their trigger fires. In this node, list the bodies loaded for the current walk and mark which sections the walk actually reached. A body loaded when it was not needed is returned behind its trigger, which is the backreference PROGDISC to HEADERONLY ("the body loaded when it was not needed"). A body that the walk needs for a named QA check is loaded through the forward edge PROGDISC to AGENTQA, into G_INDEP. Witness: the recorded list of loaded bodies with their reached and unreached sections, before and after the change.

### HEADERONLY - Header Loads, Body Fires on Trigger

Handover: a header whose trigger a rewrite cannot fix passes to AGENTSMD, which moves the caveat out of the rule file into memory with a one-line pointer; cite Header Loads, Body Fires on Trigger.

Fan-out: each candidate skill's header read is an independent slice: one subagent per candidate (`goal-s1-d7-sub<k>`), located by a `codesearch` filename query, returns its header line and whether its trigger is named. Canary: a candidate whose header was not read means its slice did not run; a subagent that rewrites a skill file rather than reporting has gone off-task.

Nominations (set): {AGENTSMD}. Backreferences in from {}; out to {}.

Check each header against the trigger it claims to predict. A skill's description must name the condition that loads its body. Read the header lines of each candidate skill with a located `Read`, and locate the candidates with `codesearch` `filename` over the skill directories. Where a body loaded on a condition the header never named, rewrite the header line so the trigger is stated. The backreference HEADERONLY to AGENTSMD ("the header does not predict the trigger") is taken when a rewrite would not fix the mismatch. Witness: an `instruction` dispatch whose prompt matches the rewritten trigger returns the skill among its hits, and the same prompt before the rewrite did not.

### AGENTSMD - AGENTS.md Hierarchical, Not Encyclopaedic

Handover: a byte-measured section that repeats a README passes to NODUPEDOC, which keeps one owning copy of each fact and replaces the rest with references; cite AGENTS.md Hierarchical, Not Encyclopaedic.

Fan-out: each AGENTS.md section's byte count is an independent slice: one subagent per section (`goal-s1-d7-sub<k>`) returns the count from a witnessed `exec_js`. Canary: a section with no byte count means its slice did not run; a subagent that writes AGENTS.md has gone off-task.

Nominations (set): {NODUPEDOC}. Backreferences in from {}; out to {}.

AGENTS.md holds rules the live tree cannot express, stated in the present tense, and it points to everything else. Measure each section's byte count with a witnessed `exec_js` (a file read plus `Buffer.byteLength`), and keep the project's own stated size limit. A cross-cutting rule stays resident. A fact-base caveat that only matters when its topic is touched moves to `memorize-fire` in the default namespace, and the AGENTS.md paragraph is replaced by a one-line pointer in the same commit. The drain runs on every memorize pass and handles a few entries per pass, never a wholesale rewrite. A load-bearing rule is dual-written: it lands in AGENTS.md and the same rule is fired to the default namespace in the same session. AGENTS.md is never written under a namespace named after the file. The backreference AGENTSMD to NODUPEDOC ("the file restates the README") is taken when a section repeats a README. Witness: the byte count before and after, and a `recall` hit for the moved fact.

### NODUPEDOC - Reference, Never Restate

Handover: the single owning copy of each fact passes to SUBAGENT, which takes independent slice searches into isolated contexts; cite Reference, Never Restate.

Fan-out: each fact's exhaustive literal search is an independent slice: one subagent per fact (`goal-s1-d7-sub<k>`) returns the owning-copy count and its `exhaustive` field. Canary: a fact whose search reports `exhaustive: false` was not closed; a subagent that edits the owning copy has gone off-task.

Nominations (set): {SUBAGENT}. Backreferences in from {}; out to {DRY}.

For each fact in the touched prose, find every file that states it. Use `codesearch` `literal` on the exact phrase, bounded with `path_glob` to the document types, and check the `exhaustive` field. Keep the one owning copy and replace every other copy with a reference to it. A duplicated fact that lives in code rather than prose is handled by the backreference NODUPEDOC to DRY ("two documents describe one fact"): the two representations merge behind one function. Witness: after the edit, the exhaustive literal search returns exactly one owning copy per fact.

### SUBAGENT - Subagent Context Isolation

Handover: each returned conclusion, located path and witness passes to COMPACT, which compacts only at a node boundary after open subgoals are written as rows; cite Subagent Context Isolation.

Fan-out: the subagents are the fan-out. Each independent slice runs with its own SESSION_ID (`<parent_session_id>-sub<k>`) and the opener that routes code questions to `callers` and `impact` first, then `codesearch`. Canary: a slice with no returned reply did not run; a reply carrying raw output (backreference to OBSCOMPRESS) or a subagent that reuses the parent's session id has gone off-task.

Nominations (set): {COMPACT}. Backreferences in from {CONTEXTROT}; out to {OBSCOMPRESS}.

Fan independent reads, searches and log reads out to subagents whenever the work decomposes into independent slices. Give each subagent its own SESSION_ID and the opening line that routes code questions to `callers` and `impact` first, then `codesearch`, and that permits `Read` only on a located path. The return contract is a conclusion, the located paths and a witness, never raw output. A single focused edit stays in the parent. The backreference SUBAGENT to OBSCOMPRESS ("the subagent returned raw output") is taken when a reply arrives with raw output. Witness: the byte count of each returned payload is recorded, and each claimed path is re-checked on the live tree before use.

### COMPACT - Node-Boundary Compaction

Handover: the compacted record of each node's subgoals passes to OBSCOMPRESS, which keeps exact strings a following step must match unchanged; cite Node-Boundary Compaction.

Fan-out: none. The compaction is one write over an ordered list of subgoal rows at a single node boundary, so it runs in one session. Canary: an open subgoal missing from `prd-list` after compaction means the record dropped it.

Nominations (set): {OBSCOMPRESS}. Backreferences in from {SMALLESTSET, MEMTOOL}; out to {}.

Compact at a node boundary: after a node's witness is recorded and before the next node's `instruction` is dispatched. Never compact mid-subgoal. Before compacting, write each open subgoal as a PRD row with `prd-add`, so the summary cannot drop it. Reactive compaction fires too late, and periodic compaction cuts subgoals, so the boundary is the trigger. The backreference COMPACT to OBSCOMPRESS ("compaction cut an active subgoal") is taken when a subgoal is lost, and SMALLESTSET to COMPACT ("context grew without new signal") is taken when the window grows without a new witness. Witness: after compaction, `prd-list` shows every open subgoal as a row, and the next `instruction` call returns the node prose.

### OBSCOMPRESS - Observational Context Compression

Handover: the compact record of each dispatch passes to MEMTOOL, which writes the fact a resuming session needs and cannot re-derive; cite Observational Context Compression.

Fan-out: the compact records of separate dispatches are independent slices: one subagent per dispatch (`goal-s1-d7-sub<k>`) builds its record from the verb, exit state, witness line and byte count. Canary: a record whose literal match count differs from the stored count means its slice was not verified; a subagent that keeps raw output in its reply has gone off-task.

Nominations (set): {MEMTOOL}. Backreferences in from {SUBAGENT}; out to {GREPFIRST}.

A dispatch's result is kept as a compact record: the verb, the exit state, the witness line and the byte count. The raw output is not kept in the window. Strings a following step must match exactly (error text, paths, symbol names, test names) are copied into the record unchanged. When a following step cannot match a paraphrase, the backreference OBSCOMPRESS to GREPFIRST ("an exact string was paraphrased away") is taken, and the exact string is re-fetched with `codesearch` `literal`. Witness: a record reused by a following dispatch resolves against the live tree, and the literal search's match count equals the count the record stored.

### MEMTOOL - Server-Side Memory Across Sessions

Handover: the memory written for a resuming session passes to STABLEPREFIX, which keeps the invariant prefix fixed so the next dispatch can hit the cache; cite Server-Side Memory Across Sessions.

Fan-out: each recall hit's live-tree re-verification is an independent slice: one subagent per hit (`goal-s1-d7-sub<k>`) returns the located file, function or flag and its witness. The `memorize-fire` and `memorize-prune` writes stay in the parent, which is their single writer. Canary: a hit returned without a located witness means its slice did not run; a subagent that writes or prunes memory has gone off-task.

Nominations (set): {STABLEPREFIX}. Backreferences in from {NAURTHEORY}; out to {COMPACT}.

A fact that a resuming session needs and that the live tree cannot supply is written with `memorize-fire`; `kind` there is a storage tier (see entry-extended.md), not a memory type. A recall that opens this node is a lead. Re-verify that the named file, function or flag still exists before acting on it. A stale, superseded or wrong hit is removed on sight with `memorize-prune {key}`. For an uncertain set, `memorize-prune {query}` returns review-only candidates, and the chosen ones are removed by `{keys}`. The backreference NAURTHEORY to MEMTOOL ("the theory died with the session") is taken when a theory exists only in the window. Witness: a `recall` after the write returns the new key with its text, and after a prune the same query no longer returns the key.

### STABLEPREFIX - Stable Prefix for Cache Hits

Handover: the invariant prefix that every dispatch carries first passes to TOOLBUDGET, which records each tool definition loaded but never dispatched; cite Stable Prefix for Cache Hits.

Fan-out: none. The check compares the prefix across two consecutive `instruction` responses, one pair in one session. Canary: a changed prefix with no edit to the prose means the comparison was not run on the matching pair.

Nominations (set): {TOOLBUDGET}. Backreferences in from {}; out to {}.

The content that every dispatch carries first is invariant: the instruction prose, the tool definitions and the node's fixed constraints. Variable content (the current prompt, the located paths, the witness) goes last. A prose file that mixes a per-task value into its invariant prefix is split so the prefix stays fixed. The backreference STABLEPREFIX to TOOLBUDGET ("the cache is missing") is taken when the prefix changes between dispatches with no edit to the prose. Witness: two consecutive `instruction` responses with a matching `known_instruction_hash` return `instruction_unchanged: true` and the short form.

### TOOLBUDGET - Tool and MCP Definition Overhead

Handover: the unused-definition row passes to GREPFIRST, which runs exact-string searches before any embedding retrieval; cite Tool and MCP Definition Overhead.

Fan-out: each loaded definition's live dispatch is an independent slice: one subagent per server or definition (`goal-s1-d7-sub<k>`) returns its normal reply or its failure. Canary: a definition counted as used with no live reply means its slice did not run; a subagent that edits the project configuration has gone off-task.

Nominations (set): {GREPFIRST}. Backreferences in from {}; out to {PROGDISC}.

List the tool and MCP definitions this session loads, and the ones this node's walk dispatches. A definition that is loaded and never dispatched is a cost on every turn. Record the unused set as a PRD row naming each server or definition. The narrowing edit is made only to the project's own configuration. A server needed by one node alone is loaded at that node. The backreference TOOLBUDGET to PROGDISC ("tool definitions dominate the prompt") is taken when definitions outweigh the bodies the walk uses. Witness: the loaded definition count before and after, and a live dispatch to each remaining verb returning its normal reply.

### GREPFIRST - Exact-String Retrieval Before Embedding Retrieval

Handover: its exit is the backreference to SMALLESTSET (gm-config/fsm/graph.json GREPFIRST -> SMALLESTSET, backreference) by design, taken when a dual answer is the only answer; cite Exact-String Retrieval Before Embedding Retrieval.

Fan-out: each exact string's literal search is an independent slice: one subagent per string (`goal-s1-d7-sub<k>`) returns its match count and `exhaustive` field. Canary: a literal search with `exhaustive: false` was not closed and is not counted as complete; a subagent that falls back to `dual` for an exact string has gone off-task.

Nominations (set): none forward. Backreferences in from {OBSCOMPRESS}; out to {SMALLESTSET}.

An error string, a path, a symbol or a test name is searched first with `codesearch` `literal` or `regex`, which are exhaustive and return tree-order matches. Embedding retrieval (`dual`) is used only for a where-is-the-concept question that has no exact string to search. An identifier-shaped token goes to `codesearch` symbol results. A phrase goes to `literal` first. The backreference GREPFIRST to SMALLESTSET ("retrieval returned approximate matches") is taken when a `dual` answer is the only answer, because an approximate hit returns the node to the context cut. Witness: the literal search's `exhaustive` field is `true`, and its match count is recorded with its query.

## Witness

The node closes when a sweep records no context-spend measure that rose per unit of change, so the backreference "context spend rose per unit of change" no longer fires. The witness is a measured quantity with the dispatch that measured it. For this node, record the bytes of instruction prose held before and after each cut, the count of loaded tool definitions before and after, the count of recall hits pruned, the `exhaustive` field of each search that closed a question, and the byte count of each subagent reply. A generic "verified", "context is lean" or "looks fine" is rejected. A recall hit is a lead until its premise has been re-witnessed on the live tree.

## Memorize

`memorize-fire` writes what a resuming session needs and cannot re-derive cheaply: which search mode answered a class of question, a subagent SESSION_ID pattern that held, a correction the user gave about context handling, and the reason a recall key was pruned. Each write is one of the four types (user, feedback, project, reference) in the default namespace. Nothing derivable from the live tree is written: file paths, function names, code patterns, git history and document contents. A stored derivable fact becomes a second source that drifts. Pruning is part of this node. A recall hit the live tree contradicts is removed with `memorize-prune {key}` in the same pass that found it.

## Transition

CONTEXT ECONOMY is entered and left by backreferences, because it applies at every node. The walk returns to the node whose work it measured with `transition to=<NODE>`, and the lean gates stay in force on that transition. The gates are `lean-one-task-in-flight`, `lean-contract-only-description`, `lean-verifier-independent`, `lean-net-negative` and `lean-contract-recorded`. The graph's edges into this node are G_SWEEP to SMALLESTSET when context spend rose per unit of change, GREPFIRST to SMALLESTSET when retrieval returned approximate matches, TOOLBUDGET to PROGDISC, CTXEXPLODE to PROGDISC, NAURTHEORY to MEMTOOL, and REWORK to G_INDEP. The edges out are REWORK to G_INDEP ("iteration, not generation, spent the budget"), SMALLESTSET to COMPACT, PROGDISC to AGENTQA (the walk moves to G_INDEP), and the dotted edge from SMALLESTSET to G_START, which, when no backreference fires, closes the node at the start of a task so that one task is in flight. When a gate denies a transition, the denial's `next_dispatch` names the recovery verb, usually `instruction`. Dispatch that verb next, never the denied transition again. A gate that has denied the same transition with the same content up to the repeat threshold (`gate_repeat_escalate_threshold`, default 3) escalates, and the walk stops retrying it blind.
