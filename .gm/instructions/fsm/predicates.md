# Compiled FSM gate predicates

Reference for `gates.predicate` in .gm/instructions/fsm/graph.json's `gates` array -- generated from the SAME registry transitions.rs's predicate_result() dispatches on, so this can never silently drift out of sync with what actually exists. A predicate name here is the ONLY thing a graph's gates array can reference directly; a genuinely new condition needs a jit hook instead (see hooks/example.js) or a Rust change to add a new compiled predicate.

- `residual-scan-fired` -- true once `residual-scan` has been dispatched in this stop window (the .gm/residual-check-fired marker exists)
- `prd-all-closed` -- true when .gm/prd.yml has zero rows with an open status (pending/in-progress, not completed)
- `mutables-all-resolved` -- true when .gm/mutables.yml has zero rows still in unknown/pending status