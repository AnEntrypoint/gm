# ORCHESTRATOR (extended reference)

On-demand tail of entry prose. Dispatch `instruction` with `{"prompt":"entry-extended"}` to receive this.

## Code Invariants (every possible emission)

The named-principle canon lives distributed across the stage prose files (Correctness & Reliability + Idempotency at STATE, Performance at CONC, Architecture + Workflow + XY at SPECIFY, Code Quality at EMIT, Security at SEC, Definition of Done at DECIDE, Chain-of-Thought at PROVE); those names are the wide preferences with narrow selection text, and they govern every emission. What remains here is the gm-specific operational residue the canon does not cover:

- **Naming by scale:** <50 lines single-letter algebraic; 50-200 short descriptors; >200 full names; public APIs explicit.
- **Binary transport, append-only persistence:** varint fields; lexical cursors for sparse reads; append-only sequence for replay; chunked by lexical range, modify only the touched chunk.
- **Single focused task per session:** no drive-by refactors; pre-compute and inline.
- **Async boundary explicit:** sequential awaitable primitives; no implicit callback ordering; unified error channel, never swallow rejections.

## Token Discipline

English describing intent = liability when code encodes it; comments = liability when names+structure encode the same; duplication-that-must-sync = liability. Same economy for reasoning: a runnable thought held as silent prose = liability -- reason by executing, not narrating; hypothesis becomes dispatch, output is conclusion. Prose enacts the discipline structurally, never narrates scenarios. Closure anti-shape: a claim composed in prose displacing a dispatch (unrun thought standing in for witnessed one). Response body is not a mutation surface.

## Install

`bun x skills add AnEntrypoint/gm` copies the skill directory into `~/.claude/skills/gm/` (and `~/.agents/skills/gm/`), installed as `/gm`. The `install.sh`/`install.ps1`/`bin/gm-install.js` installers, run beside `skills/` or with `GM_SKILL_SOURCE_DIR` set, place a link instead — junction on Windows, symlink elsewhere — so the installed `SKILL.md` and the checkout's are one file; with no local source they copy and announce it. No npx, no marketplace, no npm registry.

## Bootstrap

First dispatch checks `~/.gm-tools/plugkit.wasm` (or `~/.claude/gm-tools/plugkit.wasm` on legacy installs). Absent -> write `.gm/exec-spool/in/bootstrap/<session_id>-0.txt`; plugkit fetches, sha-verifies, writes `.bootstrap-status.json`. On pin mismatch it writes `.gm/bootstrap-error.json` and you pause the chain.

## Supervisor drift and version updates

A supervisor respawns the watcher under fresh code on `wrapper.drift`/`version.drift` or a stale `.status.json`. A dispatch landing in that window returns `wasm_aborted: true` -- retry the same dispatch. `update.available` means newer on-disk fixes -- continue, the supervisor picks them up.

**Sideload protection can silently and permanently pin a stale gm plugin build.** The real, currently-loaded plugin binaries live at `~/.agentplug/plugins/<name>.wasm` (per-plugin, e.g. `gm.wasm`, `bert.wasm`), not the bootstrap binary above -- the bootstrap binary is the initial-fetch target only; the live agentplug-runner daemon (`~/.agentplug/`) serves from its own plugins directory once running. If `~/.agentplug/plugins/<name>.version` holds a non-release-semver string (a hand-built dev tag, e.g. `local-dev-sideload-<label>`), the daemon treats it as an intentional local-dev sideload and NEVER auto-overwrites it -- by design, so a developer's hand-built plugin survives the auto-updater. The daemon records this as `~/.agentplug/plugins/<name>.local-dev-sideload.json` and warns to stderr at boot and on every stale-poll tick, but a session reading only `.status.json`'s `loaded_plugin_versions` sees just the opaque non-semver tag with no pointer to the marker file or the fix. If `instruction`/any dispatch reports `fsm_graph_rejected` or another symptom that looks like a stale compiled predicate/behavior despite the source repo being current: check `loaded_plugin_versions.<name>` in `.status.json` for a non-semver value first -- that is the tell. Fix by replacing `~/.agentplug/plugins/<name>.wasm` with a freshly built artifact, writing a real semver string to `~/.agentplug/plugins/<name>.version`, deleting the now-stale `~/.agentplug/plugins/<name>.local-dev-sideload.json` marker, then restarting the shared daemon (`taskkill`/`kill` the `agentplug-runner` process, then re-dispatch any spool verb to trigger respawn) -- `shared_process: true` in `.status.json` means this daemon serves every project on the machine, so killing it interrupts any other session's in-flight dispatch; prefer doing this only when no other session has active work, or accept and disclose that tradeoff.

