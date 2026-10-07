# AGENTS.md

## Purpose

This SolutionsAsService fork ships a lightweight, bounded `/gm` skill by default. `skills/gm/SKILL.md` is the canonical procedure. The inherited `rs-plugkit`/agentplug runtime is optional and is not installed, launched or reconfigured by ordinary skill use.

Read `SKILLS.md` before starting work. Read every relevant `skills/<name>/SKILL.md` before using that skill. The default skill applies to repository work; higher-priority host policy and user authorization always apply. Inherited runtime notes below describe optional components, not prerequisites or authority to expand a task.

## Ownership

- `skills/gm/SKILL.md` owns agent workflow and tool routing.
- `gm-config/` owns default phase prose, gate text, residual text, and the FSM graph. Project-local vendored configuration takes precedence; compiled prose is a fallback.
- `rs-plugkit/` is the WASM guest that implements orchestration, spool verbs, memory, and code search.
- `agentplug/` provides `agentplug-runner`, the native WASM host. It is the only supported loader.
- `gm-mcp/` wraps the spool write-and-poll cycle. Edit `src/` and rebuild its committed bundle together.
- `gm-mcp/` serves two transports from the same bundle: stdio (the default registration, and the one a client can lose permanently) and stateless streamable HTTP on `127.0.0.1:8787/mcp`. A stdio MCP server is a child the client owns on one pipe; once that pipe goes, `mcp__gm__gm` is gone for the rest of the session and only `/mcp` reconnect or a restart brings it back. Register the durable one with `claude mcp add --transport http gm http://127.0.0.1:8787/mcp -s user`; `gm-mcp-server.mjs ensure-http` starts the shared server, and a stdio server seeds it on start so it is already up. The HTTP one is not immune: if the port is empty when a session's client connects, that client answers "MCP server \"gm\" is not connected" for the rest of the session and no server-side fix re-dials it -- restoring the port helps every new session, and the stranded one needs `/mcp` reconnect or a restart.
- `install.sh` and `install.ps1` install the bundled skills by default. Runtime and runner setup require explicit opt-in flags. Keep their platform behavior equivalent.
- `bin/gm-install.js` installs bundled local skills by default. Only explicit runtime/MCP opt-in registers `node ~/.gm-tools/gm-mcp-server.mjs` (project `.mcp.json`: a `node -e` launcher resolving that path at start). Do not register an `npx github:` server spec that fetches packages on every connection.
- For explicit Windows runner installation, spawn PowerShell directly with argument arrays and `-File <install.ps1> --with-runtime --runner-only spool`; do not send these arguments through a shell. Preserve unrelated configuration when migrating legacy MCP entries. Replace only the full contiguous `[mcp_servers.gm]` TOML table span when updating Codex.

The root is the published package. `package.json` lists release contents. `skill-release.yml` is manually dispatched and publishes only to the current repository; ordinary pushes run checks, not releases. Do not assume a release succeeded without its workflow result.

## Repo inventory

Authoritative list; `.gitmodules` is ground truth for submodules.

| repo | role |
| --- | --- |
| agentplug, agentplug-bert, agentplug-libsql, agentplug-treesitter, agentplug-crux, gm-config, rs-codeinsight, rs-plugkit, rs-search, obrowser, gm-mcp, vendor/tencentdb-agent-memory | active-dependency (submodule) |
| rs-codeinsight, rs-search, rs-plugkit, gm | active-sibling (cascade trigger) |
| rs-learn, rs-exec, gm-skill, gm-runner-bin, 12 legacy gm-\<platform\> repos | retired-tombstone (archived, README points at rs-plugkit or gm) |

`gm-config/gm.config.json` fields carry no inline `_comment` keys -- rationale lives here. `version` gates the schema; the file IS the workflow definition `crate::config::resolve` pulls on the debounce in `sync.debounce_ms` (default 300000ms, `shallow` fetch), reproducing stock gm behavior unmodified until edited. `instructions.keys` name per-state prose files under `instructions.dir`, resolved project-vendored-first then this repo's cache then compiled default. `fsm.graph`/`fsm.predicates_reference` are the state machine as data; `gates.predicate` may only name a predicate generated into `predicates_reference` from the same registry the code dispatches on -- a condition outside that registry needs a jit hook under `fsm.hooks_dir` instead. `messages.gates_dir`/`residual_dir` are operator-editable denial/residual text; editing them never changes when a gate fires. `memory.embed_dim` (384) is compile-time coupled to baked-in model weights -- changing it invalidates every stored vector and routes through an explicit drop-if-mismatch path, never silent. `memory.tencentdb_backend.vectors_db_dims` (768 default) is independent of `embed_dim`: it matches whichever TencentDB-compatible provider produced the indexed content, never gm's own embedder. `memory_sync.*_budget_ms` bound one `memory_md.rs::sync_index` pass; a pass that cannot finish records a `:partial` digest and converges across repeated dispatches rather than blocking one. `rssearch.table`/`index` and the `git_commits`/`code_chunks` equivalents accept only `[A-Za-z_][A-Za-z0-9_]*` since they interpolate into SQL. `scoring.*` splits two fusions: `recency_floor`/`cos_floor`/`dedup_jaccard_threshold`/`half_life_ms` govern recall's cosine-x-recency score, `bm25_k1`/`bm25_b`/`fusion_rrf_k`/`fusion_identifier_boost`/`fusion_vector_list_weight` govern codesearch's BM25+vector RRF fusion. `browser_witness.extra_*`/`claim_audit.extra_*` append to built-in defaults, never replace them. `cache.*` budgets are per-namespace so one greedy consumer cannot evict another's entries.

