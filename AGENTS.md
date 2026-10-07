# AGENTS.md

## Purpose

This repository publishes the `gm-skill` release artifact. The installed `/gm` skill is `skills/gm/SKILL.md`. The agent drives the state machine; `rs-plugkit` serves it through spool verbs.

Read `SKILLS.md` before starting work. Read every relevant `skills/<name>/SKILL.md` before using that skill. The served `instruction` response, project configuration, and the applicable skill override this file when they conflict.

## Ownership

- `skills/gm/SKILL.md` owns agent workflow and tool routing.
- `gm-config/` owns default phase prose, gate text, residual text, and the FSM graph. Project-local vendored configuration takes precedence; compiled prose is a fallback.
- `rs-plugkit/` is the WASM guest that implements orchestration, spool verbs, memory, and code search.
- `agentplug/` provides `agentplug-runner`, the native WASM host. It is the only supported loader.
- `gm-mcp/` wraps the spool write-and-poll cycle. Edit `src/` and rebuild its committed bundle together.
- `gm-mcp/` serves two transports from the same bundle: stdio (the default registration, and the one a client can lose permanently) and stateless streamable HTTP on `127.0.0.1:8787/mcp`. A stdio MCP server is a child the client owns on one pipe; once that pipe goes, `mcp__gm__gm` is gone for the rest of the session and only `/mcp` reconnect or a restart brings it back. Register the durable one with `claude mcp add --transport http gm http://127.0.0.1:8787/mcp -s user`; `gm-mcp-server.mjs ensure-http` starts the shared server, and a stdio server seeds it on start so it is already up. The HTTP one is not immune: if the port is empty when a session's client connects, that client answers "MCP server \"gm\" is not connected" for the rest of the session and no server-side fix re-dials it -- restoring the port helps every new session, and the stranded one needs `/mcp` reconnect or a restart.
- `install.sh` and `install.ps1` install the skill and runner. Keep their platform behavior equivalent.
- `bin/gm-install.js` registers the MCP server as `node ~/.gm-tools/gm-mcp-server.mjs` (project `.mcp.json`: a `node -e` launcher resolving that path at start). Never register an `npx github:` spec: it re-resolves and reinstalls over the network on every connect (measured 8.2s warm, 22.2s cold, vs 0.19s local) and trips Claude Code's 30s `CONNECT_TIMEOUT` under load.
- On Windows, invoke PowerShell through `runDirect` and `-File <install.ps1> spool`; `spawnSync` with `shell:true` loses argument boundaries. Rewrite the native Cursor, Gemini, and Codex MCP registrations because `add-mcp` does not migrate their legacy entries. Replace the full contiguous `[mcp_servers.gm]` TOML table span when updating Codex.

The root is the published package. `package.json` lists release contents. `skill-release.yml` publishes skill changes from `main`; do not assume a release succeeded without its workflow result.

## Repo inventory

Authoritative list; `.gitmodules` is ground truth for submodules.

| repo | role |
| --- | --- |
| agentplug, agentplug-bert, agentplug-libsql, agentplug-treesitter, agentplug-crux, agentplug-modlens, gm-config, rs-codeinsight, rs-plugkit, rs-search, obrowser, gm-mcp, vendor/tencentdb-agent-memory | active-dependency (submodule) |
| rs-codeinsight, rs-search, rs-plugkit, gm | active-sibling (cascade trigger) |
| rs-learn, rs-exec, gm-skill, gm-runner-bin, 12 legacy gm-\<platform\> repos | retired-tombstone (archived, README points at rs-plugkit or gm) |

