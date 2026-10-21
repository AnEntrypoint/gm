# LEAN PRESSURE

A method concern, not a pipeline stage: entered from any node that reaches it, left once its ask holds. No concern gates entry to a node.

PRESSURE removes what the change did not need. It finds every superseded path, fallback, duplicate, dead function and unreachable entry point the change left behind, and deletes each one only after callers, codesearch and a build check prove nothing still depends on it, keeping the diff net-negative or recording why not. Exit: the deletion-completeness check and reachability analysis pass for every removed or superseded symbol, the diff budget holds, and transition to=ADRN is dispatched.

Principles are applied as work, from the lean method (AnEntrypoint/lean). Each heading's label is its attribution in gm-config/fsm/graph.json.

## Verbs

Enter from G_INDEP through gate G_NET (predicate lean-net-negative), once that gate has passed; the walk then sits at state NODELETE, the node's first node in gm-config/fsm/graph.json. Read the size with git_diff {"stat":true}, then each file with git_diff {"path":"<file>"}, so every added line traces to a row. git_log {"path":"<file>","limit":20} shows churn on each touched file.

For each symbol the change removed or left beside its replacement, prove removal with three checks: callers {"symbol":"<name>","limit":50} returns no edges; codesearch {"query":"<name>","mode":"literal","root":"<absolute project root>"} returns no hit outside history; codeinsight {"action":"orphans"} does not list it. For each removed file, codesearch {"query":"<file path>","mode":"filename","root":"<absolute project root>"} returns no hit.

Fallbacks and duplicates: codesearch regex over the changed paths, matching unwrap_or, or_else, fallback, default and catch blocks that return a value. Near-duplicates: codesearch {"query":"<signature words>","mode":"dual","root":"<absolute project root>"}; a candidate pair is confirmed by one exec_js probe calling both on the same inputs and printing both outputs.

Reachability: impact {"symbol":"<entry name>","max_depth":6,"direction":"callees"} for each entry point the change touches: the gm verb handler in the dispatch table, the CLI main, or the exported function a consumer calls.

A deletion: fs_read {"path":"<file>","offset":<line>,"limit":<count>} reads the exact span, then fs_write {"path":"<file>","content":"<whole file with the span removed>"}. fs_write takes the whole file, so read the complete file first. Each deletion is verified by exec_js running the build check through execFileSync: cargo check for the crate or node --check for the file, with timeoutMs of at least 120000 for a Rust crate. git_status and git_diff {"stat":true} follow each deletion for the net count and any dirty file. Git runs only through git_* verbs, never a Bash or PowerShell tool call.

Re-dispatch instruction between deletions, after a failed build check, and whenever a removed symbol turns out to have a caller: deletion order matters and this node drifts easily.

## PRD rows

A superseded path, fallback, duplicate or dead symbol becomes a row the moment it is spotted: prd-add {"id":"<kebab-case-slug>","subject":"<the symbol or path and what replaces it>"}. Each removal closes with prd-resolve {"id":"<row id>","witness_evidence":"<zero-hit codesearch reply and build output for that symbol>","witness_dispatch_id":"<dispatch id of your live run>"}. Identical witness text across rows is refused, so each row cites its own zero-hit reply.

A removal not yet provably safe is a row whose subject is the proof it needs, such as "prove the legacy parser has no callers in the crates outside the workspace", run with codesearch against the other root. A row is never closed by reasoning that a symbol looks unused.

Never write deferral wording into a row or transition note: wording that moves a removal to another time, session, person or a scope exclusion is not admitted. A superseded path is removed in this change, or it is a row that stays open until its removal proof exists.

## Mutables

PRESSURE owns no obligation kind. A mutable is created only when a removal reveals an unknown a previous node must answer, such as an unproven caller in another repository: mutable-add {"id":"<kebab-case-slug>","value":"<the unknown>","depends_on":["<ids>"]}, with no obligation_kind, resolved by mutable-resolve {"mutable_id":"<id>","witness_evidence":"<codesearch hit or zero-hit reply>"}.

## Principles

### NODELETE - Agents Avoid Deleting Code - Ebrahimi et al.

Handover: every path the diff replaced is removed in this change, so the only fallbacks left for GUARDANDGO to classify are those the diff added beside a live path; cite Agents Avoid Deleting Code - Ebrahimi et al.

Fan-out: one subagent per function or branch the diff left in place runs callers on its symbol and searches for call sites of its replacement, each with its own session id (`<parent>-<symbol>`); slices are independent because each covers one symbol. Canary: a slice that returns no callers reply for its symbol did not run; a subagent that edits any file outside its symbol did off-task work.

