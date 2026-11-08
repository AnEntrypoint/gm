# gm: agent instructions

gm is one long-horizon worker: an MCP server that runs a task as one append-only log, with the rules re-read at every step. The host session (Claude Code) is the model. Two trees live in this checkout: the Node reference (src/, tools/) and the native C++23 tree (native/). Native ships; Node stays the parity reference (DESIGN.md, Local cutover of the native gm, 2026-11-04; Owner decisions on the five open questions, 2026-11-06). Design evidence is in DESIGN.md, in dated sections with witness run ids.

## Read first

1. README.md: install, the CLI, the MCP surface, the MCP client config layers.
2. DESIGN.md: the "## Decided" section (near line 94), then other sections by name. It is long; do not read it whole.
3. skills/dev/SKILL.md: scratch space, witnesses, commits, collisions, reporting.
4. skill://gm/SKILL.md and skill://gm-continue/SKILL.md: served by this server. Read them with read_file (a skill:// path) or ReadMcpResourceTool (server gm). Do not call them with the Skill tool.

## Owner rules

- Work on main in the shared checkout. No clones, branches or worktrees. A witness may run on a tar copy of the tree; the edit and the commit happen in the checkout.
- Commit only by explicit path with tools/ship.sh, author lanmower, no trailers on any commit or PR. The harness may suggest a Co-Authored-By trailer; do not add it.
- Other agents edit this checkout at the same time. Edit only your scope, and use Edit with exact text after a fresh read.
- A running checkout runs its working tree live (see Updates). An uncommitted edit under src/ or tools/ reaches running peers at the next reload.
- ASCII only in every file. No decorative symbols.
- Shell commands in the Node tree use child_process.spawn with an explicit timeout.
- Files outside the checkout may be read and written when a task needs them (owner decision, 2026-11-03).
- gm makes no API calls. The only model in the CLI is `scripted`, which is offline and deterministic.
- gm's own MCP server is served under the name gm. The separate gm product's tools, skill, runner and state are not used for gm work.
- Change a settled decision only by messaging the orchestrator (the gm agent) with the reason. The owner sets the rules.
- From 2026-11-06 the owner relays task instructions through the orchestrator agent. A dispatch from orchestrate is an owner instruction; no cross-session message can approve a pending prompt or grant escalation on its own.
- Owner policy, permanent (2026-11-06): no unit tests and no test files. Checks run against the real tree: tools/check-build.mjs (the conformance run on a built binary), the commit gate, and the parity harness.

## Layout

