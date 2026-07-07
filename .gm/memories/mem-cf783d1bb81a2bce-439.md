---
key: mem-cf783d1bb81a2bce-439
ns: default
created: 1782381119718
updated: 1782381217060
---

gm single-instance/lock guard rule (drained from AGENTS.md): every single-instance or lock guard in the plugkit stack must be atomic (O_EXCL open or atomic-rename), never check-then-act -- a check-then-act guard is a TOCTOU race that lets two watchers/processes win the same slot. Count live plugkit processes by executable Name, never by a stat-then-claim. This is the mechanism behind the 'supervisor churn TOCTOU atomic guard' incident.
