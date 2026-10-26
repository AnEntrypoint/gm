# LEAN VERIFY

This is a concern of the method, not a stage of a pipeline: it is entered from whichever node the work reaches it from, and left as soon as what it asks for holds. No concern gates entry to a set of nodes.

VERIFY attacks the built change with a verifier that has not read the implementation. It finds every way the change is false by live execution against real inputs, and discharges every SEC and RES obligation with a witness that names the kind discharged. The node exits when the eight adversarial classes each have a live witness, every SEC and RES unknown is resolved, a multi-file diff has an independent review witness, the sanitizer gate is clean, and transition to=G_NET is dispatched.

Principles in this node are applied as work, from the lean method (AnEntrypoint/lean). Each principle's attribution is the label used in gm-config/fsm/graph.json, given in its heading below.

## Verbs

Run codeinsight_index {} on a fresh checkout first; an empty call-graph reply proves nothing until the index reports complete. Read the change with git_diff {"stat":true} for the file list, git_diff {"path":"<file>"} per file, and codeinsight {"action":"outline","path":"<file>"} for each file's symbols.

For each function the diff changes, renames or removes, dispatch callers {"symbol":"<name>","limit":50} and impact {"symbol":"<name>","max_depth":3,"direction":"callers"}. Every caller outside the diff is a site the adversarial sweep must exercise. An empty callers reply is confirmed by codesearch {"query":"<name>","mode":"literal","root":"<absolute project root>"}, which is exhaustive.

Shape sweeps use codesearch {"query":"<regex>","mode":"regex","root":"<absolute project root>","path_glob":"**/*.{rs,js,ts,py,md,toml,json,yml}"} for secret shapes, injection sinks and panic sites. Comment spans are swept with the gm verb grep and body {"mode":"comments"}. Mode dual is ranked and cut, so it answers "where is the code that does X" only, never an exhaustive question.

Every live witness is an exec_js dispatch: raw_body is the Node source, and the limit is the typed timeoutMs field, never a header line in the body. The source runs real commands through require("node:child_process").execFileSync(command, args, { encoding: "utf8" }) and prints what it observed. Build checks use the project's own tools, such as execFileSync("cargo", ["check", "-p", "<crate>"]) or execFileSync("node", ["--check", "<file>"]). Never use a host shell call (bash or PowerShell) for a build, subprocess or process check, and run git only through git_* verbs.

Dispatch the eight adversarial classes one at a time, each as its own exec_js probe, reading each reply before the next. Re-dispatch instruction between unknown resolutions, after a failed exec retry, and whenever an error is unfamiliar.

For a multi-file diff, dispatch independent reviewers as subagents. A reviewer gets the file list, the PRD rows and the changed signatures, never the implementer's reasoning. Its prompt opens with "use the gm skill for this; code questions go to codeinsight (callers/impact) first, then codesearch, and fs_read only a located path", carries its own SESSION_ID built from the parent id plus an index (for example "<parent_session_id>-sub1"), and says "assume this is broken, find why".

Rows and unknowns: prd-add {"id":"<kebab-case-slug>","subject":"<what it proves or repairs>"}, prd-resolve {"id":"<row id>","witness_evidence":"<file:line or exec output>","witness_dispatch_id":"<dispatch id of your live run>"}, unknown-add {"id":"<kebab-case-slug>","value":"<the unknown>","obligation_kind":"<kind>","depends_on":["<id>"]} and unknown-resolve {"unknown_id":"<id>","witness_evidence":"<witness>"}.

## PRD rows

Each need becomes a row the moment it is spotted, with prd-add, before the next probe runs. A failing adversarial class becomes a row naming the class and its repair. A reviewer's real finding becomes a row citing its file and line. A tool that cannot reach its witness becomes a row whose subject is making that tool reachable, because a missing witness channel is a build task. A row that looks out of reach is a row to build a way in: drive the crashing tool's protocol directly, spawn a second instance, or script the credential path.

