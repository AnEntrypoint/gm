# AGENTS.md

Publish `gm-skill` release artifact. Installed gm skill (prompt `gm`) = `skills/gm/SKILL.md`. `rs-plugkit` serve state machine via spool verbs. Rationale code cannot state lives here.

## Purpose

Start work: read `SKILLS.md`. Request or edited file match skill's frontmatter description: read `skills/<name>/SKILL.md`. Served `instruction`, project config, applicable skill override this file. Falsified by: `fs_stat` on `SKILLS.md` or `skills/<name>/SKILL.md` returning error, or served `instruction` reply contradicting applicable skill.

## Core invariants

1. Traverse: gm-graph walk runs in every free slot. Each node pass files PRD rows from its discipline, nominates next node from its outward links, hands on one-line rhetoric.
2. Drain first: pending rows exist, every free slot drains rows. Under 20 open rows, free slots traverse computer-science disciplines to file rows.
3. Orient (gm-orient): codesearch + codeinsight before any edit. Top 20 BM25, top 20 vector, top 20 commits, each with 3 live snippet lines. DB stores embeddings and ids only.
4. Resolve through six skills, each loads next: gm-orient, gm-unknowns, gm-eliminate (JIT runs; new unknowns return here), gm-edit, gm-validate (JIT runs; failures return to gm-eliminate), gm-publish.
5. Unknowns: file with `unknown-add` (status `unknown` while open), close with `unknown-resolve`. Elimination ends only when none open.
6. Publish on main only: merge upstream, commit local work by explicit path, push, read CI. Failing job returns to gm-eliminate.
7. Plugkit runs 4 concurrent workers. Call over 15 s moves to background, frees its worker. Browser or GPU call takes lease; browsers stay hot per project.
8. Subagent stopped by network or API error: restart for same row. Never resume, never park as blocked.
9. Row ends resolved with witness, or blocked with named fact. Blocked row not duplicated.
10. Success: rows always drain; traversal refills before they run out.
11. Work on main. Never clone repo for scratch copy, fake worktree, or throwaway checkout. Edit shared checkout on `main` via gm verbs, or publish with `publish_on_origin` from that checkout. Collision fixed by recovery (fetch, reapply change on origin's tip, push), never avoided by cloning. Falsified by: clone or worktree of managed repo created outside explicitly named recovery step.

## Skill installs

Installed skill must be the file it is installed from, or install must say it is not. `install.sh`, `install.ps1`, `bin/gm-install.js` materialise `~/.claude/skills/<name>` and `~/.agents/skills/<name>` from `<checkout>/skills/` (or `GM_SKILL_SOURCE_DIR`) as link (junction on Windows, symlink elsewhere), so source edit served on next dispatch. No durable source (release-tarball route, or package under npm's npx cache, a `_npx` segment npm can delete): install copies, announces it, records mode in `<root>/.gm-skill-install-modes`. Against checkout, copy is drift even when contents match.

Displaced install parks under dotted `<root>/.gm-skill-prelink/` (plain sibling would be served as skill), never deleted, since `.gm` state may be live. Deleting needs `--force-link` (bin/gm-install.js); `GM_SKILL_LINK_FORCE=1` applies only to install.sh and install.ps1 (bin/gm-install.js never reads that env var).

MSYS `ln -s` silently copies when symlink creation refused, so on MINGW/MSYS/CYGWIN only `mklink /J` counts as link. `install.sh` sets `MSYS_NO_PATHCONV=1`, uses `pwd -P`, since `readlink -f` not portable. `install.ps1` unlinks links, never recurses into them. `docs/skills.html` describes rule. `agentplug/crates/agentplug-runner/src/download.rs refresh_installed_skills` runs every 60 s in daemon: fetches `skills/manifest.sha256` from `main` (written by `scripts/build-skill-manifest.mjs`, checked by `.github/workflows/skill-release.yml`), re-fetches each changed file, installs new skills into gm-managed copy roots, skips source-linked install, parks stale files and retired copies. Falsified by: edit to `skills/<name>/SKILL.md` not visible at `~/.claude/skills/<name>/SKILL.md`, or `node bin/gm-install.js --check-skills` printing `DRIFT`.

## Glossary

- **walk**: one run of gm state machine, driven by pool loop in `skills/gm-orchestrate/SKILL.md` (Core loop).
- **hop**: one traversal of principle node by one `gm-hop` subagent (`skills/gm-hop/SKILL.md`). **candidate**: outgoing edge of current node. **successor**: next hop, spawned from candidate, which receives handover rhetoric.
- **traversal**: chain of hops within one walk, bounded by visited set and depth limit.
- **node**: vertex of `skills/dream-rsi/gm-graph.json`. Only principle nodes visited; gate, terminal, phase and tension nodes refused.
- **subagent**: agent started by host as subagent. **worker**: walk-launched hop or PRD row resolver with own SESSION_ID.
- **slot**: one unit under concurrency ceiling, held by launched subagent until complete. Freed slot refilled while independent work remains.
- **row**: one PRD entry, pending or resolved. `prd-resolve` closes it with witness.

## Ownership

- `skills/gm/SKILL.md` owns agent workflow and tool routing.
- `gm-config/` owns default phase prose, gate text, residual text, FSM graph. Project-local vendored config key served instead of cached or compiled prose. Falsified by: vendored key set in project whose `instruction` reply still carries cached or compiled text.
- `rs-plugkit/` is WASM guest implementing orchestration, spool verbs, memory, code search.
- `agentplug/` provides `agentplug-runner`, native WASM host, only supported loader.
- `gm-mcp/` wraps spool write-and-poll cycle. Agent edits `gm-mcp/src/` and rebuilds its committed bundle together. Serves stdio only, opens no listening port; streamable HTTP transport runs only when started by hand with `--http`, nothing starts it automatically. Transport failure modes and registration command owned by `gm-mcp/README.md` (Transport section). Falsified by: delivery whose `gm-mcp/src/` diff lacks matching bundle diff.
- `install.sh` and `install.ps1` install skill and runner. Equivalent = same installed paths and same MCP registration command.
- `bin/gm-install.js` registers MCP server as `node ~/.gm-tools/gm-mcp-server.mjs` (project `.mcp.json`: `node -e` launcher that resolves that path at start). Never registers `npx github:` spec; measured connect-timeout rationale owned by `README.md` (MCP launch paragraph). Falsified by: codesearch literal `npx github:` in `bin/` matching a registration rather than message at `bin/gm-install.js:34`.
- npx installer route is retired: `package.json` `bin` has no `gm-skill` key, and no `npx github:` spec installs or registers anything. Install and MCP registration go through `bin/gm-install.js` (README Install). Falsified by: codesearch literal `npx github:` in `bin/` or `package.json` `bin` carrying `gm-skill`.
- On Windows installer invokes PowerShell through `runChild` with `-File <install.ps1> spool`, because `spawnSync` with `shell:true` loses argument boundaries. It rewrites native Cursor, Gemini, Codex MCP registrations, since `add-mcp` does not migrate their legacy entries; when updating Codex it replaces full contiguous `[mcp_servers.gm]` TOML table span. Falsified by: PowerShell spawn in `bin/` whose line lacks `runChild`, or Codex update leaving second `[mcp_servers.gm]` table in place.

Root = published package; `package.json` lists release contents. Skill change lands on `main`, then `.github/workflows/skill-release.yml` publishes it. Do not assume release succeeded without its workflow result. Falsified by: release-facing completion report citing no workflow run.

## Repo inventory

Authoritative list; `.gitmodules` is ground truth for submodules.

| repo | role |
| --- | --- |
| agentplug, agentplug-bert, agentplug-libsql, agentplug-treesitter, agentplug-crux, gm-config, rs-codeinsight, rs-plugkit, rs-search, gm-mcp | active-dependency (submodule) |
| rs-codeinsight, rs-search, rs-plugkit, gm | active-sibling (cascade trigger) |
| rs-learn, rs-exec, gm-skill, gm-runner-bin, 12 legacy gm-\<platform\> repos | retired-tombstone (archived; README points at rs-plugkit or gm) |

## gm-config

- `gm-config/` is submodule. Fresh checkout: empty dir, `gm-config/gm.config.json` does not resolve until `git_submodule_update` runs with `{"path":"gm-config"}` (README.md, Install).
- `gm-config/gm.config.json` fields carry no inline `_comment` keys; rationale lives here. `version` gates schema. File is workflow definition `crate::config::resolve` pulls on debounce in `sync.debounce_ms` (`shallow` fetch; code default `DEFAULT_DEBOUNCE_MS` in `rs-plugkit/crates/plugkit-core/src/config_sync.rs`). Reproduces stock gm behaviour until edited.
- `instructions.keys` name per-state prose files under `instructions.dir`. Resolved: project-vendored first, then this repo's cache, then compiled default.
- `fsm.graph` and `fsm.predicates_reference` = state machine as data. `gates.predicate` names only predicate generated into `predicates_reference` from registry code dispatches on; any other condition uses jit hook under `fsm.hooks_dir`.
- `messages.gates_dir` and `residual_dir` = operator-editable denial and residual text. Editing them never changes when gate fires.
- `memory.embed_dim` compile-time coupled to baked-in model weights. Change invalidates every stored vector through explicit drop-if-mismatch path, never silently. `memory.tencentdb_backend.vectors_db_dims` independent of `embed_dim`: matches whichever TencentDB-compatible provider produced indexed content, never gm's own embedder.
- `memory_sync.*_budget_ms` bound one `memory_md.rs::sync_index` pass. Pass that cannot finish records `:partial` digest, converges across repeated dispatches instead of blocking one.
- `rssearch.table`/`index` and `git_commits`/`code_chunks` equivalents accept only `[A-Za-z_][A-Za-z0-9_]*`, since they interpolate into SQL.
- `scoring.*` has two fusions. `recency_floor`, `cos_floor`, `dedup_jaccard_threshold`, `half_life_ms` govern recall's cosine-times-recency score. `bm25_k1`, `bm25_b`, `fusion_rrf_k`, `fusion_identifier_boost`, `fusion_vector_list_weight` govern codesearch's BM25 plus vector RRF fusion.
- `claim_audit.extra_*` appends to built-in defaults, never replaces. `cache.*` budgets per namespace, so one greedy consumer cannot evict another's entries.

Falsified by: `rssearch.table` or `git_commits`/`code_chunks` name with non-identifier character that live dispatch accepts; `memory.embed_dim` change leaving stored vectors in place (codesearch `embed_dim` in `rs-plugkit/crates/` must show drop-if-mismatch branch); `claim_audit.extra_*` value replacing built-in default.

## Working with gm

- Use `gm` skill for engineering work through its MCP server (`gm_codemode`). If server unavailable, report it; never write spool files or start/restart runner by hand. Stale or failed runner = defect in its owning source. Never bypass gm. Falsified by: spool file written by hand, runner started or restarted by hand, or platform-native tool used where verb exists for same operation.
- Never block turn on question to user to resolve ambiguity or gate progress. Pick most defensible default, state it with one-line rationale, continue. Decision that genuinely needs human: raise in prose at end of turn. Falsified by: turn blocking on question to user, or ambiguity resolved by asking instead of stated default.
- Use no hooks, settings files, env switches, or harness-only features (host hook events, host-specific env vars, permission overrides) that other apps lack. Only skill and program (gm and its MCP server) needed. Falsified by: host hook or host-specific env var referenced by this repo, or harness-only feature relied on to change behaviour.
- Use verbs exposed by running plugin for search, git, execution, memory, state changes. `skills/gm/docs/verbs.md` = verb inventory (every name, body shape, one example each). Falsified by: shell `grep`, `find`, or `git` call where `codesearch` or git verb covers same operation.
- `codesearch` = canonical search verb (`code_search` and `search` dispatch-form aliases only), called inside `gm_codemode` as `gm.codesearch({body:{query, mode, path}})`. `grep` (alias `rg`) = its exhaustive scan for "where is this string". Body shapes, output modes, regex-reading rules: `skills/gm/docs/verbs.md` (Code lookup).
- Structural code question (who calls X, what breaks if X changes, is X dead, diff's blast radius) dispatched first as `callers {symbol}` or `impact {symbol}`. Empty call graph confirmed with `codesearch`. Falsified by: structural question answered with no `callers` or `impact` dispatch id, or empty call graph with no following `codesearch` dispatch.
- `fetch` reply returns only first `max_chars` bytes; spill note names result JSON holding whole body. Raise `max_chars` above page's byte length, or read that JSON with `gm_result` (gm-mcp verb, `gm-mcp/src/mcp-server.js` and `gm-mcp/src/dispatch.js`; not in `rs-plugkit/`), before concluding needle absent. Falsified by: needle full body contains reported absent at `max_chars` below body length.
- Project lists generated and vendored trees in `.codesearchignore` at root (gitignore syntax, read in addition to `.gitignore`; subdirectory may carry own, scoped to children), so unscoped query stays inside 45 s budget. Dropped paths reported in `excluded_by_rule_summary` and `excluded_by_rule_count`; gm-state exclusions (`gm_state_dir`, `agentplug_kv_cache`) stay out of `exhaustive`. Any other rule exclusion clears it. Per-path `excluded_by_rule` listing rides only when rule dropped code.
- On-disk PRD and unknown rows authoritative. Walk completes only when live state machine accepts `COMPLETE`, all required rows completed, and `gm-continue` checked for remaining work. Falsified by: `COMPLETE` reply while `prd-list` with `{"status":"pending"}` still returns rows.
- Subagent gets own session id and instruction to use gm skill, with codeinsight (`callers`/`impact`) first. Independent work runs in parallel. Each shared surface (any file, ref, submodule pin, or spool directory two sessions can write) has one writer. Dispatch whose `cwd` is submodule dir rewrites that submodule's tracked `.gm/last-dispatch-ts` and creates `.gm/dream-rsi/<session>/`, so parent reports submodule as modified. Restore those bytes, delete new session dir right after such probe, confirm restore with `exec_js`, since another dispatch re-dirties it. Falsified by: parent `git_status` naming submodule whose only changed path lies under its `.gm/`, subagent brief with no session id, or two briefs writing one surface.
- Every submodule tracks its `main`. Parent gitlink points to submodule's `main` tip, never sha off `main`; `.github/workflows/bump-pins.yml` advances it. Every `.gitmodules` entry carries `branch = main`. Falsified by: green bump run whose parent gitlinks differ from remote main tips.

## Implementation rules

- Prose self-explanatory. Sentence stays only when deleting it loses fact names, types, or signatures cannot state. Falsified by: deleted sentence whose named paths, verbs, and signatures not stated elsewhere in this file.
- `agentplug-libsql` build keeps `serde_json` `preserve_order` feature, so query rows and JavaScript `columns` result keep SQL SELECT order. Falsified by: codesearch literal `preserve_order` in `agentplug-libsql/Cargo.toml` returning zero hits.
- Synthetic = test, mock, or stub that bypasses real entry point. Placeholder = TODO/FIXME or stand-in value. Decorative glyph = non-ASCII symbol text does not need, so tracked prose (docs, skills, READMEs, changelogs, source comments) carries no em-dash or arrow used as decoration. Glyph carrying meaning (quoted character, detector pattern, Unicode name, spawn chain) stays. Verify through actual build and live spool dispatch. Falsified by: verification with no live dispatch id, test or mock file in delivered paths, or decorative em-dash or arrow in tracked prose.
- Before each change, state falsifiable hypothesis and live witness that would refute it. Falsified by: change whose receipt names no hypothesis or no witness dispatch id.
- Every tracked text file UTF-8 without byte-order mark. Falsified by: tracked text file whose first three bytes are `EF BB BF`.
- Single-writer or lock guard creates its marker by atomic create or atomic rename. Falsified by: marker write in guard's source using plain write with no create-new or rename step.
- Config prose keys and source paths = untrusted relative paths; only safe components accepted. Only HTTP(S) remote transports with nonempty authority accepted. Falsified by: `fs_read {"path":"../etc/hostname"}` returning `ok: true` (it returns `error_code: failed`), or remote transport with non-HTTP(S) scheme accepted by live dispatch.
- Durable memory is source. Delete every entry not current (path, verb, or setting it names no longer resolves) or not reusable (states no rule for future task). `.gm/receipts/<row>/` kept while its row pending or blocked, pruned once resolved. `.gm/witness-log.md` is cache: prd-resolve copies each row's witness into `.gm/prd-log.jsonl`, so line may be pruned any time. Falsified by: stored memory entry whose named path or verb `fs_stat` or `codesearch` cannot resolve.
- Doc names only paths and verbs that resolve, describes current behaviour in present tense, states no fact twice. Detailed protocol, release, and incident material lives in its owning README, source, or changelog. Falsified by: `fs_stat` failing on path doc names, or codesearch regex `wa[s]\b|u[s]ed to` matching doc line outside backtick-quoted text.
- Windows child spawns in `agentplug` follow windowless rule in `agentplug/AGENTS.md` (Runtime invariants). Config-source remote-tip probe (one machine-global record shared by native and wasm, its re-probe rule and falsifier) owned by `rs-plugkit/AGENTS.md`.
- File stays under 30,000 UTF-8 bytes. Revalidate: every kept line names path or verb that still resolves in source; failing lines go first. Falsified by: file size 30,000 bytes or more, or path or verb this file names that `fs_stat` or `codesearch` cannot resolve.
- Before guest-to-sibling import reports sibling absent, import calls `crate::registry::ensure_sibling_registered` (defined in `agentplug/crates/agentplug-host/src/registry.rs`, called from `agentplug/crates/agentplug-host/src/imports.rs`); without that call every embedding-dependent verb fails on every project. Falsified by: codesearch literal `ensure_sibling_registered` in `agentplug/crates/agentplug-host/src/imports.rs` returning zero hits.
- Self-update guards compare build identity (`build_info::COMMIT`, `build_info::BUILD_TS`, `build_info::is_release_build()`; `RELEASE_BUILD` generated into `agentplug/crates/agentplug-runner/src/build_info.rs` from `agentplug/crates/agentplug-runner/build.rs`), never version string, since same-version release can be downgrade. Guard = `agentplug/crates/agentplug-runner/src/download.rs`. Falsified by: self-update guard whose only comparison is on version string.
- `git_commit_dedup_lookup` answers replay only while `rev-parse HEAD` equals recorded `sha_full`. Object existence not enough, since `git_reset` leaves dropped objects present. Falsified by: replay answered after `git_reset` moves HEAD off recorded `sha_full`.
- Dream-RSI cycle trigger dispatches `dream-replay-cycle` only. Write rule owned by `rs-plugkit/crates/plugkit-core/src/orchestrator/AGENTS.md`. Reversible session-scoped probe is not unattended redeploy; project-wide promotion is gated agent dispatch. Falsified by: codesearch literal `active-strategy` in `rs-plugkit/crates/plugkit-core/src/orchestrator/dream_cycle.rs` returning any hit.
- Rebuilding `rs-plugkit` passes `--features slim`, build command owned by `rs-plugkit/AGENTS.md`. Falsified by: built `rs-plugkit` wasm of 100 MB or more.
- `scripts/sync-lean-graph.mjs emit` copies gm-config's authored graph and prose into outdir, never into `rs-plugkit`. `rs-plugkit/crates/plugkit-core/src/orchestrator/fsm.rs` holds lean graph as `include_str!("lean_graph.json")` and validates it into enforced gates, so replacing it needs own reviewed rebuild. Falsified by: `emit` that writes any path under `rs-plugkit/`.
- Windows job object that `agentplug/crates/agentplug-host/src/process_tree.rs` assigns to exec child carries no `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. `terminate_containment` (timeout expiry, `task-stop`) is only path that ends tree (`docs/verified-incidents.md`, Verified 2026-10-11). Falsified by: that literal in that file outside comment.
- Status snapshot reads slot state through `slot_snapshot_without_blocking()` (`agentplug/crates/agentplug-host/src/registry.rs`), never through slot mutex, so long dispatch cannot stall heartbeat (`docs/verified-incidents.md`, Verified 2026-09-14). Falsified by: codesearch literal `slot_content_hashes` in `agentplug/crates/agentplug-runner/src/daemon.rs` returning hit.
- Credentials and secrets never enter commit. Before each commit run `node scripts/check-staged-secrets.mjs` in repo being committed; commit only when it prints `RESULT: PASS`. Script reads only staged diff (`git diff --cached`); history-wide scan out of scope; rewriting pushed history needs owner's approval. Falsified by: commit whose staged diff contains line script reports, or commit whose receipt names no script run.

## Triage scripts and pin bumps

`scripts/triage/` holds one-call checks; each script's header states usage and output (`scripts/triage/runner-status.mjs` exits 1 when dead, `scripts/triage/doctor.sh` exits 1 when any check fails). `.github/workflows/bump-pins.yml` runs `scripts/bump-pins.sh` on every push to main, on each `submodule-released` dispatch (each submodule sends one on push to main from its `notify-gm` workflow), and hourly. It commits advanced pins to main with no `[skip ci]`, so pin commit starts full CI set on its own sha. Each attempt resets to `origin/main`. Rejected push recomputes every pin on new base, never skips one. Target gated when its tip has non-green release, publish, build, or wasm run; unreadable gate holds it. Tip whose repo has no CI workflow (only workflows are release, publish, notify-gm, or pages) is green without run; `notify-gm` runs are not gate rows. Held tip falls back to newest green of its last six main commits. `scripts/triage/check-pins.sh` runs on candidate before push; manual submodule bump runs it too. Commit body names bump run. Falsified by: green bump run whose parent gitlinks differ from remote main tips, bump commit with no passing `scripts/triage/check-pins.sh`, or bump commit with no bump run id.

## Verification and delivery

Verify changed surface through its real entry point. For `rs-plugkit`, build guest and witness changed verb through `agentplug-runner`. After `gm-mcp` source or input-schema change, rebuild bundle. After release-facing change, inspect relevant workflow run and resulting artifact. Falsified by: changed verb with no witness dispatch id, `gm-mcp` source diff with no rebuilt bundle, or release-facing change with no workflow run cited.

Before diagnostic override, save original property descriptor, record whether target owns property, refuse any override whose original state cannot be restored. Temporary own properties are `configurable: true`. In `finally`, original own property restored with saved descriptor; inherited property's temporary shadow deleted. Before final live witness, verify original lookup and absence of probe state. Falsified by: override with no saved descriptor, or final lookup whose descriptor differs from saved one.

Git work uses gm git verbs; `git_remote` inspects remote URLs and upstream without fetching or mutating state. Before delivery, confirm no residual remains (pending PRD row, dirty path, or unpushed commit), every parent gitlink equals its submodule's remote `main` tip, and remote verified. Work stays on `main` in every repo; no branch holds work in progress. Collision (`conflicted: true`, unmerged `UU` path, or `.git/MERGE_HEAD`) resolved and landed on `main` same turn, never parked. Unmerged submodule resolves to commit existing on that submodule's remote; parent pin follows. Falsified by: repo left on branch other than `main`, `.git/MERGE_HEAD` present at end of turn, or `UU` path in `git_status`. Completion report cites live witness reply. Falsified by: shell `git` call in place of gm git verb, push with no prior `git_remote` reply, or completion report with no witness reply.

`gm-mcp` server compacts every dispatch response before it crosses wire; `gm-mcp/AGENTS.md` records which fields compact and why. Falsified by: dispatch reply on wire still carrying field `gm-mcp/AGENTS.md` lists as compacted.

## Live validation interfaces

- `gm.<verb>({...})` through `gm_codemode` dispatches any verb `gm.list()` names, including `browser`. `gm.status({cwd})` reports daemon heartbeat and queue; `gm.health({cwd})` reports served build.
- Browser control witnessed through `browser` with `session=`, `expect=`, `reload`, and `close`. Reply names tab and logs each step.

## Dated findings and design

- Dated runtime findings (daemon heartbeat, sibling imports, runner self-update, wasm sideload, git_commit content filters, amend, reset) live in `docs/verified-incidents.md`. Read when failure touches one of those subsystems. Falsified by: failure in one of those subsystems diagnosed with no read of that file in session.
- Dream-RSI design, cycle-boundary trigger, and git lifecycle: `skills/dream-rsi/references/dream-rsi.md`.
- Script and CI rationale: `docs/script-rationale.md`.

## Debugging gm workflows
- Run that makes no progress checked first: compare in-flight agents with cap, read `.gm/exec-spool/.status.json`. Restart only with skill or script change addressing cause.