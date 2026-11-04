# Brief: verbs-jobs (native/components/verbs)

Read tasks/rewrite/common.md. Build dir build/verbs-jobs. You own native/components/verbs. The host worker and CoreVerbs users are finished.

1. CoreVerbs::job_snapshot(): returns, for every job the table knows, its name, state (running, exited, killed), the time since its last progress, and whether it is stuck (no progress for three minutes), plus the lists jobs changed since the last call (jobsStuck, jobsUnstuck), in the shape src/mcp.mjs gives next_context. Add a test.
2. query_log js: evaluate the expression over the matching events with the same semantics as src/mcp.mjs and src/cli.mjs (events as an array, the 1000-event and 4 MB window, next when the window ends). Evaluate with the QuickJS engine from native/components/quickjs (engine.hpp): add one helper there only if none exists, and report it. Test: js "events.filter(e => e.kind === 'job').length" over a fixture log.
3. Keep the existing tests green. Rebuild build/verbs-jobs and report the ctest lines.