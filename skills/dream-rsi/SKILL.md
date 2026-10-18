---
name: dream-rsi
description: "Infer strategy proposals from Dream-RSI observation logs, and measure and propose gm-graph traversal coverage. Use when observation logs need strategy proposals. Proposes only; never deploys."
---

# dream-rsi inference

Schedule (set by the caller, not by this skill): run as a background agent on the smallest available model at an interval. The subagent reads files and returns one JSON object. It does not edit files or dispatch verbs.

Inputs:
- `observations.json` files: `<repo>/.gm/dream-rsi/<session>/observations.json`, one JSON object per line (a legacy JSON array is also accepted), appended per record and rotated to `observations-archive-<ts>.json` past 256 records, serialized from `ObservationRecord` in `rs-plugkit/crates/plugkit-core/src/orchestrator/dream_rsi.rs`. Orchestration verbs and `dream-*` dispatches are not recorded. A failed record carries `error_code` (the reply's short failure code) or `no_match:true` (a zero-count failure, scored 0.5 and not counted as a failure); a success carries neither.
- Replay results: `.gm/dream-rsi/<session>/replay-result.json` (`baseline_policy_id`, `selected_policy_id`, `baseline_score`, `selected_score`, `improved`, `never_worse`, `rankings`) and `cycle-result.json` (`cycle_id`, `selection`, `score`, `replay_count`, `ts`).
- The gm graph: `skills/dream-rsi/gm-graph.json` (`nodes`, `edges`; node `kind` is `principle`, `gate`, `tension` or `terminal` -- there is no phase node; edge `kind` is `forward` or `backreference`). A node is a book when its `book` is non-empty; `book_index` names each anchor book and the node that carries it.
- The DADA graph: `skills/dream-rsi/dada-graph.json`, the same node layout as the gm graph (`nodes`, `edges`, `entry_points` = `DADA_START`, `convergence`). It holds the DADA anchor graph: `principle` nodes grouped by `provenance` (`dada:<cluster>`), `tension` nodes for counterpoint edges, and the gate and terminal nodes `DADA_START`, `DADA_G_ROUTE`, `DADA_G_CRITICS`, `DADA_G_NUMBERS`, `DADA_HALT`, `DADA_HOLDS`. Its page is `docs/dada-graph.html` (built from this file by `scripts/build-graph-page.mjs`). Read it with the same rules as the gm graph in Part B and Part C; it is never a phase source.
- Phase history: `.gm/turn-state.json` `phase_history`.
- Walk evidence: `.gm/lean-walk/<NODE>.json`, one subagent record per node (`node`, `applied`, `witness`).

## Part A: verb strategy

1. Read every observation file. Count records. If there are fewer than `MIN_NEW_OBSERVATIONS` across all sessions, return an `Insufficient` for Part A.
2. Per verb, compute count, failure rate (`exit_code != 0`), gate-drift rate, and mean `quality`.
3. Treat `quality` with caution. `quality` can reflect the open PRD/mutable backlog rather than the dispatch outcome. Rank by failure rate weighted by count, not by `quality`.
4. Some non-zero exits are valid answers, not failures. A `grep` exit 1 with no matches is a no-match result. Classify each failure by the record's `error_code` field; a `no_match:true` record is an answer, not a failure. A failed record with neither is `unclassified`, because its reply is pruned from `.gm/exec-spool/out` and cannot be recovered. The agent shall not propose a change for a verb until its failure exits are shown to be real errors. A verb whose failures are all unclassified gets no proposal and is counted in `unclassified_failures`.
5. Read the open rows in `.gm/prd/` and `.gm/prd.yml`. Drop a candidate when an open row already names its verb and the same change.
6. For up to `MAX_PART_A_PROPOSALS` candidates, write one proposal with the verb, the change, the counts and rates as evidence, and a measurable target on the same log. A change is executable: code, a config value or a verb contract. The paper found that directional prose hints do worse than no hint at equal budget, so a proposal that only adds guidance prose is refused.

## Part B: gm-graph traversal

The goal is to walk every principle-kind gm-graph node and every edge, through real work. Each principle node is one hop run by a subagent that advocates that node's discipline at full strength (SKILL.md Section 1d). The hop scope is principle nodes only, the same scope as the gm walk loop (`skills/gm/SKILL.md` Section 1d).

1. Load the graph. Traversable nodes are those whose `kind` is `principle`. Edges are all `edges` entries.
2. Load walk evidence. A node is walked when its `.gm/lean-walk/<NODE>.json` has `applied:true`, a `witness`, and a `verified_by` session that differs from the node file's `session` (the independent verifier lane, `skills/gm-hop/SKILL.md`). A node whose `verified_by` is missing or equal to its `session` is not walked, and is reported in `rejected_walks` with `missing_dispatch_ids: []`. A missing file means no walk yet. `phase_history` (the node keys the runtime recorded) confirms the session reached that node.
3. Run Part B under its own scorer session id, which must differ from every walk's `session`. Refuse to score any node file whose `session` equals the scorer session: report it in `rejected_walks` with `reason: "self_scored"`. Build the map from `dispatch_id` to its record `session` across `observations.json` and every `observations-archive-*.json`, for the walk sessions only.
4. Verify each walk. A walk counts only if every `dispatch_id` quoted in its `witness`:
   - maps in that map to the walk's own `session`; an id from another session fails with `reason: "foreign_dispatch"`;
   - is confirmed by a reply file under `.gm/exec-spool/out/` whose `dispatch_id` matches and whose sha256 equals the observation's `reply_sha256`;
   - is not an unobservable verb (`instruction`, `prd-list`, `transition`, `mutable-*`, `dream-*`); a quoted one fails with `reason: "unobservable_verb"` and its verb named.

   An `applied:true` walk also needs at least one quoted write-class id (`git_commit`, `fs_write`, `prd-add`) that passes all three checks. The observation writer is the guest; the spool-out reply is the trusted writer. Report any failure in `rejected_walks` with the missing or failing ids. The agent shall never count a rejected walk.
5. Coverage:
   - `nodes_verified` over `traversable_nodes`.
   - `backreferences_verified` over the number of backreference edges, counted only when the `from` node's evidence file has `applied:true` and its `witness` names the edge's condition.
   - Forward-edge coverage approximates a forward edge as covered when both endpoints have verified walks. Say that this is an approximation.
6. Proposals: up to `MAX_PART_B_PROPOSALS` unwalked nodes, in this priority order: nodes with no verified walk, then backreference edges never fired. For each, give the node id, the condition to walk it on the next real task, and the evidence that would count as a walk. Skip a node that an open row already proposes.

## Part C: the discipline tree

The graph is one tree, not nine. Every book is its own node. `book_index` names
each anchor book and the node that carries it: 43 got a node of their own and 12
are the same book as a node the lean tree already carried, so they join it there
rather than duplicating it. Their `provenance` is the prose file that owns
them, which is where they came from and nothing more: it groups nothing and gates nothing.

Traversal is nonlinear by construction. Every node can be reached, left and
re-entered, and no book is confined to the concern it was authored under: every book
has at least one edge to a book of another provenance, so a walk begun anywhere
can reach anywhere. There is no `phase` node -- nothing in the graph is a door
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
2. Read every `replay-result.json` and `cycle-result.json`. The newest by `ts` is the current replay.
3. The loop is `stalled` when the history holds at least `MIN_NEW_OBSERVATIONS` records newer than the current replay (or no replay result exists) and the current replay is older than `COOLDOWN_MS`. Name the stage that did not run: `cycle_trigger` (no `cycle-result.json` since the threshold was reached), `replay` (a cycle ran but wrote no `replay-result.json`) or `redeploy` (a result with `improved:true` has no open row).
4. A result with `never_worse:false` is a defect: the incumbent was not scored as a candidate. Report it in `defects`.
5. When the current replay has `improved:true` and `never_worse:true` and no open row names its `selected_policy_id`, propose one row to redeploy it. Redeployment runs through the normal PRD and evidence gates; this skill never writes `active-strategy.json`.

## Output

Constants:

- `MIN_NEW_OBSERVATIONS` and `COOLDOWN_MS` are the cycle-trigger constants in `agentplug/crates/agentplug-runner/src/dream_cycle.rs`; read their values there.
- `MAX_PART_A_PROPOSALS = 3`
- `MAX_PART_B_PROPOSALS = 5`

Return exactly one `DreamRsiResult`:

```
DreamRsiResult     = { status: "proposed", part_a: PartA | Insufficient, part_b: PartB, part_d: PartD }
PartD              = { history_records: number, history_sessions: number, newest_record_ts: number,
                       newest_replay_ts: number | null, baseline_policy_id: string | null,
                       selected_policy_id: string | null, improved: boolean, stalled: boolean,
                       stalled_stage: "cycle_trigger" | "replay" | "redeploy" | null,
                       defects: string[], redeploy_proposal: string | null }
Insufficient       = { status: "insufficient", records: number }   // records < MIN_NEW_OBSERVATIONS
PartA              = { records: number, per_verb: VerbStat[], proposals: VerbProposal[] }   // proposals <= MAX_PART_A_PROPOSALS
VerbStat           = { verb: string, count: number, failure_rate: number, gate_drift_rate: number }
VerbProposal       = { verb: string, change: string, evidence: string, target: string }
PartB              = { traversable_nodes: number, nodes_verified: number, backreference_edges: number,
                       backreferences_verified: number, forward_edge_coverage_approx: number,
                       rejected_walks: RejectedWalk[], proposals: NodeProposal[] }   // proposals <= MAX_PART_B_PROPOSALS
RejectedWalk       = { node: string, missing_dispatch_ids: string[] }
NodeProposal       = { node: string, walk_when: string, evidence_that_counts: string }
```

A proposal is evidence-bound planning input. It is deployed only through the normal gate, authorization and evidence gates, never by this skill.

## Finish the work

- Finishing the requested work is the goal of every run of this skill. A run that stops with work left undone is incomplete.
- When an issue blocks a step (a failing check, a fault in a tool or service, a missing input, a network or environment fault), fix it in the same run: retry on a bounded or resumable route, use an alternate route to the same result, repair the fault where it originates, then continue the remaining work.
- Stop only when the requested work is complete, or when a step is still blocked after every route has been tried. Then report the blocked step, the routes tried, and the evidence for each.

## Design reference

The cycle-boundary trigger, the three-stage loop and the git lifecycle are in [the design reference](references/dream-rsi.md). Load it only when a task changes the loop itself.
