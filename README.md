# gm

A single-worker long-horizon loop: one worker, one append-only log, governance rules re-read at every step. Design and evidence: `DESIGN.md` and `research/deep-research.md`.

Status: the MCP server, the skill, the CLI wrapper, the measurement tools, and the search, wiki, review and call-site tools are built and witnessed. The live comparison with gm is closed, with its results in DESIGN.md. Node.js 20+.

Install, once per clone, from the checkout:

    ./setup.sh

The setup installs the one pinned runtime dependency, acorn, runs the gate, and prints three add-mcp commands. add-mcp runs through npx, pinned to version 2.6.1. Run them in this order:

    npx -y add-mcp@2.6.1 list -g
    npx -y add-mcp@2.6.1 remove gm -g -y
    npx -y add-mcp@2.6.1 "node /abs/path/to/gm-new/tools/relay.mjs" -n gm -g -a claude-code -y

Use the three commands setup prints: they carry this checkout's real absolute path. The `/abs/path/to/gm-new` in the third line below is a placeholder; copying it unchanged registers a relay that does not exist, and gm fails to start with CONNECTION_CLOSED.

The first only lists. The second removes every gm entry, old or new, from the global configs. It matches any server whose name contains gm, so read the list first. The third installs gm for Claude Code at user level, where the relay starts in each session's folder. setup runs none of them. The manual is `docs/index.html`, chapter 2.

The served tools are listed in `DESIGN.md`, Decisions. `search` and `wiki_search` rank by BM25 in process, over the tracked files and the wiki pages. `callers` and `impact` parse the JavaScript with acorn. `wiki_write` and the three `review_*` tools write to the run log and the wiki.

## The worker: an MCP server

gm runs as a stdio MCP server, and the agent session is the model.

    node src/mcp.mjs --workspace <dir> --task <file-or-text> [--run-dir <dir>] [--max-steps N] [--max-inflight N]

A project can also hold its own entry in `.mcp.json`, which overrides the user-level one in that project. This is the shape, with the worker started directly:

    {"mcpServers":{"gm":{"command":"node","args":["/abs/gm-new/src/mcp.mjs","--workspace","/abs/ws","--run-dir","/abs/run","--task","/abs/task.md"]}}}