Nominates: {GUARDANDGO}. Backreference: {DELETIONGATE}.

Agents add a new path beside an old one far more often than they remove the old one. Follow every replacement in the diff with a search for the path it replaced. List each function or branch whose body the diff left in place, run callers on it, and remove the old path in the same change once its callers point at the replacement. A call site still pointing at the old path is a row: repoint it, then remove the path. An old path surviving beside the new one fires the backreference to DELETIONGATE.

### GUARDANDGO - Guard-and-Go Fallback Accumulation - Vector Labs

Handover: the fallbacks that survive classification are the only remaining guards, so TYPE4 looks for clones only among the code paths those kept fallbacks add; cite Guard-and-Go Fallback Accumulation - Vector Labs.

Fan-out: one subagent per changed file runs the codesearch regex for fallback forms and classifies each hit, each with its own session id (`<parent>-<file>`); files are independent. Canary: a fallback hit with no classification row means its slice did not run; a subagent that edits code instead of classifying did off-task work.

Nominates: {TYPE4}. Backreference: {DELETIONGATE}.

Agents add a fallback whenever a guard fails, so codesearch regex lists every fallback the diff added, and each is classified. A fallback returning a named, correct behaviour for a condition the contract allows is kept and cited in its row. A fallback returning a plausible default for a violated precondition, or existing only because the primary path was not fixed, is removed and the primary path fixed in its place. A fallback beside a path that still exists is removed with that path under DELETIONGATE.

### TYPE4 - Type-4 Semantic Clones in Agent Pull Requests

Handover: each clone pair merged here leaves one surviving function per contract, so CHURN measures the churn and repeated blocks that remain in the touched files; cite Type-4 Semantic Clones in Agent Pull Requests.

Fan-out: one subagent per new function runs codesearch dual on its signature words and the exec_js probe on each candidate pair, each with its own session id (`<parent>-<function>`); functions are independent. Canary: a candidate pair with no probe output did not run; a merge decided on fewer inputs than the probe generated, or a subagent that merged without printing both outputs, did off-task work.

Nominates: {CHURN}. Backreference: {DRY}.

Two functions with different text and the same contract are clones. For each new function, codesearch dual on its signature words finds candidates with the same input and output types. An exec_js probe calls each pair on the same generated inputs and prints both outputs. A pair that agrees on every input is merged: the survivor keeps the behaviour, and the other is removed with its callers repointed. Two functions that mean the same thing fire the backreference to DRY, and the shared behaviour is written once in the module that owns the concept.

### CHURN - Rising Churn and Duplication - Harding and Kloster, GitClear

Handover: each block consolidated for churn now lives in one place, so SLOPDRIFT re-runs the invariant against the consolidated behaviour rather than the pre-merge one; cite Rising Churn and Duplication - Harding and Kloster, GitClear.

Fan-out: one subagent per touched file runs git_log with limit 20 and codesearch literal on each distinctive line of its new blocks, each with its own session id (`<parent>-<file>`); files are independent. Canary: a touched file with no git_log reply did not run; a subagent that consolidates code outside its own file did off-task work.

Nominates: {SLOPDRIFT}. Backreference: {G_NET}.

Churn comes from git_log {"path":"<file>","limit":20} on each touched file. Duplication comes from codesearch literal on the distinctive lines of each new block, listing every place the block now appears. A block in more than one place, or a region rewritten by several recent commits, is consolidated in this change, and the consolidation is a row. A diff that is net-positive again after consolidation fires the backreference to G_NET, and the diff is shrunk until the net count passes.

### SLOPDRIFT - Behavioural Drift over Long Trajectories - Orlanski et al.

Handover: behaviour re-witnessed after the last edits is the baseline DELETIONGATE proves removals against, so the zero-hit and build checks run on drift-free code; cite Behavioural Drift over Long Trajectories - Orlanski et al.

Fan-out: two subagents run in parallel, one re-running the stateful invariant command and one re-running the red-capable command, each through exec_js with its own session id (`<parent>-invariant`, `<parent>-redcap`); the two commands are independent. Canary: a comparison missing either output did not run; a subagent that changes code instead of re-running its command did off-task work.

Nominates: {DELETIONGATE}. Backreference: {INVARIANTRUN}.

Behaviour drifts across many small edits. Before the last round of PRESSURE edits, re-run the stateful invariant command and the red-capable command from G_INDEP through exec_js, and compare the output with the output recorded in the rows. Each difference the diff did not intend is a drift finding: it fires the backreference to INVARIANTRUN, and the invariant is re-witnessed against the new behaviour before it is accepted.

