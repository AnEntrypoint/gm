# LEAN CONTEXT ECONOMY

A concern of the method, not a pipeline stage: entered from whichever node reaches it, left once its ask holds. No concern gates entry to a set of nodes.

CONTEXT ECONOMY keeps tokens spent per unit of change low at every node. The main thread holds only the signal the current change needs: instruction prose in use, search output actually read, memory entries verified against the live tree, tool definitions dispatched, and subagent replies reduced to a conclusion plus a witness. It is entered when a backreference fires into it (the sweep condition "context spend rose per unit of change", or a memory lookup that returned approximate matches). It exits when measured spend per unit of change has stopped rising and the walk returns to the node whose work it measured. The exit condition is a sweep in which no context-spend measure rose.

Principles here are applied as work, from the lean method (AnEntrypoint/lean). Each principle's book and attribution is its H3 label, taken from gm-config/fsm/graph.json.

## Verbs

Every search here is a verb dispatch. Structural questions go to the call-graph verbs first. Before a function changes, dispatch `callers {symbol}` for every call site the edit must keep valid, and `impact {symbol, max_depth}` for what the symbol depends on. Where-is questions go to `codesearch {query}`. Default mode `dual` ranks code by BM25 plus vector similarity. `literal` and `regex` are exhaustive and return every match with path and line in tree order, for "every place this exact text appears". An identifier-shaped query is answered by the exhaustive symbol mode automatically. `filename` matches paths only. Trust a result only after reading its `exhaustive` field: `true` means finished, `false` names the bound or skip rule that fired. Bound every exhaustive search with `path`, `path_glob`, `max_matches` or `max_files`.

For overviews and cleanup sweeps, dispatch `codeinsight {action:"outline", path}`, `{action:"find", symbol}`, `{action:"orphans"}`, `{action:"hotspots"}` or `{action:"impact", symbol, direction:"callers"}`. Run `codeinsight_index {}` before trusting a call-graph reply. An empty `callers` reply proves absence only when the index reports `complete: true`; otherwise confirm with an exhaustive `codesearch` identifier query. For "has this already happened", query `codesearch` with the symptom, since its `commits` field returns prior fixes by meaning. Only after a commit is named does the walk use `git_log` or `git_show` for its exact content.

Load context through `instruction`. Dispatch it with the prompt when a node begins and whenever held prose may be stale. Pass `known_instruction_hash` set to the `instruction_hash` of the latest response this session received. A match returns `instruction` empty with `instruction_unchanged: true`, and held prose stays in force. A mismatch or omission returns the full prose. Assert only a hash read off a received response, never one from bookkeeping. To read memory, open MEMORY.md, then the files it points to. A memory is a lead, re-witnessed on the live tree before the walk acts on it.

Fanned-out work goes to subagents. Each gets its own SESSION_ID: the parent id plus an index (`<parent_session_id>-sub<k>`), never the parent's literal value. Its prompt opens with: use the gm skill; route code questions to `callers` and `impact` first, then `codesearch`; `Read` only a located path. Then the task content. The reply is a conclusion, the located paths and a witness. Raw output does not return to the parent.

Transitions leave this node only by the backreference edges and the transition named under Transition, always as `transition to=<NODE>`. Nothing here dispatches Glob, Grep, `find`, `grep` from a shell, Bash git or PowerShell. Git goes through `git_*` verbs and execution through `exec_js`.

## PRD rows

A need spotted here becomes a PRD row when spotted, dispatched with `prd-add` before any dispatch that acts on it. Typical rows: a tool definition loaded every turn and never dispatched (TOOLBUDGET), a memory the live tree contradicts (MEMTOOL), a prose file restating another (NODUPEDOC), a subagent that returned raw output (SUBAGENT), an exact string paraphrased away (OBSCOMPRESS). Each row names the need, the witness condition that closes it, and the file or verb it touches. A rejected `prd-add` body is re-dispatched with the fields its rejection names, never retried blind.

A need is either a row now or not a need. A row or transition note here never carries deferral wording (no phrase pushing work to an unnamed time, another session or outside the scope) and no hedge. A row that cannot close this pass keeps its witness condition and reason inside the row and stays pending, never reworded to look finished.

