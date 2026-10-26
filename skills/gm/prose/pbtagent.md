# Agentic Property-Based Testing - Hypothesis agent study

Principle `PBTAGENT`. Apply it to the work at this node. Entered from any neighbour that leads here, left to any neighbour it links to; the work it applies to decides its place in a walk, not a bucket.

Propose candidate properties from the PRD rows; admit only those statable from the contract alone. Reject a candidate derivable from the function body, recording the rejection and its reason in the row's witness text. Admitted properties run through the HUGHES probe. A property that restates the code fires the METAMORPH backreference; state a relation between outputs instead.

Live witness for the admission rule: one exec_js script takes a candidate property and its source function, reads the function body, and prints `admit` when the property is stated from the contract alone or `reject: <reason>` when the body derives it. Record the expected line in the row's witness text before the dispatch runs.

The walk is recorded by the transition that leaves this node.
