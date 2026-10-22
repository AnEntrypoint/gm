# Dream-RSI

Design, cycle-boundary trigger and git lifecycle for the Dream-RSI loop. The standing rules live in AGENTS.md.

## Dream-RSI loop, git lifecycle and cycle trigger (arxiv 2609.14858)

Dream-RSI is a continuous core process, not an opt-in subsystem: every ordinary GM work dispatch records a bounded, session-owned observation automatically into `.gm/dream-rsi/<session>/observations.json` (a flat per-dispatch log whose record fields `skills/dream-rsi/SKILL.md` lists). `dream-replay-cycle` writes the cycle result in the same directory; the file names and record schemas are listed in `.gm/dream-rsi/index.json`, which the guest writes. No guest code and no daemon writes the active strategy file (`.gm/dream-rsi/<owner>/active-strategy.json`, which `active_strategy` reads with a `_any-session` fallback). An attended agent writes it under a PRD row, after reading `cycle-result.json` with `improved` and `never_worse` both true. Orchestration bookkeeping and Dream-RSI's own maintenance dispatches are never themselves recorded as outcomes. Only real work dispatches are recorded.

**Three-stage loop, offline-biased per the paper.** Stages are not verbs: no spool verb is named after a stage. The three stages are:

- **Stage 1, online-explore.** Drives real dispatch rounds that grow the discovery tree live. Each round runs the spool verbs `dream-evaluator-receipt` (carrying `parent_id`, the parent discovery id, or none for a root) and then `dream-discovery-record` (`id`, `evaluator_receipt_id`, `policy_id`, `dispatch_id`, `round`), which appends a `dream-discovery-record` line to `.gm/dream-rsi/<session>/discovery.json`. The discovery tree is the set of those records; each record's `parent_id` is copied from its evaluator receipt, not from the discovery-record body.
- **Stage 2, the replay simulator.** Walks that frozen tree offline, with zero re-execution and a pure disk read, to score challenger exploration policies against the SAME recorded worlds the incumbent already faced. A world is one sealed world, named by its world id, that the replay simulator scores.
- **Stage 3, policy dreaming.** Samples candidate policy variants for the simulator to score.

The incumbent policy (the one currently selected) is replayed against every challenger (a candidate policy variant) and stays selected unless a challenger scores strictly higher over the same sealed worlds. Each world is scored as best attained quality minus `beta1` times summed cost plus `beta2` times parallelism bonus, and a policy's score is the mean over its worlds. Monotonic safety means never a regression.

**A replay result is evidence-bound planning input, never execution authority.** It cannot run a tool, cannot evaluate a new outcome, and cannot make an unrecorded branch observed. Those require a real dispatch. During every active task, the agent consults the accumulated observed world (the records in `observations.json`) and the `cycle-result.json` that `dream-replay-cycle` writes (built in `rs-plugkit/crates/plugkit-core/src/orchestrator/dream_rsi.rs`) before selecting later exploration work, the same way the `recall_hits` field of an `instruction` reply informs a turn without substituting for it.

**Deploying a strategy rides the normal paths, never an autonomous trigger.**