## Working with gm

Use the host's existing authorized tools for ordinary work. Follow the bounded task, checkpoint, process and verification rules in `skills/gm/SKILL.md`. Read `skills/gm/references/runtime.md` only for an explicitly selected runtime task. No mandatory daemon, codesearch index, subagent, global memory service, repeated confirmation walk or automatic publication.

Use scoped reads/search, preserve user changes and existing tests, and collect the terminal result of each task-owned process. Reuse evidence for unchanged files. Completion is the requested outcome and its checks, not the absence of all imaginable work in a repository. Surface unrelated issues separately.

Plain clones suffice for default skill/installer changes. Initialize submodules only for a task that changes their source. Never run inherited restart/wipe/daemon scripts as part of ordinary verification. `npm test` runs the lightweight contract and isolated installer checks; live optional-runtime verification is a separate explicitly scoped operation.

## Implementation rules

- Keep code and prose self-explanatory. Put only current, non-expressible local constraints in this file.
- Keep `agentplug-libsql`'s `serde_json` `preserve_order` feature. Its query rows and JavaScript `columns` result must retain SQL SELECT order.
- Keep `oxibrowser-core` as both `rlib` and `cdylib`. The native clients use `rlib`; agentplug calls the WASM export through `cdylib`.
- Keep Blitz rendering dependencies isolated in `oxibrowser-render`. Do not add them to the root workspace or core browser crate.
- Keep the `RUSTSEC-2024-0436` exception only while Boa reaches `paste` through `boa_string`; remove it after the dependency path disappears.
- Preserve and extend appropriate tests. Verify changed behavior through its real entrypoint too; isolated test doubles are not evidence of a working external integration. A live spool dispatch is needed only when the optional runtime itself is changed.
- Keep tracked text UTF-8 without a BOM.
- Use atomic create or rename for every single-writer and lock guard.
- Treat configuration prose keys and source paths as untrusted relative paths. Accept only safe components. Accept config repositories only through approved remote transports. Keep fetch HTTP(S)-only with a nonempty authority.
- Treat durable memory as source. Keep only current, reusable facts. Remove resolved incident narration and duplicate guidance instead of growing the corpus.
- Keep documentation current, present-tense, and concise. Put detailed protocol, release, and incident material in its owning README, source, or changelog rather than duplicating it here.
- Every Windows child spawn in `agentplug` goes through `windowless::apply_windowless`, and `agentplug-runner` calls `ensure_hidden_console()` before anything else. `CREATE_NO_WINDOW` alone is not enough: it leaves a console-subsystem child (git.exe, node, powershell) console-less, and its own console-subsystem children (git.exe -> git.exe -> git-remote-https.exe) then allocate a fresh conhost each and flash a window. A console the runner owns and hides is inherited by the whole subtree instead, so git chains stay windowless; `apply_windowless` falls back to `CREATE_NO_WINDOW` only when no console exists.
- `config_sync::ensure_current` debounces on the last probe time whether or not a local checkout exists, and records that time in memory as well as on disk: the `.sync.json` write can fail under load, and with no local checkout every dispatch re-ran `git ls-remote` with no backoff (measured at more than one spawn per second, 24/7).
- Keep this file below 30 KB. When it exceeds that limit, revalidate it against current source, history, and retained memory before compacting it.

## Triage scripts

`scripts/triage/` holds the one-call checks that cost the most time to improvise: `runner-status.sh` (watcher heartbeat age, pid liveness, plugin versions, exit 1 when dead), `runner-restart.sh` (stops runners by `/proc` exe and starts one detached watcher; `pkill -f` matches the calling shell and kills it), `check-pins.sh` (every submodule pin in HEAD exists on its remote; an unpublished pin breaks fresh clones), `run-failure.sh <owner/repo> <run-id>` (failing step and error lines of a GitHub Actions run, escape codes stripped), and `doctor.sh`, which runs the watcher check, the pin check and the latest failed CI run per release repo in one call. Run `check-pins.sh` before pushing a submodule bump.

## Verification and delivery

Verify the changed surface with its real entry point. For `rs-plugkit`, build the guest and witness the changed verb through `agentplug-runner`. For `gm-mcp`, rebuild the bundle when its source or input schema changes. For release-facing changes, inspect the relevant workflow and resulting artifact.

Before a diagnostic override, save the original property descriptor. Record whether the target
owns the property. Refuse an override unless the original state can be restored. Set
`configurable: true` on new temporary own properties. In `finally`, restore an original own
property with its exact saved descriptor. For an inherited property, delete the temporary own
shadow. Verify the original property lookup and absence of probe state before the final live
witness.

Use authorized native git tools by default; optional runtime tasks may use their supported git verbs. Before delivery, resolve in-scope checks, preserve unrelated dirty work, update only affected submodule pins and verify any authorized remote publication. Report blockers without expanding the goal or claiming success from source inspection alone.

`gm-mcp` compacts every dispatch response before it crosses the wire; `gm-mcp/AGENTS.md` records which fields compact, which stay whole, and why.

## Historical optional-runtime notes

See [inherited runtime notes](docs/UPSTREAM-RUNTIME-NOTES.md) only when modifying the optional upstream runtime. They do not define the default skill workflow.
