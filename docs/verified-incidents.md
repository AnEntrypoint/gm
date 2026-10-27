# Verified runtime findings

Dated findings behind standing rules in AGENTS.md. Read section whose subsystem failure touches; rule lives in AGENTS.md.

## Verified 2026-09-14 (upstream merge + daemon heartbeat)

**FIXED UPSTREAM, verified here: daemon "looks dead" bug.** `registry.rs` comment records it: `slot_content_hashes()` take each slot's mutex, so 10s heartbeat ticker blocked behind whatever dispatch held slot, went **76 seconds stale**; every client read status as stale, concluded daemon dead, spawned competing one. Daemon start/exit churn after slow dispatch = this. Repeatedly bit docstudio sessions: `git_commit` with large message appear swallowed, status `ts` look minutes old, daemon killed and restarted, dispatch lost in churn.

`slot_snapshot_without_blocking()` fixes it. Re-verified runner 0.1.135: drove real 75-second `exec_js` (genuinely held slot; status read `busy` throughout, verb returned `exit_code:0`, "held a slot for 75075ms") while polling `.status.json` every 5s: **worst heartbeat age 2,964 ms** vs 300,000 ms dead-threshold. Never came close to looking dead.

Confirm long verb executed before trusting liveness measurement taken during it.

## Verified 2026-10-05 (side plugins load lazily, so every guest->sibling import needs an on-demand hook)

Daemon per-project eager-load list = `["gm"]` plus whatever `<root>/.agentplug/plugins.txt` declares (nothing writes that file today), so `libsql`/`bert`/`treesitter`/`crux` never instantiated for project at load time. Commit `1b1ea8c` made them lazy assuming `DispatchHandle::reinstantiate_plugin_into_pool_slot_if_reload_source_available` covers first use. Only covers `DispatchHandle::dispatch` -- daemon's own top-level plugin verb. Guest-facing sibling imports (`host_vec_embed`, `host_plugin_call`) read `HostState::siblings()` and fail outright on missing key, so every embedding-dependent verb answered `embedder failed: query embedding unavailable -- the bert embedder failed` and `code_index` answered `libsql unavailable ... unknown_plugin` on every project. Fix: `registry.rs` publishes compiled module set as global `SIBLING_RELOAD_SOURCE` (daemon sets after per-tick warm compile pass), each of those two call sites calls `ensure_sibling_registered` before reporting sibling absent. Any new guest->sibling import follows rule at AGENTS.md:88.
## Verified 2026-10-04 (windowless child spawns + runner self-update guard)

**Recurrence = VERSION-EQUAL downgrade, so version comparison never catch it.** Windowless fix committed locally as 0.1.159, release asset also 0.1.159, built from `main` before fix landed. Updater's `marker_is_trustworthy_and_current` compared only version marker vs latest release tag (on-disk marker carried `v` prefix, so never matched anyway), so release with same version number replaced running binary that had strictly more commits. Any guard must compare IDENTITY, not version.

**How releases cut:** `agentplug/.github/workflows/release.yml`, on push to `main`. `bump` job rewrites patch version in `agentplug/Cargo.toml`, then matrix job builds 6 targets, publishes assets plus `.sha256` to `AnEntrypoint/agentplug-bin`. Runner consumes `releases/latest`, stages `.exe.new`, then `takeover`, then `promote_staged_exe_to_canonical`, then re-exec. No way to trigger release except push to `main`; CI pushes own bump commits, so expect `git pull --rebase origin main` before push.

**Build identity baked at compile time**, since nothing on disk can be trusted to describe binary: `agentplug/crates/agentplug-runner/build.rs` writes generated `build_info.rs` (in `OUT_DIR`) with `COMMIT`, `BUILD_TS` and `RELEASE_BUILD`, exposed through `agentplug/crates/agentplug-runner/src/build_info.rs` and printed by `--build-info`. Release workflow sets `AGENTPLUG_RELEASE_BUILD=1`. Git-resolved HEAD, symbolic refs, existing packed refs are Cargo inputs across ordinary, submodule, worktree checkouts; ordinary commit refreshes `COMMIT` without touching source or clearing caches.

