---
name: dream-rsi
description: "Infer strategy proposals from Dream-RSI observation logs, and measure and propose gm-graph traversal coverage. Use when observation logs need strategy proposals. Proposes only; never deploys."
---

# dream-rsi inference

Schedule (set by the caller, not by this skill): run as a background agent on the smallest available model at an interval. The subagent reads files and returns one JSON object. It does not edit files or dispatch verbs.

Inputs:
- Storage index: `<repo>/.gm/dream-rsi/index.json` (`schema_version`, `files`, `record_kinds`, `fields`), written by the guest on every persist. Read it first and resolve every Dream-RSI file name and record kind from it; the observation log, the cycle result and their fields are described there. Orchestration verbs and `dream-*` dispatches are not recorded. A failed record carries `error_code` (the reply's short failure code) or `no_match:true` (a zero-count failure, scored 0.5 and not counted as a failure); a success carries neither.
- Cycle result: the `cycle_result` file of each session named in `index.json`, written by the automatic `dream-replay-cycle` boundary.
- The gm graph: `skills/dream-rsi/gm-graph.json` (`nodes`, `edges`; node `kind` is `principle`, `gate`, `tension` or `terminal` -- there is no phase node; edge `kind` is `forward` or `backreference`). A node is a book when its `book` is non-empty; `book_index` names each anchor book and the node that carries it.
- Phase history: `.gm/turn-state.json` `phase_history`.
- Walk evidence: `.gm/lean-walk/<NODE>.<SESSION>.json`, one subagent record per node visit (`node`, `applied`, `witness`); every file matching `<NODE>.*.json` is a visit of that node.

## Part A: verb strategy

1. Read every observation file. Count records. If there are fewer than `MIN_NEW_OBSERVATIONS` across all sessions, return an `Insufficient` for Part A.
2. Per verb, compute count, failure rate (`exit_code != 0`), gate-drift rate, and mean `quality`.
3. Treat `quality` with caution. `quality` can reflect the open PRD/unknown backlog rather than the dispatch outcome. Rank by failure rate weighted by count, not by `quality`.
4. Some non-zero exits are valid answers, not failures. A `grep` exit 1 with no matches is a no-match result. Classify each failure by the record's `error_code` field; a `no_match:true` record is an answer, not a failure. A failed record with neither is `unclassified`, because its reply is pruned from `.gm/exec-spool/out` and cannot be recovered. The agent shall not propose a change for a verb until its failure exits are shown to be real errors. A verb whose failures are all unclassified gets no proposal and is counted in `unclassified_failures`.
5. Read the open rows in `.gm/prd/` (legacy single file `.gm/prd.yml`, read only during migration). Drop a candidate when an open row already names its verb and the same change.
6. For up to `MAX_PART_A_PROPOSALS` candidates, write one proposal with the verb, the change, the counts and rates as evidence, and a measurable target on the same log. A change is executable: code, a config value or a verb contract. The paper found that directional prose hints do worse than no hint at equal budget, so a proposal that only adds guidance prose is refused.

## Part B: gm-graph traversal

The goal is to walk every principle-kind gm-graph node and every edge, through real work. Each principle node is one hop run by a subagent that advocates that node's discipline at full strength (SKILL.md Section 1d). The hop scope is principle nodes only, the same scope as the gm walk loop (`skills/gm/SKILL.md` Section 1d).

1. Load the graph. Traversable nodes are those whose `kind` is `principle`. Edges are all `edges` entries.
2. Deterministic counts come from code only. Take `traversable_nodes`, `nodes_verified`, `rejected_walks` and `forward_edge_coverage_approx` from the `part_b` of the `dream-replay` reply. The guest writer `derive_part_b` in `rs-plugkit/crates/plugkit-core/src/orchestrator/dream_rsi.rs` is the sole authority for node walks: a node is verified when an observation stamped with its `lean_node` succeeded. Never recount nodes from `.gm/lean-walk/` and never apply a second verified-walk rule; the lean-walk files are read only for step 3.
3. Backreferences are model-judged, and the output says so. `derive_part_b` writes `backreference_edges` and `backreferences_verified` as 0, so they are not code facts. For each backreference edge whose `from` node is verified by step 2, the model judges one condition: does that node's `.gm/lean-walk/<NODE>.<SESSION>.json` `witness` name the edge's condition, in its own words, with a quoted dispatch id? Count the edge as fired only on yes. Report `backreference_edges` and `backreferences_verified` with `"backreference_judgement": "model-judged"`. The rubric is the only model decision in Part B. The judge is a separate scorer session (step 4) that never wrote the walk it judges. Its rubric is one pass or fail for the condition, with the quoted `witness` text as evidence; a holistic score is not accepted, and length is not a criterion. Before a verdict counts, the judge classifies one known-good and one known-bad pair (a witness that names the condition with a dispatch id, and one that does not) under the same rubric; a miss on either pair blocks the verdict for the run. The verdict is owned by the scorer session: it is recorded in the Part B reply under `backreference_judgement` with the calibration result, and no other session writes it. The judge scores one condition per call and never compares two outputs, so the both-orderings rule of `skills/gm/prose/lean-p4.md` (LLMJUDGE) does not apply here.
4. Scoring session. Run Part B under a scorer session id that differs from every walk's `session`. Any lean-walk file whose `session` equals the scorer session is reported in `rejected_walks` with `reason: "self_scored"`. The `dream-replay` reply carries `part_b` only after the scorer session runs this chain in order, each step in that session: `dream-policy-register` with `{policy:{id, roots, max_nodes}, deployed:true}` (each root names a discovery id); then one successful completed dispatch (exit 0), whose `dispatch_id` feeds the next step; then `dream-evaluator-receipt` with `{receipt_id, policy_id, dispatch_id}`; then `dream-discovery-record` with `{id, evaluator_receipt_id, round}`; then `dream-world-seal` with `{world_id, discovery_ids}`; then `dream-replay` with `{world_ids, baseline_policy_id, policy_ids, beta1, beta2}`. Worked witness, all in one scorer session: register `{policy:{id:"p-scorer", roots:["d-scorer"], max_nodes:5}, deployed:true}`; run any completed dispatch and keep its `dispatch_id`; record `{receipt_id, policy_id:"p-scorer", dispatch_id}`; record `{id:"d-scorer", evaluator_receipt_id, round:1}`; seal `{world_id:"w-scorer", discovery_ids:["d-scorer"]}`; then `dream-replay` with `world_ids:["w-scorer"]`, `baseline_policy_id` and `policy_ids` `["p-scorer"]`. Its `part_b` lists each lean-walk node that the scorer session wrote under `rejected_walks` with `reason: "self_scored"`. The wire verbs are hyphenated (the gm-mcp list shows `dream_*`). Handlers: `rs-plugkit/crates/plugkit-core/src/orchestrator/dream_rsi.rs` `register_policy`, `evaluator_receipt` (rejects a dispatch whose `session_id` is not the scorer's), discovery record, `seal`, and `handle` for `dream-replay`. Without a registered policy `dream-replay` answers `dream-replay has no registered policies`. Replay observes only sealed discovery ids, so a root that names none fails with `unobserved node`. `world_ids` lists the `world_id` values sealed in the previous step. A node is verified only by a walk dispatch whose body carries `lean_node: "<NODE>"` (taken by `take_lean_node` in `rs-plugkit/crates/plugkit-core/src/wasm_dispatch/verbs.rs`) and that exits 0; a dispatch without the stamp adds no observation to any node, so `part_b` shows the node as unwalked.
5. Forward-edge coverage is the code value from step 2, approximated as covered when both endpoints have verified walks. Say that this is an approximation.
6. Proposals: up to `MAX_PART_B_PROPOSALS` unwalked nodes, in this priority order: nodes with no verified walk, then backreference edges never fired. For each, give the node id, the condition to walk it on the next real task, and the evidence that would count as a walk. Skip a node that an open row already proposes.