## Mutables

A mutable here is an open question about context spend, with the witness that would settle it, added with `mutable-add`. P7, P8 and P9 own no obligation kind, so an open item takes the `obligation_kind` of the node that discharges it: a contract-shape question takes `precondition` or `type-shape`, an observable output a consumer depends on takes `postcondition`. The kind names the owner, and the item is resolved in that owner's node. Sweep closure needs zero pending rows: the edge G_DONE to G_SWEEP is gated by `lean-contract-recorded`, which refuses while any `.gm/prd/` row is open or the worktree is dirty.

Set `depends_on` to ids this one needs resolved first; `mutable-add` refuses a cycle and names the full cycle path. Resolve with `mutable-resolve {mutable_id, witness_evidence}`, where evidence is a `file:line`, a `codesearch` hit or an `exec_js` snippet. A prose claim is not evidence. State that diverges from the PRD's assumed shape becomes a new mutable with its name, witness and resume step. A witness unreachable because a tool is broken makes a mutable to repair or replace the tool, then the witness is taken.

Two-pass rule: a mutable that survives two genuine resolution attempts without a witness is not attempted a third time under the same approach. It is re-added with `mutable-add` as a new row with a new id, naming the gap the attempts revealed; that reclassification is grounds for a backreference to G_CONTRACT, so the shape is reworked around what the attempts showed. A delegated claim or memory is a hypothesis until re-witnessed. A claim that a symbol has no callers, or that a file is junk, is checked with `callers` and `codesearch` on the live tree before the mutable resolves.

## Principles

### SMALLESTSET - The Smallest Set of High-Signal Tokens

Handover: the measured before-and-after byte count of held prose and search output passes to CONTEXTROT, which moves cut context into a fresh subagent once reasoning degrades; cite The Smallest Set of High-Signal Tokens.

Fan-out: three independent measurements run as parallel subagents: instruction prose bytes (`goal-s1-d7-sub1`), memory bytes (`goal-s1-d7-sub2`), search output and tool definition counts (`goal-s1-d7-sub3`). Each returns a byte count and a witness. Canary: a measurement absent from the node record means its slice did not run; a subagent that edits prose or dispatches a transition has gone off-task.

Nominations (set): {CONTEXTROT}. Backreferences in from {G_SWEEP, GREPFIRST}; out to {G_START, COMPACT}.

Before the first dispatch of a node pass, measure what the main thread holds: bytes of instruction prose, memory files, search output in hand, loaded tool definitions. Keep an item only when the next dispatch needs it. Cut prose by re-dispatching `instruction` with `known_instruction_hash` instead of re-reading it. Bound search output with `codesearch` `literal` plus `path` and `max_matches`. Read a file only by a located path, and only the range the located line needs. Witness: a before-and-after byte count recorded in the node. The sweep's backreference "context spend rose per unit of change" fires here when that count rises against the change it served.

### CONTEXTROT - Context Rot - Hong et al.

Handover: a degraded long session is handed to a fresh subagent that returns only located paths and a witness, so the rework check that follows counts only dispatches it can see; cite Context Rot - Hong et al.

Fan-out: each returned path is re-checked as its own parallel slice (`goal-s1-d7-sub<k>`, one per path), returning a conclusion and a witness. Canary: a path with no re-check reply means its slice did not run; a re-check that reads a whole file rather than the located line has gone off-task.

Nominations (set): {REWORK}. Backreferences in from {}; out to {SUBAGENT}.

When reasoning degrades (a dispatch misreads a file read earlier, or a gate denial names something absent from the held prose), the cause is the filled window, not the model. The walk moves the work to a fresh subagent with its own SESSION_ID; the parent receives only located paths and the witness. Backreference CONTEXTROT to SUBAGENT ("quality fell as the window filled") is taken there. Witness: every returned path is re-checked with `codesearch` or `Read` on the live tree before the parent acts on it.

### REWORK - Rework Loops Dominate Token Spend

