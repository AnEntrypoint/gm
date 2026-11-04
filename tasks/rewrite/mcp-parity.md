# Brief: mcp-parity (native/components/mcp)

Read tasks/rewrite/common.md first. Build dir build/mcp-parity. You own native/components/mcp; the host worker is finished, so no other worker edits these files now.

Spec: src/mcp.mjs (committed HEAD version, git show HEAD:src/mcp.mjs), src/pending.mjs, src/compact.mjs, src/hot.mjs, skills/gm/SKILL.md (current working tree text is the rule text; it is shared with another session, so read it but do not edit it).

Port these gaps, in this order:
1. Finish rules per skills/gm/SKILL.md: refused while a background run is running (unless stopBackground); refused while any PRD or question row is open; no argument ends a run with a row open; a gap that names an open row is refused. Open rows come from the leaves prd_list and unknown_list via the verb table.
2. Feed: pending events (pending.mjs format, queue file in the run dir), pendingCommands.wait in next_context, durMs and startMono on logged events (RunLog::now exists), feed compaction horizons as in src/compact.mjs (the seen events as compact records within two horizons; prefixSha stays the same).
3. Jobs notices in next_context: jobsOpen, jobsStuck, jobsUnstuck, jobsRunning. The job snapshot comes from the verbs worker (CoreVerbs::job_snapshot, being added now by verbs-jobs). Use it when present; if not yet built, leave the field out and say so.
4. Background run_code: a body still running after timeoutMs (default 180000, max 300000) becomes a background run: run_code returns its job id at once; job_status with that id and waitMs returns its value. stopBackground kills it. A body's verb calls are logged as they happen.
5. Resume: a server that opens an existing run rebuilds the step count, the task, the end status and the successor from the log, as src/mcp.mjs does.
6. rulesPending: when rules.md differs from the rules the run started with, next_context carries rulesPending and the text.

Tests: extend native/components/mcp/tests/mcp_test.cpp with one case per item. Quote the test lines. Report with the ctest lines from build/mcp-parity. Report which items are not done.