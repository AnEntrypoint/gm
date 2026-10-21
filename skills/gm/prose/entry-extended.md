# ORCHESTRATOR (extended reference)

On-demand tail of entry prose. Dispatch `instruction` with `{"prompt":"entry-extended"}` to receive this.

## Code Invariants (every possible emission)

The named-principle canon lives distributed across the stage prose files (Correctness & Reliability + Idempotency at STATE, Performance at CONC, Architecture + Workflow + XY at SPECIFY, Code Quality at EMIT, Security at SEC, Definition of Done at DECIDE, Chain-of-Thought at PROVE). Those names are the wide preferences with narrow selection text, and they govern every emission. What remains here is the gm-specific operational residue the canon does not cover:

- **Naming by scale:** <50 lines single-letter algebraic; 50-200 short descriptors; >200 full names; public APIs explicit.
- **Binary transport, append-only persistence:** varint fields; lexical cursors for sparse reads; append-only sequence for replay; chunked by lexical range, modify only the touched chunk.
- **Single focused task per session:** no drive-by refactors; pre-compute and inline.
- **Async boundary explicit:** sequential awaitable primitives; no implicit callback ordering; unified error channel, never swallow rejections.

## Token Discipline

English describing intent is a liability when code encodes it; comments are a liability when names and structure encode the same; duplication that must sync is a liability. Same economy for reasoning: a runnable thought held as silent prose is a liability. Reason by executing, not narrating: a hypothesis becomes a dispatch, and the output is the conclusion. Prose enacts the discipline structurally and never narrates scenarios. Closure anti-shape: a claim composed in prose displacing a dispatch (an unrun thought standing in for a witnessed one). The response body is not a mutation surface.

## Install

`bun x skills add AnEntrypoint/gm` copies the skill directory into `~/.claude/skills/gm/` (and `~/.agents/skills/gm/`), installed as `/gm`. The `install.sh`/`install.ps1`/`bin/gm-install.js` installers, run beside `skills/` or with `GM_SKILL_SOURCE_DIR` set, place a link instead (a junction on Windows, a symlink elsewhere) so the installed `SKILL.md` and the checkout's are one file. With no local source they copy and announce it. No npx, no marketplace, no npm registry.

## Bootstrap

First dispatch checks `~/.gm-tools/plugkit.wasm` (or `~/.claude/gm-tools/plugkit.wasm` on legacy installs). If absent, write `.gm/exec-spool/in/bootstrap/<session_id>-0.txt`; plugkit fetches, sha-verifies, and writes `.bootstrap-status.json`. On pin mismatch it writes `.gm/bootstrap-error.json` and you pause the chain.

## Supervisor drift and version updates

A supervisor respawns the watcher under fresh code on `wrapper.drift`/`version.drift` or a stale `.status.json`. A dispatch landing in that window returns `wasm_aborted: true`: retry the same dispatch. `update.available` means newer on-disk fixes exist: continue, the supervisor picks them up.

**Sideload protection can silently and permanently pin a stale gm plugin build.** The real, currently-loaded plugin binaries live at `~/.agentplug/plugins/<name>.wasm` (per-plugin, e.g. `gm.wasm`, `bert.wasm`), not the bootstrap binary above. The bootstrap binary is the initial-fetch target only; the live agentplug-runner daemon (`~/.agentplug/`) serves from its own plugins directory once running. If `~/.agentplug/plugins/<name>.version` holds a non-release-semver string (a hand-built dev tag, e.g. `local-dev-sideload-<label>`), the daemon treats it as an intentional local-dev sideload and NEVER auto-overwrites it, so a developer's hand-built plugin survives the auto-updater. The daemon records this as `~/.agentplug/plugins/<name>.local-dev-sideload.json` and warns to stderr at boot and on every stale-poll tick. A session reading only `.status.json`'s `loaded_plugin_versions` sees just the opaque non-semver tag, with no pointer to the marker file or the fix. If `instruction` or any dispatch reports `fsm_graph_rejected`, or another symptom that looks like a stale compiled predicate or behaviour although the source repo is current, check `loaded_plugin_versions.<name>` in `.status.json` for a non-semver value first: that is the tell. Fix: replace `~/.agentplug/plugins/<name>.wasm` with a freshly built artifact, write a real semver string to `~/.agentplug/plugins/<name>.version`, delete the stale `~/.agentplug/plugins/<name>.local-dev-sideload.json` marker, then restart the shared daemon (`taskkill`/`kill` the `agentplug-runner` process, then re-dispatch any spool verb to trigger respawn). `shared_process: true` in `.status.json` means this daemon serves every project on the machine, so killing it interrupts any other session's in-flight dispatch. Do this only when no other session has active work, or accept and disclose that tradeoff.

