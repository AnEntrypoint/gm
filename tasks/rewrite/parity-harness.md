# Brief: parity-harness (native/tests/parity)

Read tasks/rewrite/common.md. Build dir build/parity. You own native/tests/parity/ (new files only). Do not edit the native components; report bugs to the orchestrator with the failing case.

Purpose: prove the native worker answers the same as the Node reference on the same script.
1. Reference: extract the committed HEAD tree of gm into /tmp/parity-ref with git archive (src, tools, skills, package.json and node_modules symlinked from the repo). Do not run the live working tree, which has another session's uncommitted edits.
2. Native: the built worker binary from build/integ (gm worker, with the same flags as the host worker takes).
3. Script: a node program (native/tests/parity/run.mjs) that starts both servers over stdio, sends the same JSON-RPC requests in the same order to each, and records every reply. Scenarios: initialize, tools/list, next_context, run_code with gm.read_file, gm.write_file, gm.edit_file, gm.stat_file, gm.list_dir, gm.run_shell, gm.search, gm.grep (literal, regex and word), gm.query_log, gm.git_status and gm.git_log in a temp git repo, gm.prd_add, gm.prd_list, gm.prd_resolve, gm.prd_delete, gm.unknown_add and unknown_list, gm.fetch against a local http server started by the script, gm.job_start, gm.job_status, gm.job_stop, finish with a witness, next_context after finish.
4. Normalize: run ids, timestamps, mono, t, pids, durMs, startMono and tmp paths. Keep every other field. Diff the normalized transcripts and print each difference.
5. Output: a table of scenario, match or diff, and for each diff the two values. Exit non-zero when any scenario differs.
Witness: run it, quote the table. Do not fix differences yourself; list them in the report with the scenario name and the first differing field, so the owners can fix them.