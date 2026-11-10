---
name: gm
description: Runs a long task as a gm worker. A run starts with next_context, does each step's work in one run_code body, and ends with finish and a witness. Use when a task should run under the gm MCP server.
---

# gm loop

A multi-step change is built as one batch: all the steps first, then one witness pass over all of them. Each witness goes in the run log.

Three tools are served: next_context, run_code and finish. The work is done in run_code, and finish ends the run with a witness.

This skill is not in the host Skill tool. Read it with ReadMcpResourceTool (server gm, uri skill://gm/SKILL.md), or run the gm prompt (mcp__gm__gm). Read it first in every session, and again after a compaction.

## Phases

The first line of a task names its phase.

- Phase A: make the changes and commit each one locally as lanmower, with no trailers and no push. For each change, add a line to docs/PENDING_VALIDATION.md naming the file, the row and the witness it needs. Build, test, gate and browser steps wait for Phase B. Finish with a witness that lists the commits and the pending lines.
- Phase B: run each witness recorded for this peer in docs/PENDING_VALIDATION.md, read its output, fix what fails, and rerun only what failed. Push once every witness is green. A peer's Phase B covers only its own lines, and it does not wait on other peers.

## Habits

Each habit is stated once, with its reason.

- **Do each thing once.** Build, check, read a state or edit a file once per pass, after its inputs are final. A check run between two edits is paid again, and a read taken before an edit is stale after it. A result already in context is not fetched again.
- **Batch a step into one body.** Read the inputs together, decide in code, make the writes together, run the check, and return counts, paths and failures. Every run_code call is a model turn, so one verb per call multiplies the turns. A second body is right only when the next action needs a judgment that code cannot make.
- **Let a job run, and be told when it ends.** Shell commands wait up to 300 seconds by default in gm.run_shell; start a command that may run longer as a job, with a timeoutMs that fits it. Wait for it with one gm.job_status({ job, waitMs, tail }), sized from the wall time its witness recorded; if it is still running, wait again with a larger value. Never sleep and poll, because each poll is a turn.
- **Keep what you carry small.** Send long output to a file and read it by tail or by slice. Return from a body only what the next decision needs. Change an existing file with gm.edit_file: a whole-file write spends the tokens of the whole file, and it overwrites an edit made in the meantime.
- **Work through gm.** Shell and file work go through the verbs inside run_code, not the host's Bash, so the output is condensed, the steps batch, and each step lands in the run log. Create, copy, move and delete paths with gm.fs_op; a file operation beyond that is a script that gm.run_shell starts with node.
- **Debug live, then test once.** Reproduce the one failing path and read its output before any test. Run tests only for the witnesses in docs/PENDING_VALIDATION.md, once per push.
- **Stop only what you started.** Stop a process by a PID you read first in the output of ps or pgrep. Never stop a process by a name pattern, because the pattern can match the shell that runs the kill.

## Rules

These are the rules of every run. next_context returns them with each step, and this skill holds them word for word, because a skill is re-attached after a compaction.

- Paths may point inside or outside the workspace. An outside path should be absolute.
- Call next_context at the start of a run, after a compaction, and when a reply reports pendingEvents; not before every step. Each full reply is one step; stepsLeft counts the steps the run has left.
- Verify before you finish: run what you built and read its output.
- finish needs a witness: one string that quotes the evidence you observed. Calls sent with finish may be refused.
- Events older than the window are not in next_context. Query them with gm.query_log. Do not guess.
- Never print, store or request secrets, environment variables or API keys.
- If the task cannot be done, finish with a witness that states why, with the evidence.

## Run mechanics

- **next_context** opens the run and reports what changed. Its `pending` lists the events that need you, each once, with an id; delivery clears an event. A call with nothing new answers `unchanged: true`. It can hold a wait with `waitMs` (at most 100000).
- **run_code** runs a JavaScript body in the project. Each verb is `gm.<verb>(args)`, and `gm.verbs()` lists them with their schemas. A failed verb returns `{ ok: false, error }` and does not stop the body; wrap a step that may throw in `gm.try(fn)`. A body still running after its budget (100 seconds by default, at most 3600000 ms through timeoutMs) returns its job id at once, and its end arrives as an event.
- **Jobs.** `gm.job_start({ job, command, timeoutMs })` starts one. `gm.job_status({ job, waitMs, tail })` waits at most 100000 ms and returns state, exitCode and the tail; `gm.job_status({ pid, waitMs })` waits for a process gm did not start; `gm.job_stop({ job })` kills one. A shell pipeline's exit status is its last command's unless `set -o pipefail` is set, so read the test's own result line.
- **Long output.** A reply over 20000 characters carries outputPath. Page it with `gm.read_file({ path, offset, limit })` until `truncated` is false. A logged field pages with `gm.query_log({ seq, field, offset, limit, unit: 'chars' })`.
- **Untracked files.** A file this run wrote is untracked: `gm.grep` it with scope 'all'. `gm.search` reads tracked files only.
- **finish** goes outside run_code, after the step's calls return. It is refused while a background run is running or a row is open; stopBackground kills the background run. A PRD you will not implement is deleted with `gm.prd_delete({ id })`; any other open row is implemented and resolved. A question for the owner is `gm.unknown_add({ title, body })`: ask in prose, keep a wait running, and resolve it with `gm.unknown_resolve({ id, event, commit })` when the owner answers. Quote only tool output, with the tool named.
- **Rows.** PRD and question rows live in work/rows/. `gm.prd_list` and `gm.unknown_list` show them. Resolve in one call with `gm.prd_resolve({ id, witness, push: true })`.
- **stepsLeft 0.** Finish the step's last body, then call finish with a witness that names the work left. Call next_context only after that, to open a successor run.
- A run has its own log and seqs. Cite a seq from your own run.

## Waits and events

Keep a wait running while the run is open: the `pendingCommands.wait` command from next_context, or a next_context call with `waitMs` where the host can hold a call. When the wait prints an event or a timeout line, act on it and start the wait again. Do not tail the queue file, because a tail does not clear events. A job whose start did not answer `started job` wrote no event, so start it again. A crash can deliver an event twice; skip an id you have already acted on.

## Compaction

After a compaction, call `next_context({ full: true })` at once and follow the rules it returns. Use `gm.query_log` for any event the summary does not state exactly. A reply with `rulesNotice`, or next_context with `rulesPending`, means read this skill again; that read clears it.

## Task text

A host may cut a slash-command task to its first word. If the task in the run is shorter than the command you were given, pass the whole text in the first step with `next_context({ task })`. After the first step, a replacement needs `owner: true`.

## Browser

Playwriter is the browser control, used only through its verbs inside run_code: `gm.playwriter_execute({ code })` runs a snippet, and `gm.playwriter_browsers({ action })` lists or closes browsers. Do not start another browser, and do not call the playwriter binary from a shell. A browser call past 60 seconds needs timeoutMs on the playwriter server entry (defaults/mcp.json sets it).

Each project root has its own browser and profile. Each run has its own tab context, which its first execute call creates, and next_context reports the run's tabs. `playwriter_browsers` close and finish close only this run's context. `gm.browser_close_machine({ confirm: true })` closes the whole project browser, and it is for the owner's request only.

## Child sessions

Hand off a piece of work that can be done apart from this run. A separate session has its own run, and its witness comes from `node src/cli.mjs query --dir "<child workspace>/runs/<child run>" --js "..."`, read through gm.run_shell. A subagent on this connection calls `next_context({ child: true, run })` at the start of each step, does its file work through run_code, does not send finish, and passes no task. Children share the workspace, so do not branch or use worktrees. When they finish, run the check the task names once over the whole result.

## Fan-out

For work that splits into independent units, read skill://gm/WORKFLOWS.md first and follow its graph shapes. Verify each claim with three checker children that try to refute it: two refutations kill the claim, and fewer than two valid votes leave it unverified. A checker that errors casts no vote. The finish witness quotes the counts. A tool result is summarised, so after a compaction re-read WORKFLOWS.md before the next fan-out.

## Memory

- A lesson about how work is done goes into the skill section it belongs to, not into a note.
- A project fact that a run had to execute to learn (an environment gotcha, a measured result, an owner decision with its reason) goes into AGENTS.md. Each AGENTS.md edit is preceded by a full audit of the file: remove every line the code, README.md, DESIGN.md or a skill already states, and keep the file under 30 KB.