No deferral wording goes into a row or transition note. Wording that moves a need to another time, another session, another person or a scope exclusion is not admitted. A need is a row now or it is not a need. Each row's witness_evidence is specific to that row; identical witness text across rows is refused.

## Mutables

Every SEC and RES obligation is added as an unknown when found, with obligation_kind set to exactly one of: secrets, injection, identity-authority, message-timing (SEC), or exception-model, partial-failure, degradation, crucible (RES). depends_on names every unknown whose proof needs another resolved first; a message-timing proof depends on the identity-authority proof that names who may send the message.

unknown-add refuses a depends_on that closes a cycle and names the cycle path. unknown-resolve refuses while a depends_on id is pending and names it; resolve dependencies first, in order, never around them. The gates sec-obligations-ready and res-obligations-ready refuse on any untyped or blocked pending kind of their family and name the offender.

Each resolution's witness names the kind discharged and how. After two genuine failed attempts on one unknown, stop repeating the approach: add a fresh unknown with a new id and a narrower scope that states what the failures revealed, and transition to=EARS if that reshapes the plan. Closure requires mutables-all-resolved, so a pending unknown of any kind blocks it, including kinds owned by other nodes.

## Security obligations

Secrets: the diff gate catches the common literal shapes. The sweep also covers lower-entropy values in configuration, prose and fixtures, and any secret reachable through a committed path. Every secret arrives through an environment variable or a secret store. Witness: exec_js sets a marker in the environment, runs the reading path, and prints the file and line the value came from.

Injection: walk every untrusted source (request body, command argument, file content, environment variable, network response) to its sink: shell, query, eval, template or path join. Each one is parameterized or escaped, never interpolated. Witness: exec_js sends quote characters, separators and path traversal in plain, percent-encoded and Unicode forms, and prints the argument the sink received.

Identity and authority: every request is authenticated, and every action is authorized at the boundary that performs it. Trust from caller position, or a check made elsewhere, is refused. A check fails closed on any input it does not positively recognize.

Message and timing: a message delivered twice converges to one applied effect. A reordered or truncated message is applied or rejected by name, with no partial state. A secret comparison has no early exit and no secret-dependent branch. Witness: exec_js delivers each case and prints the state after each one.

## Resilience obligations

Exception model: every error lands in exactly one place, handled at a boundary that can name its cause or propagated with its context intact. A default returned under a violated precondition is refused, because a plausible wrong value is worse than a crash. A precondition violation halts with the exact state. Witness: codesearch literal and regex hits for unwrap, expect, panic, throw and unhandled rejection, each classified, plus an exec_js run that triggers the violation and prints the halt.

Partial failure: each multi-step write is atomic or recoverable by staging then rename, append-only replay, or idempotent re-entry. A retry after a cut converges rather than doubling the effect. Witness: exec_js kills the process between steps and cuts the connection mid-write, then prints the end state after recovery.

Degradation: under overload the boundary sheds, queues, or drops to a named reduced behavior. Every wait has a timeout, every retry a cap and every queue a bound, written in the code. Optimize the worst case a user sees, not the mean a benchmark reports.

Crucible: drive maximum load, degenerate input and resource exhaustion, with at least one hundred thousand iterations and memory and open handles counted before and after. Each boundary is pass or found-and-fixed in the same turn, and a fix reruns the same probe.

## Principles

### DIJKSTRATEST - Testing Shows Presence, Never Absence - Edsger Dijkstra

Handover: Presence witnessed on real inputs is handed to ORACLEBIAS so the probe expected values are checked against the contract rather than the code; nominated next node: ORACLEBIAS; cite Testing Shows Presence, Never Absence - Edsger Dijkstra.

Before claiming correctness, the agent names the one red-capable command that drives the reported behaviour on the real surface, runs it, and records the output. A pass is recorded as presence of the behaviour on that input. Each absence claim (no panic, no leak, no injection, no duplicate effect) moves into the adversarial classes or the SEC and RES sweeps, where it is witnessed on inputs that could falsify it.