## Part C: the discipline tree

The graph is one tree, not nine. Every book is its own node. `book_index` names
each anchor book and the node that carries it: 43 got a node of their own and 12
are the same book as a node the lean tree already carried, so they join it there
rather than duplicating it. Their `provenance` is the prose file that owns
them, which is where they came from and nothing more: it groups nothing and gates nothing.

Traversal is nonlinear by construction. Every node can be reached, left and
re-entered. Not every book has an edge to a book of another provenance. Reachability holds regardless: every node of `gm-graph.json` is reached from the two entry points. There is no `phase` node -- nothing in the graph is a door
into a set of nodes.

**The terminal is `G_FIXPOINT`** ("sweep changed nothing"). `G_SURFACE` is the
halt, not the goal: it means the walk stopped and handed the ambiguity to a
human. Movement toward `G_FIXPOINT` is measured by `convergence.measure`,
`unwalked_nodes + unfired_backreferences`, and that measure is non-increasing
(`MONOTONE`): a step counts as movement only when it walks a node that had no
walk or fires a backreference that had never fired, so re-walking walked ground
is not progress. The terminal is reached when a full sweep changes nothing:
`G_SWEEP` found no reopened gate, no counterexample and no growth.

`scripts/check-discipline-tree.mjs` is the gate on all of the above. It counts
isolated nodes, unreachable nodes, dead-end nodes and provenance-partitioned books and
fails when any of those counts is non-zero. Run it after any edit to the graph;
CI runs it on every push and pull request to main.