**The guard** (`agentplug/crates/agentplug-runner/src/download.rs`, `self_update_blocked_reason`, checked before anything staged): refuse when `AGENTPLUG_NO_SELF_UPDATE` set to anything but `0/false/no/off`; refuse when `~/.agentplug/agentplug-runner.no-self-update` exists; refuse when installed runner is local build (sha256 matches `~/.agentplug/agentplug-runner.local-build.json`, or probing with `--build-info` reports `release_build:false`); require incoming release version STRICTLY greater than running one. `promote_staged_exe_to_canonical` re-checks `installed_runner_blocks_promotion` at takeover, so staged copy that slipped past staging still cannot overwrite pinned local binary: process keeps running from staged copy instead. `staged_binary_self_check` untouched. `AGENTPLUG_ALLOW_UPDATE_OVER_LOCAL_BUILD=1` overrides local-build refusal only; `pin-local-build` / `unpin-local-build` maintain sha256 pin by hand.

**Pin synced every daemon boot, not inside `record_runner_version`.** Recording only happens when version marker differs, so rebuild keeping same version left pin pointing at previous binary; guard compared against sha no longer installed.

**Live witness (2026-10-04, this box):** pre-fix release 0.1.159 (14003200 bytes) running as daemon, 45 s sample saw **189 distinct visible console windows titled `C:\Program Files\Git\cmd\git.exe`** (~4/s). Fixed local build (2c16fa2, 14041088 bytes) as daemon, 60 s sample saw **0**. Exe size unchanged after sample, so old build never self-updated mid-measurement.

**Method notes, both cost a wasted measurement:**
- conhost NOT parented to process that caused console here, so attributing console flashes by `ParentProcessId` finds nothing. Detect by enumerating VISIBLE windows, matching title; new console's title = console app's path.
- **conhost count not usable before/after metric here**: default terminal Windows Terminal, so consoles hosted by `OpenConsole.exe`; peak conhost 24 before vs 25 after while real signal went 189 to 0.
- Flash only reproduces with daemon running (its repeated `project_root` calls to `git rev-parse`). Launching binary as one-shot `spool` client shows nothing, so A/B built on one-shot launches falsely reports both builds clean.

**Swapping live runner binary:** Windows refuses overwrite of running image but allows rename. `taskkill` every `agentplug-runner.exe`, rename canonical exe aside, copy new one in, restart daemon. Deleting file first does not work; gm session respawns `spool` every few seconds and re-locks it. `finally` block not optional: failed restore leaves pre-fix binary live and self-updating.

**Still open, same class, JS side:** `~/.gm-tools/gm-mcp-server.mjs` self-updates from release channel via `gm-mcp/src/self-update.js` (backing up to `.prev`); 08:57 copy lost two `windowsHide` sites `.prev` copy has: `execFileSync("git", [...])` and `spawnSync(process.execPath, ["--check", ...])`. Release channel ships bundle without them, so same "update silently reverts a fix" shape applies. Not touched pending decision; runner guard does not cover it.

## Verified 2026-10-07 (plugkit wasm load path, rebuild flags, sideload)

- Daemon loads `~/.agentplug/plugins/gm.wasm`. Sideload writes sibling `.tmp` and renames over that file (back up first); daemon hot-reloads, no restart.
- Rebuild with `cargo build -p rs-plugkit --release --target wasm32-wasip1 --features slim`; without `slim` artifact embeds 133 MB of bge weights.
- `ensure_plugin_installed` (`agentplug/crates/agentplug-runner/src/download.rs`) never re-verifies installed wasm, so sideload needs no sha256 pin bump.
- `gm.version` is semver (e.g. `0.1.1662`), so auto-updater's version check not blocked.

## Verified 2026-10-08 (git_commit content filters, amend, moving HEAD)

- `git commit -- <paths>` re-hashes worktree content itself, so needs clean filter as much
  as `git add` does. With `commit` absent from `GIT_SUBCOMMANDS_APPLYING_CONTENT_FILTERS`, spoint
  commit stored CRLF blob while `git_add` (already in list) staged LF, so index and HEAD
  disagreed, tree stayed dirty after committing, `git show` rendered `@@ -1,116 +1,122 @@`
  instead of three hunks. List now `["add","status","diff","checkout","commit","stash"]`.
  Measured in scratch repo whose `core.autocrlf=true` lives only in system config: `git add`
  alone produced 0-CR index blob while `git commit -- path` produced 116-CR HEAD blob; with fix both 0-CR.
- **`core.autocrlf` does not strip CR from file whose stored blob already has CR**
  (`has_crlf_in_index` in convert.c). So filter fix repairs repo whose blobs are LF, does NOT repair one where CRLF blob already landed -- amending keeps CRLF. Repair = `git_reset_head` followed by re-commit: once index falls back to LF parent blob, clean filter fires again.
