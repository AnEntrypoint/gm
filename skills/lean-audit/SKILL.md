---
name: lean-audit
description: Walk the lean method graph through real work. An orchestration traversal selects frontier nodes and spawns one subagent per node; each subagent runs the closed-loop audit (pre-flight, state mapping, derivation, loopback, serialization). Only validated rows reach the traversal ledger.
---

# lean-audit

The graph is `skills/dream-rsi/lean-graph.json`, parsed from the lean method. The ledger is `.gm/dream-rsi/lean-traversal.json`. The validator is `skills/lean-audit/audit.cjs`.

## Orchestration traversal (outer loop, run by the main agent)

1. Run `node skills/lean-audit/audit.cjs coverage`. It prints `unwalked_nodes`, `rejected_walks`, and backreference status.
2. Build the frontier in this order: gates, then nodes in phases with no verified walk, then backreference edges whose condition has not fired. Take at most 8 nodes per interval.
3. For each frontier node, spawn one subagent (fresh context, no shared history). Give it only the node id, label, phase, its incoming backreference conditions, and the observation-log path. Give it nothing about what the orchestrator wants to find.
4. Collect the rows the subagents return. Write them to a rows file and run `node skills/lean-audit/audit.cjs apply <rows.json>`. The validator decides what enters the ledger, not the subagent.
5. Repeat coverage once. Stop when the frontier is empty or every remaining node has a recorded fault that needs a human decision.

## Inner loop (per subagent, the EPISTEMIC_AUDIT contract)

The subagent receives a STATE_PAYLOAD (node, phase, backreference if any) and a QUERY_VECTOR (does the work in the observation logs apply this node's principle?). It runs these steps in order and halts on the first fault:

1. PRE-FLIGHT CHECKSUM. The node id must exist in the graph and must not be a phase container. The evidence list must be non-empty with no duplicates. A backreference must match a graph edge. Fault: `[FAULT: JANK_DETECTED] -> <mode>`.
2. STATE MAPPING. Every evidence `dispatch_id` must appear in an observation log under `.gm/dream-rsi/<session>/observations.json`. Look at the verb, exit code and timestamp of each one. Fault: `[FAULT: STATE_UNMAPPED] -> <missing dispatch id>`.
3. BOOLEAN DERIVATION. Decide whether the evidence shows the node's principle applied to a concrete change. Write each step as a boolean over the mapped records. Do not use anything outside the payload. If the answer needs an assumption the records do not state, stop with a fault.
4. LOOPBACK. Try to falsify the derivation. Name the strongest counterexample the records allow. If the derivation rests on an unstated assumption, a logical leap or a guess, fault: `[FAULT: SELF_REJECTED] -> <reason>`.
5. SERIALIZE. Return exactly one JSON row and nothing else:
   `{"node":"<id>","verdict":"DERIVED"|"NOT_DERIVED","evidence":["<dispatch_id>",...],"derivation":["<step>",...],"falsification_attempt":"<counterexample tried and why it fails>","backreference":null|{"from":"..","to":"..","condition":".."}}`
   A fault is returned as `{"node":"<id>","fault":"<CODE>","detail":"<reason>"}`.
6. TERMINATE.

## Rules

- Walks come only from real dispatches. A node is never marked walked because someone intended to apply it.
- `NOT_DERIVED` is a valid outcome and is recorded in `audit`, so the same node is not re-proposed without new evidence.
- A fault goes to `audit`, not to `walks`. Retry a faulted node once in a fresh subagent, then leave it for a person.
- The subagent may read files. It may not write the ledger, edit the graph, or dispatch verbs.