### DELETIONGATE - Deletion-Completeness Check

Handover: each removed symbol and file has zero hits and a passing build, so REACHABLE only has to confirm that no surviving entry point still reaches a superseded node; cite Deletion-Completeness Check.

Fan-out: one subagent per removed symbol and one per removed file runs its zero-hit codesearch, callers and build check, each with its own session id (`<parent>-<item>`); items are independent. Canary: a row with no zero-hit count did not run; a subagent that removes an item not on its list did off-task work.

Nominates: {REACHABLE}. Backreference: {REACHABLE}.

A deletion is complete only when every reference is gone. For each removed symbol: codesearch literal on its name returns zero hits outside history, callers returns no edges, and the build check passes. For each removed file: codesearch filename on its path returns zero hits, and the build check passes. The row quotes the zero-hit count and the build output. Superseded code still reachable from an entry point fires the backreference to REACHABLE, and the reachable chain is cut at the superseded node.

### DIFFBUDGET - Net-Negative Diff Target

Handover: the net line count is witnessed and each remaining addition is justified by its row, so CONVCOM commits a diff whose growth, if any, is already explained; cite Net-Negative Diff Target.

Fan-out: one subagent per touched file runs git_diff with its path and matches each addition to a row, each with its own session id (`<parent>-<file>`); files are independent. Canary: a file with additions and no row did not get checked; a subagent that reports a total without its per-file match did off-task work.

Nominates: {CONVCOM}. Backreference: {DELETIONGATE}.

The change is net-negative when added lines are at most removed lines in git_diff {"stat":true}. Where a change adds lines, each file's additions must trace to a row stating why those lines are the minimum the contract needs; growth with no row is removed. G_NET applies this at the boundary into G_NET, and the agent applies it again before RECORD, since the sweep re-checks it at G_SWEEP. Growth fires the backreference from G_NET to DIFFBUDGET. An entry point with no caller fires the backreference from REACHABLE to DIFFBUDGET, and that entry point is given its caller or removed under DELETIONGATE.

### REACHABLE - Reachability Analysis

Handover: every new symbol is confirmed reachable from an entry point or deleted, so DIFFBUDGET counts only code an entry point actually calls; cite Reachability Analysis.

Fan-out: one subagent per entry point runs impact with max_depth 6 and direction callees, each with its own session id (`<parent>-<entry>`); entry points are independent. Canary: an entry point with no impact reply did not run; a subagent that reports a symbol missing from a tree without quoting that tree did off-task work.

Nominates: {DIFFBUDGET}. Backreference: {DELETIONGATE}.

Every new function must be reached from an entry point the system calls. Run impact {"symbol":"<entry>","max_depth":6,"direction":"callees"} for each entry point the change touches; each new symbol must appear in one returned tree. A new symbol that appears in none is dead and is removed. A removed symbol still present in a tree is the DELETIONGATE case: its caller is repointed, or the symbol is deleted with its caller.

### TARPIT - Out of the Tar Pit - Moseley and Marks

Handover: each piece of state is classified essential or accidental with one writer per surface, so LEANSW checks added lines against the stated conditions of that settled state; cite Out of the Tar Pit - Moseley and Marks.

Fan-out: one subagent per piece of state the change adds or touches runs codesearch literal on its name to count writers and classifies it, each with its own session id (`<parent>-<state>`); pieces are independent. Canary: a state with two writers and no classification did not run; a subagent that changes state rather than classifying it did off-task work.

Nominates: {LEANSW}. Backreference: {ILLEGAL}.

Classify every piece of mutable state the change adds or touches as essential or accidental. State derivable from other state is accidental and is removed; its readers compute the value from the source. Essential state is kept in one place with one writer per surface, confirmed by codesearch literal on the state's name, which must show one writer. State accidental because the type does not express the invariant fires the backreference to ILLEGAL, which returns the chain to G_CONTRACT.

### LEANSW - A Plea for Lean Software - Niklaus Wirth

Handover: every added line that serves no stated condition is removed, so KOLMOGOROV measures the description of each file that remains; cite A Plea for Lean Software - Niklaus Wirth.

Fan-out: one subagent per touched file runs git_diff with its path and checks each added line against the conditions of its row, each with its own session id (`<parent>-<file>`); files are independent. Canary: an added line kept with no stated condition did not get checked; a subagent that edits a file rather than checking it did off-task work.

