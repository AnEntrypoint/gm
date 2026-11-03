# gm-new: agent instructions

You build gm-new: one long-horizon worker. Everything you need is in this directory. gm-new does not depend on the gm project, its skills, or its runner. Files outside this directory may be read when a task needs them (owner decision, 2026-11-03, DESIGN.md).

## Goal

The simplest architecture that runs one long task end to end, with a complete log the worker can query. Keep the single worker busy and overlap independent work. Measure each concurrency feature; do not assume it.

## Read first

1. README.md: how to run the CLI.
2. DESIGN.md: decisions and their evidence, in dated sections with witness run ids. It is a dated log of about 267 KB. Read the "## Decided" section first, then find the rest by section name with the gm search or grep verb. Do not read it whole.
3. research/deep-research.md: cited evidence, refuted claims, caveats.

How to work here (scratch, witnesses, commits, collisions, reporting) is in skills/dev/SKILL.md.

## Decided

These are settled. Change one only by messaging the orchestrator, with the reason. The orchestrator is the gm agent, the peer gm session that decides gm-new questions and relays owner decisions (DESIGN.md, "Dependency rule, joint decision"; memory gm-agent-decides-gm-new). The owner is the user who sets the rules.

- Node.js 20+ ES modules. One pinned runtime dependency, acorn 8.18.0. No native code and no submodules. Any further dependency needs a measured gain in turns or accuracy, and a measured memory cost per worker, recorded in DESIGN.md first.
- Shape: an MCP server over stdio (JSON-RPC written by hand) plus `skills/gm/SKILL.md`. The Claude Code session is the model. The CLI is a thin wrapper for scripted witnesses. No spool, daemon, or listening port.
- gm-new does not use gm. Its code, skill, MCP server, runner, tests and builds use no gm MCP tool, no gm skill, no gm runner and no gm state. gm was the comparison target for arm B only, and the arm B configuration was removed with the live runner (DESIGN.md, Live comparison, closed). The gm MCP server connected to a gm-new session is gm-new's own, served under the name gm (DESIGN.md, Name and install). The separate gm product's tools, skill, runner and state are not used for gm-new work. Code search for gm-new work uses gm-new's own grep and search verbs over this directory.
- gm-new makes no API calls. The model is the host session (Claude Code) in MCP mode. The only model in the CLI is `scripted`, which is offline and deterministic. Anything that would call an API is reported to the gm agent to do, not done here.
- Context: no summarisation. `next_context` returns the rules, the task, the witness requirement, the events new since the last step in full up to a 20,000-character cap and the rest as compact records, the seen events as compact records within two horizons, and `prefixSha` (owner decision, 2026-11-03, reason: the host rejects a tool result over its size limit; DESIGN.md, 2026-11-03). Older events are reached with `query_log`, which reaches every event. The horizons and the compactors are in DESIGN.md, "Feed compaction".
- Rules live in `runs/<id>/rules.md`, re-read every step and placed first in the prompt. Rules are never compacted.
- Surface: the default MCP surface serves three tools, `next_context`, `run_code` and `finish` (requires a witness, and no open row unless `stopRows` is true). Every other verb is a function on `gm` inside `run_code`: `await gm.read_file({ path })`. The owner decided this on 2026-11-01 (DESIGN.md, the surface entries). The server writes every event to the log and answers concurrent requests by JSON-RPC id.
- Paths for the file tools (`read_file`, `write_file`, `edit_file`, `stat_file`, `list_dir`, and the spec and references of `review_packet`) may point inside or outside the workspace. A relative path is taken from the workspace; an outside path should be absolute. A `..` segment and a symlink that leads outside are followed, not refused (owner decision, 2026-11-03, DESIGN.md, "Outside access allowed"). `search`, `grep`, `callers` and `impact` read only the git-tracked files of the workspace, `query_log` reads only the run's log, and the git tools and row files stay inside the workspace. A body's `require` and `import` take a literal path inside or outside the workspace, as the file tools do, and a non-literal one is refused (owner decision, 2026-11-03, DESIGN.md, "Body access outside the workspace"). `run_shell` is not confined: a shell command can hard-link a file from outside the workspace, and a path check does not see that. A remaining refusal is a `refusal` event, not a thrown error.
- Network: no cap on the network verbs (owner direction, 2026-11-03, DESIGN.md, "Network access with no caps"). `fetch` reaches any host and any scheme Node's fetch serves, returns the whole reply, follows redirects with no count, and archives the whole body. `git_fetch`, `git_pull`, `git_push` and `ci_status` reach any origin host, and `ci_status` reads every page of runs. Timeouts stay (listed in DESIGN.md, Network access with no caps) and retries stay (`src/retry.mjs` retries transient failures only). The no-API rule above is unchanged.
- Rows: a row is open until it is implemented (`gm.<kind>_resolve`, with a witness) or, for a PRD, deleted (`gm.prd_delete`). No row is held in any other state. The planner plans every open row and reports any other status as a defect (DESIGN.md, Rows without a hold).
- Storage: `runs/<id>/` with `log.jsonl` (append-only), `log.index`, `rules.md`, `task.json` and `jobs/`. `runs/` is git-ignored.

