---
name: uncrashable-design
description: Recovery hierarchy, supervised components, continuous checkpointing, infinite uptime by design
---

UNCRASHABLE IS MANDATORY

Catch at every boundary. Nothing propagates to termination. Isolate to smallest scope. Prevent cascade. Degrade gracefully. Unhandled exceptions rejections throw without catch are all forbidden.

Recovery hierarchy is absolute. Operation fails then retry with backoff. Retry exhausted then isolate and restart component. Component fails then supervisor restarts. Supervisor fails then parent supervisor restarts. Top level catches all then logs and recovers and continues. Crash exit terminate are forbidden.

Every component is supervised. Parent watches. Parent restarts. Restart with backoff. Escalate if repeated. Unsupervised components are forbidden.

Checkpoint continuously. Known good state. Restore and resume. Fresh state if recovery loops. Stateless crash is forbidden.

System runs forever. Uptime infinite by design. Acceptable downtime is forbidden. Planned termination is forbidden. Process exit is forbidden.