`gm-config/gm.config.json` fields carry no inline `_comment` keys -- rationale lives here. `version` gates the schema; the file IS the workflow definition `crate::config::resolve` pulls on the debounce in `sync.debounce_ms` (default 300000ms, `shallow` fetch), reproducing stock gm behavior unmodified until edited. `instructions.keys` name per-state prose files under `instructions.dir`, resolved project-vendored-first then this repo's cache then compiled default. `fsm.graph`/`fsm.predicates_reference` are the state machine as data; `gates.predicate` may only name a predicate generated into `predicates_reference` from the same registry the code dispatches on -- a condition outside that registry needs a jit hook under `fsm.hooks_dir` instead. `messages.gates_dir`/`residual_dir` are operator-editable denial/residual text; editing them never changes when a gate fires. `memory.embed_dim` (384) is compile-time coupled to baked-in model weights -- changing it invalidates every stored vector and routes through an explicit drop-if-mismatch path, never silent. `memory.tencentdb_backend.vectors_db_dims` (768 default) is independent of `embed_dim`: it matches whichever TencentDB-compatible provider produced the indexed content, never gm's own embedder. `memory_sync.*_budget_ms` bound one `memory_md.rs::sync_index` pass; a pass that cannot finish records a `:partial` digest and converges across repeated dispatches rather than blocking one. `rssearch.table`/`index` and the `git_commits`/`code_chunks` equivalents accept only `[A-Za-z_][A-Za-z0-9_]*` since they interpolate into SQL. `scoring.*` splits two fusions: `recency_floor`/`cos_floor`/`dedup_jaccard_threshold`/`half_life_ms` govern recall's cosine-x-recency score, `bm25_k1`/`bm25_b`/`fusion_rrf_k`/`fusion_identifier_boost`/`fusion_vector_list_weight` govern codesearch's BM25+vector RRF fusion. `browser_witness.extra_*`/`claim_audit.extra_*` append to built-in defaults, never replace them. `cache.*` budgets are per-namespace so one greedy consumer cannot evict another's entries.

## Working with gm

Use the `gm` skill for engineering work. Prefer its MCP server. Without it, use the documented spool fallback: write one complete request atomically, prefix every request number with a unique session id, and poll the matching response. Never start a second watcher while a fresh watcher is busy. A stale or failed runner is a defect in its owning source, not a reason to bypass gm.

Use the verbs exposed by the running plugin for search, browser, git, execution, memory, and state changes. Do not substitute platform-native tools when the matching verb exists. Read known runtime-state files directly only when the skill allows it. `docs/verbs.md` is the verb inventory: every name, its body shape, and one example each.

Use `codesearch` as the canonical search verb. `code_search` is an accepted compatibility alias with identical behavior. `grep` (alias `rg`) is that same exhaustive scan under a grep-shaped body -- `{"pattern":"...","path"?,"glob"?,"exclude"?,"case_insensitive"?,"context"?,"max_results"?,"output_mode"?,"regex"?}` -- for the question that is literally "where is this string". `exclude` drops paths by glob, one glob or an array: `{"exclude":["vendor/**","test/hardware/**"]}`, which replaces a hand-written brace alternation to skip a vendored tree; `exclude_glob`/`exclude_globs` are aliases, a `!`-prefixed entry inside `glob` excludes too, the reply echoes the effective glob as `exclude_glob`, exclusion never affects `exhaustive`, and `codesearch` takes `exclude` under the same aliases. `output_mode:"content"` answers `counts[]` (per-file `{path,count}`) plus `output[]` (one `path:line: text` per hit); `{"detail":true}` gives structured `matches[]` instead. The pattern is read as a regex when it carries an alternation bar, a `\d`-style class escape, a `[a-z]`-shaped range or an edge anchor (a doubled `||` stays literal), and `regex:true`/`regex:false` forces the reading either way. `search` is `codesearch`, not `grep`.

