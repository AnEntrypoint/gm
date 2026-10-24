# Verified runtime findings

Dated findings behind the standing rules in AGENTS.md. Read the section whose subsystem a failure touches; the rule itself lives in AGENTS.md.

## Verified 2026-09-14 (upstream merge + daemon heartbeat)

**FIXED UPSTREAM, verified here: the daemon "looks dead" bug.** `registry.rs`'s
own comment records it: `slot_content_hashes()` takes each slot's mutex, so the
10s heartbeat ticker blocked behind whatever dispatch held the slot and went
**76 seconds stale**; every client then read the status as stale, concluded the
daemon was dead, and spawned a competing one. That is the daemon start/exit churn
that follows a slow dispatch, and it is exactly what repeatedly bit the docstudio
sessions: a `git_commit` with a large message would appear swallowed, the status
`ts` would look minutes old, the daemon would be killed and restarted, and the
dispatch was lost in the churn.

`slot_snapshot_without_blocking()` fixes it. Re-verified on runner 0.1.135 by
driving a real 75-second `exec_js` (it genuinely held a slot; status read `busy`
throughout, and the verb returned `exit_code:0`, "held a slot for 75075ms") while
polling `.status.json` every 5s: **worst heartbeat age 2,964 ms** against a
300,000 ms dead-threshold. It never came close to looking dead.

Confirm the long verb executed before trusting a liveness measurement taken during it.

## Verified 2026-10-05 (side plugins load lazily, so every guest->sibling import needs an on-demand hook)

The daemon's per-project eager-load list is `["gm"]` plus whatever `<root>/.agentplug/plugins.txt`
declares (nothing writes that file today), so `libsql`/`bert`/`treesitter`/`crux` are
never instantiated for a project at load time. Commit `1b1ea8c` made them lazy on the assumption
that `DispatchHandle::reinstantiate_plugin_into_pool_slot_if_reload_source_available` covers first
use. It only covers `DispatchHandle::dispatch` -- the daemon's own top-level plugin verb. The
guest-facing sibling imports (`host_vec_embed`, `host_plugin_call`) read
`HostState::siblings()` and fail outright on a missing key, so every embedding-dependent verb
answered `embedder failed: query embedding unavailable -- the bert embedder failed` and `code_index`
answered `libsql unavailable ... unknown_plugin` on every project. Fix: `registry.rs` publishes the
compiled module set as a global `SIBLING_RELOAD_SOURCE` (the daemon sets it after its per-tick warm
compile pass) and each of those two call sites calls `ensure_sibling_registered` before reporting
the sibling absent. Any new guest->sibling import follows the rule at AGENTS.md:88.
## Verified 2026-10-04 (windowless child spawns + runner self-update guard)

**The recurrence is a VERSION-EQUAL downgrade, so version comparison can never
catch it.** The windowless fix was committed locally as 0.1.159 and the release
asset was also 0.1.159, built from `main` before the fix landed. The updater's
`marker_is_trustworthy_and_current` compared only the version marker against the
latest release tag (and the on-disk marker carried a `v` prefix, so it could
never have matched anyway), so a release that merely had the same version number
replaced a running binary that had strictly more commits. Any guard has to
compare IDENTITY, not version.

**How releases are cut:** `agentplug/.github/workflows/release.yml`, on push to `main`.
A `bump` job rewrites the patch version in `agentplug/Cargo.toml`, then a matrix job builds
6 targets and publishes assets plus `.sha256` to `AnEntrypoint/agentplug-bin`.
The runner consumes `releases/latest` and stages `.exe.new`, then `takeover`, then
`promote_staged_exe_to_canonical`, then re-exec. There is no way to trigger a
release other than pushing to `main`, and CI pushes its own bump commits, so
expect `git pull --rebase origin main` before a push.

**Build identity is baked at compile time**, because nothing on disk can be
trusted to describe the binary: `agentplug/crates/agentplug-runner/build.rs` writes
a generated `build_info.rs` (in `OUT_DIR`) with `COMMIT`, `BUILD_TS` and `RELEASE_BUILD`, exposed
through `agentplug/crates/agentplug-runner/src/build_info.rs` and printed by `--build-info`.
The release workflow sets `AGENTPLUG_RELEASE_BUILD=1`. Git-resolved HEAD,
symbolic refs, and existing packed refs are Cargo inputs across ordinary,
submodule and worktree checkouts; an ordinary commit refreshes `COMMIT`
without touching source or clearing caches.