## Observability

`.gm/exec-spool/.watcher.log` -- cdylib stdout/stderr, dispatch timings, sweep ticks, boot markers; tail via fs_read {path, offset, limit}; rotated 10MB.

## Daemonize

The watcher returns task_id immediately and tails to 30s wall-clock. Short finalizes in-window; long returns partial + continues -- read the partial and decide `tail`/`watch`/`wait`/`sleep`/`close`. Responses carry `running_task_ids` you track.

## Disciplines

Route KV writes to `<cwd>/.gm/disciplines/<ns>/`. `@<name>` prefix sets namespace=name; cross-project read passes `projectPath: <abs>`. Discipline KV routing is resolved by the `discipline` verb; do not hand-build its paths.

## Memorize

`kind` is a storage tier, not a memory type. `memorize-fire` passes it through to the tencentdb memory store, which keeps it as free text; the code defaults it to `l0` (memorize-fire) and `l1` (memory import).

**Exclusion principle.** Anything derivable from live project state -- code patterns, architecture, paths, git history, prior debugging -- never enters the store. Storing a derivable fact creates a second, driftable source of truth alongside the real one; the live tree always wins that race, so the memo only ever goes stale, never authoritative.

**Verification before recall.** A memory naming a specific file/function/flag is a claim indexed at write-time, not a claim about present state -- re-verify the named thing still exists before acting on the hit. A recall result is a lead, never a fact.

Write the recall index only via `memorize-fire`; surfaces outside it produce memos the index never sees. Prune bad memory on sight, since a stale or wrong recall hit poisons every future recall: `memorize-prune {keys}` removes the named entries (text + embedding); `memorize-prune {query}` is review-only and returns candidates without removing any.

By default `memorize`/`recall`/`memorize-fire`/`memorize-prune` write markdown files at `.gm/memories/<key>.md` (the durable store) with a lean cache index at `.gm/gm.db`'s `rssearch_vectors` table. A project can opt a namespace into a second, file-pointer-only backend (`memory.tencentdb_backend` in `gm.config.json`) -- its index rows carry only a path pointer plus the embedding, never inline text, and its embedding dimension is independently configurable (not gm's fixed 384-dim model). Same verb surface either way; the backend selection is transparent and config-gated.

