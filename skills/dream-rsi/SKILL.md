---
name: dream-rsi
description: Infer strategy proposals from Dream-RSI observation logs, and measure and propose lean-graph traversal coverage. Run as a background agent on the smallest available model at an interval. Proposes only; never deploys.
---

# dream-rsi inference

Run this as a background subagent on the smallest available model. The subagent reads files and returns one JSON object. It does not edit files or dispatch verbs.

Inputs:
- `observations.json` files: `<repo>/.gm/dream-rsi/<session>/observations.json`, each a JSON array of up to the newest 256 records with `dispatch_id`, `verb`, `fingerprint`, `exit_code`, `gate_drift` (bool), `prd_open_count`, `mutable_open_count`, `quality` (0..1), `ts`, `reply_sha256`, and optional `lean_node`. Orchestration verbs and `dream-*` dispatches are not recorded.
- The lean graph: `skills/dream-rsi/lean-graph.json` (`nodes`, `edges`; node `kind` is `principle`, `gate`, `tension`, `terminal`, or `phase`; edge `kind` is `forward` or `backreference`).
- Phase history: `.gm/turn-state.json` `phase_history`.
- Walk evidence: `.gm/lean-walk/<NODE>.json`, one subagent record per node (`node`, `phase`, `applied`, `witness`).

## Part A: verb strategy

1. Read every observation file. Count records. If there are fewer than `INSUFFICIENT_RECORD_THRESHOLD` across all sessions, return an `Insufficient` for Part A.
2. Per verb, compute count, failure rate (`exit_code != 0`), gate-drift rate, and mean `quality`.
3. Treat `quality` with caution. Until the scoring fix in rs-plugkit lands, `quality` mostly reflects the open PRD/mutable backlog rather than the dispatch outcome. Rank by failure rate weighted by count, not by `quality`.
4. Some non-zero exits are valid answers, not failures. A `grep` exit 1 with no matches is a no-match result. The agent shall not propose a change for a verb until its failure exits are shown to be real errors.
5. For up to `MAX_PART_A_PROPOSALS` candidates, write one proposal with the verb, the change, the counts and rates as evidence, and a measurable target on the same log.

## Part B: lean traversal

The goal is to walk every traversable lean node (all kinds except `phase`) and every edge, through real work.

1. Load the graph. Traversable nodes are those whose `kind` is not `phase`. Edges are all `edges` entries.
2. Load walk evidence. A node is walked when its `.gm/lean-walk/<NODE>.json` has `applied:true` and a `witness`. A missing file means no walk yet. `phase_history` confirms the session reached that node's phase.
3. Build the set of every `dispatch_id` across all observation files.
4. Verify each walk. A walk counts only if every `dispatch_id` quoted in its `witness` appears in that set. Report any failure in `rejected_walks` with the missing ids. The agent shall never count a rejected walk.
5. Coverage:
   - `nodes_verified` over `traversable_nodes`.
   - `backreferences_verified` over the number of backreference edges, counted only when the `from` node's evidence file has `applied:true` and its `witness` names the edge's condition.
   - Forward-edge coverage approximates a forward edge as covered when both endpoints have verified walks. Say that this is an approximation.
6. Proposals: up to `MAX_PART_B_PROPOSALS` unwalked nodes, in this priority order: gates first, then nodes in a phase with no verified walk, then backreference edges never fired. For each, give the node id, its phase, the condition to walk it on the next real task, and the evidence that would count as a walk.

## Output

Constants:

- `INSUFFICIENT_RECORD_THRESHOLD = 20`
- `MAX_PART_A_PROPOSALS = 3`
- `MAX_PART_B_PROPOSALS = 5`

Return exactly one `DreamRsiResult`:

```
DreamRsiResult     = { status: "proposed", part_a: PartA | Insufficient, part_b: PartB }
Insufficient       = { status: "insufficient", records: number }   // records < INSUFFICIENT_RECORD_THRESHOLD
PartA              = { records: number, per_verb: VerbStat[], proposals: VerbProposal[] }   // proposals <= MAX_PART_A_PROPOSALS
VerbStat           = { verb: string, count: number, failure_rate: number, gate_drift_rate: number }
VerbProposal       = { verb: string, change: string, evidence: string, target: string }
PartB              = { traversable_nodes: number, nodes_verified: number, backreference_edges: number,
                       backreferences_verified: number, forward_edge_coverage_approx: number,
                       rejected_walks: RejectedWalk[], proposals: NodeProposal[] }   // proposals <= MAX_PART_B_PROPOSALS
RejectedWalk       = { node: string, missing_dispatch_ids: string[] }
NodeProposal       = { node: string, phase: string, walk_when: string, evidence_that_counts: string }
```

A proposal is evidence-bound planning input. It is deployed only through the normal phase, authorization and evidence gates, never by this skill.
