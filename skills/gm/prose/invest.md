# INVEST - Bill Wake

Principle `INVEST`. Apply "INVEST - Bill Wake" to the work this node stands on. Entered from any neighbour that leads here; left to any neighbour it links to. Its place in a walk is set by the work it applies to, not a bucket.

Check each PRD row against six INVEST criteria. Each check is proven by a live exec_js dispatch, never by a test file; the row's witness line records the expected output before the dispatch runs.

- Independent: the row depends on no other open row. Witness: exec_js reads the row's depends_on and confirms each named row is resolved. A dependency fires the backreference to THINSLICE and is recorded with depends_on.
- Negotiable: the row states the outcome, not a fixed code edit. Witness: exec_js prints the row's outcome line; the check fails when the row names only an edit.
- Valuable: the row names the outcome it delivers to the user or the system. Witness: exec_js prints that outcome line; the check fails when it is empty.
- Estimable: the row names every file and verb it touches. Witness: exec_js counts the named paths; the check fails when the list is missing.
- Small: the row fits one walk slice with one writer per surface. Witness: exec_js counts the named writer surfaces; the check fails above one.
- Testable: the witness plan names the exec_js dispatch that proves the row. Witness: exec_js runs that dispatch and compares its output with the recorded expected line. A row that cannot be proven that way is split until it can.

The walk is recorded by the transition that leaves this node.