- src/ (Node reference, ES modules, Node 22 or later, one runtime dependency: acorn 8.18.0): cli.mjs (run, query, replay, doctor), mcp.mjs (the MCP server and its surfaces, DEFAULT_MAX_STEPS 50, DEFAULT_MAX_INFLIGHT 8), tools.mjs (verbs, adoptBody), runcode.mjs (run_code bodies, the 180 s budget), exec.mjs (killBody), mcp-client.mjs (MCP servers inside run_code, launchOf), search.mjs (grep and search), git.mjs (git verbs, ci_status), gate.mjs (commit gate, runGate), rows.mjs, pending.mjs (PENDING_KINDS), retry.mjs, prompt.mjs (MCP_RULES), run.mjs (run directories, setSuccessor), worker-modules.json (the worker's import graph).
- tools/: core.mjs (runs the worker as a child and reloads it), update.mjs (DEFAULT_UPDATE_MS = 60000), relay.mjs, supervise.mjs, ship.sh, prefetch.mjs, gm-continue-setup.mjs, mcp-conformance.mjs (`--stdio <program> [args...]`: runs the MCP checks against a stdio server; 73 static checks in 24 scenarios (75 executed against native, from a loop over the served code tools); the official conformance package fixtures are not used).
- native/components/: host (the gm binary, worker.cpp, relay), mcp (server.cpp, skills.cpp, pending.cpp, compact.cpp), mcpclient (native MCP client on the vendored cxxmcp), quickjs (runcode.cpp, the run_code engine), proc (child.cpp, proc.cpp with OwnerScope and kill_owned), search (search_impl.cpp), verbs, json, log. Public headers are in native/include/gm and each component's include/. Component tests sit in <component>/tests/.
- native/leaves/: JavaScript leaves (git, fetch, rows, review, wiki, code-ast) and vendor/acorn.mjs.
- native/third_party/: cxxmcp v1.3.0 (MIT, stdio only, VERSION.txt holds the commit and a sha256 per file) and quickjs-ng.
- native/tests/parity/: run.mjs and fake-mcp.mjs (see Parity harness).
- skills/gm/SKILL.md, skills/gm/WORKFLOWS.md, skills/gm-continue/SKILL.md, skills/dev/SKILL.md. Every file under a served skill directory is a resource, so WORKFLOWS.md is served as `skill://gm/WORKFLOWS.md` with no reconnect; SKILL.md points to it on demand and tells the model to re-read it after a compaction. defaults/mcp.json: the default MCP servers (playwriter). setup.sh. scripts/gm.sh and scripts/gm.ps1. .github/workflows/release.yml (six build presets and publish), arm-diagnose.yml (asan and gdb on arm64), and .github/actions/ninja/ (the runner image Ninja). docs/index.html (the manual). research/ (evidence). tasks/rewrite/ (rewrite briefs). work/rows/ (PRD and unknown rows).
- runs/<id>/ (git-ignored): log.jsonl (append-only), log.index, rules.md, task.json, jobs/.

## Build and test

- Native: `cmake --preset release`, then `cmake --build build/release`, then `node tools/check-build.mjs build/release`. Or `scripts/gm.sh build|test|doctor|all` (GMNEW_PRESET picks the preset, default release; gm.ps1 runs the same steps).
- Presets in CMakePresets.json: debug, release, asan, ubsan, asan-ubsan, tsan, native-perf, and x64 and arm64 for linux, windows and macos (`*-release`). release.yml builds and tests the six release presets on main and publishes latest for every target that built (publish runs with always(); a failed target keeps its earlier build, carried in the manifest, and the run summary names it); arm-diagnose.yml runs asan and gdb on arm64.
- Commit gate: tools/ship.sh runs it through src/gate.mjs runGate. It runs every check only in a checkout whose package.json name is gm; elsewhere it checks syntax and lists the rest as notCovered. A check that throws is a failure.
- Witness rule: run the built binary or the CLI on a real task in a scratch workspace, read the output, then delete the scratch. `node src/cli.mjs run --task "<text>" --workspace <dir> --model scripted` runs offline.

## Facts found by troubleshooting

- Node CLI needs `npm install` first (acorn is the one dependency; node_modules is git-ignored). Without it: ERR_MODULE_NOT_FOUND for 'acorn'. verified 2026-11-05.
- The native build needs Ninja on PATH (presets use the Ninja generator). On a host where pip is PEP 668 blocked, install it into a venv. verified 2026-11-05.
- An installed build from 409087f-77 or earlier cannot self-update: its updater looks for gm-<target> in the unpacked archive, while the archives ship gmnew-<target>. One manual scripts/install.sh run is needed; 70e4349 fixes the updater. DESIGN.md, "Update witness against the published release (2026-11-05)".
- Concurrent gm.search and gm.grep calls once shared unguarded SearchVerbs and Searcher state, which crashed the worker (exit 139). 5d9e835 serializes SearchVerbs::call, keeps cached index pointers valid, and masks .env values in hit lines. commit 5d9e835".
- gh run list --commit needs the full 40-character SHA; a 7-character prefix returns no runs. verified 2026-11-05.
- The foreground-to-background switch at 120 s is the MCP client's ("still running after 120s ... moved to the background"), not gm's. gm returns a run_code result at its own timeoutMs: a 150 s body with timeoutMs 300000 returned its value at 150.006 s (verified 2026-11-08). While a run_code body runs, native sends notifications/progress every 5 s when the request has a progressToken, as Node does; tools/check-run-code-progress.mjs pins it.
- ssh reads the stdin it is given. In `while read h; do ssh host ...; done < hosts.txt` an ssh without `</dev/null` eats the loop's remaining lines: only the first host ran (verified 2026-11-08 against a local sshd). gm's shell gives each child EOF, not the MCP pipe; tools/check-shell-stdin.mjs pins that.

## Parity harness

    node native/tests/parity/run.mjs [--bin <gm>] [--ref /tmp/parity-ref] [--scratch <dir>] [--reply-timeout-ms N]

- The default --bin is build/integ/native/components/host/gm. build/integ is a build directory that no preset names, so configure it yourself or pass --bin. Run `npm ci --ignore-scripts` in the repo first; the harness stops at startup and names that step when node_modules/acorn is missing.
- It extracts HEAD's src, tools, skills, defaults and package.json with git archive into --ref (no clone), runs the same JSON-RPC scenarios through the Node reference and the native binary, and prints one row per scenario and a total: "N/M scenarios match, X cutover-expected, Y native-ahead, Z differ".
- mcpPass (run.mjs) runs the MCP scenarios against fake-mcp.mjs: two servers, deny, ignore, a missing ${VAR}, a non-stdio entry. NATIVE_AHEAD lists the accepted differences, each with a path pattern.
- Last witness (2026-11-08, run on the tree at the commit that adds this line, `node native/tests/parity/run.mjs --bin build/release/native/components/host/gm` after `npm ci --ignore-scripts`): 23 of 93 match, 47 native-ahead, 23 documented-gap, 0 differ. Changing Node to match native is a decision, not a fix.

## Runtime and MCP surface

- Surfaces: the code surface (the default) serves next_context, run_code and finish. `--surface tools` serves each verb as a tool. Every other verb is a function on `gm` inside run_code: `await gm.read_file({ path })`. gm.verbs() returns each verb's schema; `{ name }` narrows to one and `{ names: true }` lists names.
- Verbs: read_file, write_file, edit_file, stat_file, list_dir, run_shell, job_start, job_status, job_stop, query_log, search, grep, wiki_search, wiki_write, callers, impact, git_status, git_add, git_rm, git_commit, git_push, git_log, git_diff, git_show, git_fetch, git_pull, git_checkout, git_branch, ci_status, fetch, task_set, prd_add, prd_list, prd_park, prd_reopen, prd_refute, prd_receipt, prd_resolve, prd_delete, unknown_add, unknown_list, unknown_resolve, review_packet, review_record, review_join.
- Closing a row whose work is already on origin: `gm.prd_resolve({ id, witness, push: true })`, the witness being the evidence string (for example the delivered sha on origin/main). There is no publish_on_origin verb. `gm.prd_receipt` binds a witness without closing or deleting the row. `gm.prd_reopen` moves a parked row or a refuted row with `from: 'refuted'` back to open.
- Each next_context call is one step. The first-step host truncation correction is unmarked; later task replacement needs `owner: true`. `gm.task_set({ task, owner: true })` changes or clears the current task. Large verb and body replies expose outputPath, totalChars, next and truncated; `gm.query_log({ seq, field, offset, limit })` pages compacted feed fields. Calls run in parallel up to --max-inflight (default 8); calls on one file with a write wait in order, and a shell runs alone. The log records inFlight.
- A body still running after timeoutMs (default 180000, at most 300000) becomes a background run. job_status watches it. finish refuses while a background run runs, unless stopBackground is true, which kills it.
- finish needs a witness and no open row. A PRD you will not implement is deleted with prd_delete; other rows are resolved with a witness. A question for the owner is an unknown row, and the run stays open until it is resolved.
- One run belongs to one server connection, and finish ends it for every agent on that connection. The first next_context after a finish opens a fresh run in the same workspace (reopen in src/mcp.mjs; setSuccessor in src/run.mjs writes the successor file). At stepsLeft 0 call finish with a witness, then next_context opens the successor; a next_context at the limit ends the run with status max_steps and no witness, and a later next_context opens the successor run with the same task. skills/gm/SKILL.md and skills/gm/WORKFLOWS.md teach the hand-off.
- A child agent that shares the connection never sends finish.
- Skills are served under the io.modelcontextprotocol/skills extension, and each is also a prompt: gm (mcp__gm__gm) and gm-continue (mcp__gm__gm-continue). read_file serves skill:// paths (serveSkillFile in src/mcp.mjs; served_skill_text in native/components/mcp/skills.cpp) and logs skill-loaded.
- Protocol versions served: 2025-11-25 and 2025-06-18. 2026-07-28 is behind a capability flag that is off by default (DESIGN.md, Owner decisions on the five open questions, 2026-11-06).
- Declared capabilities: tools, prompts and resources (listChanged), logging, completions, and the skills extension. resources.subscribe is not declared. subscriptions/listen is the only subscription surface; resources/subscribe and resources/unsubscribe are removed and answer -32601.
- Each next_context returns the rules, the task, the witness requirement, the new events in full up to 20,000 characters, the older events in compact form, and prefixSha. `next_context({ task })` replaces a cut slash-command task. Older events are read with query_log, which reaches every event. The rules are in runs/<id>/rules.md and are never compacted.
- query_log reads one bounded window of matching events; a count over a whole run pages with next.
- A delivered pending event is cleared once next_context or a wait returns it. A restart is logged as paused and is not pending. An added row is a row-added pending event and wakes an open `events --wait`.
- A worker that exits 0 with its run open paused itself; the core restarts it.
- read_file counts lines by default (offset is a 0-based line index). unit "chars" counts characters; job_status offset counts characters.
- Debugging: `node src/cli.mjs replay` reruns a finished CLI run through the scripted model; each replayed event carries replayOf.

## MCP servers inside run_code

- Layers, read in order: defaults/mcp.json (required), <workspace>/.gm/mcp.json, and the file given by --mcp-config (required if given). A later entry with the same name replaces the earlier one whole. `"disabled": true` removes a server.
- Each server's tools are verbs named gm.<server>_<tool>. Entry keys: command, args, env (${NAME} is expanded; a missing variable stops that server), cwd (relative to the workspace), timeoutMs, startupTimeoutMs, deny (tool names not registered as verbs), ignore (gitignore lines appended to the workspace .gitignore when it is a git repository). Only stdio servers run; a url entry is not supported yet.
- The default playwriter entry runs `npx -y -p github:AnEntrypoint/pw#1488a92 playwriter-project` with PLAYWRITER_TELEMETRY=0 and denies its reset tool, which would reset the browser context every worker shares. Where Chromium has no sandbox wrapper, a layer may set PLAYWRITER_NO_SANDBOX=1 by restating the whole entry. The default does not set it.
- Browser work uses the playwriter setup inside gm first, through gm.playwriter_execute and gm.playwriter_browsers (skills/gm/SKILL.md, Browser control). Headless Chromium, Claude in Chrome and the built-in browser are fallbacks only: use one when the playwriter setup cannot do the job, and say why.
- Native client: native/components/mcpclient, built on the vendored cxxmcp (stdio). Its gaps against Node are listed under Known gaps.
- A stopped background body: stop_locked in native/components/mcp/server.cpp calls proc::kill_owned on the body's owner, and the body thread holds a proc::OwnerScope. Its child processes are killed. Node's killBody (src/exec.mjs) kills shells only (see the native-ahead decision).

## Search and grep

- Native grep (native/components/search/search_impl.cpp): the default scope is git-tracked files plus untracked files that git does not ignore. scope "all" adds gitignored files and node_modules. Both skip .git, .gm, .agentplug, .agentplug-kv, .gm, .playwriter and runs unless git tracks the file. vendor and node_modules are skipped unless vendor is true. A zero-match reply starts with a hint counting the skipped files.
- Node search (src/search.mjs) searches tracked files only (decision 2026-11-05). Its literal pass runs the pattern again as a regex when the literal finds nothing and the pattern has regex characters; an invalid regex is an error (searcherFor).
- Native search reuses a file's lines only while its stat (device, inode, size, mtime, ctime) is unchanged and settled (STAMP_SETTLE_MS = 3000), so a same-size write in one timestamp tick is not missed.
- Do not cache the tokenized text of every file. Doing so once put a worker at 1399 MB of heap on a 108 MB tree (verified in the Node tree).
- grep's `root`, `projectPath` and `cwd` must name a directory; `path` narrows the scan to one file or directory inside that root and can be combined with `root`, and a file outside the tracked set needs `scope: "all"`. search's root must be a directory. In a non-git workspace they fail with a named git repository error.

## Updates and hot reload

- tools/update.mjs: a running checkout pulls origin main every DEFAULT_UPDATE_MS (60000 ms; GMNEW_UPDATE_MS overrides). A pull goes only into a clean checkout.
- Installed gm: the relay checks the latest manifest every 15 minutes (kUpdateInterval in update.hpp) with If-None-Match, and downloads a target's archive only when its sha256 changes. Each manifest entry has its own version, so a target that failed to build is not re-downloaded. Publish keeps the newest 3 versions (tools/prune-release-assets.mjs --keep 3).
- A change to a module listed in src/worker-modules.json restarts the worker. A change to a leaf or a skill applies in place. A src module outside the list (cli.mjs) restarts nothing. The gate's workers check fails when the list differs from the import graph.
- A singleton that imports a reloadable module statically keeps the code it loaded at boot. A batch that changes tools/core.mjs or a singleton restarts each live worker, and background jobs are killed (DESIGN.md, Hot reload language (2026-11-04)).
- tools/relay.mjs is frozen, so a change to it reaches a host only on reconnect (see tools/relay.mjs).

## Retries and network

- fetch, git_fetch, git_push and ci_status retry transient failures 3 times, with backoff from 1 s doubling to a 16 s cap and plus or minus 20% jitter (src/retry.mjs). A permanent failure is not retried. Each retry is logged. Git and gh print no error code, so their messages are matched after URLs and host names are removed.
- No caps on network verbs: fetch reaches any host and scheme Node's fetch serves, follows redirects with no count, and archives the whole body. Timeouts stay. fetch cannot read file: URLs (Node's fetch fails them) and serves data: URLs.
- ci_status pages every run with `gh api --paginate --jq`, one compact JSON array of runs per page parsed line by line, and passes origin's host as --hostname. It needs only --paginate and --jq, so gh 2.46.0 works.

