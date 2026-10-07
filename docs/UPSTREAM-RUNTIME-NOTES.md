# Inherited optional-runtime notes

These historical notes describe the inherited upstream runtime. They have not been reverified by the default-workflow audit and are not requirements for ordinary gm tasks. Consult them only when working on that optional runtime; current user scope and host policy still apply.

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
