---
name: dream-rsi
description: "Infer strategy proposals from Dream-RSI observation logs, and measure and propose gm-graph traversal coverage. Use when observation logs need strategy proposals. Proposes only; never deploys."
---

# dream-rsi inference

Schedule (set by the caller, not by this skill): run as a background agent on the smallest available model at an interval. The subagent reads files and returns one JSON object. It does not edit files or dispatch verbs.

Inputs:
- `observations.json` files: `<repo>/.gm/dream-rsi/<session>/observations.json`, each a JSON array of up to the newest 256 records with `dispatch_id`, `verb`, `fingerprint`, `exit_code`, `gate_drift` (bool), `prd_open_count`, `mutable_open_count`, `quality` (0..1), `ts`, `reply_sha256`, and optional `lean_node`. Orchestration verbs and `dream-*` dispatches are not recorded.
- The gm graph: `skills/dream-rsi/gm-graph.json` (`nodes`, `edges`; node `kind` is `principle`, `gate`, `tension` or `terminal` -- there is no phase node; edge `kind` is `forward` or `backreference`). A node is a book when its `book` is non-empty; `book_index` names each anchor book and the node that carries it.
- Phase history: `.gm/turn-state.json` `phase_history`.
- Walk evidence: `.gm/lean-walk/<NODE>.json`, one subagent record per node (`node`, `applied`, `witness`).

## Part A: verb strategy

1. Read every observation file. Count records. If there are fewer than `INSUFFICIENT_RECORD_THRESHOLD` across all sessions, return an `Insufficient` for Part A.
2. Per verb, compute count, failure rate (`exit_code != 0`), gate-drift rate, and mean `quality`.
3. Treat `quality` with caution. Until the scoring fix in rs-plugkit lands, `quality` mostly reflects the open PRD/mutable backlog rather than the dispatch outcome. Rank by failure rate weighted by count, not by `quality`.
4. Some non-zero exits are valid answers, not failures. A `grep` exit 1 with no matches is a no-match result. The agent shall not propose a change for a verb until its failure exits are shown to be real errors.
5. For up to `MAX_PART_A_PROPOSALS` candidates, write one proposal with the verb, the change, the counts and rates as evidence, and a measurable target on the same log.

## Part B: gm-graph traversal

The goal is to walk every principle-kind gm-graph node and every edge, through real work. Each principle node is one hop run by a subagent that advocates that node's discipline at full strength (SKILL.md Section 1d). The hop scope is principle nodes only, the same scope as the gm walk loop (`skills/gm/SKILL.md` Section 1d).

1. Load the graph. Traversable nodes are those whose `kind` is `principle`. Edges are all `edges` entries.
2. Load walk evidence. A node is walked when its `.gm/lean-walk/<NODE>.json` has `applied:true` and a `witness`. A missing file means no walk yet. `phase_history` (the node keys the runtime recorded) confirms the session reached that node.
3. Build the set of every `dispatch_id` across all observation files.
4. Verify each walk. A walk counts only if every `dispatch_id` quoted in its `witness` appears in that set. Report any failure in `rejected_walks` with the missing ids. The agent shall never count a rejected walk.
5. Coverage:
   - `nodes_verified` over `traversable_nodes`.
   - `backreferences_verified` over the number of backreference edges, counted only when the `from` node's evidence file has `applied:true` and its `witness` names the edge's condition.
   - Forward-edge coverage approximates a forward edge as covered when both endpoints have verified walks. Say that this is an approximation.
6. Proposals: up to `MAX_PART_B_PROPOSALS` unwalked nodes, in this priority order: nodes with no verified walk, then backreference edges never fired. For each, give the node id, the condition to walk it on the next real task, and the evidence that would count as a walk.

## Part C: the discipline tree

The graph is one tree, not nine. Every book is its own node. `book_index` names
each anchor book and the node that carries it: 43 got a node of their own and 12
are the same book as a node the lean tree already carried, so they join it there
rather than duplicating it. Their `provenance` is the prose file that used to own
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
NodeProposal       = { node: string, walk_when: string, evidence_that_counts: string }
```

A proposal is evidence-bound planning input. It is deployed only through the normal gate, authorization and evidence gates, never by this skill.