No standing test file is introduced. no-synthetic-test-files is diff-scoped as predicates.md:19 defines it: it is true when the working diff introduces no standing test file (*.test.*, *.spec.*, or a test, tests or __tests__ directory). A test file this walk created is deleted: untracked or staged as a new file now, and absent from both `git ls-files` and the untracked set recorded at session start. Its assertions become an uncommitted exec_js probe against the real boundary that prints observed values. A tracked test file, such as `gm-mcp/test/*`, is never deleted or edited by this rule: leave it byte-identical and report it as tracked.

### ORACLEBIAS - Implementation-Biased Test Generation - LLM test-generation study

Handover: Expected values derived from contracts are handed to INDEPVER so a verifier that never read the body re-derives them. cite Implementation-Biased Test Generation - LLM test-generation study.

Every probe's expected value comes from the row's pre and post conditions and the signature, never from the function body. The agent writes each expected value beside the contract clause it came from. A value copied from the code it checks is discarded and re-derived by a verifier that has not read the body. When an assertion mirrors the code, the backreference to G_INDEP fires: re-enter the gate with a fresh verifier whose SESSION_ID has never been used in this chain.

### INDEPVER - Independence-Based Verification - Grabowski

Handover: The independent verifier's probes are handed to ADVERSARIAL so a red reviewer tries to refute the change. cite Independence-Based Verification - Grabowski.

The verifier is a separate agent with its own SESSION_ID. It receives the contract (rows, signatures, types, stated invariants) and the exec_js commands the node will run, and nothing from the implementer's transcript. Its report lists each probe with the exact command and output. The implementer never writes the verifier's probes or edits its report. When the two turn out to share context, the backreference to ADVERSARIAL fires and a second independent agent re-runs the findings before any is accepted.

### ADVERSARIAL - Adversarial Red-Blue Agent Verification - Thukkaram

Handover: Red findings with live witnesses are handed to HUGHES so pure functions get generated-input property checks. cite Adversarial Red-Blue Agent Verification - Thukkaram.

The red side has one brief: refute the change. Each red finding cites a file:line and an exec_js command that reproduces it. The blue side is the implementer, which answers each finding with a live exec_js witness of the fixed behaviour, never an argument. A finding closes only when the blue witness re-runs the reproducing command. For a multi-file diff, at least one red reviewer independent of the implementer runs, and its reply names the classes it swept. A single-file diff may stay self-reviewed, but all eight classes still run live.

