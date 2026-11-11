# gm

A single-worker long-horizon loop: one worker, one append-only log, governance rules re-read at every step. Design and evidence: `DESIGN.md` and `research/deep-research.md`.

Status: the MCP server, the skill, the CLI wrapper, the measurement tools, and the search, wiki, review and call-site tools are built and witnessed. The live comparison with gm is closed, with its results in DESIGN.md.

Install the latest release, once per machine, on Linux, macOS or Windows (x64 or arm64). The installers fetch the release manifest, verify the archive's sha256 and size, unpack into `~/.gmnew/current` (or `%USERPROFILE%\.gmnew\current`), and run the installed binary's `install` subcommand, which registers gm for Claude Code at user level. The POSIX installer needs curl, tar and sha256sum or shasum; the Windows installer uses PowerShell. Node and npm are not needed.

    curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/gm/main/scripts/install.sh | sh

To register gm with a playwriter config, pass the path through `sh -s --`:

    curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/gm/main/scripts/install.sh | sh -s -- --mcp-config <path>

On Windows, run `scripts/install.ps1`; its `-McpConfig` argument does the same. Both installers retry downloads and write `.gmnew-update.json` when it is missing.

Each build is versioned as `gmnew-<version>-<target>.tar.gz` (`.zip` on Windows), and the manifest is uploaded last, so an install never mixes two builds. The last three builds stay on `latest`. A push publishes every target that built; a target that failed keeps the build it had, and the run summary names it.

Windows x64 and arm64 build and test jobs pass in CI, and the release publishes their `.zip` assets. `scripts/install.ps1` installs them.

The registration is written by the binary itself: `<path-to-gm> install [--config <file>] [--mcp-config <file>]`. `--config <file>` names the file to register in; without it the file is `~/.claude.json` (on Windows, `%USERPROFILE%\.claude.json`). `--mcp-config <file>` is the server's config, appended to the args. Any other flag is an error and nothing is written. It sets `mcpServers.gm` in that file to `{"command": "<path-to-gm>", "args": ["serve"]}`, with `--mcp-config <file>` appended to args when given. Every other key is kept. The file is written to a temp file, re-read, and renamed over the original; a file that changed meanwhile is re-merged, and a file that is not a JSON object is refused and left alone. Running it again replaces the gm entry, so running the installer again updates the path.

Installs made earlier with add-mcp registered `node <checkout>/tools/relay.mjs` (the Node host). Running the install again replaces that entry with the native binary. Remove the entry by deleting `mcpServers.gm` from `~/.claude.json`.

Auto-update: the server checks the `latest` release at start and then every 15 minutes. Each check is a conditional request for the manifest (`If-None-Match`), so an unchanged release costs one small response, and a build is downloaded only when its target's archive has changed. Set `GMNEW_AUTO_UPDATE=0` to turn that off. Development builds never update.

The served tools are listed in `DESIGN.md`, Decisions. `search` and `wiki_search` rank by BM25 in process, over the tracked files and the wiki pages. `callers` and `impact` parse the JavaScript with acorn. `wiki_write` and the three `review_*` tools write to the run log and the wiki.

## The worker: an MCP server

gm runs as a stdio MCP server, and the agent session is the model.

