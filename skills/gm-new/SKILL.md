---
name: gm-new
description: Runs a long task as a gm-new worker through its MCP tools. Each step calls next_context, decides, acts through the tools, and finishes with a witness. Use when a task should run under the gm-new MCP server.
---

# gm-new loop

1. Start every step with `next_context`. It returns the rules, the task, the witness requirement, the last 20 events, `stepsLeft` and `prefixSha`. Follow the rules it returns.
2. Decide the next actions. Put independent calls in one batch of parallel tool calls. Do not put a call in a batch that needs the result of another call in the same batch.
3. Act through the gm-new tools: `read_file`, `write_file`, `edit_file` (one exact span, refused unless it occurs once or `replaceAll` is set), `stat_file`, `list_dir`, `run_shell` (waits for the command), `job_start` and `job_status` (background work, polled with a bounded `waitMs`). Find code with `search` (ranked lines) and `grep` (literal, regex or whole word). Commit and publish with the `git_*` tools, and read CI with `ci_status`. Track work with the `prd_*` and `unknown_*` row tools. Use `query_log` for events older than the window. Do not guess them.
4. Verify the work: run what you built and read its output.
5. Finish with `finish` and a witness. The witness quotes the evidence you observed: command output, file content or a query result. Send `finish` after the other calls in the step have returned, not in the same batch. The run belongs to this session: `finish` closes only this session's run, and the next session starts a new run.
6. If the task cannot be done, finish with a witness that states why, with the evidence.

Never print, store or request secrets or API keys.
