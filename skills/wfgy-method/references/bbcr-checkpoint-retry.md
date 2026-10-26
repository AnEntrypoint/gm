# BBCR checkpoint and retry

## BBCR pattern - checkpoint, bounded retry, then surface rather than confabulate

The original's collapse-and-retry loop resets to a last-known-good state on detected instability, retries a bounded number of times (its own reference implementation defaults to 3), and gives up cleanly rather than looping forever.

- [ ] Before a risky or exploratory step (one that could leave things in a worse state than before), note what "last known good" looks like right now, in enough detail to actually get back to it.
- [ ] If you notice real incoherence -- repeated self-contradiction, circular reasoning, a mistake you catch yourself making -- stop, return to the last checkpoint, and retry.
- [ ] Retry at most 2-3 times on the same route for the same unresolved tension, then switch route.
- [ ] Surface the specific unresolved problem only when every route is blocked: state what you tried, why each attempt failed, and what you need. Never pick an answer and move on as if it were resolved.

Gotcha: "bounded" is load-bearing. Retrying indefinitely without surfacing the struggle is worse than failing fast; "give up and report" is the intended exit once every route is blocked.