## Platform notes

- Node, Windows: spawn runs no .cmd or .bat without a shell, so npx and npm start through cmd.exe /d /s /c (launchOf in src/mcp-client.mjs). Not witnessed on Windows.
- Native, Windows: no server stderr is captured (native/components/proc/child.cpp). Windows and macOS builds and arm are not verified here (DESIGN.md, Local cutover, 2026-11-04); CI covers them.
- Witnessed by release run 42286279980 (2026-11-06): Windows x64 and arm64 cmd-only run_shell witnesses report control ok:true exit 0 output gm-windows-cmd-witness-ok and cmdOnly dir /b ok:false exit 2 output dir: cannot access /b: No such file or directory, confirming the babbb28 shell switch; Windows and macOS check-build runs pass. Owner decision: keep cmd for cmd-only syntax, so dir, del, set and backslash paths route through cmd.exe and other commands keep Git bash. arm-diagnose runs 42286279871 and 42288122113 both had gdb-arm success and asan-arm failure with check-build: spawnSync /usr/local/bin/node ETIMEDOUT after exactly 10 minutes, the check-build.mjs spawnSync timeout; the fix raises it to 1200000 and reduces the asan-arm loop from five runs to one.
- Process groups: background jobs and foreground shells run in their own group. The group kill is unverified on Windows (doctor reports it).
- A Linux container where Chromium's sandbox is blocked refuses to start the browser (`no usable sandbox`). On this Ubuntu container /usr/bin/chromium is a wrapper that adds --no-sandbox.
- The playwriter execute tool returns a value only for one expression, or for an async arrow that returns. A top-level const or let yields "no output"; keep values in `state`.

