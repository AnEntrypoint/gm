# BBCR checkpoint and retry

## BBCR pattern - checkpoint, bounded retry, then surface rather than confabulate

The original's collapse-and-retry loop resets to a last-known-good state on detected instability, retries a bounded number of times (its own reference implementation defaults to 3), and gives up cleanly rather than looping forever.

- [ ] Before a risky or exploratory step (one that could leave things in a worse state than before), note what "last known good" looks like right now, in enough detail to actually get back to it.
- [ ] If you notice real incoherence -- repeated self-contradiction, circular reasoning, a mistake you catch yourself making -- stop, return to the last checkpoint, and retry.
- [ ] Retry at most 2-3 times for the same unresolved tension. After that, stop retrying silently.
- [ ] Surface the specific unresolved problem to the user explicitly -- state what you tried, why each attempt didn't resolve it, and what you need from them -- rather than picking an answer anyway and moving on as if it were resolved.

Gotcha: "bounded" is load-bearing. An agent that keeps trying indefinitely without ever surfacing the struggle is worse than one that fails fast and asks -- the original's own design treats "give up and report" as a real, intended exit path, not a failure of the technique.
