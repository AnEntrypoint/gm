---
name: gm
description: Runs a long task as a gm worker. A run starts with next_context, does each step's work in one run_code body, and ends with finish and a witness. Use when a task should run under the gm MCP server.
---

# gm loop

Three tools are served: next_context, run_code and finish. The work is done in run_code, and finish ends the run with a witness.

This skill is not in the host Skill tool. Read it once per connection: with ReadMcpResourceTool (server gm, uri `skill://gm/SKILL.md`), with the gm prompt (mcp__gm__gm), or in band as the first verb of the first run_code body, `await gm.read_file({ path: 'skill://gm/SKILL.md' })`, which also clears the gate for the connection. Read it again only after a compaction or a rules notice.

## Phases

The first line of a task names its phase.

- Phase A: make every change and commit each one locally as it is made, with no push, so a stop loses nothing. For each change, add a line to docs/PENDING_VALIDATION.md naming the file, the row and the witness it needs. Build, test, gate and browser steps wait for Phase B. Finish with a witness that lists the commits and the pending lines.
- Phase B: run each witness recorded for this peer in docs/PENDING_VALIDATION.md, fix what fails, rerun only what failed, and push as soon as they are green. Cover only your own lines and do not wait on other peers. Then install or deploy as the project's own instructions say, and check that what now runs is the build you validated.

## Time

Anything that waits, repeats or blocks is a defect, whatever the work. Each rule is stated once.

