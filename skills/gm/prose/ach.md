# Analysis of Competing Hypotheses - Richards J. Heuer Jr.

Principle `ACH`. Apply "Analysis of Competing Hypotheses" (Heuer, Psychology of Intelligence Analysis) to the question this node stands on. A question is a bug, an unexplained behavior, a claimed root cause, or a claimed fix. Work it in this order; each step writes its output into the artifact.

1. List the hypotheses: the cause the request expects, one hypothesis that the cause is outside the surface, and "the observed effect is expected behavior". Each is one falsifiable sentence.
2. List the evidence: a live witness, a `codesearch` line with `path:line`, a call-graph reply (`callers`, `impact`) or a dispatch id. Opinion and memory are not evidence. Drop an item no dispatch supports.
3. Build the matrix: rows are hypotheses, columns are evidence items. Each cell is `C` (consistent), `I` (inconsistent) or `N` (not applicable), written from the evidence, never from the favored hypothesis.
4. Find the diagnostic evidence: an item that is `C` under every hypothesis does not separate them. Drop it from the decision; keep the items that split the hypotheses.
5. Reject by inconsistency: score each hypothesis by its count of `I` cells and rank by fewest `I`. The leader is the least-inconsistent hypothesis, not the most-confirmed one. A hypothesis with any `I` cell that no evidence can explain is rejected.
6. Name the probe: one live probe per remaining hypothesis that gives a different observed value under each hypothesis. Run the leader's probe first. Its dispatch id is the witness.
7. Name the sensitivity: the one or two evidence items that would flip the leader. Run a dispatch that checks each.
8. Name the revisit: the observation that reopens the matrix, a later `I` cell on the leader.

Output, in the node's receipt:
- `ACH: <n> hypotheses; leader <id>; rejected <ids>; probe <dispatch id>; flips-on <evidence>`

Rules:
- A hypothesis the evidence has not yet ruled out stays open; record it as a mutable with `mutable-add`.
- A fix is applied only to the leader. A fix to a rejected hypothesis is refused until its `I` cells are re-derived.
- The matrix is written before the fix, never reconstructed after the fix to justify it.
- A matrix with one hypothesis is not ACH; add the alternatives before acting.
