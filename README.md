# gm-new

A single-worker long-horizon loop: one worker, one append-only log, governance rules re-read at every step. Design and evidence: `DESIGN.md` and `research/deep-research.md`.

Status: the MCP server, the skill, the CLI wrapper and the measurement tools are built and witnessed. The live comparison with gm is closed, with its results in DESIGN.md. Node.js 20+, standard library only, no build step.

## The worker: an MCP server

gm-new runs as a stdio MCP server, and the Claude Code session is the model.

    node src/mcp.mjs --workspace <dir> --task <file-or-text> [--run-dir <dir>] [--max-steps N] [--max-inflight N]

An entry for `.mcp.json`:

    {"mcpServers":{"gm-new":{"command":"node","args":["/abs/gm-new/src/mcp.mjs","--workspace","/abs/ws","--run-dir","/abs/run","--task","/abs/task.md"]}}}

Tools: `next_context`, `read_file`, `write_file`, `edit_file`, `stat_file`, `list_dir`, `run_shell`, `job_start`, `job_status`, `query_log`, `finish`; the search tools `search` (BM25 over the lines of tracked files) and `grep` (literal, regex or whole word); the git tools `git_status`, `git_add`, `git_commit`, `git_push`, `git_log`, `git_diff`, `git_show`, `git_fetch`, `git_pull`, `git_checkout`, `git_branch`; `ci_status` (through the gh CLI); and the row tools `prd_add`, `prd_list`, `prd_resolve`, `unknown_add`, `unknown_list`, `unknown_resolve`. Rows are files under `work/rows/`, and a row resolves with a seq of the run log and a commit that exists in the repository. `callers` and `impact` are not available: they wait for the user's parser decision (DESIGN.md). Each `next_context` call is one step. A call starts at once while one of `--max-inflight` slots (default 8) is free. Calls that touch one file, with a write among them, wait in order, and a shell runs alone. The server answers each request by its id, so a session's parallel calls overlap, and the log shows `inFlight`.

The skill is `skills/gm-new/SKILL.md`. It holds the loop prose only.

## The CLI wrapper, for scripted witnesses

    node src/cli.mjs run --task "<text or file>" --workspace <dir> [--model scripted] [--script replies.json] [--faults 429,429] [--latency-ms N] [--serial] [--no-background] [--overlap]
    node src/cli.mjs query --run <id> --js "events.filter((e) => e.kind === 'end')"
    node src/cli.mjs doctor [--workspace <dir>]

- `scripted` is the only model, and it is offline. gm-new makes no API call. In MCP mode the model is the host session, such as Claude Code.
- `doctor` reports Node, whether the key is set (never its value), whether the workspace is writable, the last run, and two limits: the Node-below-20 failure path has no live run, and `run_shell` is unconfined. The process-group kill is unverified on Windows.

Each run writes `runs/<id>/` with `log.jsonl`, `rules.md` and `task.json`, and ends with a `summary` event: `maxInFlight`, `meanInFlight`, `toolMs`, `modelMs`, `idleMs` and `contextCalls`. `runs/` is git-ignored.

## Measurement

    node src/bench.mjs
    node tools/live.mjs --arm A --tasks t1,t2,t3 --trials 3 --concurrency 1 [--resume true]

- `src/bench.mjs` runs four scripted arms, three tasks and three trials each, with the real tools and the offline model. It prints the median and spread of wall time and idle time, read from each run's log.
- `tasks/t1`, `t2` and `t3` are the live tasks. Each holds a `task.md`, the same text for both arms, and a `checker.mjs` that grades the workspace.
- `tools/transcript.mjs` is the one transcript parser that both live arms use. It gives wall time, tool time, model time, idle time and the tool-call split.
- `tools/live.mjs` runs each trial as one interactive Claude Code session through ccbridge, in its own tmux session and temp project. It needs the ccbridge checkout at `/workspace/airc`, tmux, and the Claude Code login. The cap is one session at a time, across both arms (DESIGN.md).

## Paths and limits

- Paths given to `read_file`, `write_file`, `edit_file`, `stat_file`, `list_dir` and the git tools stay inside the workspace. A `..` segment is refused, and so is a symlink that leaves the workspace, including a dangling one. Writes that touch one file run in order, including through a symlink alias or a hard link.
- `run_shell` is not confined. A shell command can hard-link a file from outside the workspace, and a path check does not see that.
- A background job and a foreground shell run in their own process group. A job kill, a foreground timeout, the end of a run and an interrupt all end the group.
- The repository is pushed privately to `AnEntrypoint/gm-new`.