The default surface serves three tools: `next_context`, `run_code` and `finish` (with an optional `gaps` array, logged in the end event, and `stopBackground`, which kills a background run that is still running). Every other verb is a function on `gm` inside `run_code`, for example `await gm.read_file({ path: 'a.txt' })`, and `--surface tools` serves each verb as a tool. The verbs are `read_file`, `write_file`, `edit_file`, `stat_file`, `list_dir`, `run_shell`, `job_start`, `job_status`, `job_stop` and `query_log`; the search tools `search` (BM25 over the lines of tracked files) and `grep` (literal, regex or whole word); the git tools `git_status`, `git_add`, `git_rm`, `git_commit`, `git_push`, `git_log`, `git_diff`, `git_show`, `git_fetch`, `git_pull`, `git_checkout`, `git_branch`; `ci_status` (through the gh CLI, every page of runs, from origin's host); `fetch` (an HTTP GET of a URL through Node fetch, any scheme it serves, with the whole reply and no cap on redirects; DESIGN.md, 2026-11-03); and the row tools `prd_add`, `prd_list`, `prd_resolve`, `prd_delete`, `unknown_add`, `unknown_list`, `unknown_resolve`. Rows are files under `work/rows/`, and a row resolves with a seq of the run log and a commit that exists in the repository. `callers` and `impact` parse the JavaScript with acorn; `wiki_search` ranks the wiki pages; `wiki_write`, `review_packet`, `review_record` and `review_join` write to the run log and the wiki (DESIGN.md). Each `next_context` call is one step. A call starts at once while one of `--max-inflight` slots (default 8) is free. Calls that touch one file, with a write among them, wait in order, and a shell runs alone. The server answers each request by its id, so a session's parallel calls overlap, and the log shows `inFlight`. On the code surface, `run_code` runs a body; one still running after its budget (180 seconds by default, `timeoutMs` at most 300000) becomes a background run, which `job_status` watches. Its kill, its lifetime and its restart are in DESIGN.md, Background budget.

Both skills are served as MCP skills under SEP-2640 (the `io.modelcontextprotocol/skills` extension): `skill://gm/SKILL.md` from `skills/gm/SKILL.md`, which holds the loop prose and the seven rules of a run, word for word, and `skill://gm-continue/SKILL.md` from `skills/gm-continue/SKILL.md`. The methods skills/list and skills/get answer for both, and each file of a skill is a resource with its sha256 digest and size. Both are also MCP prompts, which `prompts/list` answers: the gm skill is the prompt `gm`, invoked as mcp__gm__gm (an expected name, not witnessed) and takes the run's task, and gm-continue is the prompt `gm-continue`, invoked as mcp__gm__gm-continue (an expected name, not witnessed) and takes none. The route to each is its resource, read with ReadMcpResourceTool (server gm). Do not call gm or gm-continue with the Skill tool; it is not listed there. Both are also resources, skill://gm/SKILL.md and skill://gm-continue/SKILL.md, as above. A prompt's text is its skill's body (gm adds the task), so a host gets either skill from the server, and no user-level copy of either skill is needed. The gate checks the rules in the gm skill against the server's text (`MCP_RULES` in `src/prompt.mjs`), and it checks each served skill's frontmatter.

## Other MCP servers in run_code

The worker is also an MCP client. It starts the MCP servers that its config names, and adds each of their tools to `gm` inside `run_code` as `gm.<server>_<tool>(args)`, beside the native verbs. `gm.verbs()` and run_code's description list them. The config is three files in the `mcpServers` shape of `.mcp.json`, read in this order. A later entry with the same name replaces the earlier one whole:

1. `defaults/mcp.json` in the checkout. It is required, and a missing file is logged as an `mcp-config` problem. It starts playwriter, as `npx -y -p github:AnEntrypoint/pw#v0.1.0 playwriter-project`, with no environment. The `pw` package declares `engines` `node >=22`, and gm-new runs on Node 20 and later, so on Node 20 or 21 playwriter may fail to start. The reason is in the stderr of its `mcp-server` failed event.
2. `.gm-new/mcp.json` in the workspace, if it exists.
3. The file that `--mcp-config <file>` names, if given. It is required.

A layer that sets `"disabled": true` for a name removes that server, so `{"mcpServers":{"playwriter":{"disabled":true}}}` in the workspace file turns playwriter off. An entry looks like this:

    {"mcpServers":{"files":{"command":"npx","args":["-y","<an MCP server package>","/abs/dir"],"env":{"TOKEN":"${MY_TOKEN}"},"timeoutMs":60000}}}

- Only stdio servers run, from `command`, `args`, `env` and `cwd`; a relative `cwd` is taken from the workspace. A server with a `url` is not supported yet. A `${NAME}` in a value takes the environment variable NAME, and a missing variable stops that server from starting, with the reason in the log. On Windows, a command of `npx` or `npm` starts through `cmd.exe`. `disabled: true` keeps an entry without starting it, and in a later layer it removes the server.
- The servers start with the worker, in parallel, and tools/list and run_code wait for them, each for at most `startupTimeoutMs` (default 30000; the default playwriter entry sets 600000, because a first npx install of it took 174 s and 458 s on the measured host). A server that fails is logged as `mcp-server` with its error and the tail of its stderr, and the others still run. A server that exits is started again by its next call.
- A call is an `action` and a `code-call` in the log, with its arguments and output. A call that runs past `timeoutMs` (default 60000) fails with that message, and the server is sent `notifications/cancelled`.
- A tool whose verb name is a native verb is skipped and logged as `mcp-tool-skipped`. The other MCP tools are on the code surface only, not on `--surface tools`.
- A worker started as an MCP server starts its own servers only to a depth of two (`GMNEW_MCP_DEPTH`), so a config that names gm-new itself stops after two levels.
- The servers are stopped when the worker exits. Their state lives in the servers, so a restart of the worker starts them again with a fresh state.

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

- Paths given to `read_file`, `write_file`, `edit_file`, `stat_file` and `list_dir` (and the spec and references of `review_packet`) may point inside or outside the workspace. A relative path is taken from the workspace, and an outside path should be absolute. A `..` segment and a symlink that leads outside are followed, not refused. `search` and `grep` cover the workspace's git-tracked text files, and `query_log` reads the run's log; neither takes a path outside. The git tools and the row files stay inside the workspace. Writes that touch one file run in order, including through a symlink alias or a hard link. A `run_code` body takes the same paths, for its file verbs and for the literal `require()` and `import()` specifiers it loads.
- `run_shell` is not confined. A shell command can hard-link a file from outside the workspace, and a path check does not see that.
- A background job and a foreground shell run in their own process group. A job kill (`job_stop`), a cancel of a foreground shell, a foreground timeout, the end of a run and an interrupt all end the group.
- The server speaks protocol versions 2025-11-25 and 2025-06-18. An `initialize` that asks for another version is answered with 2025-11-25. Each tools/call result carries the run id in `_meta` under `com.anentrypoint.gmnew/run`, and the `traceparent`, `tracestate` and `baggage` of a call's `_meta` are copied into its action event.
- A `notifications/cancelled` for a `run_shell` call kills its process group, and that call gets no answer. A cancel of any other call is logged as `cancel-ignored`, and the call runs on. A `run_shell` call whose `_meta` has a `progressToken` gets `notifications/progress` every 5 seconds, with the elapsed seconds.
- The repository is pushed privately to `AnEntrypoint/gm-new`.