- `git_reset_head {count | to, mode: mixed|soft, allow_staged}` moves HEAD back without touching worktree. On 2026-10-08, earlier build, also refused `staged_paths_present` when index held paths request did not name (`allow_staged:true` overrode it), `target_not_ancestor_of_head`, `already_at_target`. Current source has none of these three codes. Pushed-commit refusal = `pushed_commit_refused` at `rs-plugkit/crates/plugkit-core/src/wasm_dispatch/verbs/git.rs:2197`, in amend path. `mode:hard` accepted by current source, which runs `git reset --hard` on `git_reset`; earlier refusal not implemented.
- `git_commit {amend:true}` rewrites current commit instead of stacking child, refuses `pushed_commit_refused` (`git.rs:2197`); on unborn HEAD fails with "amend requires an existing HEAD commit". `git_commit_dedup_key` carries `amend` so amend never answered by replayed non-amend commit.
- **`git_commit_dedup_lookup` replay rule owned by AGENTS.md bullet of that name.** Replay checks only `cat-file -e <sha>`, and object dropped by `git_reset_head` still present, so canonical repair -- reset HEAD, re-commit same message over same paths -- hit same dedup key and answered `committed:true` with old sha while HEAD never moved. Witnessed live: re-commit after `git_reset_head {count:1}` reported `sha 91f22ebd57` and left `rev-list --count HEAD` at 1. Fixed: replay now compares `rev-parse HEAD` to recorded `sha_full`.
- `daemon-guard` respawns daemon after `Stop-Process`; no manual start needed.

## Verified 2026-10-09 (pool drops: causes, empty candidates, unverified nominations)

Recorded causes of earlier drops: rule shadowed by stale vendored prose file; heartbeats not refreshed during lock waits; successors were free text, often ineligible; GPU-lock timeouts ended runs; completions not refilled same turn; `slots.live` read 0 while workers ran.

Recorded causes of drop below 12 on 2026-10-09: completions refilled in batches, not one per completion; resolvers nominated browser, GPU, design successors that could not run graph-node-only; traversal hops started late, so graph-node supply ran out; served rules not refreshed from gm-config (native config cache did not sync); stuck background shells and Monitors held GPU lock and orchestrator's attention.

Observed ceiling 2026-10-09 (14:07Z): live build accepted 24 at `.gm/instructions/entry.md:58` (refreshed codesearch in session gm-cli-3109570-1791554460239, recorded as row DRY-25).

Drop to 0 live 2026-10-09 (13:33Z): eight resolvers finished in one window, nothing relaunched them that turn. Successors chosen by hand because pool candidates list (`slots.candidates`) came back empty while 779 rows pending, pool observe `candidates:` and `live_rows:` null. Empty list logged as defect row afterwards.

Raw `prd-list` ignores `limit` and `status`, so one read cost about 35k tokens. Reading through exec_js over prd-list result avoids that cost.

Two nominations that cycle were title-only, unverified: `trav-edge-check-relative-imports-skips-edge-root` (gate change) and `tsl-only-shaders` (shader rewrite). Neither checked before launch.

## Verified 2026-10-10 (a queued gh-pages run held the deploy group for five days)

- `gh-pages.yml` puts every run in `concurrency: group: gh-pages` with `cancel-in-progress: false`. Run created 2026-10-05T21:09:21Z stayed `queued`, never got job, held that group: every run after went `pending`, cancelled by next run that arrived, so site kept serving 2026-10-05 build. Fifteen consecutive cancels recorded between 2026-10-09T14:17Z and 2026-10-10T19:23Z (34 runs total on workflow).
- Neither new `workflow_dispatch` nor push frees group; newest run only joins queue behind holder, pending run that is cancelled never deploys. Repair = cancel holder -- `gh run cancel <holder-run-id>` -- after which newest run starts within seconds.
- Block is per concurrency group, not runner starvation: `doc-drift`, `skill-release`, `bump-pins` completed normally same window, `actions/runs?status=pending` for repo reported exactly one pending run.
- Detection, one call: `gh api 'repos/AnEntrypoint/gm/actions/workflows/gh-pages.yml/runs?per_page=100' --jq '.workflow_runs[]|select(.status!="completed")|[.id,.status,.created_at]'`. Any non-completed run older than few minutes = holder; `jobs == 0` after minutes of pending = zombie shape.

## Verified 2026-10-11 (backgrounded work died when the dispatch that started it returned)