## Hard rules

- No test files and no fixtures that stand in for a real run. Verify by running the CLI on a real task in a temporary workspace, then delete that workspace.
- Shell commands use `child_process.spawn` with an explicit timeout.
- Commit only by explicit path, on main, author lanmower, no trailers. Commit with `tools/ship.sh` (skills/dev/SKILL.md). The harness may ask for a Co-Authored-By trailer; this repo and the owner's rule forbid trailers on every commit, so do not add one.
- ASCII only in every file. No decorative symbols.
- Remote: `AnEntrypoint/gm-new`, private, pushed to `main` (DESIGN.md, Remote). Making it public is the owner's decision.
- Do not create branches or worktrees.

## Concurrency strategy

This is what you build and codify. Single worker first: DESIGN.md direction 6 says a measured single-worker baseline comes before any fan-out.

1. Independent actions run together. When the model returns several actions and none reads a path that another writes, run them with `Promise.all`, each with its own timeout. Log each action's start and end.
2. Long shell commands run as background jobs with an id. The worker continues other actions and checks the job with a bounded poll: a status file or a `query_log` filter. No blind sleeps.
3. Never idle when a runnable action exists. While background work is in flight, the worker may start the next model call only if that prompt does not need the in-flight result. Default off until measured.
4. Every event records a monotonic start time, end time, and the number of actions in flight. Concurrency and waiting must be readable from the log with `query_log`.
5. The stable prefix (rules, tool list, instructions) is identical on every step and comes first, so prompt caching can apply. `prefixSha` is logged on every model event (reply, retry and error in src/loop.mjs). The host reports no cache usage, so the cache share is measured from host transcripts (G3).
6. Retries, in two places. At most one model call in flight per run. The scripted model loop (src/loop.mjs, exercised only by the `--faults` option of the scripted model, since gm-new makes no API calls) retries 408, 409, 429 and every 5xx, and network errors such as resets and timeouts. It honours `retry-after` and gives up when it is over 60 s. Its backoff starts at 1 s, doubles, is capped at 16 s, with plus or minus 20% jitter, and it makes at most 4 retries (at most 2 for a 429 without `retry-after`). Other 4xx fail at once. Each retry is logged. The network verbs `fetch`, `git_fetch`, `git_push` and `ci_status` (src/retry.mjs) retry a transient failure 3 times, with backoff from 1 s, doubling, capped at 16 s, and plus or minus 20% jitter. A permanent failure is not retried. Each retry is logged.
7. Debug from the log. A failure is an event. Reproduce a run by re-running its `task.json` with the scripted model, and say in the log which events came from the replay.
8. Measure each feature. Run the same scripted task with the feature on and off, and record the wall time from the log. Keep the numbers in DESIGN.md with the run ids.

## Current state

- Open and recorded: the minimal tool set, which is not run, and G3 (cache effect), measured by the gm agent as a cache share from the host transcripts. No saving is claimed, because the price multipliers are unverified. The project closes when both are recorded.
- Updates: a running checkout pulls origin main about every minute (`tools/update.mjs`, DEFAULT_UPDATE_MS). A pull goes only into a clean checkout. A change to a reloadable leaf or to a skill is applied in place. A change to any other module the worker loads (`src/worker-modules.json`, src/hot-config.mjs included) restarts it; a `src/` module the worker does not load restarts nothing (DESIGN.md, HMR step 1; Skill in place). `tools/relay.mjs` is frozen, so a change to it reaches a host only on reconnect (DESIGN.md, Update on push).