Handover: a repeated artifact stops the loop and the affected rows are rescoped in place, so the walk passes the bodies it actually loaded to PROGDISC for disclosure review; cite Rework Loops Dominate Token Spend.

Fan-out: none. Dispatch count and row rescope write each row's own file under `.gm/prd/`, one owner per row file, so rescopes of two rows never contend; the count runs in one session. Canary: a `rescoped` reply absent for a repeated row means the rescope did not run.

Nominations (set): {PROGDISC}. Backreferences in from {}; out to {G_INDEP}.

Count the dispatches in the node that repeat earlier work: a resolve retried with the same witness, an edit undone and redone, a search re-run with the same query. When the same artifact repeats a second time, stop iterating and rearchitect at once: an in-spirit improvement just recognised is an immediate transition to G_CONTRACT in this turn, with affected rows re-added through `prd-add` using their existing id, which rescopes them in place and keeps position and dependents. Narrating "I should rearchitect this" without dispatching the transition strands the chain on a stale plan. Backreference REWORK to G_INDEP ("iteration, not generation, spent the budget") routes verification to a verifier working from the contract in a separate context. Witness: the dispatch count before and after, and the `rescoped` reply naming the row id.

### PROGDISC - Progressive Disclosure via SKILL.md

Handover: the recorded list of loaded skill bodies passes to HEADERONLY to test each header's trigger, and the bodies a named QA check needs pass to AGENTQA; cite Progressive Disclosure via SKILL.md.

Fan-out: each loaded skill body is an independent slice: one subagent per skill (`goal-s1-d7-sub<k>`) reports its reached and unreached sections. Canary: a loaded skill absent from the recorded list means its slice did not run; a subagent that loads a body the walk did not need has gone off-task.

Nominations (set): {HEADERONLY, AGENTQA}. Backreferences in from {TOOLBUDGET, CTXEXPLODE}; out to {}.

Headers load at session start; bodies load when their trigger fires. List the bodies loaded for this walk and mark which sections it reached. A body loaded when not needed is returned behind its trigger: backreference PROGDISC to HEADERONLY ("the body loaded when it was not needed"). A body the walk needs for a named QA check loads through the forward edge PROGDISC to AGENTQA, into G_INDEP. Witness: the recorded list of loaded bodies with reached and unreached sections, before and after the change.

### HEADERONLY - Header Loads, Body Fires on Trigger

Handover: a header whose trigger a rewrite cannot fix passes to AGENTSMD, which moves the caveat out of the rule file into memory with a one-line pointer; cite Header Loads, Body Fires on Trigger.

Fan-out: each candidate skill's header read is an independent slice: one subagent per candidate (`goal-s1-d7-sub<k>`), located by a `codesearch` filename query, returns its header line and whether its trigger is named. Canary: a candidate whose header was not read means its slice did not run; a subagent that rewrites a skill file rather than reporting has gone off-task.

Nominations (set): {AGENTSMD}. Backreferences in from {}; out to {}.

Check each header against the trigger it claims to predict: a skill's description must name the condition that loads its body. Read each candidate's header lines with a located `Read`; locate candidates with `codesearch` `filename` over the skill directories. Where a body loaded on a condition the header never named, rewrite the header line to state the trigger. Backreference HEADERONLY to AGENTSMD ("the header does not predict the trigger") is taken when a rewrite would not fix the mismatch. Witness: an `instruction` dispatch whose prompt matches the rewritten trigger returns the skill among its hits, and the same prompt before the rewrite did not.

### AGENTSMD - AGENTS.md Hierarchical, Not Encyclopaedic

Handover: a byte-measured section that repeats a README passes to NODUPEDOC, which keeps one owning copy of each fact and replaces the rest with references; cite AGENTS.md Hierarchical, Not Encyclopaedic.

Fan-out: each AGENTS.md section's byte count is an independent slice: one subagent per section (`goal-s1-d7-sub<k>`) returns the count from a witnessed `exec_js`. Canary: a section with no byte count means its slice did not run; a subagent that writes AGENTS.md has gone off-task.