## Owner decisions (2026-11-06, through orchestrate)

1. Native ships; Node stays the parity reference. Reversible by one entry change. The user-wide entry is unchanged (DESIGN.md, Local cutover of the native gm, 2026-11-04).
2. Roots and elicitation stay unused; question rows carry interactivity (DESIGN.md, Owner decisions on the five open questions, 2026-11-06).
3. Negotiate protocol 2026-07-28 behind a capability flag that is off by default, with a witness test. It does not become the default until a client test exists (DESIGN.md, Owner decisions on the five open questions, 2026-11-06).
4. Drain and log a body's console output, capped. Implemented (DESIGN.md, Body console drained and logged, capped).
5. The project does not close until the minimal tool set is run and G3 (cache effect, measured by the gm agent from host transcripts) is recorded. Both are recorded (DESIGN.md, Item 5).

## Decisions (owner), with current state

- Console output: implemented (DESIGN.md, Body console drained and logged, capped).
- Minimal tool set and G3: recorded; the claim may be closed by the owner (DESIGN.md, Item 5).

## Known gaps, native against Node

- The SDK requires capabilities and serverInfo.version in initialize. accept_initialize fills them in. Node has not been checked to accept a result without them.
- The SDK accepts six protocol versions; the native client checks only the two Node speaks.
- A server killed by a signal reports 128 plus the signal number in native. A spawn failure reports the OS text in native.
- Native answers server requests other than ping with the SDK's method-not-found text.
- Windows captures no server stderr in native.
- A stopped background fetch follows native: the body stop kills the curl; Node parity is scheduled (DESIGN.md, Decided).

## Ship and commits

- tools/ship.sh "<subject>" <paths...>: refuses a path that is neither present nor tracked in the index or HEAD, stages only the named paths (a deleted path is staged as its deletion, also when already staged), runs the gate, unstages them if the gate fails, commits, and pushes origin main. SHIP_PUSH=0 commits without pushing; SHIP_ROOT names the checkout; SHIP_OUT names the gate log (default /tmp/ship-gate.out).
- Attribution: author lanmower; no trailers.
- Collisions: fetch, reapply on origin's tip, push. Do not clone to get around one.
- Remote: AnEntrypoint/gm, public, pushed to main. The owner decided the repository is public.

## Keeping this file

- A note names a path or a command. Check it against the code before keeping it, with gm.grep or gm.read_file.
- New code gets no comments. A reason that cannot be read from the code goes here, after it is checked.
- This file is rebuilt when it passes 30 KB (owner invariant 3); the gate (src/gate.mjs agents-size) fails above that. Write each note in the fewest words that keep it instructive. At the limit, compress first, then drop notes in this order: what the code already shows, menial steps, then obvious facts. Keep only what took a long run to learn and cannot be read from the code. Tool replies carry only what the next step needs, so a step does not pay for text it will not use. The gm skill holds the same rule.
