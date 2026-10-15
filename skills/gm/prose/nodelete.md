# Agents Avoid Deleting Code - Ebrahimi et al.

Principle `NODELETE`. Apply "Agents Avoid Deleting Code - Ebrahimi et al." to the work this node stands on. The node is entered from any neighbour that leads here and left to any neighbour it links to; its place in a walk is decided by the work it applies to, not by a bucket.

Claims:
- Agents add a new path beside an old one far more often than they remove the old one. A function or branch whose body the diff left in place, beside its replacement, is dead weight until its callers point at the replacement.
- Every replacement the diff makes is followed by a search for the path it replaced. A call site still pointing at the old path is repointed to the replacement, and then the old path is removed in the same change.
- An old path that survives beside its new one is a defect of this node, never a style choice.

Pre-deletion witness, run before each removal:
1. callers {"symbol":"<name>","limit":50} returns no edges outside the removed path.
2. codesearch {"query":"<name>","mode":"literal","root":"<absolute project root>"} returns zero hits outside history.
3. After the deletion, exec_js runs the project's build check through execFileSync and prints its output line.

The row quotes the callers reply, the zero-hit count and the build output line. A removal without all three is not made.

Test: the replacement is run live through exec_js on the inputs the removed path handled, and the printed output matches the output the old path gave for the same inputs before removal. No test file is created for it.

The walk is recorded by the transition that leaves this node.