## Facts found by troubleshooting

- The commit gate runs every check only in a checkout whose package.json name is gm-new. Elsewhere it runs syntax on the modules a commit names, and `notCovered` lists the rest. A check that throws is a failed check (DESIGN.md, Commit gate in other workspaces).
- `grep` streams files and skips `node_modules` and `vendor` unless `vendor` is true. Caching the tokenized text of every file once put the worker at 1399 MB of heap on a 108 MB tree (DESIGN.md, Friction from oscraft run 23125-406580).
- `query_log`'s `js` sees one window of matching events, at most 1000 events or 4 MB of log. A count over a whole run pages with `next` (DESIGN.md, Query log window).
- A body's console output is drained by the session and is not returned or logged. The owner's decision on it is open (DESIGN.md, "Limits, stated, not closed").
- `fetch` cannot read `file:` URLs: Node's fetch fails them, and the reply is "request failed: fetch failed". `data:` URLs are served (DESIGN.md, "Network access with no caps (2026-11-03)").
- `ci_status` pages every run with `gh api --paginate --slurp` and passes origin's host as `--hostname`, so it needs a gh that has --slurp (gh 2.102.0 has it) (DESIGN.md, "Network access with no caps (2026-11-03)").
- `src/retry.mjs` classifies a failure by its error code and HTTP status. git and gh print no code, so their message is matched after its URLs and dotted host names are removed, and a host name never decides a retry (DESIGN.md, "Retry by code and status (2026-11-03)").
- After `finish`, or at a worker start on a closed run, every call on that run is refused with "run <id> has ended; call next_context to open a new run", and the run id does not change. The first next_context on the same connection opens a fresh run in the same workspace, which takes the ended run's task and serves the step (`reopen` in `src/mcp.mjs`; DESIGN.md, "Fresh run on the first next_context after finish (2026-11-03)"). A run ended by max_steps is the exception: its calls are refused with the step-limit text, and only a restart opens a fresh run (`stepLimited` in `src/mcp.mjs`). A run has its own log and seqs: a seq from an earlier run names a different event, so a resolve cites a seq from its own run's log, and query_log reads only that run's log. Whether runs are shared across connections is the shared-run question, open with the owner.
- A body that outlives its budget becomes a background job. Each body runs in a worker thread, four at most at once per session. A thread costs about 31 ms to start, most of a median `run_code` call (DESIGN.md, "Limits, stated, not closed").
- The update checks tick every 60 s counted from the core's start, and the first is at 30 s. A push is pulled at the next tick, so within about a minute. A witness that pushes must time from the tick, not from the first check.
- The running relay, core and worker that start from /workspace/gm-new run its working tree. An uncommitted edit under `src/` or `tools/` is live at the next reload or restart, so a half-made change breaks the runs of peers (DESIGN.md, Shared checkout is live).
- A row file holds only the names in `FIELDS` (src/rows.mjs). A verb rewrite drops any other name, so a planner that reads a field no verb writes sees every row as lacking it (DESIGN.md, Row states).
- A reloadable module's verbs are rebuilt per session from the worker's leaf set. A singleton that imports one statically keeps the code it loaded at boot (DESIGN.md, Hot reload in place).
- A batch that changes `tools/core.mjs` or a singleton restarts each live worker on the checkout, and the two debounce windows can restart a worker twice. Background jobs are killed (DESIGN.md, Hot reload in place).
- `src/worker-modules.json` is the worker's import graph, and the gate's `workers` check fails when it differs. The core reads it at each change, so a `src/` module outside it, such as cli.mjs, restarts nothing (DESIGN.md, HMR step 1).
- A pull whose core and worker changed is not reset when the worker does not start: the update check starts the worker in a clone before the checkout moves, so only a failure after the pull reaches the checkout (DESIGN.md, HMR step 1).
- The wake rules are in skills/gm/SKILL.md, Pending events, and in DESIGN.md, "Wake by a watcher" and "Events cleared once delivered".
- A worker that exits 0 with the run open paused itself. The core restarts it at once, and a call in flight gets a repeat-the-call error. Any other exit fails calls until the retry (DESIGN.md, Self-pause keeps calls held).
- `read_file` counts lines by default: offset is a 0-based line index and limit a line count. `unit: "chars"` counts characters instead. `job_status`'s `offset` counts characters. `total` and `next` follow their verb's unit (src/tools.mjs, readLinePage and readCharPage).
- The host drops the words of a `/mcp__gm__gm` command after the first: it splits the command on whitespace and binds words by position to the declared arguments, and the gm prompt declares one. gm-new keeps every word it receives, and the commit gate's `prompt` check holds it to that (DESIGN.md, "Session prompt keeps every word (2026-11-03)").
- A delivered pending event is cleared: next_context clears what it returns, and a wait clears what it prints. A tail of the queue file clears nothing, so the next step delivers the same event again (DESIGN.md, "Events cleared once delivered").
- `events --wait` used to exit 0 with no output at its timeout (1800000 ms by default), the one silent exit; it now prints one line that names the timeout or the signal (DESIGN.md, "events --wait exits with a reason (2026-11-03)").
- A replay (`cli.mjs replay`) reproduces the tools' results, not the model's choices, and each replayed event carries `replayOf`.
- MCP client (`src/mcp-client.mjs`): the worker stops its child servers on input end and on pause. `process.on('exit')` alone never runs there, because a live child's pipes keep the event loop open (DESIGN.md, "MCP client in run_code (2026-11-03)").
- A worker started as an MCP server reads the workspace's config too, so a config that names gm-new itself recurses. `GMNEW_MCP_DEPTH` stops the servers at depth 2.
- Concurrent calls to one MCP server that is down share one restart (`ServerProcess.starting`). A server's tool list is read once per start, so a tool it adds later appears after the next restart.
- `search` and `wiki_search` still refuse a workspace that is not a git repository. `grep` walks it instead and reports `files: walk` (DESIGN.md, "Peer report: grep without git and read_file lines (2026-11-03)").
- The pending queue is guarded by `runs/<id>/pending.lock`, held for one append or one claim. A claimed copy is named with its reader's pid, and another reader takes it only when that pid is gone, so a zombie reader keeps its copy until it is reaped (DESIGN.md, "Pending append and claim under one lock (2026-11-03)").
- A top-level tools/call run_shell is always foreground: the session's handler drops `background`, so job_start is the only background shell path (DESIGN.md, Protocol conformance and cancellation, batch 1).
- A cancel of a run_shell call kills its group, and the worker sends no answer for it. The core stops counting that request when the cancel passes, so a restart does not wait for it. Any other cancelled request counts until its answer (DESIGN.md, the same section).
- `tools/gm-continue-setup.mjs` and the row verbs read the session's workspace, not gm-new: from a freddie session the setup reports freddie's HEAD and no defect, and `gm.prd_list` returns (none) for every status (DESIGN.md, "gm-continue from a freddie-attached session (2026-11-03)").

