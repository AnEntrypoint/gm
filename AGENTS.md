# gm-new: agent instructions

You build gm-new: one long-horizon worker. Everything you need is in this directory. gm-new does not depend on the gm project, its skills, or its runner. Do not read files outside this directory, except the files named in the brief you were given.

## Goal

Finish gm-new as the simplest architecture that runs one long task end to end, with a complete log that the worker can query. Concurrency is a first-class goal: keep the single worker busy, overlap independent work, and never wait on work that could run in parallel. Each concurrency feature must be measured, not assumed.

## Read first

1. README.md: how to run the CLI.
2. DESIGN.md: decisions (the Decided section) and design directions with their evidence level.
3. research/deep-research.md: cited evidence, refuted claims, and caveats.

## Decided

These are settled. Change one only by messaging the orchestrator, with the reason.

- Node.js 20+ ES modules. One pinned runtime dependency, acorn 8.18.0. No native code and no submodules. Any further dependency needs a measured gain in turns or accuracy, and a measured memory cost per worker, recorded in DESIGN.md first.
- Shape: an MCP server over stdio (JSON-RPC written by hand) plus `skills/gm/SKILL.md`. The Claude Code session is the model. The CLI is a thin wrapper for scripted witnesses. No spool, daemon, or listening port.
- gm-new does not use gm. Its code, skill, MCP server, runner, tests and builds use no gm MCP tool, no gm skill, no gm runner and no gm state. gm was the comparison target for arm B only, and the arm B configuration was removed with the live runner (DESIGN.md, Live comparison, closed). Code search for gm-new work uses this directory's own files, not gm.
- gm-new makes no API calls. The model is the host session (Claude Code) in MCP mode. The only model in the CLI is `scripted`, which is offline and deterministic. Anything that would call an API is reported to the gm agent to do, not done here.
- Context: no summarisation. `next_context` returns the rules, the task, the witness requirement, the events new since the last step in full, the seen events as compact records within two horizons, and `prefixSha`. Older events are reached with `query_log`, which reaches every event. The horizons and the compactors are in DESIGN.md, "Feed compaction".
- Rules live in `runs/<id>/rules.md`, re-read every step and placed first in the prompt. Rules are never compacted.
- MCP tools: `next_context`, `read_file`, `write_file`, `list_dir`, `run_shell` (60 s default timeout), `job_start`, `job_status`, `query_log`, `finish` (requires a witness). The server writes every event to the log and answers concurrent requests by JSON-RPC id.
- Paths stay inside the workspace for the file tools. A `..` segment is refused. A symlink that leaves the workspace is refused, including a dangling one. Refusals are `refusal` events, not thrown errors. `run_shell` is not confined. A shell command can hard-link a file from outside the workspace; a path check does not see that, and it is a known limit, not a bug to close with a path check.
- Storage: `runs/<id>/` with `log.jsonl` (append-only), `rules.md`, `task.json`. `runs/` is git-ignored.

## Hard rules

- Test runs run with the gm MCP disabled: each live trial uses a strict MCP configuration that names only the arm's own server, and the scripted runs call no gm tool. Anything that would make an API call, such as a cache measurement or a live model run, is reported to the gm agent to do.
- No test files and no fixtures that stand in for a real run. Verify by running the CLI on a real task in a temporary workspace, then delete that workspace.
- Shell commands use `child_process.spawn` with an explicit timeout.
- Commit only by explicit path, on branch `main`. Author lanmower. The commit body states the change only. No trailers of any kind.
- ASCII only in every file. No decorative symbols.
- Remote: `AnEntrypoint/gm-new`, private, pushed to `main` (DESIGN.md, Remote). Making it public is the owner's decision.
- Do not create branches or worktrees.
- Batch flow: a multi-step change is built as one batch, all steps first, then witnessed in one pass over all of them, and the commits land after that pass. Each step's witness is recorded in the run log and cited in DESIGN.md. A step is not witnessed on its own during the build.

## Concurrency strategy

This is what you build and codify. Single worker first: DESIGN.md direction 6 says a measured single-worker baseline comes before any fan-out.