Nominations (set): {NODUPEDOC}. Backreferences in from {}; out to {}.

AGENTS.md holds rules the live tree cannot express, stated in the present tense, and points to everything else. Measure each section's byte count with a witnessed `exec_js` (a file read plus `Buffer.byteLength`), and keep the project's own stated size limit. A cross-cutting rule stays resident. A fact-base caveat that only matters when its topic is touched moves to a memory file, and its AGENTS.md paragraph becomes a one-line pointer in the same commit. A load-bearing rule lands in AGENTS.md. Backreference AGENTSMD to NODUPEDOC ("the file restates the README") is taken when a section repeats a README. Witness: the byte count before and after, and the memory file holding the moved fact, found through MEMORY.md.

### NODUPEDOC - Reference, Never Restate

Handover: the single owning copy of each fact passes to SUBAGENT, which takes independent slice searches into isolated contexts; cite Reference, Never Restate.

Fan-out: each fact's exhaustive literal search is an independent slice: one subagent per fact (`goal-s1-d7-sub<k>`) returns the owning-copy count and its `exhaustive` field. Canary: a fact whose search reports `exhaustive: false` was not closed; a subagent that edits the owning copy has gone off-task.

Nominations (set): {SUBAGENT}. Backreferences in from {}; out to {DRY}.

For each fact in the touched prose, find every file that states it: `codesearch` `literal` on the exact phrase, bounded with `path_glob` to the document types, checking `exhaustive`. Keep the one owning copy; replace every other copy with a reference to it. A duplicated fact that lives in code rather than prose takes the backreference NODUPEDOC to DRY ("two documents describe one fact"): the two representations merge behind one function. Witness: after the edit, the exhaustive literal search returns exactly one owning copy per fact.

### SUBAGENT - Subagent Context Isolation

Handover: each returned conclusion, located path and witness passes to COMPACT, which compacts only at a node boundary after open subgoals are written as rows; cite Subagent Context Isolation.

Fan-out: the subagents are the fan-out. Each independent slice runs with its own SESSION_ID (`<parent_session_id>-sub<k>`) and the opener routing code questions to `callers` and `impact` first, then `codesearch`. Canary: a slice with no returned reply did not run; a reply carrying raw output (backreference to OBSCOMPRESS) or a subagent reusing the parent's session id has gone off-task.

Nominations (set): {COMPACT}. Backreferences in from {CONTEXTROT}; out to {OBSCOMPRESS}.

Fan independent reads, searches and log reads out to subagents whenever the work decomposes into independent slices. Give each its own SESSION_ID and the opener that routes code questions to `callers` and `impact` first, then `codesearch`, permitting `Read` only on a located path. The return contract is a conclusion, the located paths and a witness, never raw output. A single focused edit stays in the parent. Backreference SUBAGENT to OBSCOMPRESS ("the subagent returned raw output") is taken when a reply arrives with raw output. Witness: the byte count of each returned payload, and each claimed path re-checked on the live tree before use.

### COMPACT - Node-Boundary Compaction

Handover: the compacted record of each node's subgoals passes to OBSCOMPRESS, which keeps exact strings a following step must match unchanged; cite Node-Boundary Compaction.

Fan-out: none. Compaction is one write over an ordered list of subgoal rows at a single node boundary, so it runs in one session. Canary: an open subgoal missing from `prd-list` after compaction means the record dropped it.

Nominations (set): {OBSCOMPRESS}. Backreferences in from {SMALLESTSET, MEMTOOL}; out to {}.

Compact at a node boundary: after the node's witness is recorded and before the next node's `instruction` is dispatched. Never compact mid-subgoal. Before compacting, write each open subgoal as a PRD row with `prd-add`, so the summary cannot drop it. Reactive compaction fires too late and periodic compaction cuts subgoals, so the boundary is the trigger. Backreference COMPACT to OBSCOMPRESS ("compaction cut an active subgoal") is taken when a subgoal is lost; SMALLESTSET to COMPACT ("context grew without new signal") when the window grows without a new witness. Witness: after compaction, `prd-list` shows every open subgoal as a row, and the next `instruction` call returns the node prose.

