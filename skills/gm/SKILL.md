---
name: gm
description: Runs a long task as a gm-new worker. Each step calls next_context, does the work in one run_code body, and ends with finish and a witness. Use when a task should run under the gm-new MCP server.
---

# gm loop

Flow rule. A multi-step change is built as one batch, all steps first, then witnessed in one pass over all of them, and the commits land after that pass. Each step's witness goes in the run log and is cited in DESIGN.md. A step is not witnessed on its own during the build.

Setup invariant. The gm-continue setup runs before any work, and this skill takes its task from the setup's list.

The served tools are three: next_context, run_code and finish. All the work is done in run_code.

1. Start every step with `next_context`. It returns the rules, the task, the witness requirement, the events new since your last step in full, the older events in compact form, `stepsLeft` and `prefixSha`. `gm.query_log` reaches every event. Follow the rules it returns.
2. Do the work in one `run_code` call. Its body is JavaScript in the project, and each verb is a function on `gm`: `await gm.read_file({ path: 'a.txt' })`, `await gm.write_file({ path: 'c.txt', content })`, `await gm.run_shell({ command: 'npm test' })`. The verb list is in run_code's description, and `gm.verbs()` returns each verb's description and input schema as data.
3. Put independent calls in one body with `Promise.all`, for example `const [a, b] = await Promise.all([gm.read_file({ path: 'a.txt' }), gm.read_file({ path: 'b.txt' })]);`. Do not put a call in the body that needs the result of another call in the same batch.
4. A failed verb call returns `{ ok: false, error }` as data, and it does not stop the body. For per-call isolation, wrap any step that may throw in `gm.try`: `await gm.try(async () => ...)` returns the value, or `{ ok: false, error }` if the function throws.
5. Background work: `await gm.job_start({ job: 'build', command })` starts a job, and `await gm.job_status({ job: 'build', waitMs: 30000 })` waits for it. Call it again only if the job is still running.
6. Verify the work: run what you built and read its output.
7. Finish outside `run_code`, with `finish` and a witness. The witness quotes the evidence you observed: command output, file content or a query result. Send `finish` after the run_code calls in the step have returned, not in the same body. The run belongs to this session: `finish` closes only this session's run, and the next session starts a new run.
8. If the task cannot be done, finish with a witness that states why, with the evidence.

Never print, store or request secrets or API keys.