1. Independent actions run together. When the model returns several actions and none reads a path that another writes, run them with `Promise.all`, each with its own timeout. Log each action's start and end.
2. Long shell commands run as background jobs with an id. The worker continues other actions and checks the job with a bounded poll: a status file or a `query_log` filter. No blind sleeps.
3. Never idle when a runnable action exists. While background work is in flight, the worker may start the next model call only if that prompt does not need the in-flight result. Default off until measured.
4. Every event records a monotonic start time, end time, and the number of actions in flight. Concurrency and waiting must be readable from the log with `query_log`.
5. The stable prefix (rules, tool list, instructions) is identical on every step and comes first, so prompt caching can apply. When the API reports cache usage, log it.
6. At most one model call in flight per run. Retry 408, 409, 429 (honouring `retry-after`), and every 5xx, with exponential backoff from 1 s, doubling, capped at 16 s, plus or minus 20% jitter, at most 4 retries. Other 4xx fail at once. Log each retry.
7. Debug from the log. A failure is an event. Reproduce a run by re-running its `task.json` with the scripted model, and say in the log which events came from the replay.
8. Measure each feature. Run the same scripted task with the feature on and off, and record the wall time from the log. Keep the numbers in DESIGN.md with the run ids.
9. Collisions are resolved after the fact, not avoided. Change existing files with Edit only, never Write over an existing file. On a failed Edit, re-read the region and reapply once; if it fails again, stop and report. Only the single writer commits, by explicit path. On an `index.lock` error, retry the add 3 times, 2 s apart. Never delete `.git/index.lock`; if it persists, report. Do not commit runtime files such as `.gm/cold-index.*.queued`.

## Work plan, in order

Each item is done when its live witness is recorded in the log and its line is in DESIGN.md or README.md.

1. Concurrent independent actions (rule 1), with per-action events (rule 4). Witness: a scripted run whose model returns two independent actions. The log shows overlapping start and end times.
2. Background shell jobs with bounded polling (rule 2). Witness: a 3-second job, polled while the worker does other work.
3. Retry with backoff for model calls (rule 6). Witness: a scripted model that returns 429 twice, then succeeds. The log shows both backoffs.
4. Stable prefix and cache-usage logging (rule 5). Witness: two consecutive scripted steps show an identical prefix hash in the log.
5. Symlink-escape refusal, witnessed for real. In a temporary workspace, create a symlink that points outside it, then `read_file` it. The refusal is logged. Delete the workspace.
6. `doctor` command: Node version, whether the key is set (never print its value), whether the workspace is writable, and a summary of the last run.
7. Measurement harness: runs one task with each concurrency feature on and off, and prints wall time from the logs.
8. Keep DESIGN.md and README.md current. Each decision is one line with its reason.

Item 7 was a live comparison of gm-new and gm on the same task, run through Claude Code interactive sessions. It is closed, and its report is in DESIGN.md. Compare wall time, idle time, step count and outcome from the logs.

9. MCP server (`src/mcp.mjs`): stdio, JSON-RPC by hand, concurrent requests answered by id. Witness: a host session makes parallel tool calls and the log shows overlapping calls.
10. Skill `skills/gm/SKILL.md`: loop prose only (call `next_context`, decide, act through tools, finish with a witness). Witness: a session loads it and finishes a run.
11. Interactive Claude Code witness, driven in tmux. Witness: a real session, not a script. Record the session transcript path and the run id.

The work-plan order was 3, the symlink and alias fix, 4, 6, 9, 10, 11, then 7 and 8. All are done. Keep one writer for any new change.

## Reporting

Send a message to `main` when a work-plan item lands. Include: the item number, the run id, the event sequence numbers that witness it, and any open question. Keep each message under 15 lines. Send a question to `main` when you need a decision, and keep working on other items while you wait.

## Done means

Work-plan items 1 to 11 are witnessed and committed on main, and DESIGN.md is current. The live comparison of gm-new and gm is closed, with its report in DESIGN.md under "Project close". Still open and recorded: the minimal tool set, which is not run, and G3 (cache effect), measured by the gm agent as a cache share from the host transcripts. No saving is claimed, because the price multipliers are unverified. The project closes when those are recorded, and it is recorded.

## Rationale not expressible in code

- Summary meanInFlight is the sum of tool spans over wall time. That equals the integral of inFlight, because a span runs from enter to leave of one action.
- A model span is one attempt (startMono to reply, retry or error), so backoff sleeps count as idle.
- The summary event's mono is the end time it was computed at, so the summary can be recomputed from the events before it.
- A reply with a finish action is never overlapped, because the finish result decides whether another step runs.
- An MCP call starts only when no active call and no earlier waiting call conflicts with it. Conflicting calls keep arrival order, and none starves.
