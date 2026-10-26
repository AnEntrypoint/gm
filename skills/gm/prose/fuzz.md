# Coverage-Guided Fuzzing - Michal Zalewski

Principle `FUZZ`. Apply "Coverage-Guided Fuzzing - Michal Zalewski" to the work this node stands on. Entered from any neighbour that leads here; left to any neighbour it links to. Its place in a walk follows the work it applies to, not a bucket.

Checkable claims for the work this node stands on. Each is checked by live dispatches against the real entry point, never by a test file, fuzz harness or mock:

1. Coverage feedback: a verification pass records which files, symbols and verbs it reached. A pass that reaches nothing new is recorded as no new coverage, not as passed. Witness: the reached-set count from the `codesearch` or `prd-list` reply before and after the pass, each with its dispatch id.
2. Seed corpus: each check starts from the real inputs the request names (its paths, verbs and PRD rows), and only then from inputs derived from them. Witness: the dispatch id of the first live call, made with the named input.
3. Input budget: each row fixes its number of live dispatches before the first one is sent. Exhausting the budget ends the check as incomplete, never as passed. Witness: the count of dispatch ids recorded against the row.
4. Crash triage: a failed or timed-out dispatch is recorded with its dispatch id and `error_code`, repeated once with the same input, and classified as reproducible or not before any fix. An unreproducible failure is filed as a PRD row, never counted as passed. Witness: the two dispatch ids for the repeat.

The walk is recorded by the transition that leaves this node.