The eight classes, each one exec_js probe: empty, overflow and reentrant input (zero-length, maximum-size, the same operation in flight); concurrency and races (two writers on one surface, interleaving, check-then-act windows where the operation must be atomic); partial failure (kill mid-operation, half-applied multi-step write, IO or network cut mid-call); degenerate input (null, undefined, wrong type, malformed encoding, boundary-adjacent invalid values); boundary conditions (off by one, exact limits 0, 1, max and max+1, first and last element); injection (untrusted input reaching a shell, query, eval, template or path join unescaped); resource exhaustion (unbounded loops or recursion, unclosed handles, memory growth under repeated calls); adjacent-row interaction (the change breaks an invariant a landed sibling row relies on, exercised through that sibling's callers).

### HUGHES - QuickCheck Property-Based Testing - Claessen and Hughes

Handover: Property results on pure functions are handed to PBTAGENT so candidate properties are admitted only from the contract. cite QuickCheck Property-Based Testing - Claessen and Hughes.

For each pure function the diff adds or changes, one exec_js script generates inputs from a seeded pseudo-random generator, runs at least one thousand cases, and on the first falsified case runs a shrink pass that reduces the input to a minimal counterexample, then prints that minimal case in full. Properties come from the contract: round trips where an inverse exists, idempotence where a row states it, invariant preservation over outputs, totality over the stated domain. A falsified property fires the backreference to ILLEGAL: transition to=G_CONTRACT, because the type cannot express the rule.

### PBTAGENT - Agentic Property-Based Testing - Hypothesis agent study

Handover: Admitted agent-proposed properties are handed to INVARIANTRUN so stateful modules are checked over random call sequences. cite Agentic Property-Based Testing - Hypothesis agent study.

The agent proposes candidate properties from the PRD rows and admits only those statable from the contract alone. A candidate derivable from the function body is rejected, and the rejection with its reason goes into the row's witness text. Admitted properties run through the HUGHES probe. A property that restates the code fires the backreference to METAMORPH, and the agent states a relation between outputs instead.

### INVARIANTRUN - Stateful Invariant Runs over Random Call Sequences - Foundry and Hypothesis

Handover: Invariant results over call sequences are handed to METAMORPH so outputs without an oracle are checked by stated relations. cite Stateful Invariant Runs over Random Call Sequences - Foundry and Hypothesis.

For each stateful module the diff touches, one exec_js script drives the real module through at least two hundred seeded sequences of at most fifty calls, checks the stated invariant after every step, and prints the shortest failing sequence with the state before and after the failing call. A module with no stated invariant gets a row before it is probed. A broken invariant fires the backreference to DBC: transition to=G_CONTRACT, state the rule as a signature precondition, and re-run the sequences.

### METAMORPH - Metamorphic Testing - T. Y. Chen

Handover: Relations that hold between outputs are handed to FUZZ so parsers and decoders are fed malformed input. cite Metamorphic Testing - T. Y. Chen.

Where a function has no oracle for its direct output, the agent states a relation the contract guarantees: a permuted input leaves an order-free result unchanged, doubling an input doubles a size, applying the operation twice is the identity, a filter before and after a map agree. Both sides run live in one exec_js script, and both outputs and the comparison are printed. When no relation can be stated, the backreference to LLMJUDGE fires.

### FUZZ - Coverage-Guided Fuzzing - Michal Zalewski

Handover: Malformed-input results from parsers are handed to CONTRACTTEST so each consumer of the changed surface is exercised the way it calls it. cite Coverage-Guided Fuzzing - Michal Zalewski.

Every parser, decoder or input adapter the diff touches is fed malformed bytes, truncated input, invalid UTF-8, length prefixes larger than the buffer, deep nesting and repeated delimiters. The input grows step by step until new branches stop appearing, and the reached branches are recorded. Each malformed input must return a named error; a crash, a hang past the timeout or an uncaught throw fails the witness and fires the backreference to PARSEDV, which moves the input type to the parsed form so malformed input cannot reach the crash.

### CONTRACTTEST - Consumer-Driven Contract Test - Ian Robinson

Handover: Consumer-field checks are handed to CHARTEST, which applies only where no contract remains to describe the changed code. cite Consumer-Driven Contract Test - Ian Robinson.

For each consumer of the changed surface found by callers, exec_js calls the surface the way that consumer does and asserts the response fields the consumer reads, citing the consumer by file and line. A field the surface no longer returns is a failing witness and a row. A consumer that broke on a behaviour no row promised fires the backreference to HYRUM: the promise is written into a row and kept, or the consumer moves to the promised shape, and the row records which.

### CHARTEST - Characterization Test, Legacy Only - Michael Feathers

Handover: A characterization record with no remaining contract ends this chain, so this node nominates no further node. cite Characterization Test, Legacy Only - Michael Feathers.

A characterization probe is written only when the changed code has no contract left: no row, signature or invariant describes it. The agent runs the current behaviour through exec_js, records the outputs in the owning row's witness labelled as a characterization, and leaves no standing test file. When the recorded behaviour is the only description left, the backreference to SPECDRIFT fires, and the agent writes the contract the characterization implies and routes it to G_CONTRACT.

### AGENTQA - Agent-Native QA over MCP

Handover: Verb and MCP reply checks are handed to LLMJUDGE for surfaces where no metamorphic relation can be stated. cite Agent-Native QA over MCP.

For each gm verb, MCP tool or spool reply the diff changes, the agent dispatches that verb through the gm MCP exactly as a calling agent does, with a real session id, and quotes the reply fields in the row. A dashboard, screenshot or human view is never the witness for a surface an agent consumes. When verification needs a dashboard, the backreference to SANITIZE fires and the check is re-expressed as a verb dispatch returning the value the dashboard would show.

### LLMJUDGE - LLM as a Judge

Handover: Judge verdicts with their judged pairs are handed to SANITIZE so the static analysers gate the final change. cite LLM as a Judge.

The judge is used only where METAMORPH found no relation. It is a separate agent given a rubric derived from the contract and the input and output pair. The rubric is one pass or fail per criterion, each with cited evidence; a holistic score is not accepted. When the judge compares two outputs it judges both orderings, and a disagreement between orderings is no verdict. Length is not a criterion. Before a verdict counts, the judge classifies one known-good and one known-bad pair under the same rubric, once per run when the judge shares the author's model; a miss on either pair blocks the verdict. The verdict is owned by the row that cites it and is recorded by the orchestrator. The witness quotes the judged pair, the rubric, the calibration result and the verdict. A judge that is the implementer or shares its context fires the backreference to INDEPVER and is replaced.

### SANITIZE - Sanitizer and Static Analysis Gate

Handover: A passing analyser run is handed to G_NET, the net-negative gate that decides whether the change may leave VERIFY. cite Sanitizer and Static Analysis Gate.

The project's analysers run through execFileSync inside exec_js with warnings treated as failures: cargo clippy with warnings denied for Rust, the project's linter and type checker for JavaScript and TypeScript, and each other language's checker for the languages in the diff. Each finding becomes a row or unknown, is fixed in the code, and is re-run until clean. A lint rule is never disabled to clear a finding. A finding the type system could have prevented fires the backreference to TOTALITY: transition to=TOTALITY and make the partial function total.

## Witness

A witness is a live exec_js dispatch, a codesearch hit with path and line, or a file:line read from the live tree, quoted in witness_evidence with its kind named. A generic witness ("verified", "looks correct", "tests pass") is rejected.

- secrets: codesearch regex over changed paths for high-confidence shapes (key identifiers, private key headers, bearer tokens assigned to literals, database URLs with inline passwords), and over tracked config, prose and fixtures for lower-entropy values. exec_js runs the reading code path with an environment variable set to a marker and prints the read's file:line, proving the value comes from the environment or a secret store.
- injection: for each untrusted source (request body, CLI argument, file content, environment variable, network response), exec_js feeds the sink quote characters, command separators, path traversal in plain, percent-encoded and Unicode forms, and encoding tricks. The witness prints the argument array the sink received and shows an escaped value or a named rejection.
- identity-authority: exec_js calls the boundary with no credential, with another principal's credential, and with an unrecognised token. Each must refuse by name, and the replies are printed. A codesearch hit cites the authorisation check at the boundary that performs the action.
- message-timing: exec_js delivers a message twice, two messages reversed, and a truncated message, printing state after each. The duplicate converges, the reordered pair is applied or rejected by name, and the truncated message is rejected by name with no corruption. Constant-time comparison is witnessed by the codesearch hit naming the primitive at file:line; a timing measurement cannot separate the primitive from noise.
- exception-model: codesearch literal and regex hits for unwrap, expect, panic, throw and unhandled rejection, each classified as handled at a boundary that names the cause or propagated with context. exec_js raises the precondition violation on purpose and prints that the process halts with exact state. A default returned under a violated precondition is refused.
- partial-failure: exec_js runs the multi-step operation as a child process, kills it between steps with process.kill, restarts it, and prints the named end state. The same probe cuts IO or network mid-call and checks that the retry converges to one applied effect. Staging-then-rename, append-only replay and idempotent re-entry are accepted shapes.
- degradation: exec_js drives the boundary with the largest accepted input and one element more, printing which path each took. Waits and retries are cited by codesearch literal on the primitives, showing a timeout and a cap. The queue bound is a number read from the code, not inferred from samples.
- crucible: exec_js runs maximum load, degenerate input and resource exhaustion in turn. Exhaustion runs at least one hundred thousand iterations and prints process.memoryUsage() before and after, with open handles counted before and after. Each boundary is pass or found-and-fixed in the same turn, and the fix is re-run against the same probe.

Live witnesses must reflect the current code. Enumerate every cache between the fix and the response: HTTP cache headers on the route, CDN or edge caches, build-artifact caches, and probe session reuse. Use a cache-busting parameter or a fresh session when any exists. A build-artifact cache keyed only by input hash is refused; its key folds in a hash of the transform's own source. A witness that reports still broken, or suspiciously still fine, on its first attempt is checked for a masking cache before anything else.

A log line that says the fixed code ran is not a witness that the defect is gone. The witness is the primary artifact the bug report named: the live response body, the live file, the live rendered value. Re-run the same diagnostic that found the bug against the same target.

A subagent's finding or a memory is a hypothesis. Before acting on a claimed dead function, junk file or tracking state, run the check that confirms it on the live tree: callers and a codesearch identifier query, fs_read on the claimed path, git_log or git_show for tracking intent. An overturned premise is re-scoped with prd-add under the same id.

When a tool cannot produce a witness, the unknown is to make that tool reachable (fix it, replace it, or drive its protocol directly), then witness. Parking the unknown as blocked on an outside party is refused.

No mock, fake or stub stands in for a real dependency. Mock, Fake and Stub classes, hard-coded always-succeed returns and input short-circuits are removed and replaced by real input through real code, and a missing real dependency becomes a row that installs or provisions it. Comment-opening tokens found by the comment sweep are deleted, except directives a tool reads: shebangs, eslint-disable and oxlint-disable, ts-expect-error, ts-ignore, c8 and istanbul ignore, prettier-ignore, and a SAFETY justification in Rust.

## Memory

A witness that contradicts a memory deletes that memory on sight: remove its file and its MEMORY.md line.

## Transition

The node is entered from TOTALITY through G_INDEP, the gate for "verifier has not read the implementation". Its predicate lean-verifier-independent is advisory and always passes, so independence is held by dispatching a fresh verifier agent before transition {"to":"G_INDEP"}, not by the gate.

The exit runs SANITIZE to G_NET, the gate for "change closes net-negative, or states why not", whose predicate lean-net-negative is blocking: it passes only when added lines in the working diff are at most the removed lines. Leave with transition {"to":"G_NET"} once every unknown and row of this node is resolved and the net count passes. A denial names next_dispatch; dispatch it first, which removes superseded or duplicated code in the same change, then re-dispatch transition {"to":"G_NET"}. The predicate reads no growth reason, so a growing change is refused until it shrinks.

Feedback routes each discovery to the earliest node able to fix it. A gap between spec and code routes to EARS. A boundary or ownership defect routes to G_CONTRACT when the type cannot express the rule (ILLEGAL), and to TOTALITY when the repair is code. A panic, unchecked error or partial-failure repair routes to TOTALITY. A failing invariant or property routes to G_CONTRACT through DBC or ILLEGAL. A sanitizer finding the type system could have prevented routes to TOTALITY. An assertion that mirrors the code routes to G_INDEP for a fresh verifier. Take the graph edge whose label matches the discovery and re-walk from where it lands.

A gate denial is never retried blind: dispatch the next_dispatch verb the denial names, then continue. An identical denial repeated three times is escalated by the repeat threshold, and the escalation is read before any further dispatch.
