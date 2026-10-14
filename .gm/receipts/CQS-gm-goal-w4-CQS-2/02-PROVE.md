STAGE: PROVE  row: CQS-gm-goal-w4-CQS-2
Precondition: the row's cited file and function exist at the cited path. Result: dispatch.js exists; capReplyText exists at 304-333, not at 275.
Invariant: capReplyText has no side effect. Probe: codesearch dispatch 1791960254014-500-b71540c5c0e0f42e, no writeFileSync hit inside 304-333. Holds.
Postcondition: the spill write is a separate step before the pure call. Probe: dispatch.js:2099 writes spillPath, dispatch.js:2100 calls capReplyText. Holds.
Leader probe (H2 vs H1) separated: H1 predicted a hit inside 304-333; none. Separated.