**The guard** (`agentplug/crates/agentplug-runner/src/download.rs`,
`self_update_blocked_reason`, checked before anything is staged): refuse when
`AGENTPLUG_NO_SELF_UPDATE` is set to anything but `0/false/no/off`; refuse when
`~/.agentplug/agentplug-runner.no-self-update` exists; refuse when the installed
runner is a local build (either its sha256 matches
`~/.agentplug/agentplug-runner.local-build.json`, or probing it with
`--build-info` reports `release_build:false`); and require the incoming release
version to be STRICTLY greater than the running one. `promote_staged_exe_to_canonical`
re-checks `installed_runner_blocks_promotion` at takeover, so a staged copy that
slipped past staging still cannot overwrite a pinned local binary: the process
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
  enumerating VISIBLE windows and matching the title; a new console's title is
  the console app's path.
- **conhost count is not a usable before/after metric on this machine**: the
  default terminal is Windows Terminal, so consoles are hosted by
  `OpenConsole.exe`, and peak conhost was 24 before vs 25 after while the real
  signal went from 189 to 0.
- The flash only reproduces with the daemon running (its repeated `project_root`
  calls to `git rev-parse`). Launching the binary as a one-shot `spool` client
  shows nothing, so an A/B built on one-shot launches will falsely report both
  builds clean.

**Swapping the live runner binary:** Windows refuses to overwrite a running
image but allows renaming it. `taskkill` every `agentplug-runner.exe`, rename the
canonical exe aside, copy the new one in, and restart the daemon. Deleting the
file first does not work; the gm session respawns `spool` every few seconds and
re-locks it. A `finally` block is not optional here: a failed restore leaves the
pre-fix binary live and self-updating.

**Still open, same class, JS side:** `~/.gm-tools/gm-mcp-server.mjs` self-updates
from a release channel via `gm-mcp/src/self-update.js` (backing up to `.prev`)
and the 08:57 copy lost two `windowsHide` sites the `.prev` copy has:
`execFileSync("git", [...])` and `spawnSync(process.execPath, ["--check", ...])`.
The release channel is shipping a bundle without them, so the same
"update silently reverts a fix" shape applies there. Not touched pending a
decision; the runner guard does not cover it.

## Verified 2026-10-07 (plugkit wasm load path, rebuild flags, sideload)

- The daemon loads `~/.agentplug/plugins/gm.wasm`. A sideload writes a sibling `.tmp` and renames it over that file (back up first); the daemon hot-reloads, no restart.
- Rebuild with `cargo build -p rs-plugkit --release --target wasm32-wasip1 --features slim`; without `slim` the artifact embeds 133 MB of bge weights.
- `ensure_plugin_installed` (`agentplug/crates/agentplug-runner/src/download.rs`) never re-verifies an installed wasm, so a sideload needs no sha256 pin bump.
- `gm.version` is semver (e.g. `0.1.1662`), so the auto-updater's version check is not blocked.

## Verified 2026-10-08 (git_commit content filters, amend, moving HEAD)

- `git commit -- <paths>` re-hashes worktree content itself, so it needs the clean filter as much
  as `git add` does. With `commit` absent from `GIT_SUBCOMMANDS_APPLYING_CONTENT_FILTERS`, a spoint
  commit stored a CRLF blob while `git_add` (already in the list) staged LF, so index and HEAD
  disagreed, the tree stayed dirty after committing, and `git show` rendered `@@ -1,116 +1,122 @@`
  instead of three hunks. The list is now `["add","status","diff","checkout","commit","stash"]`.
  Measured in a scratch repo whose `core.autocrlf=true` lives only in the system config: `git add`
  alone produced a 0-CR index blob while `git commit -- path` produced a 116-CR HEAD blob; with the
  fix both are 0-CR.
- **`core.autocrlf` does not strip CR from a file whose stored blob already has CR**
  (`has_crlf_in_index` in convert.c). So the filter fix repairs a repo whose blobs are LF, and does
  NOT repair one where a CRLF blob already landed -- amending keeps the CRLF. The repair is
  `git_reset_head` followed by a re-commit: once the index falls back to the LF parent blob the
  clean filter fires again.
- `git_reset_head {count | to, mode: mixed|soft, allow_staged}` moves HEAD back without touching the
  worktree. On 2026-10-08, in an earlier build, it also refused `staged_paths_present` when the index held
  paths the request did not name (`allow_staged:true` overrode it), `target_not_ancestor_of_head`,
  and `already_at_target`. Current source has none of these three codes. The pushed-commit refusal
  is `pushed_commit_refused` at `rs-plugkit/crates/plugkit-core/src/wasm_dispatch/verbs/git.rs:2197`, in the amend path. `mode:hard` is
  accepted by the current source, which runs `git reset --hard` on `git_reset`; the earlier refusal is not implemented.
