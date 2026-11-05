# gm

A single-worker long-horizon loop: one worker, one append-only log, governance rules re-read at every step. Design and evidence: `DESIGN.md` and `research/deep-research.md`.

Status: the MCP server, the skill, the CLI wrapper, the measurement tools, and the search, wiki, review and call-site tools are built and witnessed. The live comparison with gm is closed, with its results in DESIGN.md. Node.js 22 or later; older Node lines are not supported.

Install the latest release, once per machine, on Linux or macOS (x64 or arm64). It fetches the release manifest, verifies the archive's sha256 and size, unpacks into `~/.gmnew/current`, and registers gm for Claude Code at user level with add-mcp. It needs curl, tar and sha256sum or shasum; Node is not needed to run gm.

    curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/gmc/main/scripts/install.sh | sh

To register gm with a playwriter config, pass the path through `sh -s --`:

    curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/gmc/main/scripts/install.sh | sh -s -- --mcp-config <path>

Each build is published under its own file names (`gmnew-<version>-<target>`), and the manifest is uploaded last, so an install never mixes two builds. The last three builds stay on `latest`.

Windows is not published yet: the Windows build fails most of its tests, so the release carries Linux and macOS only. `scripts/install.ps1` is kept for when it is.

The registration is add-mcp, pinned to version 2.6.1, run through npx. The command it runs is:

    npx -y add-mcp@2.6.1 <path-to-gmnew> --args serve -n gm -g -a claude-code -y

add-mcp takes the executable as its target and each argument after `--args`, so the command and its arguments are stored apart. Do not put the whole command in one string: add-mcp stores that string as the executable name, and the server cannot start.

Check the registration with `npx -y add-mcp@2.6.1 list -g`. Remove it with `npx -y add-mcp@2.6.1 remove gm -g -y`. The installer re-registers over an existing gm entry, so running it again updates the path.

Auto-update: the server checks the `latest` release at start and every six hours, and downloads a build only when the release has changed. Set `GMNEW_AUTO_UPDATE=0` to turn that off. Development builds never update.

The playwriter fetch is the setup step after the gate. Before it runs, setup prints what it does: it runs `npx -y -p github:AnEntrypoint/pw#v0.1.0 playwriter-project help`, which downloads the browser tool gm uses (pw v0.1.0, which installs playwriter 0.9.0) once into the npm cache, at the path `npm config get cache` prints. The download can take a few minutes on a slow network. The help command starts no gate, browser or server, and the browser starts only on first use. After it, setup prints the result. Setup refuses any Node below 22, the floor the pw package needs, so the fetch always runs. A failed fetch prints its reason and does not stop setup: gm still installs and runs, the playwriter tools are fetched on the first gm start, and `./setup.sh` retries the fetch.

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

1. `defaults/mcp.json` in the checkout. It is required, and a missing file is logged as an `mcp-config` problem. It starts playwriter, as `npx -y -p github:AnEntrypoint/pw#v0.1.0 playwriter-project`, with `PLAYWRITER_TELEMETRY=0` in its environment, which turns off playwriter's anonymous usage stats, and with `"ignore": [".playwriter/"]`. The `pw` package declares `engines` `node >=22`, the same floor setup enforces. A failed start gives its reason in the stderr of the `mcp-server` failed event.
2. `.gm-new/mcp.json` in the workspace, if it exists.
3. The file that `--mcp-config <file>` names, if given. It is required.

A layer that sets `"disabled": true` for a name removes that server, so `{"mcpServers":{"playwriter":{"disabled":true}}}` in the workspace file turns playwriter off. An entry looks like this:

    {"mcpServers":{"files":{"command":"npx","args":["-y","<an MCP server package>","/abs/dir"],"env":{"TOKEN":"${MY_TOKEN}"},"timeoutMs":60000}}}

A Linux container where Chromium's sandbox is blocked makes the browser refuse to start, with `no usable sandbox`. The default entry does not set `PLAYWRITER_NO_SANDBOX`, because that turns off Chromium's sandbox on every machine that runs the default. On the Ubuntu container this work runs in, `/usr/bin/chromium` is a wrapper that adds `--no-sandbox`, so the default starts there without the flag. Where Chromium is not wrapped that way, set it in a layer, restating the whole playwriter entry:

    {"mcpServers":{"playwriter":{"command":"npx","args":["-y","-p","github:AnEntrypoint/pw#v0.1.0","playwriter-project"],"env":{"PLAYWRITER_TELEMETRY":"0","PLAYWRITER_NO_SANDBOX":"1"},"ignore":[".playwriter/"],"startupTimeoutMs":600000}}}

