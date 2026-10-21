# Agents Avoid Deleting Code - Ebrahimi et al.

Principle `NODELETE`. Apply it to the work this node stands on. Entered from any neighbour that leads here, left to any neighbour it links to; its place in a walk is decided by the work it applies to, not by a bucket.

Claims:
- Agents add a new path beside an old one far more often than they remove it. A function or branch the diff leaves beside its replacement is dead weight until its callers point at the replacement.
- Every replacement is followed by a search for the path it replaced. A call site still pointing at the old path is repointed to the replacement, then the old path is removed in the same change.
- An old path that survives beside its new one is a defect of this node, never a style choice.

Pre-deletion witness, run before each removal:
1. callers {"symbol":"<name>","limit":50} returns no edges outside the removed path.
2. codesearch {"query":"<name>","mode":"literal","root":"<absolute project root>"} returns zero hits outside history.
3. After the deletion, exec_js runs the project's build check through execFileSync and prints its output line.

The row quotes the callers reply, the zero-hit count and the build output line; a removal without all three is not made.

Test: run the replacement live through exec_js on the inputs the removed path handled; its printed output must match the old path's output for the same inputs before removal. Create no test file.

The walk is recorded by the transition that leaves this node.
