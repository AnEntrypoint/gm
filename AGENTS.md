# AGENTS.md

This repository publishes the `gm-skill` release artifact. The installed `/gm` skill is `skills/gm/SKILL.md`; `rs-plugkit` serves the state machine through spool verbs. Rationale that code cannot state lives here, in compact form.

## Purpose

When the agent starts work, it first reads `SKILLS.md`. When a request or an edited file matches a skill's frontmatter description, it reads `skills/<name>/SKILL.md`. The served `instruction` response, project configuration and the applicable skill govern over this file. Falsified by: `fs_stat` on `SKILLS.md` or `skills/<name>/SKILL.md` returning an error, or a served `instruction` reply that contradicts the applicable skill.

## Core invariants

1. Traverse: the gm-graph walk runs in every free slot. Each node pass files PRD rows from its discipline and nominates the next node from its own outward links, with a one-line rhetoric handed on.
2. Drain first: while pending rows exist, every free slot drains rows. Under 20 open rows, free slots traverse computer-science disciplines to file rows.
3. Orient (gm-orient): codesearch and codeinsight before any edit. Top 20 BM25, top 20 vector and top 20 commits, each with 3 live snippet lines. The database stores embeddings and ids only.
4. Resolve through six skills, each loading the next: gm-orient, gm-unknowns, gm-eliminate (JIT runs; new unknowns return here), gm-edit, gm-validate (JIT runs; failures return to gm-eliminate), gm-publish.
5. Unknowns are filed with `mutable-add` (status `unknown` while open) and closed with `mutable-resolve`. Elimination ends only when none are open.
6. Publish on main only: merge upstream, commit local work by explicit path, push, read CI. A failing job returns to gm-eliminate.
7. Plugkit runs 4 concurrent workers. A call over 15 s moves to background and frees its worker. A browser or GPU call takes a lease; browsers stay hot per project.
8. A subagent stopped by a network or API error is restarted for the same row, never resumed and never parked as blocked.
9. A row ends resolved with a witness or blocked with a named fact. A blocked row is not duplicated.
10. Success: rows always drain, and traversal refills them before they run out.

## Skill installs

