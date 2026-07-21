# Compiled FSM gate predicates

Reference for `gates.predicate` in .gm/instructions/fsm/graph.json's `gates` array -- generated from the SAME registry transitions.rs's predicate_result() dispatches on, so this can never silently drift out of sync with what actually exists. A predicate name here is the ONLY thing a graph's gates array can reference directly; a genuinely new condition needs a jit hook instead (see hooks/example.js) or a Rust change to add a new compiled predicate.

- `residual-scan-fired` -- true once `residual-scan` has been dispatched in this stop window (the .gm/residual-check-fired marker exists)
- `prd-all-closed` -- true when .gm/prd.yml has zero rows with an open status (pending/in-progress, not completed)
- `mutables-all-resolved` -- true when .gm/mutables.yml has zero rows still in unknown/pending status
- `worktree-clean` -- true when `git status --porcelain` is empty -- no uncommitted/unpushed delta
- `ci-validated-fresh` -- true when .gm/exec-spool/.ci-validated exists and its head_sha matches the current `git rev-parse HEAD` -- a witnessed-green CI run for the exact pushed commit
- `browser-witness-coverage` -- true when every client-side file edited this session (per .gm/exec-spool/.turn-browser-edits.json) has a matching entry in .gm/exec-spool/.turn-browser-witnessed with the same content hash