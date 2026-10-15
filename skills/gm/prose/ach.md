# Analysis of Competing Hypotheses - Richards J. Heuer Jr.

Principle `ACH`. Apply "Analysis of Competing Hypotheses" (Heuer, Psychology of Intelligence Analysis) to the question this node stands on. A question is a bug, an unexplained behavior, a claimed root cause, or a claimed fix. Work the question in this order. Each step writes its output into the artifact.

1. List the hypotheses. Include the cause the request expects. Include one hypothesis that the cause is outside the surface. Include "the observed effect is expected behavior". Each hypothesis is one falsifiable sentence.
2. List the evidence. Each item is a live witness, a `codesearch` line with `path:line`, a call-graph reply (`callers`, `impact`) or a dispatch id. Opinion and memory are not evidence. Drop an item that no dispatch supports.
3. Build the matrix. Rows are hypotheses. Columns are evidence items. Each cell is one of `C` (consistent), `I` (inconsistent), `N` (not applicable). Write the cell from the evidence, never from the favored hypothesis.
4. Find the diagnostic evidence. An item that is `C` under every hypothesis does not separate them. Drop it from the decision. Keep the items that split the hypotheses.
5. Reject by inconsistency. Score each hypothesis by its count of `I` cells. Rank by fewest `I`. The leader is the least-inconsistent hypothesis, not the most-confirmed one. A hypothesis with any `I` cell that no evidence can explain is rejected.
6. Name the probe. Write one live probe per remaining hypothesis that gives a different observed value under each hypothesis. Run the probe for the leader first. The probe's dispatch id is the witness.
7. Name the sensitivity. State the one or two evidence items that would flip the leader. Run a dispatch that checks each one.
8. Name the revisit. State the observation that reopens the matrix. A later `I` cell on the leader reopens it.

Output, in the node's receipt:
- `ACH: <n> hypotheses; leader <id>; rejected <ids>; probe <dispatch id>; flips-on <evidence>`

Rules:
- A hypothesis that the evidence has not yet ruled out stays open. Record it as a mutable with `mutable-add`.
- A fix is applied only to the leader. A fix to a rejected hypothesis is refused until its `I` cells are re-derived.
- The matrix is written before the fix. It is never reconstructed after the fix to justify it.
- A matrix with one hypothesis is not ACH. Add the alternatives before you act.