An installed skill must be the file it is installed from, or the install must say it is not. `install.sh`, `install.ps1` and `bin/gm-install.js` materialise `~/.claude/skills/<name>` and `~/.agents/skills/<name>` from `<checkout>/skills/` (or `GM_SKILL_SOURCE_DIR`) as a link (a junction on Windows, a symlink elsewhere), so a source edit is served on the next dispatch. With no durable source (the release-tarball route, or a package under npm's npx cache, a `_npx` segment that npm can delete) the install copies, announces it, and records the mode in `<root>/.gm-skill-install-modes`. Against a checkout, a copy is drift even when its contents match.

A displaced install is parked under the dotted `<root>/.gm-skill-prelink/` (a plain sibling would be served as a skill), never deleted, because `.gm` state may be live. Deleting needs `--force-link` (bin/gm-install.js) or `GM_SKILL_LINK_FORCE=1`.

MSYS `ln -s` silently copies when symlink creation is refused, so on MINGW/MSYS/CYGWIN only `mklink /J` counts as a link. `install.sh` sets `MSYS_NO_PATHCONV=1` and uses `pwd -P`, since `readlink -f` is not portable. `install.ps1` unlinks links and never recurses into them. `docs/skills.html` describes the rule. `agentplug/crates/agentplug-runner/src/download.rs refresh_installed_skills` runs every 300 s in the daemon: it fetches `skills/manifest.sha256` from `main` (written by `scripts/build-skill-manifest.mjs`, checked by `.github/workflows/skill-release.yml`), re-fetches each changed file, installs new skills into gm-managed copy roots, skips a source-linked install, and parks stale files and retired copies. Falsified by: an edit to `skills/<name>/SKILL.md` that is not visible at `~/.claude/skills/<name>/SKILL.md`, or `node bin/gm-install.js --check-skills` printing `DRIFT`.

## Glossary

- **walk**: one run of the gm state machine, driven by the walk loop in `skills/gm/SKILL.md` (Section 1c).
- **hop**: one traversal of a principle node by one `gm-hop` subagent (`skills/gm-hop/SKILL.md`). **candidate**: an outgoing edge of the current node. **successor**: the next hop, spawned from a candidate, which receives the handover rhetoric.
- **traversal**: the chain of hops within one walk, bounded by the visited set and the depth limit.
- **node**: a vertex of `skills/dream-rsi/gm-graph.json`. Only principle nodes are visited; gate, terminal, phase and tension nodes are refused.
- **subagent**: an agent started with the Agent tool. **worker**: a walk-launched hop or PRD row resolver with its own SESSION_ID.
- **slot**: one unit under the concurrency ceiling, held by a launched subagent until it completes. A freed slot is refilled while independent work remains.
- **row**: one PRD entry, pending or resolved. `prd-resolve` closes it with a witness.

## Ownership

- `skills/gm/SKILL.md` owns agent workflow and tool routing.
- `gm-config/` owns default phase prose, gate text, residual text and the FSM graph. A project-local vendored configuration key is served instead of the cached or compiled prose. Falsified by: a vendored key set in the project whose `instruction` reply still carries the cached or compiled text.
- `rs-plugkit/` is the WASM guest that implements orchestration, spool verbs, memory and code search.
- `agentplug/` provides `agentplug-runner`, the native WASM host and the only supported loader.
- `gm-mcp/` wraps the spool write-and-poll cycle. The agent edits `gm-mcp/src/` and rebuilds its committed bundle together. It serves stdio (the default registration) and stateless streamable HTTP on `127.0.0.1:8787/mcp`; transport failure modes, the durable registration command and `ensure-http` are owned by `gm-mcp/README.md` (Transport section). Falsified by: a delivery whose `gm-mcp/src/` diff lacks the matching bundle diff.
- `install.sh` and `install.ps1` install the skill and runner. Equivalent = same installed paths and same MCP registration command.
- `bin/gm-install.js` registers the MCP server as `node ~/.gm-tools/gm-mcp-server.mjs` (project `.mcp.json`: a `node -e` launcher that resolves that path at start). The system never registers an `npx github:` spec; the measured connect-timeout rationale is owned by `README.md` (MCP launch paragraph). Falsified by: a codesearch literal `npx github:` in `bin/` that matches a registration rather than the message at `bin/gm-install.js:34`.
- `package.json` `bin` carries a key equal to the unscoped package name (`gm-skill`), because `npx github:AnEntrypoint/gm` resolves its executable only from that key or from a `bin` whose every value is the same file. The installer treats a skill source under npm's npx cache (a `_npx` segment) as disposable and copies it. Falsified by: `node scripts/check-npx-bin.mjs` exiting non-zero, or `npx --yes github:AnEntrypoint/gm --help` printing no `Usage: gm` line.
- On Windows the installer invokes PowerShell through `runChild` with `-File <install.ps1> spool`, because `spawnSync` with `shell:true` loses argument boundaries. It rewrites the native Cursor, Gemini and Codex MCP registrations, since `add-mcp` does not migrate their legacy entries; when updating Codex it replaces the full contiguous `[mcp_servers.gm]` TOML table span. Falsified by: a PowerShell spawn in `bin/` whose line lacks `runChild`, or a Codex update that leaves a second `[mcp_servers.gm]` table in place.

The root is the published package; `package.json` lists release contents. When a skill change lands on `main`, `.github/workflows/skill-release.yml` publishes it. The agent does not assume a release succeeded without its workflow result. Falsified by: a release-facing completion report that cites no workflow run.

## Repo inventory

Authoritative list; `.gitmodules` is ground truth for submodules.

| repo | role |
| --- | --- |
| agentplug, agentplug-bert, agentplug-libsql, agentplug-treesitter, agentplug-crux, gm-config, rs-codeinsight, rs-plugkit, rs-search, gm-mcp | active-dependency (submodule) |
| rs-codeinsight, rs-search, rs-plugkit, gm | active-sibling (cascade trigger) |
| rs-learn, rs-exec, gm-skill, gm-runner-bin, 12 legacy gm-\<platform\> repos | retired-tombstone (archived; README points at rs-plugkit or gm) |

## gm-config

- `gm-config/` is a submodule. In a fresh checkout it is an empty directory and `gm-config/gm.config.json` does not resolve, until the `git_submodule_update` verb runs with `{"path":"gm-config"}` (README.md, Install).
- `gm-config/gm.config.json` fields carry no inline `_comment` keys; rationale lives here. `version` gates the schema. The file is the workflow definition that `crate::config::resolve` pulls on the debounce in `sync.debounce_ms` (`shallow` fetch; code default `DEFAULT_DEBOUNCE_MS` in `rs-plugkit/crates/plugkit-core/src/config_sync.rs`). It reproduces stock gm behaviour until edited.
- `instructions.keys` name per-state prose files under `instructions.dir`, resolved project-vendored first, then this repo's cache, then the compiled default.
- `fsm.graph` and `fsm.predicates_reference` are the state machine as data. `gates.predicate` names only a predicate generated into `predicates_reference` from the registry the code dispatches on; any other condition uses a jit hook under `fsm.hooks_dir`.
- `messages.gates_dir` and `residual_dir` are operator-editable denial and residual text; editing them never changes when a gate fires.
- `memory.embed_dim` is compile-time coupled to the baked-in model weights. A change invalidates every stored vector through an explicit drop-if-mismatch path, never silently. `memory.tencentdb_backend.vectors_db_dims` is independent of `embed_dim`: it matches whichever TencentDB-compatible provider produced the indexed content, never gm's own embedder.
- `memory_sync.*_budget_ms` bound one `memory_md.rs::sync_index` pass. A pass that cannot finish records a `:partial` digest and converges across repeated dispatches rather than blocking one.
- `rssearch.table`/`index` and the `git_commits`/`code_chunks` equivalents accept only `[A-Za-z_][A-Za-z0-9_]*`, since they interpolate into SQL.
- `scoring.*` has two fusions. `recency_floor`, `cos_floor`, `dedup_jaccard_threshold` and `half_life_ms` govern recall's cosine-times-recency score. `bm25_k1`, `bm25_b`, `fusion_rrf_k`, `fusion_identifier_boost` and `fusion_vector_list_weight` govern codesearch's BM25 plus vector RRF fusion.
- `claim_audit.extra_*` appends to the built-in defaults and never replaces them. `cache.*` budgets are per namespace, so one greedy consumer cannot evict another's entries.

Falsified by: a `rssearch.table` or `git_commits`/`code_chunks` name containing a non-identifier character that a live dispatch accepts; a `memory.embed_dim` change that leaves stored vectors in place (codesearch `embed_dim` in `rs-plugkit/crates/` must show a drop-if-mismatch branch); a `claim_audit.extra_*` value that replaces a built-in default.

## Working with gm

- The agent uses the `gm` skill for engineering work and prefers its MCP server. If the MCP server is unavailable, it uses the spool fallback: write one complete request atomically, prefix every request number with a unique session id, and poll the matching response. While a fresh watcher is busy, it never starts a second one. A stale or failed runner is a defect in its owning source. The agent never bypasses gm. Falsified by: a second watcher started while `scripts/triage/runner-status.sh` reports one busy, or a platform-native tool used where a verb exists for the same operation.
- The agent never uses `AskUserQuestion` to resolve an ambiguity or gate progress. It chooses the most defensible default, states it with a one-line rationale, and continues. A decision that genuinely needs the human is raised in prose at the end of the turn. Falsified by: a turn that blocks on an `AskUserQuestion` reply, or an ambiguity resolved by asking instead of by a stated default.
- The agent uses no hooks, settings files, environment switches or harness-only features (`PreToolUse` hooks, `CLAUDE_*` variables, permission overrides) that other apps lack. Only the skill and the program (gm and its MCP server) are needed. Falsified by: a hook or `CLAUDE_*` variable referenced by this repo, or a harness-only feature the agent relies on to change behaviour.
- The agent uses the verbs exposed by the running plugin for search, git, execution, memory and state changes. `skills/gm/docs/verbs.md` is the verb inventory (every name, body shape, and one example each). Falsified by: a Bash `grep`, `find` or `git` call where `codesearch` or a git verb covers the same operation.
- `codesearch` is the canonical search verb (`code_search` and `search` are dispatch-form aliases only), called inside `gm_codemode` as `gm.codesearch({body:{query, mode, path}})`. `grep` (alias `rg`) is its exhaustive scan for "where is this string". Body shapes, output modes and regex-reading rules: `skills/gm/docs/verbs.md` (Code lookup).
- A structural code question (who calls X, what breaks if X changes, is X dead, a diff's blast radius) is dispatched first as `callers {symbol}` or `impact {symbol}`. An empty call graph is confirmed with `codesearch`. Falsified by: a structural question answered with no `callers` or `impact` dispatch id, or an empty call graph with no following `codesearch` dispatch.
- A `fetch` reply returns only its first `max_chars` bytes, and its spill note names the result JSON that holds the whole body. The agent raises `max_chars` above the page's byte length, or reads that JSON with `gm_result` (a gm-mcp verb, `gm-mcp/src/mcp-server.js` and `gm-mcp/src/dispatch.js`; not in `rs-plugkit/`), before it concludes a needle is absent. Falsified by: a needle that the full body contains reported absent at a `max_chars` below the body length.
- A project lists its generated and vendored trees in a `.codesearchignore` at its root (gitignore syntax, read in addition to `.gitignore`; a subdirectory may carry its own, scoped to its children), so an unscoped query stays inside its 45 s budget. Dropped paths are reported in `excluded_by_rule_summary` and `excluded_by_rule_count`; gm-state exclusions (`gm_state_dir`, `agentplug_kv_cache`) stay out of `exhaustive`. Any other rule exclusion clears it. The per-path `excluded_by_rule` listing rides only when a rule dropped code.
- The on-disk PRD and mutable state are authoritative. A walk completes only when the live state machine accepts `COMPLETE`, all required rows are completed, and `gm-continue` has checked for remaining work. Falsified by: a `COMPLETE` reply while `prd-list` with `{"status":"pending"}` still returns rows.
- A subagent gets its own session id and the instruction to use the gm skill, with codeinsight (`callers`/`impact`) first. Independent work runs in parallel. Each shared surface (any file, ref, submodule pin or spool directory that two sessions can write) has one writer. A dispatch whose `cwd` is a submodule directory rewrites that submodule's tracked `.gm/last-dispatch-ts` and creates `.gm/dream-rsi/<session>/`, so the parent reports the submodule as modified. The agent restores those bytes, deletes the new session directory right after such a probe, and confirms the restore with `exec_js`, since another dispatch re-dirties it. Falsified by: a parent `git_status` naming a submodule whose only changed path lies under its `.gm/`, a subagent brief with no session id, or two briefs that write one surface.
- Every submodule tracks its `main`. The parent gitlink points to that submodule's `main` tip, never to a sha off `main`, and `.github/workflows/bump-pins.yml` advances it. Every `.gitmodules` entry carries `branch = main`. Falsified by: a green bump run whose parent gitlinks differ from the remote main tips.

## Implementation rules

- Prose is self-explanatory. A sentence stays here only when deleting it loses a fact that names, types or signatures cannot state. Falsified by: a deleted sentence whose named paths, verbs and signatures are not stated elsewhere in this file.
- The `agentplug-libsql` build keeps its `serde_json` `preserve_order` feature, so that query rows and the JavaScript `columns` result keep SQL SELECT order. Falsified by: a codesearch literal `preserve_order` in `agentplug-libsql/Cargo.toml` returning zero hits.
- Synthetic = a test, mock or stub that bypasses the real entry point. Placeholder = TODO/FIXME or a stand-in value. Decorative glyph = a non-ASCII symbol the text does not need, so tracked prose (docs, skills, READMEs, changelogs, source comments) carries no em-dash or arrow used as decoration. A glyph that carries meaning (a quoted character, a detector pattern, a Unicode name, a spawn chain) stays. The agent verifies through the actual build and a live spool dispatch. Falsified by: a verification with no live dispatch id, a test or mock file in the delivered paths, or a decorative em-dash or arrow in tracked prose.
- Before each change, the agent states a falsifiable hypothesis and the live witness that would refute it. Falsified by: a change whose receipt names no hypothesis or no witness dispatch id.
- Every tracked text file is UTF-8 without a byte-order mark. Falsified by: a tracked text file whose first three bytes are `EF BB BF`.
- A single-writer or lock guard creates its marker by atomic create or atomic rename. Falsified by: a marker write in the guard's source that uses a plain write with no create-new or rename step.
- Configuration prose keys and source paths are untrusted relative paths; only safe components are accepted. Only HTTP(S) remote transports with a nonempty authority are accepted. Falsified by: `fs_read {"path":"../etc/hostname"}` returning `ok: true` (it returns `error_code: failed`), or a remote transport with a non-HTTP(S) scheme accepted by a live dispatch.
- Durable memory is source. Delete every entry that is not current (a path, verb or setting it names no longer resolves) or not reusable (it states no rule for a future task). `.gm/receipts/<row>/` is kept while its row is pending or blocked and pruned once the row is resolved. `.gm/witness-log.md` is append-only; a line is pruned only when no pending row cites it and its walk reached COMPLETE. Falsified by: a stored memory entry whose named path or verb `fs_stat` or `codesearch` cannot resolve.
- A doc names only paths and verbs that resolve, describes current behaviour in the present tense, and states no fact twice. Detailed protocol, release and incident material lives in its owning README, source or changelog. Falsified by: `fs_stat` failing on a path a doc names, or a codesearch regex `wa[s]\b|u[s]ed to` matching a line of the doc outside backtick-quoted text.
- Windows child spawns in `agentplug` follow the windowless rule in `agentplug/AGENTS.md` (Runtime invariants). The config-source remote-tip probe (one machine-global record shared by native and wasm, its re-probe rule and falsifier) is owned by `rs-plugkit/AGENTS.md`.
- This file stays under 30,000 UTF-8 bytes. Revalidate: every kept line names a path or verb that still resolves in source; failing lines go first. Falsified by: a file size of 30,000 bytes or more, or a path or verb this file names that `fs_stat` or `codesearch` cannot resolve.
- Before a guest-to-sibling import reports the sibling absent, the import calls `crate::registry::ensure_sibling_registered` (defined in `agentplug/crates/agentplug-host/src/registry.rs`, called from `agentplug/crates/agentplug-host/src/imports.rs`); without that call every embedding-dependent verb fails on every project. Falsified by: a codesearch literal `ensure_sibling_registered` in `agentplug/crates/agentplug-host/src/imports.rs` returning zero hits.
- Self-update guards compare build identity (`build_info::COMMIT`, `build_info::BUILD_TS`, `build_info::is_release_build()`; `RELEASE_BUILD` is generated into `agentplug/crates/agentplug-runner/src/build_info.rs` from `agentplug/crates/agentplug-runner/build.rs`), never the version string, because a same-version release can be a downgrade. The guard is `agentplug/crates/agentplug-runner/src/download.rs`. Falsified by: a self-update guard whose only comparison is on the version string.
- `git_commit_dedup_lookup` answers a replay only while `rev-parse HEAD` equals the recorded `sha_full`. Object existence is not enough, because `git_reset` leaves dropped objects present. Falsified by: a replay answered after `git_reset` moves HEAD off the recorded `sha_full`.
- Dream-RSI's cycle trigger dispatches `dream-replay-cycle` only. The write rule is owned by `rs-plugkit/crates/plugkit-core/src/orchestrator/AGENTS.md`. A reversible session-scoped probe is not an unattended redeploy; project-wide promotion is a gated agent dispatch. Falsified by: a codesearch literal `active-strategy` in `agentplug/crates/agentplug-runner/src/dream_cycle.rs` returning any hit.
- Rebuilding `rs-plugkit` passes `--features slim`, the build command that `rs-plugkit/AGENTS.md` owns. Falsified by: a built `rs-plugkit` wasm of 100 MB or more.
- `scripts/sync-lean-graph.mjs emit` copies gm-config's authored graph and prose into an outdir and never into `rs-plugkit`. `rs-plugkit/crates/plugkit-core/src/orchestrator/fsm.rs` holds the lean graph as `include_str!("lean_graph.json")` and validates it into the enforced gates, so replacing it needs its own reviewed rebuild. Falsified by: an `emit` that writes any path under `rs-plugkit/`.
- The Windows job object that `agentplug/crates/agentplug-host/src/process_tree.rs` assigns to an exec child carries no `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. `terminate_containment` (timeout expiry, `task-stop`) is the only path that ends the tree (`docs/verified-incidents.md`, Verified 2026-10-11). Falsified by: that literal in that file outside a comment.
- A status snapshot reads slot state through `slot_snapshot_without_blocking()` (`agentplug/crates/agentplug-host/src/registry.rs`), never through a slot mutex, so a long dispatch cannot stall the heartbeat (`docs/verified-incidents.md`, Verified 2026-09-14). Falsified by: a codesearch literal `slot_content_hashes` in `agentplug/crates/agentplug-runner/src/daemon.rs` returning a hit.
- Credentials and secrets never enter a commit. Before each commit the agent runs `node scripts/check-staged-secrets.mjs` in the repository being committed, and commits only when it prints `RESULT: PASS`. The script reads only the staged diff (`git diff --cached`); a history-wide scan is out of scope, and rewriting pushed history needs the owner's approval. Falsified by: a commit whose staged diff contains a line the script reports, or a commit whose receipt names no script run.

## Triage scripts and pin bumps

`scripts/triage/` holds the one-call checks; each script's header states its usage and output (`scripts/triage/runner-status.sh` exits 1 when dead, `scripts/triage/doctor.sh` exits 1 when any check fails). `.github/workflows/bump-pins.yml` runs `scripts/bump-pins.sh` on every push to main, on each submodule release and hourly, and commits the advanced pins to main with no `[skip ci]`, so the pin commit starts the full CI set on its own sha. Each attempt resets to `origin/main`. A rejected push recomputes every pin on the new base and never skips one. A target is gated when its tip has a non-green release, publish, build or wasm run; an unreadable gate holds it. A held tip falls back to the newest green of its last six main commits. `scripts/triage/check-pins.sh` runs on the candidate before the push, and a manual submodule bump runs it too. The commit body names the bump run. Falsified by: a green bump run whose parent gitlinks differ from the remote main tips, a bump commit with no passing `scripts/triage/check-pins.sh`, or a bump commit with no bump run id.

## Verification and delivery

The agent verifies the changed surface through its real entry point. For `rs-plugkit`, it builds the guest and witnesses the changed verb through `agentplug-runner`. After a `gm-mcp` source or input-schema change it rebuilds the bundle. After a release-facing change it inspects the relevant workflow run and the resulting artifact. Falsified by: a changed verb with no witness dispatch id, a `gm-mcp` source diff with no rebuilt bundle, or a release-facing change with no workflow run cited.

Before a diagnostic override, the agent saves the original property descriptor, records whether the target owns the property, and refuses any override whose original state cannot be restored. Temporary own properties are `configurable: true`. In `finally`, an original own property is restored with its saved descriptor and an inherited property's temporary shadow is deleted. Before the final live witness, the agent verifies the original lookup and the absence of probe state. Falsified by: an override with no saved descriptor, or a final lookup whose descriptor differs from the saved one.

Git work uses the gm git verbs, and `git_remote` inspects remote URLs and the upstream without fetching or mutating state. Before delivery the agent confirms that no residual remains (a pending PRD row, dirty path or unpushed commit), that every parent gitlink equals its submodule's remote `main` tip, and that the remote is verified. Work stays on `main` in every repository; no branch holds work in progress. A collision (`conflicted: true`, an unmerged `UU` path, or a `.git/MERGE_HEAD`) is resolved and landed on `main` in the same turn, never parked. An unmerged submodule resolves to a commit that exists on that submodule's remote, and the parent pin follows. Falsified by: a repository left on a branch other than `main`, a `.git/MERGE_HEAD` present at the end of a turn, or a `UU` path in `git_status`. A completion report cites a live witness reply. Falsified by: a Bash `git` call in place of a gm git verb, a push with no prior `git_remote` reply, or a completion report with no witness reply.

The `gm-mcp` server compacts every dispatch response before it crosses the wire; `gm-mcp/AGENTS.md` records which fields compact and why. Falsified by: a dispatch reply on the wire that still carries a field `gm-mcp/AGENTS.md` lists as compacted.

## Live validation interfaces

- `node scripts/triage/dispatch-verb.mjs <verb> --cwd <project> --raw <body>` dispatches any spool verb, including verbs the MCP table does not expose such as `crawl`, and prints the reply and latency. It touches only the local spool.
- `agentplug-runner selfcheck-update-probes` reads the release channel for the runner, every loaded plugin and the skill manifest, through the daemon's own functions. Its only write is the skill manifest cache.
- `node <toolsDir>/gm-mcp-server.mjs self-update-status` prints the channel cache: the stored etag, the digest, the time of the last unconditional fetch and the outcome of the last check. `self-update-now` forces a check.
- Browser control is witnessed through `crawl` with `session=`, `expect=`, `reload` and `close`. The reply names the tab and logs each step.

## Dated findings and design

- Dated runtime findings (daemon heartbeat, sibling imports, runner self-update, wasm sideload, git_commit content filters, amend, reset) live in `docs/verified-incidents.md`. The agent reads it when a failure touches one of those subsystems. Falsified by: a failure in one of those subsystems diagnosed with no read of that file in the session.
- Dream-RSI design, the cycle-boundary trigger and its git lifecycle: `skills/dream-rsi/references/dream-rsi.md`.
- Script and CI rationale: `docs/script-rationale.md`.