- `git_commit {amend:true}` rewrites the current commit instead of stacking a child, and refuses
  `pushed_commit_refused` (`git.rs:2197`); on an unborn HEAD it fails with "amend requires an existing HEAD commit". `git_commit_dedup_key` carries `amend` so an
  amend is never answered by a replayed non-amend commit.
- **The `git_commit_dedup_lookup` replay rule is owned by the AGENTS.md bullet of that name.** The replay checks only `cat-file -e <sha>`, and an object dropped by
  `git_reset_head` is still present, so the canonical repair -- reset HEAD, then re-commit the same
  message over the same paths -- hit the same dedup key and answered `committed:true` with the old
  sha while HEAD never moved. Witnessed live: re-commit after `git_reset_head {count:1}` reported
  `sha 91f22ebd57` and left `rev-list --count HEAD` at 1. Fixed: the replay now compares `rev-parse HEAD`
  to the recorded `sha_full`.
- `daemon-guard` respawns the daemon after `Stop-Process`; no manual start is needed.

## Verified 2026-10-09 (pool drops: causes, empty candidates, unverified nominations)

Recorded causes of earlier drops: the rule was shadowed by a stale vendored prose file; heartbeats
were not refreshed during lock waits; successors were free text and often ineligible; GPU-lock
timeouts ended runs; completions were not refilled in the same turn; `slots.live` read 0 while
workers ran.

Recorded causes of the drop below 12 on 2026-10-09: completions were refilled in batches, not one
per completion; resolvers nominated browser, GPU and design successors that could not run
graph-node-only; traversal hops started late, so graph-node supply ran out; the served rules were not refreshed
from gm-config (the native config cache did not sync); stuck background shells and Monitors held the
GPU lock and the orchestrator's attention.

Observed ceiling on 2026-10-09 (14:07Z): the live build accepted 24 at `.gm/instructions/entry.md:58`
(a refreshed codesearch in session gm-cli-3109570-1791554460239, recorded as row DRY-25).

Drop to 0 live on 2026-10-09 (13:33Z): eight resolvers finished in one window and nothing relaunched
them in that turn. Successors were chosen by hand because the pool candidates list (`slots.candidates`) came back empty while
779 rows were pending, with the pool observe `candidates:` and `live_rows:` null. The empty list
was logged as a defect row afterwards.

A raw `prd-list` ignores `limit` and `status`, so one read cost about 35k tokens. Reading through
exec_js over the prd-list result avoids that cost.

Two nominations in that cycle were title-only and unverified: `trav-edge-check-relative-imports-skips-edge-root`
(a gate change) and `tsl-only-shaders` (a shader rewrite). Neither was checked before launch.

## Verified 2026-10-10 (a queued gh-pages run held the deploy group for five days)

- `gh-pages.yml` puts every run in `concurrency: group: gh-pages` with `cancel-in-progress: false`. A run created 2026-10-05T21:09:21Z stayed `queued` and never got a job, and it held that group: every run after it went `pending` and was cancelled by the next run that arrived, so the site kept serving the 2026-10-05 build. Fifteen consecutive cancels are recorded between 2026-10-09T14:17Z and 2026-10-10T19:23Z (34 runs total on the workflow).
- Neither a new `workflow_dispatch` nor a push frees the group; the newest run only joins the queue behind the holder, and a pending run that is cancelled never deploys. The repair is to cancel the holder -- `gh run cancel <holder-run-id>` -- after which the newest run starts within seconds.
- The block is per concurrency group, not runner starvation: `doc-drift`, `skill-release` and `bump-pins` completed normally throughout the same window, and `actions/runs?status=pending` for the repo reported exactly one pending run.
- Detection, one call: `gh api 'repos/AnEntrypoint/gm/actions/workflows/gh-pages.yml/runs?per_page=100' --jq '.workflow_runs[]|select(.status!="completed")|[.id,.status,.created_at]'`. Any non-completed run older than a few minutes is the holder; `jobs == 0` after minutes of pending is the zombie shape.

## Verified 2026-10-11 (backgrounded work died when the dispatch that started it returned)

