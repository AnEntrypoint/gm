# Verified runtime findings

Dated findings behind the standing rules in AGENTS.md. Read the section whose subsystem a failure touches; the rule itself lives in AGENTS.md.

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
the sibling absent. Any new guest->sibling import must do the same.
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
The runner consumes `releases/latest` and stages `.exe.new` -> `takeover` ->
`promote_staged_exe_to_canonical` -> re-exec. There is no way to trigger a
release other than pushing to `main`, and CI pushes its own bump commits, so
expect `git pull --rebase origin main` before a push.

**Build identity is baked at compile time**, because nothing on disk can be
trusted to describe the binary: `agentplug/crates/agentplug-runner/build.rs` writes
`OUT_DIR/build_info.rs` with `COMMIT`, `BUILD_TS` and `RELEASE_BUILD`, exposed
through `src/build_info.rs` and printed by `--build-info`.
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

## Verified 2026-10-07 (plugkit wasm load path, rebuild flags, sideload)

- The daemon LOADS `~/.agentplug/plugins/gm.wasm`, not `~/.gm-tools/plugkit.wasm`: `daemon-status.json`'s `loaded_plugin_content_sha256.gm` matches the former. Both paths exist, so a staleness hunt that stats only `~/.gm-tools/plugkit.wasm` reads the wrong file; a refresh writes both.
- Rebuild with `--features slim` -- `cargo build -p rs-plugkit --release --target wasm32-wasip1 --features slim`. Without it `weights/bge-small-en-v1.5.safetensors` (133 MB) is embedded and the artifact is 139,690,176 bytes; with it ~5.06 MB. Reuse the existing target dir (incremental build measured 1m06s).
- The sha256 pin is checked only at download time against the GitHub release sidecar (`download.rs:299`), and `ensure_plugin_installed` returns as soon as a wasm exists (`:1294`), so an installed wasm is never re-verified and `~/.gm-tools/plugkit.wasm.sha256` is a local record, not an enforced pin. Sideloading a fresh build is safe and needs no pin bump.
- `gm.version` is currently `local-dev-sideload-body-parse-diagnostic`, which is non-semver, so the auto-updater can never overwrite a sideloaded wasm and staleness is manual-only until a semver version is restored. A session expecting an auto-update to fix stale verbs waits forever.
- A swap needs no daemon restart: write a sibling `.tmp` and rename, and the daemon hot-reloads (`health` `ok:true`, `daemon-status.json`'s hash updates). Back up first; roll back by restoring the backup.

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
  worktree. It refuses `pushed_commit_refused` when HEAD is reachable from any `refs/remotes/` ref,
  `staged_paths_present` when the index holds paths the request did not name (`allow_staged:true`
  overrides), `target_not_ancestor_of_head`, and `already_at_target`. `mode:hard` is refused -- this
  verb never rewrites the worktree.
- `git_commit {amend:true}` rewrites the current commit instead of stacking a child, and refuses
  `pushed_commit_refused` / `amend_requires_head`. `git_commit_dedup_key` carries `amend` so an
  amend is never answered by a replayed non-amend commit.
- **`git_commit_dedup_lookup` must require HEAD to still equal the recorded `sha_full`, not merely
  that the object exists.** The replay only checked `cat-file -e <sha>`, and an object dropped by
  `git_reset_head` is still present, so the canonical repair -- reset HEAD, then re-commit the same
  message over the same paths -- hit the same dedup key and answered `committed:true` with the old
  sha while HEAD never moved. Witnessed live: re-commit after `git_reset_head {count:1}` reported
  `sha 91f22ebd57` and left `rev-list --count HEAD` at 1. Now the lookup compares `rev-parse HEAD`
  to the record, so a stale entry falls through to a real commit.
- `daemon-guard` respawns the daemon after `Stop-Process`; no manual start is needed.

## Verified 2026-10-09 (pool drops: causes, empty candidates, unverified nominations)

Recorded causes of earlier drops: the rule was shadowed by a stale vendored prose file; heartbeats
were not refreshed during lock waits; successors were free text and often ineligible; GPU-lock
timeouts ended runs; completions were not refilled in the same turn; `slots.live` read 0 while
workers ran.

Recorded causes of the drop below 12 on 2026-10-09: completions were refilled in batches, not one
per completion; resolvers nominated browser, GPU and design successors that could not run
node-only; traversal hops started late, so node supply ran out; the served rules were not refreshed
from gm-config (the native config cache did not sync); stuck background shells and Monitors held the
GPU lock and the orchestrator's attention.

Drop to 0 live on 2026-10-09 (13:33Z): eight resolvers finished in one window and nothing relaunched
them in that turn. Successors were chosen by hand because `slots.candidates` came back empty while
779 rows were pending, with the pool observe `candidates:` and `live_rows:` null. The empty list
was logged as a defect row afterwards.

A raw `prd-list` ignores `limit` and `status`, so one read cost about 35k tokens. Reading through
exec_js over the prd-list result avoids that cost.

Two nominations in that cycle were title-only and unverified: `trav-edge-check-relative-imports-skips-edge-root`
(a gate change) and `tsl-only-shaders` (a shader rewrite). Neither was checked before launch.