### OBSCOMPRESS - Observational Context Compression

Handover: the compact record of each dispatch passes to MEMTOOL, which writes the fact a resuming session needs and cannot re-derive; cite Observational Context Compression.

Fan-out: each dispatch's compact record is an independent slice: one subagent per dispatch (`goal-s1-d7-sub<k>`) builds it from the verb, exit state, witness line and byte count. Canary: a record whose literal match count differs from the stored count was not verified; a subagent that keeps raw output in its reply has gone off-task.

Nominations (set): {MEMTOOL}. Backreferences in from {SUBAGENT}; out to {GREPFIRST}.

Keep a dispatch's result as a compact record: verb, exit state, witness line and byte count. Raw output is not kept in the window. Strings a following step must match exactly (error text, paths, symbol names, test names) are copied into the record unchanged. When a following step cannot match a paraphrase, backreference OBSCOMPRESS to GREPFIRST ("an exact string was paraphrased away") is taken and the exact string is re-fetched with `codesearch` `literal`. Witness: a record reused by a following dispatch resolves against the live tree, and the literal search's match count equals the count the record stored.

### MEMTOOL - Server-Side Memory Across Sessions

Handover: the memory written for a resuming session passes to STABLEPREFIX, which keeps the invariant prefix fixed so the next dispatch can hit the cache; cite Server-Side Memory Across Sessions.

Fan-out: each memory's live-tree re-verification is an independent slice: one subagent per memory (`goal-s1-d7-sub<k>`) returns the located file, function or flag and its witness. Memory writes and deletes stay in the parent, its single writer. Canary: a memory returned without a located witness means its slice did not run; a subagent that writes or deletes memory has gone off-task.

Nominations (set): {STABLEPREFIX}. Backreferences in from {NAURTHEORY}; out to {COMPACT}.

A fact a resuming session needs that the live tree cannot supply is an unknown: save it as one flat file with frontmatter fields name, description and metadata.type (value unknown), and add one line to MEMORY.md pointing to it. Reading MEMORY.md opens leads only. Re-verify that the named file, function or flag still exists before acting on it. A stale, superseded or wrong memory is deleted on sight, with its MEMORY.md line. Backreference NAURTHEORY to MEMTOOL ("the theory died with the session") is taken when a theory exists only in the window. Witness: fs_stat on the new memory file succeeds and its MEMORY.md line names it; after a deletion, fs_stat fails and the line is gone.

### STABLEPREFIX - Stable Prefix for Cache Hits

Handover: the invariant prefix every dispatch carries first passes to TOOLBUDGET, which records each tool definition loaded but never dispatched; cite Stable Prefix for Cache Hits.

Fan-out: none. The check compares the prefix across two consecutive `instruction` responses, one pair in one session. Canary: a changed prefix with no edit to the prose means the comparison was not run on the matching pair.

Nominations (set): {TOOLBUDGET}. Backreferences in from {}; out to {}.

Content every dispatch carries first is invariant: instruction prose, tool definitions and the node's fixed constraints. Variable content (current prompt, located paths, witness) goes last. A prose file that mixes a per-task value into its invariant prefix is split so the prefix stays fixed. Backreference STABLEPREFIX to TOOLBUDGET ("the cache is missing") is taken when the prefix changes between dispatches with no edit to the prose. Witness: two consecutive `instruction` responses with a matching `known_instruction_hash` return `instruction_unchanged: true` and the short form.

### TOOLBUDGET - Tool and MCP Definition Overhead

Handover: the unused-definition row passes to GREPFIRST, which runs exact-string searches before any embedding retrieval; cite Tool and MCP Definition Overhead.

Fan-out: each loaded definition's live dispatch is an independent slice: one subagent per server or definition (`goal-s1-d7-sub<k>`) returns its normal reply or its failure. Canary: a definition counted as used with no live reply means its slice did not run; a subagent that edits the project configuration has gone off-task.

Nominations (set): {GREPFIRST}. Backreferences in from {}; out to {PROGDISC}.