- Symptom: `( nohup cmd >log 2>&1 & )` started from `bash` dispatch kept writing while dispatch ran, stopped the moment it returned; log stayed 0 bytes, no process survived five minutes. Kill was hard: `trap`-installed HUP, TERM, INT handlers never fired, ruling out signal shell could catch.
- Cause: `agentplug/crates/agentplug-host/src/process_tree.rs` set `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` on job object `Job::assign` creates for every exec child; job membership inherited by descendants, so `Job::drop` at end of `exec_js::run` closed handle and Windows terminated whole tree. Runner in service was `0.1.294` (commit `225200d`), still carried flag; checked-out submodule at `f87064f` did not, so reading checkout alone made bug look already fixed.
- Fix: `Job::assign` creates job with no limit flags. Job now only kill switch for `terminate_containment`, runs at `timeoutMs` expiry and on `task-stop`; returning from dispatch kills nothing. Pinned by `exec_js::tests::detached_writer_is_still_appending_a_minute_after_the_dispatch_returned`, asserts redirected writer still appending 60 seconds after dispatch returned.
- Second mechanism, unchanged, still live: backgrounded child that keeps runner's stdout or stderr pipe open is adopted as task, ends with that task's 30-minute deadline, so redirect in idiom is part of contract, not decoration.
- Witness: dispatch `1791713402860-500-44475da329867bd1` returned 10:09:59Z having started background probe writer; dispatch `1791713499562-500-181ddfad4fb41b00` at 10:11:35Z read 79 appended ticks from pid 47497. Still appending 10:18:45Z (tick 445), ran to tick 461, ~9 minutes and five later dispatches after one that started it, until explicit `Stop-Process` ended it.
- Installed runner = local build of `225200d` plus this fix: `--build-info` reports `release_build: false`, makes `reconcileRunner` in `gm-mcp/src/release-bridge.js` answer `skipped: local-build`, so no later upstream release silently replaces it. Previous binary kept as `~/.gm-tools/agentplug-runner.exe.bak-pre-durable-20261011-100752Z`.

## Verified 2026-10-12 (shared work tree, refused pushes)

- Measured in C:/dev/gm (lane a48ac11a): local main `09575d5d` vs remote main `538a0c80`, twelve unpushed local commits. Each came from `git_finalize` that refused push over ~150 `clashing_paths` while same content already published.
- Each refused push left local commit redundant with published one, widening gap between local HEAD, work tree, remote main (see skills/gm/docs/rationale.md, Autonomy).

## Verified 2026-10-24 (every gm verb: "plugin gm is not registered", after the wasip3 guest release)

- Symptom: `gm_codemode` (codesearch, fs_read) failed every project with `plugin gm is not registered for this project (no plugin pool exists ...)`, while dispatch-start and dispatch-end logged. Bundle not cause: 0.2.291 bundle run from shell (`gm-mcp-server.mjs dispatch fs_read`) failed same way.
- Cause: rs-plugkit commit `cf87806ab` ("build: release the wasip3 component", not on rs-plugkit main) built release guest `plugkit-slim.wasm` (plugkit-bin 0.1.2096, installed 15:58) as wasip3 component (header `00 61 73 6d 0d 00 01 00`). Runner 0.1.545 (agentplug origin/main `6d2cb16`) installs component only per project, through `.agentplug/plugins.txt`, and `claim_dispatch.rs` (`handle.dispatch("gm", ...)`) routes every gm verb through `DispatchHandle::dispatch` in `registry.rs`. That path has no component branch; its reload snapshot (`modules_with_hashes`) holds core modules only, so gm never reaches sibling pool. Writing `.agentplug/plugins.txt` with `gm` does not help (probed in scratch root, no pool created).
- Mitigation on this machine, no daemon restart: `~/.agentplug/plugins/gm.wasm` restored from `gm.wasm.prev` (core 0.1.2095, sha256 `fed30fa2...`), `gm.version` set to `0.1.2095-core-pin` (non-semver marker that runner's sideload check and gm-mcp release bridge both skip), `gm.build.json` origin `local-dev-sideload`. Component kept as `gm.wasm.component-0.1.2096.bak`. Daemon picked it up on next tick. Verified: CLI `fs_read` dispatch_id `1792859037812-797-af8e7390388fcab0`; `gm_codemode` `fs_read` `1792859043732-798-f7bb4a69732a5260`; `codesearch` `1792859049083-799-2b297956c982b661`.
- Lift pin only after either runner dispatches component gm through gm verb path (fix belongs in agentplug `claim_dispatch.rs` and `registry.rs` `DispatchHandle::dispatch`), or rs-plugkit's release target returns to `wasm32-wasip1`. Lifting earlier re-installs component and reproduces this outage.