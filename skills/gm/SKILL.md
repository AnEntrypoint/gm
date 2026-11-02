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
5. Background work: `await gm.job_start({ job: 'build', command })` starts a job, and `await gm.job_status({ job: 'build', waitMs: 30000 })` waits for it. Call it again only if the job is still running. A body still running after its budget (180 seconds by default, `timeoutMs` at most 300000) becomes a background run: run_code returns its job id at once, with the verb results logged so far. `gm.job_status` with that id and `waitMs` returns its value when it ends. finish is refused while a background run is running and names it; finish with `stopBackground: true` kills it first. Each step's next_context also lists `jobsOpen`: every open job with its state and `sinceProgressMs`, and `stuck` is true for a job that has made no progress for three minutes. `jobsStuck` and `jobsUnstuck` name the jobs that changed since your last step.
6. Verify the work: run what you built and read its output.
7. Finish outside `run_code`, with `finish` and a witness. The witness quotes the evidence you observed: command output, file content or a query result. Quote only tool output, labelled with the tool that returned it. If gm.search did not return the target, say so. Never present a gm.read_file result as a gm.search result. Send `finish` after the run_code calls in the step have returned, not in the same body. The run belongs to this session: `finish` closes only this session's run, and the next session starts a new run.
8. If the task cannot be done, finish with a witness that states why, with the evidence.

## Bundling a step

A step is one run_code body and one finish. The body does the step's work in code, in this order:

1. Read the inputs in one Promise.all.
2. Decide in code, from what was read.
3. Act: the independent writes go in one Promise.all.
4. Verify in the same body, from a check whose output the body reads.
5. Return a compact result: counts, paths and failures, not the full output.

Then send finish, outside run_code, with a witness that quotes the returned result.

```
const [spec, notes] = await Promise.all([gm.read_file({ path: 'spec.md' }), gm.read_file({ path: 'notes.md' })]);
const todo = [spec.output, notes.output].join('\n').split('\n').filter((line) => line.startsWith('TODO'));
await gm.write_file({ path: 'todo.txt', content: todo.join('\n') + '\n' });
const count = await gm.run_shell({ command: 'wc -l < todo.txt' });
return { todo: todo.length, wc: count.output.trim() };
```

Polling a job inside the body, in a bounded loop, so the body never waits without a limit:

```
await gm.job_start({ job: 'build', command: 'npm test' });
let state = 'running';
for (let round = 0; round < 10 && state === 'running'; round += 1) {
  state = (await gm.job_status({ job: 'build', waitMs: 30000 })).state;
}
return { state };
```

Failures: a verb call that fails returns { ok: false, error } as data. Collect them with gm.try and return them with the successes, so one failure does not hide the rest:

```
const files = ['a.mjs', 'b.mjs', 'c.mjs'];
const checks = await Promise.all(files.map((f) => gm.try(() => gm.run_shell({ command: `node --check ${f}` }))));
const failed = files.filter((f, i) => checks[i].ok !== true || checks[i].exitCode !== 0);
return { checked: files.length, failed };
```

Fan-out, three shapes:

- Map: independent calls over a list go in one Promise.all, as above.
- Filter: keep the items whose result you need, in code, before the next batch.
- For...of: when each call needs the previous result, await them one by one.

```
const found = [];
for (const f of ['a.txt', 'b.txt']) {
  const r = await gm.read_file({ path: f });
  if (r.output.includes('TODO')) found.push(f);
}
return { found };
```

When not to bundle: a second run_code body is right when the next action needs a judgment that code cannot make, such as reading a failing output to choose the fix. Its first comment says why, for example `// Second body: the fix depends on the test output read here.`

## After a context compaction

A summary can replace earlier messages, including the rules, the witness requirement and the events of this run. A skill is not summarised, so these steps are the ones to follow after a compaction:

1. Call `next_context` at once. It returns the rules, the task, the witness requirement and the events new since your last step.
2. Follow the rules it returns. They are the same rules as before the compaction.
3. Do not rely on a summary for a rule, the witness requirement or an event. Use `gm.query_log` for any event the summary does not give exactly.
4. If a reply carries `rulesNotice`, or `next_context` carries `rulesPending`, call the gm skill again with /mcp__gm-new__gm and follow it. The notice stays until you do.

Never print, store or request secrets or API keys.