The default surface serves three tools: `next_context`, `run_code` and `finish` (with an optional `gaps` array, logged in the end event, and `stopBackground`, which kills a background run that is still running). Every other verb is a function on `gm` inside `run_code`, for example `await gm.read_file({ path: 'a.txt' })`, and `--surface tools` serves each verb as a tool. The verbs are `read_file`, `write_file`, `edit_file`, `stat_file`, `list_dir`, `run_shell`, `job_start`, `job_status`, `job_stop` and `query_log` (`list_dir` pages with `prefix`, `offset` and `limit`, and replies with `total` and `next`); the search tools `search` (BM25 over the lines of tracked files) and `grep` (literal, regex or whole word); the git tools `git_status`, `git_state`, `git_add`, `git_rm`, `git_commit`, `git_push`, `git_log`, `git_diff`, `git_show`, `git_fetch`, `git_pull`, `git_checkout`, `git_branch`; `ci_status` (through the gh CLI, every page of runs, from origin's host); `fetch` (an HTTP GET of a URL through Node fetch, any scheme it serves, with the whole reply and no cap on redirects; DESIGN.md, 2026-11-03); and the row tools `prd_add`, `prd_list`, `prd_park`, `prd_reopen`, `prd_resolve`, `prd_delete`, `unknown_add`, `unknown_list`, `unknown_resolve`. Rows are files under `work/rows/`. `prd_resolve({ id, witness, push: true })` closes a row whose work is already on origin: it writes `closes/<id>.txt`, removes the row file, commits the close and pushes it by full sha to origin/main. In place, `prd_resolve({ id, event, commit })` keeps the row as resolved, with a seq of the run log and a commit that exists in the repository. `prd_reopen` moves a parked row back to open and does not reopen a resolved one. `callers` and `impact` parse the JavaScript with acorn; `wiki_search` ranks the wiki pages; `wiki_write`, `review_packet`, `review_record` and `review_join` write to the run log and the wiki (DESIGN.md). Each `next_context` call is one step. A call starts at once while one of `--max-inflight` slots (default 8) is free. Calls that touch one file, with a write among them, wait in order, and a shell runs alone. The server answers each request by its id, so a session's parallel calls overlap, and the log shows `inFlight`. On the code surface, `run_code` runs a body; one still running after its budget (180 seconds by default, `timeoutMs` at most 300000) becomes a background run, which `job_status` watches. Its kill, its lifetime and its restart are in DESIGN.md, Background budget.

Both skills are served as MCP skills under SEP-2640 (the `io.modelcontextprotocol/skills` extension): `skill://gm/SKILL.md` from `skills/gm/SKILL.md`, which holds the loop prose and the seven rules of a run, word for word, and `skill://gm-continue/SKILL.md` from `skills/gm-continue/SKILL.md`. The methods skills/list and skills/get answer for both, and each file of a skill is a resource with its sha256 digest and size. Both are also MCP prompts, which `prompts/list` answers: the gm skill is the prompt `gm`, invoked as mcp__gm__gm (an expected name, not witnessed) and takes the run's task, and gm-continue is the prompt `gm-continue`, invoked as mcp__gm__gm-continue (an expected name, not witnessed) and takes none. The route to each is its resource, read with ReadMcpResourceTool (server gm). Do not call gm or gm-continue with the Skill tool; it is not listed there. Both are also resources, skill://gm/SKILL.md and skill://gm-continue/SKILL.md, as above. A prompt's text is its skill's body (gm adds the task), so a host gets either skill from the server, and no user-level copy of either skill is needed. The gate checks the rules in the gm skill against the server's text (`MCP_RULES` in `src/prompt.mjs`), and it checks each served skill's frontmatter.

The first tool call of a connection is a read of `skill://gm/SKILL.md` (`resources/read`, or ReadMcpResourceTool with server gm). Until that read has happened, `run_code` answers with a refusal that names the read call, and the read sets the flag only on the connection it arrives on; the prompt route (`prompts/get`) does not set it. The flag lives in the worker process. The relay (native, `replay_handshake`) and core (`replaySkillRead`) replay the host's read to a restarted worker, after the handshake, so a restart keeps the gate open (docs/PENDING_VALIDATION.md, Validation gate).

The gm skill also serves `skills/gm/WORKFLOWS.md` as `skill://gm/WORKFLOWS.md`, read on demand with `gm.read_file({ path: 'skill://gm/WORKFLOWS.md' })`. It holds the workflow-graph discipline (the work order, pipeline over barrier, adversarial verify, loop until dry, no silent caps, budget guard, witness counts and the stepsLeft hand-off); SKILL.md points to it, so the seven rules and the connect-time instructions stay unchanged.

## Other MCP servers in run_code

The worker is also an MCP client. It starts the MCP servers that its config names, and adds each of their tools to `gm` inside `run_code` as `gm.<server>_<tool>(args)`, beside the native verbs. `gm.verbs()` and run_code's description list them. run_code's description also names `gm.try(fn)`, which wraps a call that may throw and returns its value or `{ ok: false, error }` as data. The config is three files in the `mcpServers` shape of `.mcp.json`, read in this order. A later entry with the same name replaces the earlier one whole:

1. `defaults/mcp.json` in the checkout. It is required, and a missing file is logged as an `mcp-config` problem. It starts playwriter, as `npx -y -p github:AnEntrypoint/pw#ebbba11 playwriter-project` (the commit is pinned in that file), with `PLAYWRITER_TELEMETRY=0` in its environment, which turns off playwriter's anonymous usage stats, and with `"ignore": [".playwriter/"]`. Each server starts with `PLAYWRITER_PROJECT_DIR` set to the run's workspace unless its entry sets that variable, so each project root gets its own playwriter gate, Chrome and profile at `<root>/.playwriter/browser-profile`. The `pw` package declares `engines` `node >=22`, the same floor setup enforces. A failed start gives its reason in the stderr of the `mcp-server` failed event.
2. `.gm/mcp.json` in the workspace, if it exists.
3. The file that `--mcp-config <file>` names, if given. It is required.

A layer that sets `"disabled": true` for a name removes that server, so `{"mcpServers":{"playwriter":{"disabled":true}}}` in the workspace file turns playwriter off. An entry looks like this:

    {"mcpServers":{"files":{"command":"npx","args":["-y","<an MCP server package>","/abs/dir"],"env":{"TOKEN":"${MY_TOKEN}"},"timeoutMs":60000}}}

A Linux container where Chromium's sandbox is blocked makes the browser refuse to start, with `no usable sandbox`. The default entry does not set `PLAYWRITER_NO_SANDBOX`, because that turns off Chromium's sandbox on every machine that runs the default. On the Ubuntu container this work runs in, `/usr/bin/chromium` is a wrapper that adds `--no-sandbox`, so the default starts there without the flag. Where Chromium is not wrapped that way, set it in a layer, restating the whole playwriter entry:

    {"mcpServers":{"playwriter":{"command":"npx","args":["-y","-p","github:AnEntrypoint/pw#ebbba11","playwriter-project"],"env":{"PLAYWRITER_TELEMETRY":"0","PLAYWRITER_NO_SANDBOX":"1"},"ignore":[".playwriter/"],"startupTimeoutMs":600000}}}

Setup registers only gm with the host, so the worker is the only thing that starts playwriter.

- `ignore` lists gitignore lines for the workspace's `.gitignore`. When the server connects in a git repository (a `.git` file or directory exists in the workspace), each line the file does not already hold is appended, and the file is created when it is missing. Existing lines and their line endings are kept, and no line is removed. Each change is logged as a `gitignore` event with the lines added, and a connect with nothing to add logs nothing. A workspace that is not a git repository gets one `gitignore` event with state `skipped`, and no file is written. Each line must be relative, with no `..` segment, and a leading slash makes a line absolute, so an anchored pattern is written without it. A bad `ignore` fails that server only, with its problem in the log.
- Only stdio servers run, from `command`, `args`, `env` and `cwd`; a relative `cwd` is taken from the workspace. A server with a `url` is not supported yet. A `${NAME}` in a value takes the environment variable NAME, and a missing variable stops that server from starting, with the reason in the log. On Windows, a command of `npx` or `npm` starts through `cmd.exe`. `disabled: true` keeps an entry without starting it, and in a later layer it removes the server.
- `deny` lists tool names of that server that are not registered as verbs. `defaults/mcp.json` denies the `reset` tool of playwriter, so `playwriter_reset` is not registered. That tool recreates the browser connection and resets the context that every worker shares.
- The servers start with the worker, in parallel, and tools/list and run_code wait for them, each for at most `startupTimeoutMs` (default 30000, or 600000 when the command is `npx` or `npm`, because a first npx install of a git package took 174 s and 458 s on the measured host). A server that exits before it answers `initialize` is started again, up to three attempts in all, and a server that does not start fails with every attempt's cause, its startup budget and the tail of its stderr, all logged as `mcp-server` and returned to the caller; the others still run. A server that exits later is started again by its next call.
- A call is an `action` and a `code-call` in the log, with its arguments and output. A call that runs past `timeoutMs` (default 60000) fails with that message, and the server is sent `notifications/cancelled`.
- A tool whose verb name is a native verb is skipped and logged as `mcp-tool-skipped`. The other MCP tools are on the code surface only, not on `--surface tools`.
- A worker started as an MCP server starts its own servers only to a depth of two (`GMNEW_MCP_DEPTH`), so a config that names gm itself stops after two levels.
- The servers are stopped when the worker exits. Their state lives in the servers, so a restart of the worker starts them again with a fresh state.

## Paths and limits

- Paths given to `read_file`, `write_file`, `edit_file`, `stat_file` and `list_dir` (and the spec and references of `review_packet`) may point inside or outside the workspace. A relative path is taken from the workspace, and an outside path should be absolute. A `..` segment and a symlink that leads outside are followed, not refused. `search` and `grep` cover the workspace's git-tracked text files, and `query_log` reads the run's log; neither takes a path outside. The git tools and the row files stay inside the workspace. Writes that touch one file run in order, including through a symlink alias or a hard link. A `run_code` body takes the same paths, for its file verbs and for the literal `require()` and `import()` specifiers it loads.
- `run_shell` is not confined. A shell command can hard-link a file from outside the workspace, and a path check does not see that.
- A background job and a foreground shell run in their own process group. A job kill (`job_stop`), a cancel of a foreground shell, a foreground timeout, the end of a run and an interrupt all end the group. A worker restart does not end a job: the job's shell writes its exit code to `jobs/<name>.exit`, and the new worker adopts a job whose process is still alive, with its remaining timeout, and settles a job that exited while no worker ran. Background bodies are still stopped at a restart.
- The server speaks the five protocol versions the MCP SDK accepts: 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05 and 2024-10-07. `initialize` echoes the version the client asks for when it is one of these, and any other version is answered with 2025-11-25. `server/discover` lists 2025-11-25 and 2025-06-18. Each tools/call result carries the run id in `_meta` under `com.anentrypoint.gmnew/run`, and the `traceparent`, `tracestate` and `baggage` of a call's `_meta` are copied into its action event.
- A `notifications/cancelled` for a `run_shell` call kills its process group, and that call gets no answer. A cancel of any other call is logged as `cancel-ignored`, and the call runs on. A `run_shell` call whose `_meta` has a `progressToken` gets `notifications/progress` every 5 seconds, with the elapsed seconds.
- The repository is pushed publicly to `AnEntrypoint/gm`.

## Native build

    cmake --preset release
    cmake --build build/release
    node tools/check-build.mjs build/release

- `scripts/gm.sh` and `scripts/gm.ps1` run the same steps: `build`, `test` (the build, then `tools/check-build.mjs`), `doctor` or `all`. `GMNEW_PRESET` picks the preset (default `release`). The project has no unit tests; checks run on the built binary.
- The binary is build/PRESET/native/components/host/gm.
- Two workflows run on pushes to main: `.github/workflows/release.yml` builds and tests six targets and publishes `latest`; `.github/workflows/arm-diagnose.yml` runs asan and gdb on arm64. There is no ci.yml.