List the tool and MCP definitions this session loads, and those this node's walk dispatches. A definition loaded and never dispatched costs every turn. Record the unused set as a PRD row naming each server or definition. The narrowing edit is made only to the project's own configuration. A server needed by one node alone loads at that node. Backreference TOOLBUDGET to PROGDISC ("tool definitions dominate the prompt") is taken when definitions outweigh the bodies the walk uses. Witness: the loaded definition count before and after, and a live dispatch to each remaining verb returning its normal reply.

### GREPFIRST - Exact-String Retrieval Before Embedding Retrieval

Handover: its exit is the backreference to SMALLESTSET (gm-config/fsm/graph.json GREPFIRST -> SMALLESTSET, backreference) by design, taken when a dual answer is the only answer; cite Exact-String Retrieval Before Embedding Retrieval.

Fan-out: each exact string's literal search is an independent slice: one subagent per string (`goal-s1-d7-sub<k>`) returns its match count and `exhaustive` field. Canary: a literal search with `exhaustive: false` was not closed and is not counted as complete; a subagent that falls back to `dual` for an exact string has gone off-task.

Nominations (set): none forward. Backreferences in from {OBSCOMPRESS}; out to {SMALLESTSET}.

Search an error string, path, symbol or test name first with `codesearch` `literal` or `regex`, which are exhaustive and return tree-order matches. Embedding retrieval (`dual`) is used only for a where-is-the-concept question with no exact string. An identifier-shaped token goes to `codesearch` symbol results; a phrase goes to `literal` first. Backreference GREPFIRST to SMALLESTSET ("retrieval returned approximate matches") is taken when a `dual` answer is the only answer, because an approximate hit returns the node to the context cut. Witness: the literal search's `exhaustive` field is `true`, and its match count is recorded with its query.

## Witness

The node closes when a sweep records no context-spend measure that rose per unit of change, so the backreference "context spend rose per unit of change" no longer fires. The witness is a measured quantity with the dispatch that measured it: bytes of instruction prose held before and after each cut, loaded tool definitions before and after, memories deleted, the `exhaustive` field of each search that closed a question, and the byte count of each subagent reply. A generic "verified", "context is lean" or "looks fine" is rejected. A memory is a lead until its premise is re-witnessed on the live tree.

## Memory

Save a memory only for an unknown a resuming session cannot re-derive cheaply, such as which search mode answered a class of question, or a subagent SESSION_ID pattern that held. Each memory is one flat file with frontmatter fields name, description and metadata.type (value unknown), and one line in MEMORY.md pointing to it. Corrections the user gave and the reason a memory was deleted are not saved. Nothing derivable from the live tree is saved (file paths, function names, code patterns, git history, document contents), because a stored derivable fact becomes a second source that drifts. Pruning is part of this node: a memory the live tree contradicts is deleted, with its MEMORY.md line, in the pass that found it.

## Transition

CONTEXT ECONOMY is entered and left by backreferences, because it applies at every node. The walk returns to the node whose work it measured with `transition to=<NODE>`, and the lean gates stay in force on that transition: `lean-one-task-in-flight`, `lean-contract-only-description`, `lean-verifier-independent`, `lean-net-negative` and `lean-contract-recorded`. Edges in: G_SWEEP to SMALLESTSET when context spend rose per unit of change, GREPFIRST to SMALLESTSET when retrieval returned approximate matches, TOOLBUDGET to PROGDISC, CTXEXPLODE to PROGDISC, NAURTHEORY to MEMTOOL, and REWORK to G_INDEP. Edges out: REWORK to G_INDEP ("iteration, not generation, spent the budget"), SMALLESTSET to COMPACT, PROGDISC to AGENTQA (the walk moves to G_INDEP), and the dotted edge from SMALLESTSET to G_START, which, when no backreference fires, closes the node at the start of a task so that one task is in flight. When a gate denies a transition, its `next_dispatch` names the recovery verb, usually `instruction`. Dispatch that verb next, never the denied transition again. A gate denying the same transition with the same content up to the repeat threshold (`gate_repeat_escalate_threshold`, default 3) escalates, and the walk stops retrying it blind.
