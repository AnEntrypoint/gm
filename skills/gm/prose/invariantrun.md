# Stateful Invariant Runs over Random Call Sequences - Foundry and Hypothesis

Principle `INVARIANTRUN`. Apply "Stateful Invariant Runs over Random Call Sequences - Foundry and Hypothesis" to the work this node stands on. Entered from any neighbour that leads here; left to any neighbour it links to. Its place in a walk is set by the work it applies to, not a bucket.

Handover: invariant results over call sequences go to METAMORPH so outputs without an oracle are checked by stated relations; cite Stateful Invariant Runs over Random Call Sequences - Foundry and Hypothesis.

Procedure, for each stateful module the diff touches:
1. Read the module's stated invariant from its row. A module with no stated invariant gets a row before it is probed; the probe waits for that row.
2. Write one exec_js script (raw_body: Node source, with the typed timeoutMs field set) that drives the real module through at least two hundred seeded sequences of at most fifty calls each. Each sequence draws its calls from a seeded pseudo-random generator, so a rerun with the same seeds repeats them.
3. After every call, check the stated invariant against the module's state.
4. Print the shortest failing sequence, the state before the failing call, the failing call with its arguments, and the state after it. When no sequence fails, print the seed count, the sequence count and the longest sequence length run.

Expected values come from the invariant's statement, never from the module body.

A broken invariant fires the backreference to DBC: transition to=CONTRACT, state the rule as a signature precondition, and re-run the sequences with the same seeds.

The walk is recorded by the transition that leaves this node.