Setup registers only gm with the host, so the worker is the only thing that starts playwriter.

- `ignore` lists gitignore lines for the workspace's `.gitignore`. When the server connects in a git repository (a `.git` file or directory exists in the workspace), each line the file does not already hold is appended, and the file is created when it is missing. Existing lines and their line endings are kept, and no line is removed. Each change is logged as a `gitignore` event with the lines added, and a connect with nothing to add logs nothing. A workspace that is not a git repository gets one `gitignore` event with state `skipped`, and no file is written. Each line must be relative, with no `..` segment, and a leading slash makes a line absolute, so an anchored pattern is written without it. A bad `ignore` fails that server only, with its problem in the log.
- Only stdio servers run, from `command`, `args`, `env` and `cwd`; a relative `cwd` is taken from the workspace. A server with a `url` is not supported yet. A `${NAME}` in a value takes the environment variable NAME, and a missing variable stops that server from starting, with the reason in the log. On Windows, a command of `npx` or `npm` starts through `cmd.exe`. `disabled: true` keeps an entry without starting it, and in a later layer it removes the server.
- `deny` lists tool names of that server that are not registered as verbs. `defaults/mcp.json` denies the `reset` tool of playwriter, so `playwriter_reset` is not registered. That tool recreates the browser connection and resets the context that every worker shares.
- The servers start with the worker, in parallel, and tools/list and run_code wait for them, each for at most `startupTimeoutMs` (default 30000; the default playwriter entry sets 600000, because a first npx install of it took 174 s and 458 s on the measured host). A server that fails is logged as `mcp-server` with its error and the tail of its stderr, and the others still run. A server that exits is started again by its next call.
- A call is an `action` and a `code-call` in the log, with its arguments and output. A call that runs past `timeoutMs` (default 60000) fails with that message, and the server is sent `notifications/cancelled`.
- A tool whose verb name is a native verb is skipped and logged as `mcp-tool-skipped`. The other MCP tools are on the code surface only, not on `--surface tools`.
- A worker started as an MCP server starts its own servers only to a depth of two (`GMNEW_MCP_DEPTH`), so a config that names gm-new itself stops after two levels.
- The servers are stopped when the worker exits. Their state lives in the servers, so a restart of the worker starts them again with a fresh state.

## The CLI wrapper, for scripted witnesses

    node src/cli.mjs run --task "<text or file>" --workspace <dir> [--model scripted] [--script replies.json] [--faults 429,429] [--latency-ms N] [--serial] [--no-background] [--overlap]
    node src/cli.mjs query (--run <id> | --dir <run dir>) --js "events.filter((e) => e.kind === 'end')"
    node src/cli.mjs replay (--run <id> | --dir <run dir>) [--workspace <dir>]
    node src/cli.mjs doctor [--workspace <dir>]

- `scripted` is the only model, and it is offline. gm makes no API call. In MCP mode the model is the host session, such as Claude Code.
- `doctor` reports Node, whether the key is set (never its value), whether the workspace is writable, the last run, and two limits: the Node-below-22 failure path has no live run, and `run_shell` is unconfined. The process-group kill is unverified on Windows.
- `replay` reruns a finished CLI run through the scripted model, and every replayed event carries `replayOf`.

Each run writes `runs/<id>/` under its `--workspace` (gm-new's own `runs/` when the workspace is the checkout), with `log.jsonl`, `rules.md` and `task.json`, and ends with a `summary` event: `maxInFlight`, `meanInFlight`, `toolMs`, `modelMs`, `idleMs` and `contextCalls`. The run's `log:` line prints its path. `runs/` is git-ignored.

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

## Native build

    cmake --preset release -DGMNEW_BUILD_TESTS=ON
    cmake --build build/release
    ctest --test-dir build/release --output-on-failure

- `scripts/gmnew.sh` and `scripts/gmnew.ps1` run the same steps: `build`, `test`, `doctor` or `all`. `GMNEW_PRESET` picks the preset (default `release`).
- The binary is build/PRESET/native/components/host/gmnew. `setup.sh` builds it and prints the path; it does not change `.mcp.json`.
- `.github/workflows/ci.yml` builds and tests on Linux, macOS and Windows, x64 and arm64. `release.yml` uploads the binary for each target on a `v*.*.*` tag.
