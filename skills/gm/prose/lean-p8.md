# LEAN TENSIONS

A concern of the method, not a pipeline stage: entered from whichever node reaches it, left once its ask holds. No concern gates entry to a set of nodes.

TENSIONS are the costs this method accepts on purpose: comments carrying what code cannot, tacit knowledge, consumers relying on behaviour nobody promised, evidence trails git must hold, the measured cost of agent-written code, descriptions drifting from the code, and whole-repository context. Each tension is a standing check, not a problem to solve. The node finds where a tension fired in the current artifact and converts it when the artifact allows, or takes a local exception and records its reason when it does not. Reversing the method to remove a tension is not an option. The exit condition: every fired tension is converted (a comment became code, a constraint became a recorded decision, a consumer's reliance became a promised contract, a second description was removed) or carries a recorded exception with its reason, and the sweep shows no tension firing without one of those outcomes.

Principles here are applied as work, from the lean method (AnEntrypoint/lean). Each principle's book and attribution is its H3 label, taken from gm-config/fsm/graph.json.

## Verbs

The comment sweep is a `grep` dispatch with `{"mode":"comments"}`, which walks comment spans without a pattern. Scope it with `path` or `path_glob` to the touched set. For an exact string such as a stale product name or a removed symbol, use `grep` with `output_mode:"content"`; `codesearch` `literal` does the same where the phrase is not a regular expression. Every search reports `exhaustive`, and a result with `exhaustive: false` is not the completion witness until its bound is re-run.

Use `callers {symbol}` for the consumers of a public symbol the artifact touches. Use `codeinsight {action:"outline", path}` or `{action:"find", symbol}` for a file or symbol overview. Read a file only at a located path. Witness a consumer's reliance on behaviour by running its real path with `exec_js`, never by reading the consumer and guessing.

Read history with `git_log` and `git_show`, passing `path` to scope `git_log` to the touched file. A reason that lives only in a commit message is read from that commit. Use `git_diff` with `stat:true` for the size of a change. For a documentation-only commit use `git_finalize {message, paths:[...]}`, or `git_commit` followed by `git_push`, so the commit stages only the documentation paths.

Record each open tension as an unknown with `unknown-add`, resolved with `unknown-resolve {unknown_id, witness_evidence}`. Record each newly spotted need with `prd-add`, closed with `prd-resolve {id, witness_evidence, witness_dispatch_id}`. Read the open set with `unknown-list` and `prd-list`. Before a transition, dispatch `node-status` to confirm the node and the pending count.

Nothing here dispatches native search or file-read tools, `find`, a shell `grep`, shell git or PowerShell. The verbs above are the only surfaces.

## PRD rows

Each comment that cannot become code, each documentation paragraph that disagrees with the code, each consumer relying on an unpromised behaviour, and each second description of a fact is a PRD row the moment it is spotted, added with `prd-add`. The row names the file and line, the tension it fired, and the witness that will close it. A need is either a row now or not a need.

A row or transition note here never carries deferral wording (no phrase pushing work to an unnamed time, another session or outside the scope) and no hedge. A row that cannot close this pass keeps its witness condition and reason inside the row and stays pending, never reworded to look finished.

## Mutables

A tension firing becomes an unknown. The backreference from the sweep into TENSIONS ("a tension fired") creates one with `unknown-add`. It names the artifact, the witness showing the firing (a `file:line` of the comment, a `callers` edge, a `codesearch` hit on the duplicated sentence), and the `obligation_kind` of the node that discharges it. This node owns no obligation kind, so the kind is the owner's: a rule the signature must carry takes `precondition`, a rule that moves into a type takes `type-shape`, and an observable behaviour a consumer depends on takes `postcondition`. Set `depends_on` where a conversion needs another unknown first, such as a rename that must land before the comment it replaces is deleted.

Sweep closure needs zero pending rows. Documentation and comment unknowns are resolved before the sweep ends; an open one keeps the sweep from closing. Two-pass rule: a tension unknown that survives two genuine resolution attempts is re-added as a new unknown naming the gap, and the reclassification routes the walk back to G_CONTRACT. A claim that a comment is redundant, or that a document is current, is a hypothesis until a live check confirms it.

## Principles

### OUSTERHOUTC - Comments Capture What Code Cannot - John Ousterhout

Handover: a comment span whose reason the code cannot express passes to NAURTHEORY, which records that theory sentence in memory or in the commit that changed the shape; cite Comments Capture What Code Cannot - John Ousterhout.

Fan-out: one subagent per touched path group, each with its own session id (goal-s1-d8-ousterhoutc-N), runs the `grep` `{"mode":"comments"}` sweep over its group and returns the classified spans. Groups are independent and run in parallel; the parent merges the lists. Canary: a touched path in no group's sweep is a slice that did not run; a subagent that edits code instead of classifying spans is off-task. Nominated destinations, as a set: {NAURTHEORY (forward), WHYNOTWHAT (backreference, the knowledge has no home in the code)}.

Run `grep` with `{"mode":"comments"}` over every touched path and the file set the change touched. Classify each comment span. A span that states what the code does is removed, and the code is changed to say it: a name made intention-revealing, a branch extracted into a named function, or a small type carrying the rule. A span holding a reason or constraint the code cannot express moves to AGENTS.md (first confirmed still relevant and factual against the live tree, with `callers` and a `fs_read` of the located path) or to the commit message that changes the code. Directive comments a tool reads are not comments and stay, because removing one changes behaviour: a shebang on line 1, `eslint-disable`, `oxlint-disable`, `@ts-expect-error`, `@ts-ignore`, `@vite-ignore`, coverage ignore markers, `prettier-ignore`, and a `SAFETY:` justification in Rust. When the touched set is large, spawn a subagent with its own SESSION_ID to run the sweep and return the classified list. The backreference OUSTERHOUTC to WHYNOTWHAT ("the knowledge has no home in the code") routes a reason to the commit record. Witness: the same `grep` comments call over the same paths returns only the directive residue, and each removed span has a named replacement (a renamed symbol, a `file:line` in AGENTS.md, or a commit sha).

### NAURTHEORY - Programming as Theory Building - Peter Naur

Handover: a theory sentence that governs an irreversible fork passes to TACIT, which turns the constraint into a signature or an ADR; cite Programming as Theory Building - Peter Naur.

Fan-out: one subagent per touched module, each with its own session id (goal-s1-d8-naur-N), finds that module's theory sentences and checks each against MEMORY.md. Modules are independent and run in parallel. Canary: a module with no slice report is a slice that did not run; a subagent that writes code instead of theory sentences is off-task. Nominated destinations, as a set: {TACIT (forward), MEMTOOL (backreference, the theory died with the session)}.

The team's theory of why the code is shaped this way must be written where a resuming session reads it. Find the theory sentences a resuming session would otherwise rebuild: why a boundary sits where it does, why a module owns a responsibility, why a rejected alternative was rejected. Write each sentence as the commit message of the change that made the shape. A theory that governs an irreversible fork moves to the ADR form (see TACIT). Verify each sentence with `git_log` on the touched path, and confirm the commit message carries it. The backreference NAURTHEORY to MEMTOOL ("the theory died with the session") is taken when a sentence exists only in the window. Witness: `git_log` on the touched path shows a commit whose message carries the same reason.

### TACIT - Tacit Knowledge Resists Specification

Handover: its exit is the backreference to ADRN (gm-config/fsm/graph.json TACIT -> ADRN, backreference) by design, taken for each irreversible fork found; cite Tacit Knowledge Resists Specification.

Fan-out: one subagent per candidate constraint, each with its own session id (goal-s1-d8-tacit-N), decides signature-or-ADR for that candidate. Candidates are independent and run in parallel. Canary: a candidate with no signature or ADR outcome is a slice that did not run; an ADR written for a reversible choice, or a subagent that edits unrelated code, is off-task. Standing tension: the exit is a backreference by design, so the nominated set is {ADRN (backreference)}, taken for each irreversible fork found.

Find constraints the code obeys and nothing states: a unit, an ordering, a naming convention, a value a consumer assumes. Ask of each candidate whether the type or signature can carry it. If it can, the constraint becomes a precondition in the signature, so the rule is enforced rather than remembered. If it cannot and the choice is an irreversible fork (a storage format, an API shape with consumers, a chosen dependency), it becomes an ADR in the ADR form, which states the decision, the alternatives and the reason, and is recorded as its own row. Ordinary reversible choices get no ADR. The backreference TACIT to ADRN ("the constraint was never stated anywhere") is taken for each irreversible fork found. Witness: the signature or the ADR exists on the live tree, read by a located `fs_read`, and `callers` shows the consumer that depends on the constraint.

### HYRUM - Hyrum's Law - Hyrum Wright

Handover: a consumer's reliance on an unpromised behaviour passes to REGEVIDENCE, which confirms the reason for that change is held in git; cite Hyrum's Law - Hyrum Wright.

Fan-out: one subagent per public symbol the artifact touches, each with its own session id (goal-s1-d8-hyrum-N), runs `callers` on the symbol and the consumer's real path with `exec_js` before and after the change. Symbols are independent and run in parallel. Canary: a symbol with no `callers` reply, or an `exec_js` output missing its before or after capture, is a slice that did not run; a subagent that edits the consumer instead of recording the comparison is off-task. Nominated destinations, as a set: {REGEVIDENCE (forward), CONTRACTTEST (backreference, an unpromised behaviour became a contract)}.

For each public symbol the artifact touches, `callers {symbol}` lists every consumer. A consumer relying on a behaviour the contract does not promise is found by running its real path with `exec_js` against the changed artifact and comparing the output with the output before the change. The reliance is then either promised, as a `postcondition` unknown that names the behaviour, or removed from the consumer by a row that changes the consumer. The backreference HYRUM to CONTRACTTEST ("an unpromised behaviour became a contract") routes the case to a consumer-driven contract test in the G_INDEP node. The backreference CONTRACTTEST to HYRUM ("a consumer broke on an unpromised behaviour") is the opposite entry. Witness: the `exec_js` output before and after the change, and the `callers` reply naming the consumer.

### REGEVIDENCE - Regulated Environments Need an Evidence Trail

Handover: each touched behaviour with its reason confirmed in git passes to MAINTCOST, which measures the diff stat and caller counts of that change; cite Regulated Environments Need an Evidence Trail.

Fan-out: one subagent per touched behaviour, each with its own session id (goal-s1-d8-regev-N), runs `git_log` with `path` and `git_show` on the commit that carries the reason. Behaviours are independent and run in parallel. Canary: a behaviour whose `git_log` reply is empty is a slice that did not run and raises an ADR row; a subagent that reads source in place of git history is off-task. Nominated destinations, as a set: {MAINTCOST (forward), ADRN (backreference, the audit needs an artifact git does not hold)}.

Where a change must answer who changed a behaviour, why, and what it was verified against, the answer must be an artifact git holds. The reason is in the commit message. The witness is in the PRD row's `witness_evidence`. The head sha that passed CI is recorded in the validation record. For each touched behaviour, `git_log` with `path` lists the commits that changed it, and `git_show` on the commit that carries the reason confirms the reason is present. Where the trail is missing, a row is raised to record the reason in an ADR. The backreference REGEVIDENCE to ADRN ("the audit needs an artifact git does not hold") is taken for each missing reason. Witness: `git_log` with the path returns the commit that carries the reason, and the reason text is in its message.

### MAINTCOST - Measured Maintenance Cost of Agent Code

Handover: the measured diff stat, caller counts and duplicate count, each with its sha, pass to DELETIONGATE, which takes the walk to superseded paths that remain reachable; cite Measured Maintenance Cost of Agent Code.

Fan-out: three independent measurements run as parallel subagents, each with its own session id (goal-s1-d8-maint-N): `git_diff {stat:true}`, `callers` counts per changed symbol, and the literal `codesearch` duplicate count on each documentation key sentence. Canary: a measurement missing from the record, or a figure with no sha, is a slice that did not run; a subagent that edits code instead of measuring is off-task. Nominated destinations, as a set: {DELETIONGATE (forward), G_NET (backreference, merged code costs more than it saved)}.

Measure the maintenance cost of the change; do not assume it. Record the lines added and removed with `git_diff {stat:true}`. Record the number of callers of each changed symbol with `callers`. Record each documentation paragraph that now states the change in more than one file with a literal `codesearch` on its key sentence. A change that adds more to maintain than it removed is routed to the net-negative gate G_NET, and the change either shrinks or states why it grew. The forward edge MAINTCOST to DELETIONGATE takes the walk to the superseded paths that remain reachable. Witness: the diff stat, the caller counts per symbol and the duplicate count, all with the sha they were measured at.

### SPECDRIFT - Silent Spec-Code Drift - Grabowski

Handover: the owning code for each drift claim passes to CTXEXPLODE, which scopes the sweep to the touched set and the located paths; cite Silent Spec-Code Drift - Grabowski.

Fan-out: one subagent per description document (README, AGENTS.md, docs/, the site source), each with its own session id (goal-s1-d8-drift-N), runs a literal `codesearch` for each claim's key term. Documents are independent and run in parallel. Canary: a document with no claim check is a slice that did not run; a subagent that edits generated output instead of its source is off-task. Nominated destinations, as a set: {CTXEXPLODE (forward), G_CONTRACT (backreference, two descriptions disagree)}.

The descriptions of the system are the README, AGENTS.md, the documentation under docs/, the site source, the types, the signatures, and the stated pre- and postconditions of the PRD rows. Check each claim in a document against the code. Take the claim's key term, run an exhaustive `codesearch` `literal` for it, and confirm the owning code is found with `exhaustive: true` and that the code does what the document says. A claim with no owning code, or code whose documented behaviour has changed, is drift and becomes an unknown. The owner is the code or the contract; the other description becomes a reference to it. Documentation follows the update rules: docs describe the present, so past-tense framing, FIXED markers and dated entries move out of AGENTS.md. The history goes to the CHANGELOG entry for the commit (subject plus one sentence of why), and the present rule stays. README.md is refreshed to the surface a new reader meets, with stale install steps and gone features removed. The generated site page is edited through its site source (the YAML content and the theme file), never the generated HTML; the generated stylesheet is edited through its generator's input, never the output. The backreference SPECDRIFT to G_CONTRACT ("two descriptions disagree") is taken for each drift that touches a contract, and G_CONTRACT back to SPECDRIFT ("a second durable description appeared") when a second description is found. The writing preferences in the update rules apply: the conclusion leads the paragraph, plain words are used, and each document has one purpose (Pyramid Principle, BLUF, Diataxis). Witness: each claim's literal search returns its owning code with `exhaustive: true`, and the document paragraph names that code's file.

### CTXEXPLODE - Context Explosion in Whole-Repo Reasoning - Grabowski

Handover: its exit is the backreference to PROGDISC (gm-config/fsm/graph.json CTXEXPLODE -> PROGDISC, backreference) by design, taken when a sweep cannot be scoped; cite Context Explosion in Whole-Repo Reasoning - Grabowski.

Fan-out: none. The touched set is one list computed once from `git_diff` plus the `callers` replies, and every search in the sweep depends on it, so no independent slice exists and the sweep runs single-session. Canary: a search in the sweep with no recorded path scope, or a `fs_read` outside the touched set plus the located paths, shows the scope was not held. Standing tension: the exit is a backreference by design, so the nominated set is {PROGDISC (backreference, the agent must read the whole repository)}, taken when a sweep cannot be scoped.

The comment sweep, documentation sweep and drift check are scoped to the touched set: the file list from `git_diff` plus the `callers` reply for each changed symbol. No search runs over the whole repository when a path is known. A question that truly needs the whole repository is answered by `codesearch` `dual` with a result cap `k`, and only the located paths it returns are read. The backreference CTXEXPLODE to PROGDISC ("the agent must read the whole repository") is taken when a sweep cannot be scoped. Witness: each search in the sweep records its path scope and its `exhaustive` value, and no `fs_read` in the sweep goes outside the touched set plus the located paths.

## Witness

The node closes when the tension sweep is clean. The witness is a measured residue, not a sentence. Record the `grep` comments count over the touched paths, which must equal the directive residue and nothing else. For each removed comment, record its replacement (the renamed symbol, the AGENTS.md line by `file:line`, or the commit sha). For each drift claim, record the literal search with its `exhaustive` value and the owning code's `file:line`. For each recorded exception, record the reason and the tension it accepts. A generic "docs are current", "comments are clean" or "verified" is rejected. A memory is a lead until the live tree confirms it.

## Memory

An accepted tension and its reason are recorded in the commit that accepts it, so a resuming session does not treat it as a new defect. Theory sentences of NAURTHEORY and the consumer reliance HYRUM found go into commit messages, not memory. A load-bearing AGENTS.md rule lands in AGENTS.md only. A memory whose named file or symbol no longer exists is deleted with its MEMORY.md line. Nothing is saved as memory from comment text, because a comment is removed or moved, not copied. Documentation paragraphs are not copied into memory either. The commit message states a reason, and the reason is referenced rather than restated.

## Transition

TENSIONS is entered from the sweep when a tension fires (G_SWEEP to OUSTERHOUTC, "a tension fired"), and from the principles that point into it: DEEPMOD to OUSTERHOUTC ("the interface needs prose to be usable"), CONTRACTTEST to HYRUM, CHARTEST to SPECDRIFT ("current behaviour is the only description left"), and G_CONTRACT to SPECDRIFT. Inside the node the forward edges are OUSTERHOUTC to NAURTHEORY to TACIT, HYRUM to REGEVIDENCE to MAINTCOST, and SPECDRIFT to CTXEXPLODE. The exits are OUSTERHOUTC to WHYNOTWHAT, NAURTHEORY to MEMTOOL, TACIT to ADRN, HYRUM to CONTRACTTEST, REGEVIDENCE to ADRN, MAINTCOST to G_NET, SPECDRIFT to G_CONTRACT, and CTXEXPLODE to PROGDISC in CONTEXT ECONOMY. When the tensions are converted or excepted and their unknowns resolved, the walk returns to the sweep with `transition to=G_SWEEP`. The documentation commit is made before that transition. It stages only the documentation paths (AGENTS.md and its host import file, README.md, SKILLS.md, CHANGELOG.md, LICENSE files, docs/**, site/**), is a commit of its own, and any path outside that set is split into its own node commit first. Push with `git_finalize` or `git_push`, never a raw git shell body. When a gate denies a transition, its `next_dispatch` names the recovery verb. Dispatch that verb next, and never the denied transition again. The repeated-denial escalation (`gate_repeat_escalate_threshold`, default 3) stops a blind retry.