An accepted strategy is the currently selected policy: the incumbent, or a challenger that strictly beat the incumbent over the same sealed worlds. A deployment uses the normal PRD (`prd-*` verbs), unknown (`unknown-*` verbs), phase, authorization and evidence paths. No daemon tick or scheduled job redeploys a strategy unattended; redeployment is a dispatch an agent makes under the same gates as any other state-changing transform. Metrics driving selection are re-derived from the dispatch ledger (the guest's `dispatch_ledger` module, keyed by dispatch id) on each replay, never supplied by the model narrating its own progress.

**Git lifecycle: `.gm/dream-rsi/` is gitignored** (see `.gitignore`), because its scratch trees have path names past the Windows 260-character limit and `git status` must not walk them. No session file is tracked: `git ls-files .gm/dream-rsi/` lists none. The session files are small, human-readable JSON with no binary blobs, and they stay untracked, so observations do not sync between clones.

**The cycle-boundary trigger is a periodic tick inside agentplug-runner's own daemon loop, not a GitHub Actions cron.** `spawn_dream_rsi_cycle_ticker` (`agentplug/crates/agentplug-runner/src/daemon.rs`) mirrors the existing `spawn_heartbeat_ticker` pattern: on each periodic tick, per known project root, it counts `.gm/dream-rsi/*/observations.json` records newer than each owner's last verified replay, and writes one `dream-replay-cycle` spool request per owner session (`rs-plugkit/crates/plugkit-core/src/orchestrator/mod.rs` routes it to `dream_cycle::handle`, already live) only after an observation carrying `run_end: true` has landed since the last verified replay (a dispatch sent with `"run_end": true` in its body, which `observe_dispatch` records on that row), or, as a backstop for owners that never send it, after `MIN_NEW_OBSERVATIONS` new observations have accumulated and the newest one is `BACKSTOP_IDLE_MS` old; `COOLDOWN_MS` must also have passed since the previous cycle's reply or deferral, matching the paper's own build-tree-then-dream cycle boundary and never firing on every tick. The daemon-tick path beats a git-push-triggered Actions cron because it observes real cross-session accumulated discovery-tree data on one machine without needing a commit to fire. The trigger dispatches `dream-replay-cycle` only.

## Use cases

Each use case is fully dressed (Cockburn): primary actor, scope, level, stakeholders, preconditions, trigger, main success scenario (MSS), extensions keyed to the MSS step they replace, and guarantees. Every extension names the code path that implements it or the PRD row that will.

### UC-1 Record an observation

- **Primary actor:** the gm dispatch pipeline, acting for the owning session.
- **Scope:** one project root, one session's `.gm/dream-rsi/<session>/observations.json`.
- **Level:** subfunction.
- **Stakeholders:** the replay simulator (needs complete records), the human reviewer (needs an audit trail).
- **Preconditions:** the dispatch is a real work dispatch. Orchestration bookkeeping and Dream-RSI maintenance dispatches are excluded before recording.
- **Trigger:** a real work dispatch finishes.
- **MSS:**
  1. The pipeline builds the observed dispatch for the finished work.
  2. `observe_dispatch` (`rs-plugkit/crates/plugkit-core/src/orchestrator/dream_rsi.rs`) appends one JSON line through `pkfs::append`.
  3. When the body carried `"run_end": true`, the row records it.
- **Extensions:**
  - 1a. The dispatch is orchestration or a Dream-RSI maintenance dispatch: nothing is recorded (line 7 of this file).
  - 2a. The live file holds 256 records: the whole file moves to `observations-archive-<ts>.json` and the newest 32 stay live (`rs-plugkit/crates/plugkit-core/src/orchestrator/AGENTS.md`).
  - 2b. The append fails: no partial line is left by design of the single append; the failure surfaces in the dispatch reply. Behavior beyond that is filed under PRD row USECASES-pw-hop-USECASES-1018-3 for confirmation.
  - 3a. The record carries no active policy id: `ObservationRecord` (`rs-plugkit/crates/plugkit-core/src/orchestrator/dream_rsi.rs`) has no policy field, so a later replay cannot attribute the outcome to a redeployed policy. Filed under PRD row find-1-3-policy-id-observation-field.
- **Guarantees:** a recorded line is never rewritten; concurrent dispatches cannot drop each other's lines; a line exists only for a real work dispatch.

### UC-2 Replay the frozen tree offline

- **Primary actor:** the Dream-RSI cycle (`dream-replay-cycle`, routed to `dream_cycle::handle`).
- **Scope:** one owner session's discovery tree and its sealed worlds.
- **Level:** user goal.
- **Stakeholders:** the human reviewer, the incumbent policy owner, challenger policy authors.
- **Preconditions:** the owner has at least `MIN_NEW_OBSERVATIONS` new records, or one with `run_end: true`, since its last verified replay.
- **Trigger:** the periodic tick in `spawn_dream_rsi_cycle_ticker` (`agentplug/crates/agentplug-runner/src/daemon.rs`) decides a cycle boundary.
- **MSS:**
  1. The tick checks the cooldown (`COOLDOWN_MS` since the previous reply or deferral) and writes one `dream-replay-cycle` request per owner.
  2. The handler replays the frozen tree with zero re-execution and a pure disk read.
  3. Each challenger and the incumbent are scored over the same sealed worlds: quality minus `beta1` times cost plus `beta2` times parallelism, averaged per policy.
  4. The result is written to the owner directory's `cycle_result` file (see `index.json`).
- **Extensions:**
  - 1a. Cooldown has not passed: the tick defers, and no request is written (`agentplug/crates/agentplug-runner/src/daemon.rs`).
  - 1b. Neither trigger condition holds: no request is written on that tick (`agentplug/crates/agentplug-runner/src/daemon.rs`, `spawn_dream_rsi_cycle_ticker`).
  - 2a. The cursor rolled off the 256-entry window: the daemon marks `pending-partial-window` (`agentplug/crates/agentplug-runner/src/dream_cycle.rs`), and the cycle result does not yet carry a partial flag. Filed under PRD row USECASES-pw-hop-USECASES-1018-3; until that row lands, consumers must not treat the replay as covering the lost records.
  - 2b. A replay that cannot finish: the replay reply reports the failure and the incumbent stays selected (`rs-plugkit/crates/plugkit-core/src/orchestrator/mod.rs`, which routes `dream-replay-cycle` to `dream_cycle::handle`).
- **Guarantees:** the replay performs no re-execution; the incumbent stays selected unless a challenger scores strictly higher; no strategy is deployed by this use case.

### UC-3 Select the policy

- **Primary actor:** the human reviewer or an agent acting on the reviewer's behalf.
- **Scope:** one owner session's policy choice.
- **Level:** user goal.
- **Stakeholders:** the incumbent policy owner, the reviewer, downstream PRD rows.
- **Preconditions:** the owner's cycle result exists and is newer than its last selection.
- **Trigger:** the reviewer reads the replay result before later exploration work.
- **MSS:**
  1. The reviewer reads the incumbent score and each challenger score over the same sealed worlds.
  2. The reviewer selects the incumbent, or a challenger that scored strictly higher.
  3. The selection is recorded as evidence, not as an execution step.
- **Extensions:**
  - 1a. The replay is stale (its newest observation is newer than the replay): the reviewer re-runs UC-2 before selecting.
  - 2a. No challenger scored strictly higher: the incumbent stays selected (`rs-plugkit/crates/plugkit-core/src/orchestrator/dream_rsi.rs`, strict comparison).
  - 2b. A challenger ties the incumbent: the incumbent stays selected, monotonic safety (`rs-plugkit/crates/plugkit-core/src/orchestrator/dream_rsi.rs`, strict comparison).
- **Guarantees:** a selection never regresses the incumbent; a replay result is planning input and carries no execution authority.

### UC-4 Redeploy a selected policy

- **Primary actor:** an agent dispatching a state-changing transform under the normal gates.
- **Scope:** the project's PRD, mutable state, phase and authorization paths.
- **Level:** user goal.
- **Stakeholders:** the human reviewer, every session that runs under the deployed policy.
- **Preconditions:** UC-3 has selected a policy; the dispatch carries the normal authorization evidence.
- **Trigger:** the reviewer or an agent decides to deploy the selected policy.
- **MSS:**
  1. The agent opens a PRD row for the deployment through `prd-*` verbs.
  2. The agent applies the policy change through `unknown-*` verbs under the phase and authorization gates.
  3. The metrics that drove selection are re-derived from the dispatch ledger, keyed by dispatch id.
  4. The row is resolved with a witness dispatch id.
- **Extensions:**
  - 2a. A gate refuses the dispatch: the refusal is the result. The agent records the refused dispatch and does not bypass the gate (`skills/gm/SKILL.md`).
  - 3a. The ledger does not hold the dispatch ids the metrics cite: the metrics are not re-derived and the deployment stays open under its row (`rs-plugkit/crates/plugkit-core/src/orchestrator/AGENTS.md`, dispatch ledger).
  - 4a. No witness exists: the row stays open with a named fact (`skills/gm/SKILL.md`, PRD rows).
  - 4b. The deployed policy id is not written to later observation records, so the outcomes of later dispatches cannot be attributed to the deployment. Filed under PRD row find-1-3-policy-id-observation-field.
- **Guarantees:** no daemon tick or scheduled job redeploys a policy; every deployment has a PRD row and a witness dispatch id.

## Minimal sealed-world chain for dream-replay

`dream-replay` takes sealed `world_ids` only and refuses a body carrying `worlds` (`dream-replay accepts sealed world_ids, never caller-supplied worlds`). A single dispatch therefore cannot witness a replay. The witness is the final `dream-replay` dispatch of the chain below, which consumes the sealed worlds. Every record is owned by the dispatch session, so all steps run under one session id. The chain holds three worlds, the minimum that gives `dream-replay` an `order` domain (`PROMOTION_MIN_WORLDS` in `rs-plugkit/crates/plugkit-core/src/orchestrator/dream_rsi.rs`).

1. Three completed dispatches in the session with `exit_code` 0, for example `fs_stat` on three paths. Their dispatch ids are read from `.gm/exec-spool/.dispatch-ledger.json` (`dispatch_id`, `session_id`, `verb`).
2. `dream-policy-register` with `policy` `{"id":"base-policy","roots":["d-root"],"max_nodes":4}` and `"deployed":true`. The baseline is the session's only deployed policy. Its deployment writes `.gm/dream-rsi/<session>/active-strategy.json` and nothing outside the session directory.
3. `dream-policy-register` with `policy` `{"id":"chal-policy","roots":["d-root"],"max_nodes":4}` and no `deployed` field.
4. For each discovery, `dream-evaluator-receipt` with `receipt_id`, `policy_id` `base-policy`, `dispatch_id` (one id from step 1) and `parent_id` when the discovery has a parent, then `dream-discovery-record` with `id` and `evaluator_receipt_id`. The discovery takes its `policy_id`, `dispatch_id` and `parent_id` from its receipt. The chain records `d-root` (no parent), then `d-a` and `d-b` (parent `d-root`).
5. `dream-world-seal` three times: `w1` over `["d-root","d-a"]`, `w2` over `["d-root","d-b"]`, and `w3` over `["d-root","d-a","d-b"]`. Each world holds the root of both policies, since replay refuses a root the world did not observe.
6. `dream-replay` with `world_ids` `["w1","w2","w3"]`, `baseline_policy_id` `base-policy`, `policy_ids` `["base-policy","chal-policy"]` (the baseline must be listed in `policy_ids`), `beta1` and `beta2`. The challenger has the same roots and budget as the baseline, so the two scores tie and the reply keeps the incumbent. In the `replay` object of the reply, `selected_policy_id` is `base-policy`, `improved` is false, `promotion_reason` is `below_margin` and `n_observations` is 3.
