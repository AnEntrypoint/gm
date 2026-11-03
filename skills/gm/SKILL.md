---
name: gm
description: Runs a long task as a gm worker. Each step calls next_context, does the work in one run_code body, and ends with finish and a witness. Use when a task should run under the gm MCP server.
---

# gm loop

Flow rule. A multi-step change is built as one batch, all steps first, then witnessed in one pass over all of them. Each step's witness goes in the run log. A step is not witnessed on its own during the build.

The served tools are three: next_context, run_code and finish. All the work is done in run_code.

## Rules

These are the rules of every run. next_context returns them with each step, and this skill holds them word for word as well, because a skill is re-attached after a compaction.

- Paths may point inside or outside the workspace. An outside path should be absolute.
- Call next_context at the start of every step. Each call is one step; stepsLeft counts the steps the run has left.
- Verify before you finish: run what you built and read its output.
- finish needs a witness: one string that quotes the evidence you observed. Calls sent with finish may be refused.
- Events older than the window are not in next_context. Query them with gm.query_log. Do not guess.
- Never print, store or request secrets, environment variables or API keys.
- If the task cannot be done, finish with a witness that states why, with the evidence.

A subagent never calls `finish` and never closes a run. It reports its result to the session that started it, and that session decides when the run ends.

1. Start every step with `next_context`. It returns the rules, the task, the witness requirement, the events new since your last step in full up to 20,000 characters, the rest of those events and the older events in compact form, `query` (the seq range of the step, and how to read any event by seq), `run` (this run's id), `stepsLeft` and `prefixSha`. `gm.query_log` reaches every event. Follow the rules it returns.
2. Do the work in one `run_code` call. Its body is JavaScript in the project, and each verb is a function on `gm`: `await gm.read_file({ path: 'a.txt' })`, `await gm.write_file({ path: 'c.txt', content })`, `await gm.run_shell({ command: 'npm test' })`. The verb list is in run_code's description, and `gm.verbs()` returns each verb's description and input schema as data. The tools of the MCP servers that the project configures are verbs too, named `gm.<server>_<tool>`.
3. Put independent calls in one body with `Promise.all`, for example `const [a, b] = await Promise.all([gm.read_file({ path: 'a.txt' }), gm.read_file({ path: 'b.txt' })]);`. Do not put a call in the body that needs the result of another call in the same batch.
4. A failed verb call returns `{ ok: false, error }` as data, and it does not stop the body. For per-call isolation, wrap any step that may throw in `gm.try`: `await gm.try(async () => ...)` returns the value, or `{ ok: false, error }` if the function throws.
5. Background work: `await gm.job_start({ job: 'build', command })` starts a job, and `await gm.job_status({ job: 'build', waitMs: 30000 })` waits for it. Call it again only if the job is still running. `await gm.job_stop({ job: 'build' })` kills a shell job that is no longer needed. A body still running after its budget (180 seconds by default, `timeoutMs` at most 300000) becomes a background run: run_code returns its job id at once, with the verb results logged so far. `gm.job_status` with that id and `waitMs` returns its value when it ends. Each step's next_context also lists `jobsOpen`: every open job with its state and `sinceProgressMs`, and `stuck` is true for a job that has made no progress for three minutes. `jobsStuck` and `jobsUnstuck` name the jobs that changed since your last step. `jobsRunning` carries each reminder that a background run has made, and each reminder has `prd`: the PRD rows' `total`, the `open` count, the first five open rows as `window` (`id` and `title`), and `more`, the number of open rows past the window.
6. Send `finish` outside `run_code`, after the run_code calls in the step have returned, with a witness. A finish call is refused without a witness, while a background run is running, or while a PRD or question row is open; stopBackground, which kills a background run, and stopRows, which ends the run with each open row listed as a gap, are the way past those. A PRD you will not implement is deleted with `gm.prd_delete({ id })`; any other open row is implemented and resolved, never held. The witness quotes the evidence you observed: command output, file content or a query result. Quote only tool output, labelled with the tool that returned it. If gm.search did not return the target, say so. Never present a gm.read_file result as a gm.search result. A run belongs to one server connection, and every agent on that connection shares it: `finish` closes that run for all of them. A child agent that shares your connection must not send `finish`. After a `finish`, every call on that run is refused with "run <id> has ended; call next_context to open a new run", and the run id does not change. The first `next_context` on the same connection opens a fresh run in the same workspace. A run has its own log and seqs: a seq from an earlier run names a different event, so cite a seq from your own run's log, and `gm.query_log` reads only that run's log.
   In gm-new, before finish, read skill://gm-continue/SKILL.md with ReadMcpResourceTool (server gm) or run the gm-continue prompt, and keep working while it lists open rows.

## Bundling a step

A step is one run_code body and one finish. The body does the step's work in code, in this order:

1. Read the inputs in one Promise.all.
2. Decide in code, from what was read.
3. Act: the independent writes go in one Promise.all.
4. Verify in the same body, from a check whose output the body reads.
5. Return a compact result: counts, paths and failures, not the full output.

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

Fan out with gm.try and return the failures with the successes, so one failure does not hide the rest:

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
4. If a reply carries `rulesNotice`, or `next_context` carries `rulesPending`, read the gm skill again with ReadMcpResourceTool (server gm, uri skill://gm/SKILL.md) and follow it. That one read clears the notice, and it is the only extra step the notice needs. Do not repeat finished work.

## Pending events

next_context returns `pending`: the events that need you since your last step, each one once, with an `id`. They are a job that starts, exits, is killed or stuck, a rules notice, a recovery, a paused run (the worker was stopped with the run open), and a host-idle notice (no call for a while). Delivery clears an event: next_context clears what it returns, and a wait clears what it prints, so no later step or wait lists it again. A crash between the delivery and the clear can deliver one event twice, so skip an id you have already acted on.

Keep a wait running while the run is open: start one at the start of every turn, before other work, using the most effective wait your host offers. A wait is either a command that ends at the next event and hands over the events, which `pendingCommands.wait` from `next_context` is (it prints the queued events once and exits, at once if events are queued; with none, it prints one line that names its timeout or the signal that stopped it, and exits), or, where the host can run a tool call in the background, a `next_context` call with `waitMs` run that way, whose return is the wake. Act on the events, or on a line that names a timeout or a signal, then start the wait again. A Monitor runs the same wait command and re-arms it after each event. Do not tail the queue file: a tail does not clear what it shows, so the next `next_context` delivers the same event again.

A host that can only hold a call in the foreground calls `next_context` with `waitMs` (at most 300000) to hold the step until an event lands; that reply carries the events, and each later step's `next_context` carries the events queued since. A job whose start answers with an error wrote no job event, so no wait reports it: check that the start answered `started job`, and start it again if it did not.

## Handing work to a child session

Hand a piece of work to a child session when it can be done apart from this run, and its context would crowd this one. A child is a new session with its own run, log and context. It sees its task and its own events, and you see only what it hands back.

1. Put the child's task in a file in the project, and name the file and the workspace to the child.
2. The child calls `next_context` first. Its reply has `run`, the child's run id. The child puts that id in its witness, with its evidence, and finishes as in step 6.
3. Read the child's result from a body. The CLI reads the child's log by its run id, and your context keeps only the witness:

```
const res = await gm.run_shell({ command: `node src/cli.mjs query --run ${childRun} --js "events.filter((e) => e.kind === 'end').map((e) => e.witness)"` });
return res.output;
```

4. The child shares the workspace with you, and you both edit it at the same time. Do not branch, do not use worktrees, and do not claim files to keep sessions apart. An edit that collides is repaired after the fact, which costs far less than keeping sessions apart.
5. When the child has finished and your own edits are in, run the validation once over the whole result: the checks the task names. Read its output. If it fails, repair in one pass, and run the validation again. Every hand-off ends this way, and your finish witness quotes the last validation run.
