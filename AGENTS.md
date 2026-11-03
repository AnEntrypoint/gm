# gm-new: agent instructions

You build gm-new: one long-horizon worker. Everything you need is in this directory. gm-new does not depend on the gm project, its skills, or its runner. Do not read files outside this directory, except the files named in the brief you were given.

## Goal

The simplest architecture that runs one long task end to end, with a complete log the worker can query. Keep the single worker busy and overlap independent work. Measure each concurrency feature; do not assume it.

## Read first

1. README.md: how to run the CLI.
2. DESIGN.md: decisions and their evidence, in dated sections with witness run ids.
3. research/deep-research.md: cited evidence, refuted claims, caveats.

How to work here (scratch, witnesses, commits, collisions, reporting) is in skills/dev/SKILL.md.

## Decided

These are settled. Change one only by messaging the orchestrator, with the reason.

- Node.js 20+ ES modules. One pinned runtime dependency, acorn 8.18.0. No native code and no submodules. Any further dependency needs a measured gain in turns or accuracy, and a measured memory cost per worker, recorded in DESIGN.md first.
- Shape: an MCP server over stdio (JSON-RPC written by hand) plus `skills/gm/SKILL.md`. The Claude Code session is the model. The CLI is a thin wrapper for scripted witnesses. No spool, daemon, or listening port.
- gm-new does not use gm. Its code, skill, MCP server, runner, tests and builds use no gm MCP tool, no gm skill, no gm runner and no gm state. gm was the comparison target for arm B only, and the arm B configuration was removed with the live runner (DESIGN.md, Live comparison, closed). Code search for gm-new work uses this directory's own files, not gm.
- gm-new makes no API calls. The model is the host session (Claude Code) in MCP mode. The only model in the CLI is `scripted`, which is offline and deterministic. Anything that would call an API is reported to the gm agent to do, not done here.
- Context: no summarisation. `next_context` returns the rules, the task, the witness requirement, the events new since the last step in full, the seen events as compact records within two horizons, and `prefixSha`. Older events are reached with `query_log`, which reaches every event. The horizons and the compactors are in DESIGN.md, "Feed compaction".
- Rules live in `runs/<id>/rules.md`, re-read every step and placed first in the prompt. Rules are never compacted.
- Surface: the default MCP surface serves three tools, `next_context`, `run_code` and `finish` (requires a witness, and no open row unless `stopRows` is true). Every other verb is a function on `gm` inside `run_code`: `await gm.read_file({ path })`. The owner decided this on 2026-11-01 (DESIGN.md, the surface entries). The server writes every event to the log and answers concurrent requests by JSON-RPC id.
- Paths stay inside the workspace for the file tools. A `..` segment is refused. A symlink that leaves the workspace is refused, including a dangling one. Refusals are `refusal` events, not thrown errors. `run_shell` is not confined. A shell command can hard-link a file from outside the workspace; a path check does not see that, and it is a known limit, not a bug to close with a path check.
- Rows: a row is open until it is implemented (`gm.<kind>_resolve`, with a witness) or, for a PRD, deleted (`gm.prd_delete`). No row is held in any other state. The planner plans every open row and reports any other status as a defect (DESIGN.md, Rows without a hold).
- Storage: `runs/<id>/` with `log.jsonl` (append-only), `log.index`, `rules.md`, `task.json` and `jobs/`. `runs/` is git-ignored.

## Hard rules

- No test files and no fixtures that stand in for a real run. Verify by running the CLI on a real task in a temporary workspace, then delete that workspace.
- Shell commands use `child_process.spawn` with an explicit timeout.
- Commit only by explicit path, on main, author lanmower, no trailers. Commit with `tools/ship.sh` (skills/dev/SKILL.md).
- ASCII only in every file. No decorative symbols.
- Remote: `AnEntrypoint/gm-new`, private, pushed to `main` (DESIGN.md, Remote). Making it public is the owner's decision.
- Do not create branches or worktrees.

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

## Current state

- Work-plan items 1 to 11 are witnessed and in DESIGN.md. The live comparison of gm-new and gm is closed; its report is in DESIGN.md, Project close.
- Open and recorded: the minimal tool set, which is not run, and G3 (cache effect), measured by the gm agent as a cache share from the host transcripts. No saving is claimed, because the price multipliers are unverified. The project closes when both are recorded.
- Updates: a running checkout pulls origin main about every minute (`tools/update.mjs`, DEFAULT_UPDATE_MS). A pull goes only into a clean checkout. A change to a reloadable module (src/hot-config.mjs) or to a skill is applied in place. Any other change under `src/` restarts the worker (DESIGN.md, Hot reload in place; Skill in place). `tools/relay.mjs` is frozen, so a change to it reaches a host only on reconnect (DESIGN.md, Update on push).

