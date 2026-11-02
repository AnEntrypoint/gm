# gm-new

A single-worker long-horizon loop: one worker, one append-only log, governance rules re-read at every step. Design and evidence: `DESIGN.md` and `research/deep-research.md`.

Status: the MCP server, the skill, the CLI wrapper, the measurement tools, and the search, wiki, review and call-site tools are built and witnessed. The live comparison with gm is closed, with its results in DESIGN.md. Node.js 20+.

Install, once, after a clone (one pinned runtime dependency, acorn):

    npm install

The served tools are listed in `DESIGN.md`, Decisions. `search` and `wiki_search` rank by BM25 in process, over the tracked files and the wiki pages. `callers` and `impact` parse the JavaScript with acorn. `wiki_write` and the three `review_*` tools write to the run log and the wiki.

## The worker: an MCP server

gm-new runs as a stdio MCP server, and the Claude Code session is the model.

    node src/mcp.mjs --workspace <dir> --task <file-or-text> [--run-dir <dir>] [--max-steps N] [--max-inflight N]

An entry for `.mcp.json`:

    {"mcpServers":{"gm-new":{"command":"node","args":["/abs/gm-new/src/mcp.mjs","--workspace","/abs/ws","--run-dir","/abs/run","--task","/abs/task.md"]}}}

Tools: `next_context`, `read_file`, `write_file`, `edit_file`, `stat_file`, `list_dir`, `run_shell`, `job_start`, `job_status`, `query_log`, `finish` (with an optional `gaps` array, logged in the end event, and `stopBackground`, which kills a background run that is still running); the search tools `search` (BM25 over the lines of tracked files) and `grep` (literal, regex or whole word); the git tools `git_status`, `git_add`, `git_commit`, `git_push`, `git_log`, `git_diff`, `git_show`, `git_fetch`, `git_pull`, `git_checkout`, `git_branch`; `ci_status` (through the gh CLI); and the row tools `prd_add`, `prd_list`, `prd_resolve`, `unknown_add`, `unknown_list`, `unknown_resolve`. Rows are files under `work/rows/`, and a row resolves with a seq of the run log and a commit that exists in the repository. `callers` and `impact` parse the JavaScript with acorn; `wiki_search` ranks the wiki pages; `wiki_write`, `review_packet`, `review_record` and `review_join` write to the run log and the wiki (DESIGN.md). Each `next_context` call is one step. A call starts at once while one of `--max-inflight` slots (default 8) is free. Calls that touch one file, with a write among them, wait in order, and a shell runs alone. The server answers each request by its id, so a session's parallel calls overlap, and the log shows `inFlight`. On the code surface, `run_code` runs a body; one still running after its budget (180 seconds by default, `timeoutMs` at most 300000) becomes a background run, which `job_status` watches. Its kill, its lifetime and its restart are in DESIGN.md, Background budget.

The skill is `skills/gm/SKILL.md`. It holds the loop prose only.

## The CLI wrapper, for scripted witnesses

    node src/cli.mjs run --task "<text or file>" --workspace <dir> [--model scripted] [--script replies.json] [--faults 429,429] [--latency-ms N] [--serial] [--no-background] [--overlap]
    node src/cli.mjs query --run <id> --js "events.filter((e) => e.kind === 'end')"
    node src/cli.mjs replay --run <id> [--workspace <dir>]
    node src/cli.mjs doctor [--workspace <dir>]

- `scripted` is the only model, and it is offline. gm-new makes no API call. In MCP mode the model is the host session, such as Claude Code.
- `doctor` reports Node, whether the key is set (never its value), whether the workspace is writable, the last run, and two limits: the Node-below-20 failure path has no live run, and `run_shell` is unconfined. The process-group kill is unverified on Windows.
- `replay` reruns a finished CLI run through the scripted model, and every replayed event carries `replayOf`.

Each run writes `runs/<id>/` with `log.jsonl`, `rules.md` and `task.json`, and ends with a `summary` event: `maxInFlight`, `meanInFlight`, `toolMs`, `modelMs`, `idleMs` and `contextCalls`. `runs/` is git-ignored.

## Measurement

    node src/bench.mjs

- `src/bench.mjs` runs four scripted arms, three tasks and three trials each, with the real tools and the offline model. It prints the median and spread of wall time and idle time, read from each run's log.
- The live comparison is closed. Its runner and transcript parser were removed from the repo, and the recorded results are archived outside it. DESIGN.md, Live comparison, closed, names the removal commit and the archive.

## Paths and limits

- Paths given to `read_file`, `write_file`, `edit_file`, `stat_file`, `list_dir` and the git tools stay inside the workspace. A `..` segment is refused, and so is a symlink that leaves the workspace, including a dangling one. Writes that touch one file run in order, including through a symlink alias or a hard link.
- `run_shell` is not confined. A shell command can hard-link a file from outside the workspace, and a path check does not see that.
- A background job and a foreground shell run in their own process group. A job kill, a foreground timeout, the end of a run and an interrupt all end the group.
- The repository is pushed privately to `AnEntrypoint/gm-new`.