Nominates: {KOLMOGOROV}. Backreference: {KOLMOGOROV}.

Each file's growth must be explained by a row. Read git_diff {"path":"<file>"} for each touched file and check each added line against the stated pre and post conditions of its row. A line serving no stated condition is removed. A file that grew with no row reason fires the backreference to KOLMOGOROV.

### KOLMOGOROV - Kolmogorov Complexity - Kolmogorov and Chaitin

Handover: each module's one-sentence description has been compressed to its distinct facts, so PARNAS checks that the surviving module's interface still hides its internals; cite Kolmogorov Complexity - Kolmogorov and Chaitin.

Fan-out: one subagent per new module writes its one-sentence description and counts its distinct facts, each with its own session id (`<parent>-<module>`); modules are independent. Canary: a module whose description matches its neighbour's did not get merged or split; a subagent that edits module code instead of describing it did off-task work.

Nominates: {PARNAS}. Backreference: {DEEPMOD}.

The shortest description of a module measures its size. For each new module or file, write a one-sentence description and count the distinct facts it must state. If the description needs more words than the content has distinct facts, compress the content: merge repeated logic, and merge a module whose description matches its neighbour's into it. A description that exceeds its content fires the backreference to DEEPMOD, and the module is restructured into a deeper module with a narrower interface, a CONTRACT change.

## Witness

A removal is witnessed by a zero-hit reply and a build check. A size claim is witnessed by a git_diff stat reply. The reply must show the zero count, the caller list or the build output; "removed", "unused" and "clean" are rejected as witnesses.

- Deletion of a symbol: codesearch literal returns zero hits outside history, callers returns no edges, the build check passes. The row quotes the count and the build output line.
- Deletion of a file: codesearch filename returns zero hits, the build check passes.
- Reachability: impact on each entry point lists every new symbol in its tree. A symbol missing from every tree is deleted, and the row quotes the tree checked.
- Duplicates: exec_js prints both outputs for the same inputs, and the row quotes the agreeing outputs.
- Net size: git_diff {"stat":true} after the last edit gives the added and removed counts, quoted in the transition note.
- Drift: exec_js prints the re-run invariant output beside the recorded output, and the row quotes the match or the intended difference.

The last witness before the transition is a build check of the whole crate or package the change touched, run through exec_js with execFileSync, so a deletion that broke an unrelated caller is found here and not in CI.

## Memory

Save a memory only for an unknown: the recurring cause of dead code. When a deletion reveals a pattern that will recur, such as a module whose every change leaves a superseded path behind, save it once the check that catches the pattern is confirmed, as one flat file with frontmatter fields name, description and metadata.type (value unknown), and add one line to MEMORY.md that points to it. A memory that says a path is in use, when the zero-hit check proves it gone, is deleted with its MEMORY.md line.

Deleted symbol and file lists live in the commit and the rows. Diff stats live in git. Zero-hit replies live in the rows that cite them. None of them is saved as a memory.

## Transition

The node is entered from G_INDEP through G_NET, the gate for "change closes net-negative, or states why not". Its predicate lean-net-negative is blocking: it passes only when added lines in the working diff against HEAD are at most the removed lines. Enter the walk at state NODELETE only after the G_NET gate passes. A denial names next_dispatch: dispatch it, which removes superseded or duplicated code in this change, then re-dispatch the G_NET transition. The predicate reads no growth reason, so the denial clears by shrinking the diff, not by describing it.

The exit is DIFFBUDGET to CONVCOM, a forward edge with no gate. Dispatch transition {"to":"ADRN"} once every removal has its zero-hit or reachability witness and the net count passes. The gate lean-contract-recorded is checked at the next boundary, in ADRN, where it refuses until every PRD row is closed and the worktree is clean.

Feedback routes each discovery to the earliest node able to fix it. A net-positive diff that removals cannot shrink returns to G_NET and BUILD, because the grown code must be rebuilt in a smaller shape. A superseded path still reachable is cut under DELETIONGATE here. A new symbol with no entry point is removed here. An accidental state caused by a type that does not express its invariant returns to G_CONTRACT through ILLEGAL. A description that exceeds its content returns to G_CONTRACT through DEEPMOD. Duplicate behaviour is merged in TOTALITY through DRY. A drift finding returns to G_INDEP through INVARIANTRUN, because behaviour is re-witnessed there rather than accepted here.

A gate denial is never retried blind: dispatch the next_dispatch verb the denial names, then re-dispatch the transition. An identical denial repeated three times is escalated by the repeat threshold, and the escalation is read before any further dispatch.
