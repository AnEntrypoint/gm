# SPECIFY (session gm-drain-w2-260)
Row: JTBD-FRESH-CLONE-RECALL-blocker-gm-drain-w1-184. Prior lane (gm-drain-w1-184) reported first recall index_converged:false across 8 calls on a fresh clone, unbounded indexing.
Cited lines: prior witness dispatch ids 1791958683898-0-20f80494e91a7ae0 .. 1791958737909-8-464b0f5486d9a273 (present in .gm/prd-log history as the row body). Row resolvable: prd-list id returned it, status pending.
ACH matrix:
- H1 (leader): first-call indexing is a bounded slice per recall; repeated recall converges in a few calls on a fresh store. Predicts convergence at call 2-4.
- H2: index never converges on a fresh store (defect). Predicts index_converged:false after 8+ calls.
- H3: converges only because the fresh copy shares the main index (confound). Predicts identical hits to main store.
Evidence: H2 refuted by live run below (converged on call 3). H3 remains a caveat (root-based recall).
Leader: H1. Probe: repeated recall with root = scratchpad fresh-clone-184c, count calls until index_converged.