**`tencentdb_backend` is a local, schema-compatible storage swap, NOT a live connection to a deployed TencentDB-Agent-Memory stack.** It reads/writes a local libsql table (its table and vector index, inside `memory.tencentdb_backend.data_dir`) with zero HTTP calls to MemoryCore/MemoryHub/Proxy -- there is no code path in rs-plugkit that talks to ports 8420/8424/8096 or any deployed service. The only real capability it changes is storage shape: a project-configurable embedding dimension (`vectors_db_dims`, gm's own default backend is fixed at 384) and index rows that point at a file rather than inlining text. It does NOT give gm access to that project's Chat Memory tiers (L0 conversation -> L1 atom -> L2 scenario -> L3 persona), its extracted Skill library, or its Wiki/CodeGraph -- those live only inside an actually-deployed `agent-memory` stack (Docker Compose, real LLM API credentials, a running proxy that intercepts the coding-agent's own connection) and reaching them is a separate, heavier decision: standing up network services and consuming external LLM credentials is world-scope (Section 4) -- ask before deploying it for a project, never silently.

Four config fields actually read from `gm.config.json`'s `memory.tencentdb_backend` block: `enabled` (bool), `data_dir` (string), `vectors_db_dims` (uint), `namespaces` (array of namespace names routed to this backend -- everything else stays on the default backend regardless of `enabled`). Their defaults and the fixed internal table/index names live in `TencentBackendConfig::default()` and its constants in `rs-plugkit/crates/plugkit-core/src/tencentdb_memory.rs`.

**Relationship to the AGENTS.md-drain (Coding Style section, "Every memorize run also drains AGENTS.md"): unaffected, always the default backend.** The drain instruction hardcodes `memorize-fire their substance to the default namespace` -- enabling `tencentdb_backend` for other namespaces never redirects AGENTS.md-drained content there, by design: AGENTS.md governs gm/rs-* itself, never a target project's namespace, so routing its drained substance into a target-project-scoped backend would be exactly the cross-project memory pollution `gm's recall store holds gm/rs-* method/tooling/invariants ONLY` already forbids.

**When to actually enable it for a project:** a real, reachable signal, never a default-on guess -- a project's own `.gm/`/README/CONTRIBUTING already references TencentDB-Agent-Memory or a deployed instance of it, the project's embedding pipeline elsewhere already commits to a non-384 dimension the default backend can't hold, or the user names the need directly. Absent one of those, leave it disabled; flipping it on speculatively fragments a project's memory across two backends for no reachable benefit.

**Migrating existing `.gm/memories/*.md` content into a newly-enabled `tencentdb_backend` namespace once one of those signals fires:** two real, wired mechanisms, both documented in the `agent-memory` skill (`Skill(skill="agent-memory")` for full detail) -- the `tencentdb-memory-import` verb (`{"source_namespace", "dest_namespace", "kind"}`, single dispatch from a live session) and `scripts/migrate-memory-to-tencentdb.mjs` (batch/CLI, also applies a derivable-state discard filter). Both refuse unless the destination namespace's `vectors_db_dims` is exactly 384 (gm's embedder's only output width); default is a one-way copy, `archive_source`/`--archive` opts into moving migrated files out of the live `.gm/memories/` corpus instead of leaving them duplicated.

## Liqology memory-firewall plugin

`agentplug-liqology` (repo `AnEntrypoint/liqology`) is now part of gm's own compiled default capability allowlist for `caller_plugin=="gm"` (`imports.rs`'s `compiled_default_capability_allowlist`, `liqology` alongside `bert`/`libsql`/`treesitter`) -- first-party-adjacent, not a truly external plugin any consuming project needs a `.agentplug/capability-allowlist.json` override to reach. It wraps a real, from-source-vendored FAISS `IndexFlatIP` (compiled for `wasm32-wasip1-threads`, `-fno-exceptions` since this wasi-sdk's prebuilt `libc++abi` lacks a working exception runtime for that triplet) behind six verbs: `record` (embed an interaction's input/output, reinforce FAISS-similar prior entries, decay and prune the rest per a `CostBalancePolicy` -- gm's own `git_commit`/`git_finalize` already call this automatically on every real commit, best-effort, never blocking), `query_relevance`, `prune_report` (a real preview -- what would be evicted under the current policy, without mutating state -- gm's own `residual-scan` already calls this automatically, surfacing a `liqology_stale_memory` finding when meaningful, observability only), `tune_policy`, `suggest_fsm_update`, `capabilities`.

**This is a memory-relevance tool, not a memory store.** It does not replace `memorize`/`recall`/`memorize-fire` -- those remain the only sanctioned write/read surface for gm's own recall index (see Memorize above). `agentplug-liqology` consumes recall activity (via `emit_recall`'s `hit_keys` field, now logged per-entry alongside the existing `n_hits`/`top_score`) and git-commit activity (via `git_commit`/`git_finalize`'s `git_commit`/`git.commit` events, both now carrying a full `sha_full` -- every `emit_event` call already auto-tags its own session's `sess`, so a commit and the recall hits that informed it join on matching `sess` values in `.watcher.log`, no new database table) to infer which memory entries were surfaced-but-never-reflected-in-a-diff (candidates for pruning) versus surfaced-and-reused (candidates for reinforcement).

**When to actually reach for it:** a real, reachable signal, same bar as `tencentdb_backend` above -- the project's own recall corpus has grown large enough that `recall`'s top-k results visibly include stale/irrelevant entries, or the user names the need directly (a request to prune, tune retention, or inspect what memory is/isn't earning its keep). Absent one of those, plain `recall`/`memorize-fire` is sufficient; dispatching a `host_plugin_call("liqology", ...)` speculatively on every turn is the same over-fragmentation `tencentdb_backend`'s own guidance warns against.

**`suggest_fsm_update`** takes a caller-supplied `{phase, gate, recurrence_count, correction_summary}` pattern and returns a proposal for review.

**When to dispatch the three on-demand verbs** (`record`/`prune_report` already fire automatically, above -- these three are agent-initiated):

- `query_relevance` -- before making any pruning/retention judgment call by hand, or when a `liqology_stale_memory` residual-scan finding names a count worth actually looking at (which entries, not just how many).
- `tune_policy` -- when `prune_report`'s `would_evict_ids` consistently disagrees with what the agent independently judges should be retained/pruned (the current `CostBalancePolicy` no longer matches this project's actual usage pattern), not a first-resort tuning knob.
- `suggest_fsm_update` -- the SAME correction has recurred at the SAME `{phase, gate}` at least twice this session (matches the verb's own `recurrence_count >= 2` validation, which rejects a single occurrence as not-a-pattern) -- a real, witnessed repetition, never a hunch after one instance.

## Overridden-setting drift notification

Every `instruction` response carries a `config_changed` array: config sources (prose, discipline policy, FSM vendor doc, `gm.config.json` -- any tier) that changed since this session was last told, delivered exactly once per session (`delivered_to` roster tracked server-side; never re-shown, never polled for). Each record: `{id, tier, old_sha, new_sha, changed, changed_count, changed_truncated, ts}` -- `changed` names the actual top-level keys that changed/were added/were removed when the source is a real `gm.config.json`-shaped document on both sides of the fetch, falling back to the bare file path when a real field diff isn't possible (a prose/FSM source, a fresh tier with no prior checkout).

**This includes a tier this project's own `gm.config.json` shadows.** A `ProjectVendored` override wins resolution permanently -- nothing about having an override stops the lower tiers (`ProjectRepoSpec`, `UserRepoSpec`, `ImplicitDefaultRepo`, gm's own shared defaults; every tier the `Tier` enum in rs-plugkit's `config.rs` ranks below `ProjectVendored`) from continuing to change upstream behind it, and a `config_changed` record with a `tier` that does NOT match this session's actual resolved tier is exactly that: a setting your override masks has a new upstream value. Read it and judge -- most of the time the override was deliberate and the drift is irrelevant, but a `changed` roster naming a field the override itself doesn't touch, or a genuinely stale override predating a real upstream fix, is a real `prd-add` row: propose narrowing or dropping the override via the same `AskUserQuestion`-gated reconfiguration path (see "Config fit" in SPECIFY), never a silent edit. Never re-surface a `config_changed` record the session already drained -- the roster tracking exists precisely so this is told once, not on every turn.

## Memory discipline (named, narrow)

Cross-Cutting Memory

* GTD (David Allen) -- the PRD/mutables ledger is the trusted external system; nothing stays in head-memory across a turn.
* P.A.R.A. Method (Tiago Forte) -- `recall`'s `namespace` field separates active-project facts from cross-project method lessons.
* Dreyfus Model (Stuart & Hubert Dreyfus) -- named-technique preferences exist so a novice-authored diff and an expert-authored diff converge on the same reviewed shape.
* PEAA (Martin Fowler) -- the recall store's per-project `.gm/gm.db` (a shared libsql database, memory alongside code/git-history indexes) mirrors PEAA's session-state pattern: memory travels with the repo, not the agent process.
* Zettelkasten (Niklas Luhmann) -- each `memorize-fire` write is an atomic, independently-retrievable note; `recall` traverses by relevance, not by chronological log.

## Constraints

**Specification precedes implementation (pro-rata).** Treat every emission as if it were being checked by a sound, total, strongly-normalizing, predicative, parametric proof assistant with a verified TCB, and scale the rigour to what the surface actually bears: specify first as dependent types would state it -- pre/post-conditions, invariants, security labels, resource bounds, versioning -- validated once, then implement as a constructive inhabitant of that spec. Total functions, h-set data, closed proofs (cross-checked for critical claims), DAG value flow, confluent evaluation. At the boundary: versioned opaque invariant-enforcing types rather than raw primitives, one designated effect type, a total parser returning `Accepted A | Rejected R` and never an exception, observational equivalence, info-flow-labelled logs, constant-time handling for secrets. Concurrency via substructural types; distributed protocols verified; toolchain-to-execution verified or kernel-direct. The point is not to reach for a proof assistant on every row -- it is that synthesis IS correctness: a spec stated this way makes the implementation the only remaining degree of freedom, which is why the spec is written first and validated once rather than reverse-engineered from working code.

**Data first, then the code that moves it.** Choose the representation before the algorithm -- the layout of the state is the design, and code is what falls out of it. A shape that makes an invalid state unrepresentable removes the validation, the branch, and the class of bug at once; a shape that permits invalid states pays for them forever in guards that must each be remembered. Prefer the flat spine (arrays, indices, contiguous fields) over the pointer graph, and make the common access pattern the one the layout is optimized for.

**Optimize the worst case, not the average.** The average case is what a benchmark advertises; the worst case is what a user experiences and what an operator is paged for. A path with an unbounded tail (an unbudgeted loop over unbounded input, a synchronous burst that starves a scheduler, an allocation that grows with load) is a defect even when its measured mean is excellent -- bound it by time or by size, and make the bound explicit in the code rather than implicit in the input distribution that happened to hold during measurement.

**Fail fast, at the earliest boundary that can still name the cause.** Validate at entry, where the offending input is still in scope and the error message can be specific; a check moved downstream reports a symptom whose cause has already been lost. Silent degradation is worse than a crash: a component that returns a plausible-but-wrong value under a violated precondition converts one loud failure into an unbounded number of quiet ones. Never swallow an error to keep a path alive -- a fallback is admissible only when it is a real, named, correct behaviour for that condition, never as a way to avoid handling it.

**Names and structure carry meaning; comments do not.** A comment that says what the line does is duplication that must be kept in sync and will not be. When the urge to write one arrives, rename, extract, or restructure instead -- a name, a function boundary, or a small type IS the explanation, and a comment beside one is a second, driftable copy. This includes the paragraph-long rationale comment: explaining a WHY inline is the same violation at greater volume, not an exemption from it, and that explaining urge is the signal a name is doing too little.

Rationale genuinely worth keeping -- the constraint being honoured, the failure mode prevented, the measurement that motivated a non-obvious shape -- goes in the commit message, `AGENTS.md`, or the recall store, where it is durable and searchable, never beside the line it describes. EXECUTE states the enforcement form of this rule and VERIFY blocks a transition on any comment in the diff; this is the same rule, not a softer one.

**No standing test files, ever.** The `no-synthetic-test-files` predicate is diff-scoped as predicates.md:19 defines it: it blocks a diff that introduces a test file or test directory, and it does not flag a tracked one. A tracked test file is left byte-identical and reported as tracked. Verification is running the real code path and reading its output through `exec_js`. Do not pull in jest/mocha/vitest/pytest/unittest or any assertion/mocking framework. A mock standing in for real code is the same false-completion class as a hedged `prd-resolve`: it reports a pass that the real path never produced.

## Self-reconfiguration content shape

Every `fsm-propose-override` proposal of `kind:"prose"` expresses its named-technique content as `body.anchors`, a non-empty array of `Anchor` values. An `Anchor` is `{name, author}`: exactly those two non-empty strings, no `url` or other key; `fsm_propose.rs` parses each entry at the boundary and refuses anything else. Anchors are attributed, not paraphrase. An anchor is a compact reference to a well-known, well-attributed technique from real literature -- "MECE (Barbara Minto)", never "split into groups that don't overlap and cover everything". Where the proposed prose lists more than one anchor and those anchors relate to each other, express the relation as a mermaid graph (`flowchart` with `-.->` edges), not a flat list. Never invent an edge: state only a relation genuinely known from the cited literature (a shared author, a documented dependency, an explicit "see also" in the technique's own source). If the proposal's synthesis surfaces a well-known, well-attributed technique missing from the target phase's existing anchor list, add it with correct attribution rather than leaving the gap unnamed -- and graph it in, don't just append it to a flat list. Never cite an external anchor-catalog website by name or URL; the anchor + author pair is the citation, self-contained regardless of where it was first indexed. This governs every prose-kind self-reconfiguration proposal on every project, not a one-time pass.