- **Do each thing once.** Build, check, read or edit once per pass, after its inputs are final. Do not fetch a result that is already in context. A result holds only for the tree it ran on: a check that passed on a tree is not run again on that tree, and a job overtaken by an edit is stopped and started once on the final tree.
- **Gate.** Start a heavy window through the gate detached, with GATE_TREE set to the tree it tests: a label that already passed on that tree prints CACHED and runs nothing. Set GATE_FORCE only when its code or witness changed. Set GATE_EXCLUSIVE only for a window that measures time or peaks above free memory. The gate polls for you; do not poll it.
- **Batch.** One run_code body per step: read the inputs together, decide in code, write together, run the check, and return counts, paths and failures. Each call is a model turn. A second body is right only when the next action needs a judgment that code cannot make. A multi-step change is built whole and witnessed in one pass.
- **Wait in one call, in the turn that started the work.** Start anything that may run long with gm.job_start and a timeoutMs that fits, never a shell `&`. Wait with one gm.job_status({ job, waitMs, tail }), or gm.job_status({ pid, waitMs }) for a process gm did not start. For a longer wait, loop inside one body: `for (;;) { const r = await gm.job_status({ pid, waitMs: 60000 }); if (r.state !== 'running') return r.state; }`. Never sleep, never poll with zero-wait calls, and never arm a watcher: each empty answer is a turn, and a turn that ends on a running job leaves its wait to the next prompt.
- **Work while you wait.** Do every reachable item that the running job does not test. A measurement whose data does not exist yet is taken last, or reported open with the time it becomes possible.
- **Keep going until nothing reachable is left.** Build a reachable item in the pass that ranks it. An idle loop tick ends the tick, not the run. A run that ends early names what stopped it. A usage or credit limit is a block to report, not a finish.
- **Use the smallest proof.** Reproduce a failure live and read its output before running any test. Prove a change with the narrowest check that can fail for it, rerun a failing row alone, and run the full set once before a push.
- **Reuse before you build.** A published artifact, a cache or an earlier result that answers the question replaces a build. One build serves a series: switch behaviour at run time, not by rebuilding.
- **Carry little.** Read a range with gm.read_file (offset and limit), not a whole file through the shell. Bound every read to the summary and the failing rows, and return from a body only what the next decision needs. Change a file with gm.edit_file; a whole-file write spends the whole file and overwrites an edit made meanwhile. A result over 12000 characters comes back cut, with outputPath holding the rest; full: true returns all of it.
- **Do not pay for retries.** Text that holds backticks or ${ goes in run_code's data argument and is read as data.<name>. Shell text with quotes, pipes or sed expressions goes in a script file written with gm.write_file. Inline quoting that fails costs a turn for each try.
- **Measure the loop.** Know the project's cold build, warm build, one-edit-to-test and pre-push times, keep each build's and check's wall time in a ledger, and shorten the largest first. An edit that costs about a cold build means the incremental path is broken. Examine a slow check's scenario before its code. Name the longest step in each report, and what was done about it.
- **Do not fight for the machine.** One heavy job per worker at a time; check free memory and swap before parallel heavy work. A load-sensitive check gets a budget that does not depend on load, or runs elsewhere; one that fails only under load is a load defect. Suspect the sampler before the code. Prune caches untouched for two days.
- **Report held work once.** Work that waits on a person, a credential or a host is held: give its cause once, then one line.
- **Turn each loss into a rule.** When time is lost, write the fix into this section in general terms, naming no project, host or date.

## Habits

- **Work through gm.** Shell and file work go through the verbs inside run_code, not the host's shell, so output is condensed, steps batch, and each step lands in the run log. Create, copy, move and delete paths with gm.fs_op.
- **Push through the project's gate.** `gm.git_push({ gate: '<the project check command>' })` runs the command on the committed tree and pushes main only when it exits 0. Always name the gate, and push only after the witnesses pass.
- **Commit under the owner's configured git identity.** No trailers and no tool or model attribution.
- **Stop only what you started,** by a PID you read first, browsers included, when its witness ends. Never stop by a name pattern: it can match the shell that runs the kill.
- **After a reboot, read the saved state and carry on** from the last recorded step; do not restart the task. The running version must match the checkout's; a mismatch is a stale install to report.
- **Check liveness with a call that answers,** or a pid with its start time. A pid file alone goes stale when pids are reused.
## Rules

These are the rules of every run. next_context returns them with each step, and this skill holds them word for word, because a skill is re-attached after a compaction.

- Paths may point inside or outside the workspace. An outside path should be absolute.
- Call next_context only at the start of a run, after a compaction, or when a reply reports pendingEvents. Never call it in a loop to check for events, and not before every step. Each full reply is one step; stepsLeft counts the steps the run has left.
- Verify before you finish: run what you built and read its output.
- finish needs a witness: one string that quotes the evidence you observed. Calls sent with finish may be refused.
- Events older than the window are not in next_context. Query them with gm.query_log. Do not guess.
- Never print, store or request secrets, environment variables or API keys.
- If the task cannot be done, finish with a witness that states why, with the evidence.

## Run mechanics

- **next_context** opens the run and reports what changed. Its `pending` lists the events that need you, each once, with an id; delivery clears an event. A call with nothing new answers `unchanged: true`. With `waitMs` (at most 60000) it holds until an event arrives or the wait times out, then answers; wait with that one call, not with a loop of zero-wait calls.
- **run_code** runs a JavaScript body in the project. Each verb is `gm.<verb>(args)`, and `gm.verbs()` lists them with their schemas. A failed verb returns `{ ok: false, error }` and does not stop the body; wrap a step that may throw in `gm.try(fn)`. A body still running at its budget becomes a background run: the call returns its job id at once, and its end arrives as an event. The budget is timeoutMs (100 seconds by default, with no maximum; the foreground wait never exceeds 100 seconds, so the call returns before the 120-second call limit). Its value comes from `gm.job_status({ job, waitMs })` with that id; each call waits for the waitMs it is given.
- **Jobs.** `gm.job_start({ job, command, timeoutMs })` starts one; a job name is letters, digits, `_` and `-`, up to 64 characters. `gm.job_status({ job, waitMs, tail })` waits for the waitMs it is given, with no ceiling, and returns state, exitCode and the tail; `gm.job_status({ pid, waitMs })` waits for a process gm did not start; `gm.job_stop({ job })` kills one. A shell pipeline's exit status is its last command's unless `set -o pipefail` is set, so read the test's own result line.
- **Long output.** Inside run_code a gm.read_file or gm.run_shell result over 12000 characters is cut, as the rule above says; a gm.read_file of a skill:// file is returned whole. A reply over 20000 characters carries outputPath. Page it with `gm.read_file({ path, offset, limit })` until `truncated` is false. A logged field pages with `gm.query_log({ seq, field, offset, limit, unit: 'chars' })`.
- **Untracked files.** A file this run wrote is untracked: `gm.grep` it with scope 'all'. `gm.search` reads tracked files only.
- **finish** goes outside run_code, after the step's calls return. It is refused while a background run is running or a row is open; stopBackground kills the background run. A PRD you will not implement is deleted with `gm.prd_delete({ id })`; any other open row is implemented and resolved. A question for the owner is `gm.unknown_add({ title, body })`: ask in prose, keep a wait running, and resolve it with `gm.unknown_resolve({ id, event, commit })` when the owner answers. Quote only tool output, with the tool named.
- **Rows.** PRD and question rows live in work/rows/. `gm.prd_list` and `gm.unknown_list` show them. Resolve in one call with `gm.prd_resolve({ id, witness, push: true })`.
- **stepsLeft 0.** Finish the step's last body, then call finish with a witness that names the work left. Call next_context only after that, to open a successor run.
- A run has its own log and seqs. Cite a seq from your own run.

## Waits and events

Keep a wait running while the run is open: the `pendingCommands.wait` command from next_context, or one next_context call with `waitMs` where the host can hold a call, started again only after it answers. When the wait prints an event or a timeout line, act on it and start the wait again. Do not tail the queue file, because a tail does not clear events. A job whose start did not answer `started job` wrote no event, so start it again. A crash can deliver an event twice; skip an id you have already acted on.

## Compaction

After a compaction, call `next_context({ full: true })` at once and follow the rules it returns. Use `gm.query_log` for any event the summary does not state exactly. A reply with `rulesNotice`, or next_context with `rulesPending`, means read this skill again; that read clears it.

## Task text

A host may cut a slash-command task to its first word. If the task in the run is shorter than the command you were given, pass the whole text in the first step with `next_context({ task })`. After the first step, a replacement needs `owner: true`. After `finish`, the first `next_context` opens a successor run that inherits the ended run's task, so a new task on that call needs `owner: true`; `next_context({ task: '<new task>', owner: true })` opens the successor and sets the task in one call.

## Browser

For an HTTP-level question (a status code, headers, a page's HTML, an API response), use curl or curl-impersonate first. Use playwriter only where JavaScript must run in the page.

Playwriter is the browser control, used only through its verbs inside run_code: `gm.playwriter_execute({ code })` runs a snippet, and `gm.playwriter_browsers({ action })` lists or closes browsers. Do not start another browser, and do not call the playwriter binary from a shell. A browser call past 60 seconds needs timeoutMs on the playwriter server entry (defaults/mcp.json sets it).

Each project root has its own browser and profile. Each run has its own tab context, which its first execute call creates, and next_context reports the run's tabs. `playwriter_browsers` close and finish close only this run's context. `gm.browser_close_machine({ confirm: true })` closes the whole project browser, and it is for the owner's request only.

## Child sessions

Hand off a piece of work that can be done apart from this run. A separate session has its own run, and its witness comes from `node src/cli.mjs query --dir "<child workspace>/runs/<child run>" --js "..."`, read through gm.run_shell. A subagent on this connection calls `next_context({ child: true, run })` at the start of each step, does its file work through run_code, does not send finish, and passes no task. Children share the workspace, so do not branch or use worktrees. A child's model is set in the project's configuration and applied at launch, not chosen inside the conversation: a session relaunched or resumed takes its model from there, so the model does not reset to the default on a relaunch. Measured: a model set inside the conversation was lost on every relaunch. When they finish, run the check the task names once over the whole result.

## Fan-out

For work that splits into independent units, read skill://gm/WORKFLOWS.md first and follow its graph shapes. Verify each claim with three checker children that try to refute it: two refutations kill the claim, and fewer than two valid votes leave it unverified. A checker that errors casts no vote. The finish witness quotes the counts. A tool result is summarised, so after a compaction re-read WORKFLOWS.md before the next fan-out.

## Memory

- A lesson about how work is done goes into the skill section it belongs to, not into a note.
- A project fact that a run had to execute to learn (an environment gotcha, a measured result, an owner decision with its reason) goes into AGENTS.md. Each AGENTS.md edit is preceded by a full audit of the file: remove every line the code, README.md, DESIGN.md or a skill already states, and keep the file under 30 KB.