## Facts found by troubleshooting

- The commit gate runs every check only in a checkout whose package.json name is gm-new. Elsewhere it runs syntax on the modules a commit names, and `notCovered` lists the rest. A check that throws is a failed check (DESIGN.md, Commit gate in other workspaces).
- A top-level `return` fails `node --check` in an ES module. A probe that needs one wraps its body in a function.
- `grep` streams files and skips `node_modules` and `vendor` unless `vendor` is true. Caching the tokenized text of every file once put the worker at 1399 MB of heap on a 108 MB tree (DESIGN.md, Friction from oscraft run 23125-406580).
- `query_log`'s `js` sees one window of matching events, at most 1000 events or 4 MB of log. A count over a whole run pages with `next` (DESIGN.md, Query log window).
- A top-level tool call writes `action` and `result` events. A verb called inside `run_code` writes `code-call`. Filter by the kind the call writes.
- A body's console output is drained by the session and is not returned or logged. The owner's decision on it is open (DESIGN.md, "Limits, stated, not closed").
- `run_code` and `next_context` refuse with "run has ended" after `finish`. Only a reconnect opens a new run. This is the shared-run question, open with the owner.
- A body that outlives its budget becomes a background job. Each body runs in a worker thread, four at most at once per session. A thread costs about 31 ms to start, most of a median `run_code` call (DESIGN.md, "Limits, stated, not closed").
- The update checks tick every 60 s counted from the core's start, and the first is at 30 s. A push is pulled at the next tick, so within about a minute. A witness that pushes must time from the tick, not from the first check.
- The running relay, core and worker that start from /workspace/gm-new run its working tree. An uncommitted edit under `src/` or `tools/` is live at the next reload or restart, so a half-made change breaks the runs of peers (DESIGN.md, Shared checkout is live).
- A row file holds only the names in `FIELDS` (src/rows.mjs). A verb rewrite drops any other name, so a planner that reads a field no verb writes sees every row as lacking it (DESIGN.md, Row states).
- A reloadable module's verbs are rebuilt per session from the worker's leaf set. A singleton that imports one statically keeps the code it loaded at boot (DESIGN.md, Hot reload in place).
- A batch that changes `tools/core.mjs` or a singleton restarts each live worker on the checkout, and the two debounce windows can restart a worker twice. Background jobs are killed (DESIGN.md, Hot reload in place).
- A turn that ends with the run open and no watcher running leaves nothing to wake the agent. A paused run wrote no event that reached an idle agent before the watcher, so oscraft run 79788-955320 stopped with no finish (DESIGN.md, Wake by a watcher).
- A `next_context` held by `waitMs` is an active call, so the host-idle watchdog does not count it as quiet (DESIGN.md, Wake by a watcher).
- A worker that exits 0 with the run open paused itself. The core restarts it at once, and a call in flight gets a repeat-the-call error. Any other exit fails calls until the retry (DESIGN.md, Self-pause keeps calls held).

## Rationale not expressible in code

- Summary meanInFlight is the sum of tool spans over wall time. That equals the integral of inFlight, because a span runs from enter to leave of one action.
- A model span is one attempt (startMono to reply, retry or error), so backoff sleeps count as idle.
- The summary event's mono is the end time it was computed at, so the summary can be recomputed from the events before it.
- A reply with a finish action is never overlapped, because the finish result decides whether another step runs.
- An MCP call starts only when no active call and no earlier waiting call conflicts with it. Conflicting calls keep arrival order, and none starves.

## Continuation

Every continuation starts with this, before new work. The gm-continue skill (skills/gm-continue/SKILL.md) runs it at each finish.

- A project fact that troubleshooting found (how the code behaves, a limit, a surprise) gets one line under "Facts found by troubleshooting", with its DESIGN.md section.
- A process lesson (how to witness, commit, recover a collision, use scratch space) goes to skills/dev/SKILL.md, in the section it belongs to.
- A line here that needed no troubleshooting to learn is deleted, and so is a line about finished work. Anything the code, a tool description or DESIGN.md already states is not repeated here.
- Keep this file under 30 KB. If it grows past that, rebuild it from the Decided list, the facts and the rationale, not from the history.