## Part D: the dream loop

The loop is the one at https://dream-rsi.com/: explore online, append the recorded tree to the history, dream M policy revisions and score each by replay over the whole history, redeploy the winner. The incumbent is always one of the M candidates, so the deployed policy is never worse. Parts A to C read the history; Part D checks that the loop turns.

1. History is the whole project, not one session: count records and sessions across every observation file, and take the newest record `ts`.
2. Read every session's cycle result (the `cycle_result` file in `index.json`). The newest by `ts` is the current cycle.
3. The loop is `stalled` when the history holds at least `MIN_NEW_OBSERVATIONS` records newer than the current cycle (or no cycle result exists) and the current cycle is older than `COOLDOWN_MS`. The stage that did not run is `cycle_trigger`: no cycle result since the threshold was reached.
4. The cycle result carries the incumbent-versus-challenger fields `selection` (`propose-challenger` or `keep-incumbent`), `improved`, `never_worse`, `baseline_score` and `selected_score`, written by `dream-replay-cycle` (`rs-plugkit/crates/plugkit-core/src/orchestrator/dream_rsi.rs`). Report them as read. A challenger is selected only when the replay holds at least `PROMOTION_MIN_WORLDS` (3) worlds and its score is strictly above `baseline_score + PROMOTION_MARGIN` (0.02), both constants in `rs-plugkit/crates/plugkit-core/src/orchestrator/dream_rsi.rs`; otherwise `selection: keep-incumbent`, `improved: false`, with `promotion_reason` `insufficient_worlds` or `below_margin`. `never_worse` is `selected_score >= baseline_score`. Redeployment stays a manual act under the normal PRD and evidence gates; this skill never writes the active strategy.

## Output

Constants:

- `MIN_NEW_OBSERVATIONS` and `COOLDOWN_MS` are the cycle-trigger constants in `agentplug/crates/agentplug-runner/src/dream_cycle.rs`; read their values there.
- `MAX_PART_A_PROPOSALS = 3`
- `MAX_PART_B_PROPOSALS = 5`

Return exactly one `DreamRsiResult`:

```
DreamRsiResult     = { status: "proposed", part_a: PartA | Insufficient, part_b: PartB, part_d: PartD }
PartD              = { history_records: number, history_sessions: number, newest_record_ts: number,
                       newest_cycle_ts: number | null, stalled: boolean,
                       stalled_stage: "cycle_trigger" | null, defects: string[] }
Insufficient       = { status: "insufficient", records: number }   // records < MIN_NEW_OBSERVATIONS
PartA              = { records: number, per_verb: VerbStat[], proposals: VerbProposal[] }   // proposals <= MAX_PART_A_PROPOSALS
VerbStat           = { verb: string, count: number, failure_rate: number, gate_drift_rate: number }
VerbProposal       = { verb: string, change: string, evidence: string, target: string, check: Check }
PartB              = { traversable_nodes: number, nodes_verified: number, backreference_edges: number,
                       backreferences_verified: number, forward_edge_coverage_approx: number,
                       rejected_walks: RejectedWalk[], proposals: NodeProposal[] }   // proposals <= MAX_PART_B_PROPOSALS
RejectedWalk       = { node: string, missing_dispatch_ids: string[] }
NodeProposal       = { node: string, walk_when: string, evidence_that_counts: string, check: Check }
Check              = { verb: string, body: object, pass: string }   // one dispatch; pass is a predicate over its reply
```

A `check` names one dispatch that the history replay or a live witness can run, and a `pass` predicate over its reply (a field and value, or a replay score that beats the incumbent). A proposal with no runnable `check`, or with boilerplate acceptance text in its place, is not filed.

A proposal is evidence-bound planning input. It is deployed only through the normal gate, authorization and evidence gates, never by this skill.

## Finish the work

- Finishing the requested work is the goal of every run of this skill. A run that stops with work left undone is incomplete.
- When an issue blocks a step (a failing check, a fault in a tool or service, a missing input, a network or environment fault), fix it in the same run: retry on a bounded or resumable route, use an alternate route to the same result, repair the fault where it originates, then continue the remaining work.
- Stop only when the requested work is complete, or when a step is still blocked after every route has been tried. Then report the blocked step, the routes tried, and the evidence for each.

## Design reference

The cycle-boundary trigger, the three-stage loop and the git lifecycle are in [the design reference](references/dream-rsi.md). Load it only when a task changes the loop itself