## Rationale not expressible in code

- Summary meanInFlight is the sum of tool spans over wall time. That equals the integral of inFlight, because a span runs from enter to leave of one action.
- A model span is one attempt (startMono to reply, retry or error), so backoff sleeps count as idle.
- The summary event's mono is the end time it was computed at, so the summary can be recomputed from the events before it.
- A reply with a finish action is never overlapped, because the finish result decides whether another step runs.
- An MCP call starts only when no active call and no earlier waiting call conflicts with it. Conflicting calls keep arrival order, and none starves.

## Continuation

Every continuation starts with this, before new work. The gm-continue skill runs it at each finish. It is the MCP prompt `gm-continue`, invoked as mcp__gm__gm-continue (typed as /mcp__gm__gm-continue; an expected name, not witnessed), and the resource skill://gm-continue/SKILL.md, read with ReadMcpResourceTool (server gm). Do not call gm-continue with the Skill tool; it is not listed there.

- A project fact that troubleshooting found (how the code behaves, a limit, a surprise) gets one line under "Facts found by troubleshooting", with its DESIGN.md section.
- A process lesson (how to witness, commit, recover a collision, use scratch space) goes to skills/dev/SKILL.md, in the section it belongs to.
- A line here that needed no troubleshooting to learn is deleted, and so is a line about finished work. Anything the code, a tool description or DESIGN.md already states is not repeated here.
- Keep this file under 30 KB. If it grows past that, rebuild it from the Decided list, the facts and the rationale, not from the history.