## Observability

`.gm/exec-spool/.watcher.log` holds cdylib stdout/stderr, dispatch timings, sweep ticks and boot markers. Tail it via `fs_read {path, offset, limit}`; it rotates at 10MB.

## Daemonize

The watcher returns task_id immediately and tails to 30s wall-clock. Short finalizes in-window; long returns partial and continues. Read the partial and decide `tail`/`watch`/`wait`/`sleep`/`close`. Responses carry `running_task_ids` you track.

## Disciplines

Route KV writes to `<cwd>/.gm/disciplines/<ns>/`. The `@<name>` prefix sets namespace=name; a cross-project read passes `projectPath: <abs>`. The `discipline` verb resolves discipline KV routing; do not hand-build its paths.

## Memory

Memory is one flat file per fact. Save an unknown as a memory only when a later task needs it. Save nothing else as memory.

Write each memory as a file in the harness memory directory, the directory that holds MEMORY.md. The file has frontmatter with the fields name, description and metadata.type. Set metadata.type to unknown. Add one line to MEMORY.md that points to the file.

To find a memory, read MEMORY.md and open the files it points to. A memory is a lead, not a fact: re-verify any named path, symbol or flag before you act on it. When a witness contradicts a memory, delete the file and its MEMORY.md line.

Do not save a fact that the live tree can answer. The tree wins over a memory.

## Overridden-setting drift notification

Every `instruction` response carries a `config_changed` array: config sources (prose, discipline policy, FSM vendor doc, `gm.config.json`, any tier) that changed since this session's last delivery. Each is delivered exactly once per session (`delivered_to` roster tracked server-side; never re-shown, never polled for). Each record: `{id, tier, old_sha, new_sha, changed, changed_count, changed_truncated, ts}`. `changed` names the actual top-level keys that changed or were added or removed when the source is a real `gm.config.json`-shaped document on both sides of the fetch. It falls back to the bare file path when a real field diff is not possible (a prose/FSM source, a fresh tier with no prior checkout).

**This includes a tier this project's own `gm.config.json` shadows.** A `ProjectVendored` override wins resolution permanently. Nothing about having an override stops the lower tiers (`ProjectRepoSpec`, `UserRepoSpec`, `ImplicitDefaultRepo`, gm's own shared defaults; every tier the `Tier` enum in rs-plugkit's `config.rs` ranks below `ProjectVendored`) from changing upstream behind it. A `config_changed` record whose `tier` does NOT match this session's actual resolved tier is exactly that: a setting your override masks has a new upstream value. Read it and judge. Most of the time the override is deliberate and the drift is irrelevant. But a `changed` roster naming a field the override does not touch, or a genuinely stale override predating a real upstream fix, is a real `prd-add` row: propose narrowing or dropping the override via the same `AskUserQuestion`-gated reconfiguration path (gm, Section 4), never a silent edit. Never re-surface a `config_changed` record the session already drained; the roster tracking exists so this is told once, not on every turn.

## Memory discipline (named, narrow)

Cross-Cutting Memory

* GTD (David Allen): the PRD/mutables ledger is the trusted external system; nothing stays in head-memory across a turn.
* Dreyfus Model (Stuart & Hubert Dreyfus): named-technique preferences exist so a novice-authored diff and an expert-authored diff converge on the same reviewed shape.
* Zettelkasten (Niklas Luhmann): each memory file is one atomic, independently retrievable note; MEMORY.md is its index.

## Constraints

