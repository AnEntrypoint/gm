# PROVE
Precondition: endpoint reachable (curl GET /health 200).
Invariant: fixed JSON-RPC tools/list body, only Accept varies.
Postcondition: status pattern 406,406,200 matches H1 and separates it from H3 (H3 would not flip with Accept alone).
Probe run: dispatch 1791959327946-500-96ef1a69c097fdf9. Result: application/json 406; text/event-stream 406; application/json, text/event-stream 200.
Separation: H1 predicted exactly this pattern; the next hypothesis H2 predicts the same only if app code emits the text, which the codesearch refuted.
