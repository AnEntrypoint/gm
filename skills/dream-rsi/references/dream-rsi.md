# Dream-RSI

Design, cycle-boundary trigger and git lifecycle for the Dream-RSI loop. The standing rules live in AGENTS.md.

## Dream-RSI loop, git lifecycle and cycle trigger (arxiv 2609.14858)

Dream-RSI is a continuous core process, not an opt-in subsystem: every ordinary GM work dispatch records a bounded, session-owned observation automatically into `.gm/dream-rsi/<session>/observations.json` (a flat per-dispatch log whose record fields `skills/dream-rsi/SKILL.md` lists) and `active-strategy.json` (current selection summary). Orchestration bookkeeping and Dream-RSI's own maintenance dispatches are never themselves recorded as outcomes. Only real work dispatches are recorded.

**Three-stage loop, offline-biased per the paper.** Stages are not verbs: no spool verb is named after a stage. The three stages are:

- **Stage 1, online-explore.** Drives real dispatch rounds that grow the discovery tree live. The discovery tree is the set of discovery records, each linked to its parent record by `parent_id`.
- **Stage 2, the replay simulator.** Walks that frozen tree offline, with zero re-execution and a pure disk read, to score challenger exploration policies against the SAME recorded worlds the incumbent already faced. A world is one sealed world, named by its world id, that the replay simulator scores.
- **Stage 3, policy dreaming.** Samples candidate policy variants for the simulator to score.

The incumbent policy (the one currently selected) is replayed against every challenger (a candidate policy variant) and stays selected unless a challenger scores strictly higher over the same sealed worlds. Each world is scored as best attained quality minus `beta1` times summed cost plus `beta2` times parallelism bonus, and a policy's score is the mean over its worlds. Monotonic safety means never a regression.

**A replay result is evidence-bound planning input, never execution authority.** It cannot run a tool, cannot evaluate a new outcome, and cannot make an unrecorded branch observed. Those require a real dispatch. During every active task, the agent consults the accumulated observed world (the records in `observations.json`) and the result that `automatic_replay` returns (`rs-plugkit/crates/plugkit-core/src/orchestrator/dream_rsi.rs:687`) before selecting later exploration work, the same way the `recall_hits` field of an `instruction` reply informs a turn without substituting for it.

**Deploying a strategy rides the normal paths, never an autonomous trigger.**

An accepted strategy is the currently selected policy: the incumbent, or a challenger that strictly beat the incumbent over the same sealed worlds. A deployment uses the normal PRD (`prd-*` verbs), mutable (`mutable-*` verbs), phase, authorization and evidence paths. No daemon tick or scheduled job redeploys a strategy unattended; redeployment is a dispatch an agent makes under the same gates as any other state-changing transform. Metrics driving selection are re-derived from the dispatch ledger (the guest's `dispatch_ledger` module, keyed by dispatch id) on each replay, never supplied by the model narrating its own progress.

**Git lifecycle: `.gm/dream-rsi/` is gitignored** (`.gitignore:168`), because its scratch trees have path names past the Windows 260-character limit and `git status` must not walk them. No session file is tracked: `git ls-files .gm/dream-rsi/` lists none. The session files are small, human-readable JSON with no binary blobs, and they stay untracked, so observations do not sync between clones.

**The cycle-boundary trigger is a periodic tick inside agentplug-runner's own daemon loop, not a GitHub Actions cron.** `spawn_dream_rsi_cycle_ticker` (`agentplug/crates/agentplug-runner/src/daemon.rs`) mirrors the existing `spawn_heartbeat_ticker` pattern: once a minute, per known project root, it counts `.gm/dream-rsi/*/observations.json` records newer than each owner's last verified replay, and writes one `dream-replay-cycle` spool request per owner session (`rs-plugkit/crates/plugkit-core/src/orchestrator/mod.rs` routes it to `dream_cycle::handle`, already live) only after 20 or more new observations (`MIN_NEW_OBSERVATIONS`) have accumulated since the last verified replay AND 15 minutes (`COOLDOWN_MS`) have passed since the previous cycle's reply or deferral, matching the paper's own build-tree-then-dream cycle boundary and never firing on every tick. The daemon-tick path beats a git-push-triggered Actions cron because it observes real cross-session accumulated discovery-tree data on one machine without needing a commit to fire. The trigger dispatches `dream-replay-cycle` only. `observe_dispatch` (`rs-plugkit/crates/plugkit-core/src/orchestrator/dream_rsi.rs`), writes `active-strategy.json` on each observed dispatch, and the cycle trigger never writes it.