**Specification precedes implementation (pro-rata).** Treat every emission as if it were checked by a sound, total, strongly-normalizing, predicative, parametric proof assistant with a verified TCB. Scale the rigour to what the surface actually bears. Specify first as dependent types would state it (pre/post-conditions, invariants, security labels, resource bounds, versioning), validated once, then implement as a constructive inhabitant of that spec. Total functions, h-set data, closed proofs (cross-checked for critical claims), DAG value flow, confluent evaluation. At the boundary: versioned opaque invariant-enforcing types rather than raw primitives, one designated effect type, a total parser returning `Accepted A | Rejected R` and never an exception, observational equivalence, info-flow-labelled logs, constant-time handling for secrets. Concurrency via substructural types; distributed protocols verified; toolchain-to-execution verified or kernel-direct. The point is not to reach for a proof assistant on every row. Synthesis IS correctness: a spec stated this way makes the implementation the only remaining degree of freedom, which is why the spec is written first and validated once, not reverse-engineered from working code.

**Data first, then the code that moves it.** Choose the representation before the algorithm: the layout of the state is the design, and code is what falls out of it. A shape that makes an invalid state unrepresentable removes the validation, the branch and the class of bug at once; a shape that permits invalid states pays for them forever in guards that must each be remembered. Prefer the flat spine (arrays, indices, contiguous fields) over the pointer graph, and make the common access pattern the one the layout is optimized for.

**Optimize the worst case, not the average.** The average is what a benchmark advertises; the worst case is what a user experiences and what an operator is paged for. A path with an unbounded tail (an unbudgeted loop over unbounded input, a synchronous burst that starves a scheduler, an allocation that grows with load) is a defect even when its measured mean is excellent. Bound it by time or size, and make the bound explicit in the code rather than implicit in the input distribution that held during measurement.

**Fail fast, at the earliest boundary that can still name the cause.** Validate at entry, where the offending input is still in scope and the error can be specific; a check moved downstream reports a symptom whose cause is already lost. Silent degradation is worse than a crash: a component that returns a plausible-but-wrong value under a violated precondition converts one loud failure into an unbounded number of quiet ones. Never swallow an error to keep a path alive. A fallback is admissible only when it is a real, named, correct behaviour for that condition, never a way to avoid handling it.

**Names and structure carry meaning; comments do not.** A comment that says what the line does is duplication that must be kept in sync and will not be. When the urge to write one arrives, rename, extract or restructure instead: a name, a function boundary or a small type IS the explanation, and a comment beside one is a second, driftable copy. This includes the paragraph-long rationale comment. Explaining a WHY inline is the same violation at greater volume, not an exemption, and that urge is the signal a name is doing too little.

Rationale genuinely worth keeping (the constraint being honoured, the failure mode prevented, the measurement that motivated a non-obvious shape) goes in the commit message, `AGENTS.md`, or a memory file, where it is durable and searchable, never beside the line it describes. No state-machine gate blocks a transition on a comment in the diff: the gate registry has no comment predicate. Comments are found by the comment sweep (`grep` with `{"mode":"comments"}`) and dispositioned by hand.

**No standing test files, ever.** The `no-synthetic-test-files` predicate is diff-scoped as predicates.md:19 defines it: it blocks a diff that introduces a test file or test directory, and does not flag a tracked one. A tracked test file is left byte-identical and reported as tracked. Verification is running the real code path and reading its output through `exec_js`. Do not pull in jest/mocha/vitest/pytest/unittest or any assertion or mocking framework. A mock standing in for real code is the same false-completion class as a hedged `prd-resolve`: it reports a pass that the real path never produced.

## Self-reconfiguration content shape

Every `fsm-propose-override` proposal of `kind:"prose"` expresses its named-technique content as `body.anchors`, a non-empty array of `Anchor` values. An `Anchor` is `{name, author}`: exactly those two non-empty strings, no `url` or other key. `fsm_propose.rs` parses each entry at the boundary and refuses anything else. Anchors are attributed, not paraphrased: a compact reference to a well-known, well-attributed technique from real literature ("MECE (Barbara Minto)", never "split into groups that don't overlap and cover everything"). Where the proposed prose lists more than one anchor and those anchors relate, express the relation as a mermaid graph (`flowchart` with `-.->` edges), not a flat list. Never invent an edge: state only a relation genuinely known from the cited literature (a shared author, a documented dependency, an explicit "see also" in the technique's own source). If the synthesis surfaces a well-known, well-attributed technique missing from the target phase's anchor list, add it with correct attribution rather than leaving the gap unnamed, and graph it in rather than appending it to a flat list. Never cite an external anchor-catalog website by name or URL: the anchor and author pair is the citation, self-contained regardless of where it was first indexed. This governs every prose-kind self-reconfiguration proposal on every project, not a one-time pass.
