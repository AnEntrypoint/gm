# PROVE
Precondition: fresh-state copy built from git archive HEAD .gm plus 99 mem-*.md (100 files in .gm/memories), no gm.db in the copy.
Invariant: recall returns index_converged true and a non-empty hit list once converged.
Postcondition: in a loop of at most 10 recall calls, index_converged becomes true within a bounded count.
Run: call 1 false (8s), call 2 false (15s elapsed), call 3 true (17s elapsed). Final single converged reply dispatch 1791963256798-500-b57bdd39ec2a04bb, index_converged true, hits 2 (scores 0.466, 0.446).
Probe separates H1 from H2: H2 predicted false after 8 calls; observed true at call 3.
