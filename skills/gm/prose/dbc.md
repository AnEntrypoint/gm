# Design by Contract - Bertrand Meyer

Principle `DBC`. Apply "Design by Contract - Bertrand Meyer" to the work this node stands on. Entered from any neighbour that leads here; left to any neighbour it links to. Its place in a walk is set by the work it applies to, not a bucket.

Precondition: the PRD row this node contracts has a subject and a witness, both readable with `prd-list {"id":"<row id>"}`.

Postcondition: this node writes one precondition, one postcondition and one invariant; each names the verb and the dispatch id whose live run falsifies it.

Invariant: every contract sentence names a verb that can run it live. A sentence no live run can falsify is rewritten before the walk leaves this node.

The walk is recorded by the transition that leaves this node.
