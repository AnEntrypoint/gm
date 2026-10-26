# XY Problem

Principle `XYPROB`. Apply it to the work this node stands on. Placement follows that work, not a bucket: enter from any neighbour that leads here; leave to any neighbour it links to.

Claims, each with the walk that falsifies it:

- E1: WHEN a request names a means, THE agent SHALL record the goal the means serves before its first edit. Falsified by a P1 walk whose first edit has no earlier goal row.
- E2: WHEN the goal and the named means disagree, THE agent SHALL record both as PRD rows before it chooses a solution. Falsified by a walk that picks a solution with no paired goal row.
- E3: IF the goal cannot be stated without the means, THEN THE agent SHALL record the request as an unknown. Falsified by such a request reaching P2 with no unknown row.

The walk is recorded by the transition that leaves this node.