# gm

A single-worker long-horizon loop: one worker, one append-only log, governance rules re-read at every step. Design and evidence: `DESIGN.md` and `research/deep-research.md`.

Status: the MCP server, the skill, the CLI wrapper, the measurement tools, and the search, wiki, review and call-site tools are built and witnessed. The live comparison with gm is closed, with its results in DESIGN.md. Node.js 20+.

Install, once per clone, from the checkout:

    ./setup.sh

The setup installs the one pinned runtime dependency, acorn, runs the gate, and prints three add-mcp commands. add-mcp runs through npx, pinned to version 2.6.1. Run them in this order:

    npx -y add-mcp@2.6.1 list -g
    npx -y add-mcp@2.6.1 remove gm -g -y
    npx -y add-mcp@2.6.1 "node /abs/path/to/gm-new/tools/relay.mjs" -n gm -g -a claude-code -y

The first only lists. The second removes every gm entry, old or new, from the global configs. It matches any server whose name contains gm, so read the list first. The third installs gm for Claude Code at user level, where the relay starts in each session's folder. setup runs none of them. The manual is `docs/index.html`, chapter 2.

The served tools are listed in `DESIGN.md`, Decisions. `search` and `wiki_search` rank by BM25 in process, over the tracked files and the wiki pages. `callers` and `impact` parse the JavaScript with acorn. `wiki_write` and the three `review_*` tools write to the run log and the wiki.

## The worker: an MCP server

gm runs as a stdio MCP server, and the agent session is the model.

    node src/mcp.mjs --workspace <dir> --task <file-or-text> [--run-dir <dir>] [--max-steps N] [--max-inflight N]

A project can also hold its own entry in `.mcp.json`, which overrides the user-level one in that project. This is the shape, with the worker started directly:

    {"mcpServers":{"gm":{"command":"node","args":["/abs/gm-new/src/mcp.mjs","--workspace","/abs/ws","--run-dir","/abs/run","--task","/abs/task.md"]}}}

The default surface serves three tools: `next_context`, `run_code` and `finish` (with an optional `gaps` array, logged in the end event, and `stopBackground`, which kills a background run that is still running). Every other verb is a function on `gm` inside `run_code`, for example `await gm.read_file({ path: 'a.txt' })`, and `--surface tools` serves each verb as a tool. The verbs are `read_file`, `write_file`, `edit_file`, `stat_file`, `list_dir`, `run_shell`, `job_start`, `job_status`, `job_stop` and `query_log`; the search tools `search` (BM25 over the lines of tracked files) and `grep` (literal, regex or whole word); the git tools `git_status`, `git_add`, `git_rm`, `git_commit`, `git_push`, `git_log`, `git_diff`, `git_show`, `git_fetch`, `git_pull`, `git_checkout`, `git_branch`; `ci_status` (through the gh CLI); `fetch` (an HTTP GET of a public URL); and the row tools `prd_add`, `prd_list`, `prd_resolve`, `prd_delete`, `unknown_add`, `unknown_list`, `unknown_resolve`. Rows are files under `work/rows/`, and a row resolves with a seq of the run log and a commit that exists in the repository. `callers` and `impact` parse the JavaScript with acorn; `wiki_search` ranks the wiki pages; `wiki_write`, `review_packet`, `review_record` and `review_join` write to the run log and the wiki (DESIGN.md). Each `next_context` call is one step. A call starts at once while one of `--max-inflight` slots (default 8) is free. Calls that touch one file, with a write among them, wait in order, and a shell runs alone. The server answers each request by its id, so a session's parallel calls overlap, and the log shows `inFlight`. On the code surface, `run_code` runs a body; one still running after its budget (180 seconds by default, `timeoutMs` at most 300000) becomes a background run, which `job_status` watches. Its kill, its lifetime and its restart are in DESIGN.md, Background budget.

Both skills are served as MCP skills under SEP-2640 (the `io.modelcontextprotocol/skills` extension): `skill://gm/SKILL.md` from `skills/gm/SKILL.md`, which holds the loop prose and the seven rules of a run, word for word, and `skill://gm-continue/SKILL.md` from `skills/gm-continue/SKILL.md`. The methods skills/list and skills/get answer for both, and each file of a skill is a resource with its sha256 digest and size. The `gm` prompt is kept. The gate checks the rules in the gm skill against the server's text (`MCP_RULES` in `src/prompt.mjs`), and it checks each served skill's frontmatter.

## The CLI wrapper, for scripted witnesses

    node src/cli.mjs run --task "<text or file>" --workspace <dir> [--model scripted] [--script replies.json] [--faults 429,429] [--latency-ms N] [--serial] [--no-background] [--overlap]
    node src/cli.mjs query --run <id> --js "events.filter((e) => e.kind === 'end')"
    node src/cli.mjs replay --run <id> [--workspace <dir>]
    node src/cli.mjs doctor [--workspace <dir>]

- `scripted` is the only model, and it is offline. gm makes no API call. In MCP mode the model is the host session, such as Claude Code.
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
- A background job and a foreground shell run in their own process group. A job kill (`job_stop`), a cancel of a foreground shell, a foreground timeout, the end of a run and an interrupt all end the group.
- The server speaks protocol versions 2025-11-25 and 2025-06-18. An `initialize` that asks for another version is answered with 2025-11-25. Each tools/call result carries the run id in `_meta` under `com.anentrypoint.gmnew/run`, and the `traceparent`, `tracestate` and `baggage` of a call's `_meta` are copied into its action event.
- A `notifications/cancelled` for a `run_shell` call kills its process group, and that call gets no answer. A cancel of any other call is logged as `cancel-ignored`, and the call runs on. A `run_shell` call whose `_meta` has a `progressToken` gets `notifications/progress` every 5 seconds, with the elapsed seconds.
- The repository is pushed privately to `AnEntrypoint/gm-new`.
