---
key: mem-37e7be8cfeece212-922
ns: default
created: 1785250484764
updated: 1785250484764
---

A recurring-interval poll gated on Instant::now() seeded fresh at every process boot looks broken forever on a machine whose process restarts more often than the interval -- the timer itself is correct in isolation (verified live: it fires exactly on schedule when the process stays up), but restart churn resets the clock before it ever completes a cycle, and the failure LOOKS identical to a dead/never-spawned thread from the outside (a permanently-null observability field). Diagnose by checking actual process uptime against the interval before assuming the poll logic itself is broken -- a null status field plus a short-lived pid is cold-start-in-progress, not a defect, but repeated restarts under the interval IS the real defect, fixed by persisting the last-fired wall-clock timestamp to disk and backdating the in-process timer baseline from it at boot so restart no longer resets progress toward the next fire.