Structural code questions (who calls X, what breaks if X changes, is X dead, a diff's blast radius) go to `callers {symbol}` / `impact {symbol}` first; `codesearch` (alias `code_search`) is the search verb and the exhaustive confirmation when the call-graph reply is empty.

A project declares what codesearch must not walk in a `.codesearchignore` at its root: gitignore syntax, anchored at that file's directory, read *in addition to* `.gitignore` (a directory may also carry its own, applying to its immediate children). Use it for generated and vendored trees -- Chrome profile caches, genome dumps, build output -- so an unscoped query stays inside its 45 s wall budget instead of dying partway through at `exhaustive: false`. Every dropped path is reported per call in `excluded_by_rule_summary`/`excluded_by_rule_count` and rule exclusions never affect `exhaustive`, which stays governed only by the real bounds (budget, size ceiling, unreadable files, listing completeness); a project declaring nothing scans exactly what it scanned before.

The on-disk PRD and mutable state is authoritative. A walk completes only when the live state machine accepts `COMPLETE`, all required rows are closed, and `gm-continue` has checked for remaining work.

Give each subagent its own session id and tell it to use the gm skill, codeinsight (`callers`/`impact`) first. Parallelize independent work, but assign one writer to each shared surface. A submodule change includes updating the parent pin.

Browsers: one task, one Chrome. The parent passes a single `sessionId=<id>` into every subagent prompt; agents run `session list` and reuse a live session before launching (`chrome_max_concurrent` defaults to 2), and end with `session close-all` then `session list` to confirm none remain. The parent closes the shared id after its subagents finish. Never run a scratch agentplug daemon against a real project root while other agents work: its orphan sweep sees every gm chrome on the machine.

## Implementation rules

- Keep code and prose self-explanatory. Put only current, non-expressible local constraints in this file.
- Keep `agentplug-libsql`'s `serde_json` `preserve_order` feature. Its query rows and JavaScript `columns` result must retain SQL SELECT order.
- Keep `oxibrowser-core` as both `rlib` and `cdylib`. The native clients use `rlib`; agentplug calls the WASM export through `cdylib`.
- Keep Blitz rendering dependencies isolated in `oxibrowser-render`. Do not add them to the root workspace or core browser crate.
- Keep the `RUSTSEC-2024-0436` exception only while Boa reaches `paste` through `boa_string`; remove it after the dependency path disappears.
- Do not add synthetic tests, mocks, placeholders, or decorative glyphs. Verify behavior through the actual build and a live spool dispatch.
- Keep tracked text UTF-8 without a BOM.
- Use atomic create or rename for every single-writer and lock guard.
- Treat configuration prose keys and source paths as untrusted relative paths. Accept only safe components. Accept config repositories only through approved remote transports. Keep fetch HTTP(S)-only with a nonempty authority.
- Treat durable memory as source. Keep only current, reusable facts. Remove resolved incident narration and duplicate guidance instead of growing the corpus.
- Keep documentation current, present-tense, and concise. Put detailed protocol, release, and incident material in its owning README, source, or changelog rather than duplicating it here.
- Every Windows child spawn in `agentplug` goes through `windowless::apply_windowless`, and `agentplug-runner` calls `ensure_hidden_console()` before anything else. `CREATE_NO_WINDOW` alone is not enough: it leaves a console-subsystem child (git.exe, node, powershell) console-less, and its own console-subsystem children (git.exe -> git.exe -> git-remote-https.exe) then allocate a fresh conhost each and flash a window. A console the runner owns and hides is inherited by the whole subtree instead, so git chains stay windowless; `apply_windowless` falls back to `CREATE_NO_WINDOW` only when no console exists.
- `config_sync::ensure_current` debounces on the last probe time whether or not a local checkout exists, and records that time in memory as well as on disk: the `.sync.json` write can fail under load, and with no local checkout every dispatch re-ran `git ls-remote` with no backoff (measured at more than one spawn per second, 24/7).
- Keep this file below 30 KB. When it exceeds that limit, revalidate it against current source, history, and retained memory before compacting it.

## Verification and delivery

Verify the changed surface with its real entry point. For `rs-plugkit`, build the guest and witness the changed verb through `agentplug-runner`. For `gm-mcp`, rebuild the bundle when its source or input schema changes. For release-facing changes, inspect the relevant workflow and resulting artifact.

Before a diagnostic override, save the original property descriptor. Record whether the target
owns the property. Refuse an override unless the original state can be restored. Set
`configurable: true` on new temporary own properties. In `finally`, restore an original own
property with its exact saved descriptor. For an inherited property, delete the temporary own
shadow. Verify the original property lookup and absence of probe state before the final live
witness.

Use the gm git verbs. Use `git_remote` to inspect configured remote URLs and the current branch's upstream without fetching or mutating state. Before delivery, resolve every residual, keep the worktree clean, update affected submodule pins, and verify the remote state. Do not claim completion from source inspection alone.

`gm-mcp` compacts every dispatch response before it crosses the wire; `gm-mcp/AGENTS.md` records which fields compact, which stay whole, and why.

## Verified 2026-09-14 (upstream merge + daemon heartbeat)

**FIXED UPSTREAM, verified here — the daemon "looks dead" bug.** `registry.rs`'s
own comment records it: `slot_content_hashes()` takes each slot's mutex, so the
10s heartbeat ticker blocked behind whatever dispatch held the slot and went
**76 seconds stale**; every client then read the status as stale, concluded the
daemon was dead, and spawned a competing one. That is the daemon start/exit churn
that follows a slow dispatch, and it is exactly what repeatedly bit the docstudio
sessions — a `git_commit` with a large message would appear swallowed, the status
`ts` would look minutes old, the daemon would be killed and restarted, and the
dispatch was lost in the churn.

`slot_snapshot_without_blocking()` fixes it. Re-verified on runner 0.1.135 by
driving a real 75-second `exec_js` (it genuinely held a slot — status read `busy`
throughout, and the verb returned `exit_code:0`, "held a slot for 75075ms") while
polling `.status.json` every 5s: **worst heartbeat age 2,964 ms** against a
300,000 ms dead-threshold. It never came close to looking dead.

Method note: the first attempt at this measurement was INVALID and said so only
because the out-file was read. Hand-writing the dispatch into the spool bypassed
the MCP path, so it was `gate_denied` (`long-gap-no-instruction`) and never ran —
the heartbeat stayed fresh because the daemon was idle, not because the fix
worked. Always confirm the long verb actually executed before believing a
liveness measurement taken "during" it.

**STILL BROKEN — oxibrowser serves an empty document.**
Reproduced on oxibrowser 0.18.3 (plugin gm 0.1.1296). `url=https://example.com`
returns `ok:true` and JS sees the right `location.href` ("https://example.com/")
and `readyState:"complete"` — so it is the same session and navigation reported
success — but `document.documentElement` is **null**, `outerHTML` length 0, and
all three read paths come back empty: `evaluate` (`NO BODY`), `dom=h1` (ok with
no matches), and `extract-markdown` (`markdown: ""`).

Narrowed, not fixed: `Session::navigate` (oxibrowser-core/src/session.rs:545)
looks correct — it fetches, errors on >=400, builds `Page::from_html`, sets
`active_page` and calls `inject_dom_snapshot()`. The `document.documentElement`
getter (js/runtime.rs:5465) is also correct, returning null only when both the
render doc and the DOM snapshot are empty. So the break is between
`inject_dom_snapshot()` and the JS realm the plugin's `evaluate` runs in. Left
for the obrowser repo rather than patched speculatively from here: it is a young
engine (2 commits), the lifecycle involved is substantial, and `browser`
(lightpanda) and `cdp` (real Chrome) both work and are the documented fallbacks,
so nothing is blocked by this. No gm verb dispatches through oxibrowser any
more: `serp` is an HTTP search over `host_fetch`, the same transport `fetch`
uses.

## Verified 2026-10-05 (side plugins load lazily, so every guest->sibling import needs an on-demand hook)

The daemon's per-project eager-load list is `["gm"]` plus whatever `<root>/.agentplug/plugins.txt`
declares (nothing writes that file today), so `libsql`/`bert`/`treesitter`/`oxibrowser`/`crux` are
never instantiated for a project at load time. Commit `1b1ea8c` made them lazy on the assumption
that `DispatchHandle::reinstantiate_plugin_into_pool_slot_if_reload_source_available` covers first
use. It only covers `DispatchHandle::dispatch` -- the daemon's own top-level plugin verb. The
guest-facing sibling imports (`host_vec_embed`, `host_plugin_call`, `call_oxibrowser`) read
`HostState::siblings()` and fail outright on a missing key, so every embedding-dependent verb
answered `embedder failed: query embedding unavailable -- the bert embedder failed` and `code_index`
answered `libsql unavailable ... unknown_plugin` on every project. Fix: `registry.rs` publishes the
compiled module set as a global `SIBLING_RELOAD_SOURCE` (the daemon sets it after its per-tick warm
compile pass) and each of those three call sites calls `ensure_sibling_registered` before reporting
the sibling absent. Any new guest->sibling import must do the same.
## Dream-RSI grounded replay (arxiv 2609.14858)

Dream-RSI is a continuous core process, not an opt-in subsystem: every ordinary GM work dispatch records a bounded, session-owned observation automatically into `.gm/dream-rsi/<session>/observations.json` (a flat per-dispatch log: verb, exit code, fingerprint, quality, timestamp) and `active-strategy.json` (current selection summary). Orchestration bookkeeping and Dream-RSI's own maintenance dispatches are never themselves recorded as outcomes -- only real work dispatches are.

**Three-stage loop, offline-biased per the paper.** Online-explore drives real dispatch rounds that grow the discovery tree live. The replay simulator then walks that frozen tree offline -- zero re-execution, pure disk read -- to score challenger exploration policies against the SAME recorded worlds the incumbent already faced. Policy dreaming samples candidate policy variants for the simulator to score. The incumbent policy is replayed against every challenger and stays selected unless a challenger scores strictly higher over the same supplied worlds -- monotonic safety, never a regression.

**A replay result is evidence-bound planning input, never execution authority.** It cannot run a tool, cannot evaluate a new outcome, and cannot make an unrecorded branch observed -- those require a real dispatch. During every active task, the agent consults the accumulated observed world and its automatic replay receipt before selecting later exploration work, the same way `instruction`'s own recall hits inform a turn without substituting for it.

**Deployment of an accepted strategy rides the normal PRD/mutable/phase/authorization/evidence paths, never an autonomous trigger.** No daemon tick or scheduled job redeploys a strategy unattended; redeployment is a dispatch an agent makes under the same gates as any other state-changing transform. Metrics driving selection are re-derived from the dispatch ledger on each replay, never supplied by the model narrating its own progress.

**Git lifecycle: `.gm/dream-rsi/` is tracked**, not managed-gitignored. Its on-disk shape (small per-session JSON, human-readable, no binary blobs) matches the tracked `.gm/memories/*.md` precedent -- durable improvement history that follows the codebase -- not the derived-binary-store class (`gm.db`, the untracked `.gm/prd.yml`/`.gm/mutables.yml` revision-churn) this file's own gitignore comments document as the untracking rationale. The whole point of RSI is accumulating this evidence across deployment cycles; gitignoring it would discard the one thing the mechanism exists to produce.

**The cycle-boundary trigger is a periodic tick inside agentplug-runner's own daemon loop, not a GitHub Actions cron.** `spawn_dream_rsi_cycle_ticker` (`agentplug/crates/agentplug-runner/src/daemon.rs`) mirrors the existing `spawn_project_heartbeat_ticker` pattern: once a minute, per known project root, it counts `.gm/dream-rsi/*/observations.json` entries and writes one real `dreamrsi-replay` spool in-file (rs-plugkit's `orchestrator::dream_rsi::handle_replay`, already live) only after >=20 new observations have accumulated since the last fired cycle AND >=15 minutes have elapsed -- matching the paper's own build-tree-then-dream cycle boundary, never firing on every tick. The daemon-tick path beats a git-push-triggered Actions cron because it observes real cross-session accumulated discovery-tree data on one machine without needing a commit to fire. The trigger dispatches `dreamrsi-replay` only, never `dreamrsi-select`: `handle_select`'s current implementation writes `active-strategy.json` directly, so an unattended call would be the exact autonomous redeploy this section forbids. Promoting the trigger to call a future authorization-gated propose-only verb is the sibling `dreamrsi-offline-scoring-and-selection` row's decision.