- Symptom: `( nohup cmd >log 2>&1 & )` started from a `bash` dispatch kept writing while the dispatch ran and stopped the moment it returned; the log stayed at 0 bytes and no process survived five minutes. The kill was hard: `trap`-installed HUP, TERM and INT handlers never fired, which rules out a signal the shell could catch.
- Cause: `agentplug/crates/agentplug-host/src/process_tree.rs` set `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` on the job object `Job::assign` creates for every exec child, and job membership is inherited by descendants, so `Job::drop` at the end of `exec_js::run` closed the handle and Windows terminated the whole tree. The runner in service was `0.1.294` (commit `225200d`), which still carried the flag, while the checked-out submodule at `f87064f` did not, so reading the checkout alone made the bug look already fixed.
- Fix: `Job::assign` creates the job with no limit flags. The job is now only a kill switch for `terminate_containment`, which runs at `timeoutMs` expiry and on `task-stop`; returning from a dispatch kills nothing. Pinned by `exec_js::tests::detached_writer_is_still_appending_a_minute_after_the_dispatch_returned`, which asserts a redirected writer is still appending 60 seconds after the dispatch returned.
- Second mechanism, unchanged and still live: a backgrounded child that keeps the runner's stdout or stderr pipe open is adopted as a task and ends with that task's 30-minute deadline, so the redirect in the idiom is part of the contract, not decoration.
- Witness: dispatch `1791713402860-500-44475da329867bd1` returned at 10:09:59Z having started a background probe writer; dispatch `1791713499562-500-181ddfad4fb41b00` at 10:11:35Z read 79 appended ticks from pid 47497. It was still appending at 10:18:45Z (tick 445) and ran to tick 461, ~9 minutes and five later dispatches after the one that started it, until an explicit `Stop-Process` ended it.
- The installed runner is a local build of `225200d` plus this fix: `--build-info` reports `release_build: false`, which makes `reconcileRunner` in `gm-mcp/src/release-bridge.js` answer `skipped: local-build`, so no later upstream release silently replaces it. The previous binary is kept as `~/.gm-tools/agentplug-runner.exe.bak-pre-durable-20261011-100752Z`.

## Verified 2026-10-12 (shared work tree, refused pushes)

- Measured in C:/dev/gm (lane a48ac11a): local main `09575d5d` against remote main `538a0c80`, twelve unpushed local commits. Each came from a `git_finalize` that refused to push over ~150 `clashing_paths` while the same content was already published.
- Each refused push left a local commit redundant with the published one, widening the gap between local HEAD, the work tree and remote main (see skills/gm/docs/rationale.md, Autonomy).

## Verified 2026-10-24 (every gm verb: "plugin gm is not registered", after the wasip3 guest release)

- Symptom: `gm_codemode` (codesearch, fs_read) failed in every project with `plugin gm is not registered for this project (no plugin pool exists ...)`, while dispatch-start and dispatch-end were logged. The bundle was not the cause: the 0.2.291 bundle run from the shell (`gm-mcp-server.mjs dispatch fs_read`) failed the same way.
- Cause: rs-plugkit commit `cf87806ab` ("build: release the wasip3 component", not on rs-plugkit main) built the release guest `plugkit-slim.wasm` (plugkit-bin 0.1.2096, installed 15:58) as a wasip3 component (header `00 61 73 6d 0d 00 01 00`). Runner 0.1.545 (agentplug origin/main `6d2cb16`) installs a component only per project, through `.agentplug/plugins.txt`, and `claim_dispatch.rs` (`handle.dispatch("gm", ...)`) routes every gm verb through `DispatchHandle::dispatch` in `registry.rs`. That path has no component branch and its reload snapshot (`modules_with_hashes`) holds core modules only, so gm never reaches a sibling pool. Writing `.agentplug/plugins.txt` with `gm` does not help (probed in a scratch root, no pool created).
- Mitigation on this machine, no daemon restart: `~/.agentplug/plugins/gm.wasm` restored from `gm.wasm.prev` (core 0.1.2095, sha256 `fed30fa2...`), `gm.version` set to `0.1.2095-core-pin` (a non-semver marker that the runner's sideload check and the gm-mcp release bridge both skip), `gm.build.json` origin `local-dev-sideload`. The component is kept as `gm.wasm.component-0.1.2096.bak`. The daemon picked it up on its next tick. Verified: CLI `fs_read` dispatch_id `1792859037812-797-af8e7390388fcab0`; `gm_codemode` `fs_read` `1792859043732-798-f7bb4a69732a5260`; `codesearch` `1792859049083-799-2b297956c982b661`.
- Lift the pin only after either the runner dispatches a component gm through the gm verb path (the fix belongs in agentplug `claim_dispatch.rs` and `registry.rs` `DispatchHandle::dispatch`), or rs-plugkit's release target returns to `wasm32-wasip1`. Lifting it earlier re-installs the component and reproduces this outage.
