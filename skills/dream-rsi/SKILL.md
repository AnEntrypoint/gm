---
name: dream-rsi
description: Infer strategy proposals from Dream-RSI observation logs, and measure and propose lean-graph traversal coverage. Run as a background agent on the smallest available model at an interval. Proposes only; never deploys.
---

# dream-rsi inference

Run this as a background subagent on the smallest available model. The subagent reads files and returns one JSON object. It does not edit files or dispatch verbs.

Inputs:
- `observations.json` files: `<repo>/.gm/dream-rsi/<session>/observations.json`, each a JSON array of records with `verb`, `exit_code`, `quality` (0..1), `gate_drift` (bool), `fingerprint`, `dispatch_id`, `ts`.
- The lean graph: `skills/dream-rsi/lean-graph.json` (`nodes`, `edges`; node `kind` is `principle`, `gate`, `tension`, `terminal`, or `phase`; edge `kind` is `forward` or `backreference`).
- Phase history: `.gm/turn-state.json` `phase_history`.
- Walk evidence: `.gm/lean-walk/<NODE>.json`, one subagent record per node (`node`, `phase`, `applied`, `witness`).

## Part A: verb strategy

1. Read every observation file. Count records. If there are fewer than 20 across all sessions, return `{"status":"insufficient","records":N}` for Part A.
2. Per verb, compute count, failure rate (`exit_code != 0`), gate-drift rate, and mean `quality`.
3. Treat `quality` with caution. Until the scoring fix in rs-plugkit lands, `quality` mostly reflects the open PRD/mutable backlog rather than the dispatch outcome. Rank by failure rate weighted by count, not by `quality`.
4. Some non-zero exits are valid answers, not failures. A `grep` exit 1 with no matches is a no-match result. Do not propose a change for a verb until its failure exits are shown to be real errors.
5. For up to 3 candidates, write one proposal with the verb, the change, the counts and rates as evidence, and a measurable target on the same log.

## Part B: lean traversal

The goal is to walk every traversable lean node (all kinds except `phase`) and every edge, through real work.

1. Load the graph. Traversable nodes are those whose `kind` is not `phase`. Edges are all `edges` entries.
2. Load walk evidence. A node is walked when its `.gm/lean-walk/<NODE>.json` has `applied:true` and a `witness`. A missing file means no walk yet. `phase_history` confirms the session reached that node's phase.
3. Build the set of every `dispatch_id` across all observation files.
4. Verify each walk. A walk counts only if every `dispatch_id` quoted in its `witness` appears in that set. Report any failure in `rejected_walks` with the missing ids. Never count a rejected walk.
5. Coverage:
   - `nodes_verified` over `traversable_nodes`.
   - `backreferences_verified` over the number of backreference edges, counted only when the `from` node's evidence file has `applied:true` and its `witness` names the edge's condition.
   - Forward-edge coverage approximates a forward edge as covered when both endpoints have verified walks. Say that this is an approximation.
6. Proposals: up to 5 unwalked nodes, in this priority order: gates first, then nodes in a phase with no verified walk, then backreference edges never fired. For each, give the node id, its phase, the condition to walk it on the next real task, and the evidence that would count as a walk.

## Output

Return exactly one JSON object:

```
{"status":"proposed","part_a":{"records":N,"per_verb":[{"verb":"...","count":n,"failure_rate":y,"gate_drift_rate":z}],"proposals":[{"verb":"...","change":"...","evidence":"...","target":"..."}]},"part_b":{"traversable_nodes":N,"nodes_verified":N,"backreference_edges":N,"backreferences_verified":N,"forward_edge_coverage_approx":x,"rejected_walks":[{"node":"...","missing_dispatch_ids":["..."]}],"proposals":[{"node":"...","phase":"...","walk_when":"...","evidence_that_counts":"..."}]}}
```

A proposal is evidence-bound planning input. It is deployed only through the normal phase, authorization and evidence gates, never by this skill.