## Verified 2026-10-04 (windowless child spawns + runner self-update guard)

**The recurrence is a VERSION-EQUAL downgrade, so version comparison can never
catch it.** The windowless fix was committed locally as 0.1.159 and the release
asset was also 0.1.159, built from `main` before the fix landed. The updater's
`marker_is_trustworthy_and_current` compared only the version marker against the
latest release tag (and the on-disk marker carried a `v` prefix, so it could
never have matched anyway), so a release that merely had the same version number
replaced a running binary that had strictly more commits. Any guard has to
compare IDENTITY, not version.

**How releases are cut:** `.github/workflows/release.yml`, on push to `main`.
A `bump` job rewrites the patch version in `Cargo.toml`, then a matrix job builds
6 targets and publishes assets plus `.sha256` (and `.sig` when
`release-signatures/manifest.json` names one) to `AnEntrypoint/agentplug-bin`.
The runner consumes `releases/latest` and stages `.exe.new` -> `takeover` ->
`promote_staged_exe_to_canonical` -> re-exec. There is no way to trigger a
release other than pushing to `main`, and CI pushes its own bump commits, so
expect `git pull --rebase origin main` before a push.

**Build identity is baked at compile time**, because nothing on disk can be
trusted to describe the binary: `crates/agentplug-runner/build.rs` writes
`OUT_DIR/build_info.rs` with `COMMIT`, `BUILD_TS` and `RELEASE_BUILD`, exposed
through `src/build_info.rs` and printed by `--build-info`.
The release workflow sets `AGENTPLUG_RELEASE_BUILD=1`. Git-resolved HEAD,
symbolic refs, and existing packed refs are Cargo inputs across ordinary,
submodule and worktree checkouts; an ordinary commit refreshes `COMMIT`
without touching source or clearing caches.

**The guard** (`crates/agentplug-runner/src/download.rs`,
`self_update_blocked_reason`, checked before anything is staged): refuse when
`AGENTPLUG_NO_SELF_UPDATE` is set to anything but `0/false/no/off`; refuse when
`~/.agentplug/agentplug-runner.no-self-update` exists; refuse when the installed
runner is a local build (either its sha256 matches
`~/.agentplug/agentplug-runner.local-build.json`, or probing it with
`--build-info` reports `release_build:false`); and require the incoming release
version to be STRICTLY greater than the running one. `promote_staged_exe_to_canonical`
re-checks `installed_runner_blocks_promotion` at takeover, so a staged copy that
slipped past staging still cannot overwrite a pinned local binary — the process
then keeps running from the staged copy instead. `staged_binary_self_check` is
untouched. `AGENTPLUG_ALLOW_UPDATE_OVER_LOCAL_BUILD=1` overrides the local-build
refusal only; `pin-local-build` / `unpin-local-build` maintain the sha256 pin by
hand.

**The pin is synced on every daemon boot, not inside `record_runner_version`.**
Recording only happens when the version marker differs, so a rebuild that keeps
the same version left the pin pointing at the previous binary and the guard
compared against a sha that was no longer installed.

**Live witness (2026-10-04, this box):** with the pre-fix release 0.1.159
(14003200 bytes) running as the daemon, a 45 s sample saw **189 distinct visible
console windows titled `C:\Program Files\Git\cmd\git.exe`** (~4/s). With the
fixed local build (2c16fa2, 14041088 bytes) as the daemon, a 60 s sample saw
**0**. The exe size was unchanged after the sample, so the old build never
self-updated mid-measurement.

**Method notes, both of which cost a wasted measurement:**
- conhost is NOT parented to the process that caused the console here, so
  attributing console flashes by `ParentProcessId` finds nothing. Detect them by
  enumerating VISIBLE windows and matching the title — a new console's title is
  the console app's path.
- **conhost count is not a usable before/after metric on this machine**: the
  default terminal is Windows Terminal, so consoles are hosted by
  `OpenConsole.exe`, and peak conhost was 24 before vs 25 after while the real
  signal went 189 -> 0.
- The flash only reproduces with the daemon running (its repeated `project_root`
  -> `git rev-parse` calls). Launching the binary as a one-shot `spool` client
  shows nothing, so an A/B built on one-shot launches will falsely report both
  builds clean.

**Swapping the live runner binary:** Windows refuses to overwrite a running
image but allows renaming it. `taskkill` every `agentplug-runner.exe`, rename the
canonical exe aside, copy the new one in, and restart the daemon. Deleting the
file first does not work — the gm session respawns `spool` every few seconds and
re-locks it. A `finally` block is not optional here: a failed restore leaves the
pre-fix binary live and self-updating.

**Still open, same class, JS side:** `~/.gm-tools/gm-mcp-server.mjs` self-updates
from a release channel via `gm-mcp/src/self-update.js` (backing up to `.prev`)
and the 08:57 copy lost two `windowsHide` sites the `.prev` copy has —
`execFileSync("git", [...])` and `spawnSync(process.execPath, ["--check", ...])`.
The release channel is shipping a bundle without them, so the same
"update silently reverts a fix" shape applies there. Not touched pending a
decision; the runner guard does not cover it.
