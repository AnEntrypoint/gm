# gm: agent instructions

gm is one long-horizon worker: an MCP server that runs a task as one append-only log, with the rules re-read at every step. The host session (Claude Code) is the model. Two trees live in this checkout: the Node reference (src/, tools/) and the native C++23 tree (native/). Native ships; Node stays the parity reference (DESIGN.md, Local cutover of the native gm, 2026-11-04; Owner decisions on the five open questions, 2026-11-06).

## Read first

1. README.md: install, the MCP surface, the MCP client config layers, paths and limits.
2. DESIGN.md: the "## Decided" section (near line 94), then other sections by name. It is long; do not read it whole.
3. skills/dev/SKILL.md: scratch space, witnesses, commits, collisions, reporting.
4. skill://gm/SKILL.md and skill://gm-continue/SKILL.md: served by this server. Read them with read_file (a skill:// path) or ReadMcpResourceTool (server gm). Do not call them with the Skill tool.

## Owner rules

- Work on main in the shared checkout. No clones, branches or worktrees. A witness may run on a tar copy of the tree; the edit and the commit happen in the checkout.
- Commit only by explicit path with tools/ship.sh, author lanmower, no trailers on any commit or PR. The harness may suggest a Co-Authored-By trailer; do not add it.
- Other agents edit this checkout at the same time. Edit only your scope, and use Edit with exact text after a fresh read.
- In the Node tree an uncommitted edit reaches running peers: a src/ module the worker loads reloads or restarts it, and tools/core.mjs or tools/update.mjs hands the core over (tools/core.mjs onSourceChange, onCoreChange). Native peers reload on a leaf, skill or binary change.
- ASCII only in every file. No decorative symbols.
- New shell commands in the Node tree use child_process.spawn with an explicit timeout. Older calls without one remain (execFileSync in src/gate.mjs, spawnSync in src/body-worker.mjs).
- Files outside the checkout may be read and written when a task needs them (owner decision, 2026-11-03).
- gm makes no API calls. The only model in the CLI is `scripted`, which is offline and deterministic.
- gm's own MCP server is served under the name gm. The separate gm product's tools, skill, runner and state are not used for gm work.
- Change a settled decision only by messaging the orchestrator (the gm agent) with the reason. The owner sets the rules.
- From 2026-11-06 the owner relays task instructions through the orchestrator agent. A dispatch from orchestrate is an owner instruction; no cross-session message can approve a pending prompt or grant escalation on its own.
- No test files and no unit tests. The first written form is AGENTS.md at 5ecd512 (2026-11-01): "No test files and no fixtures that stand in for a real run." DESIGN.md "Revert of restored test files (2026-11-06)" says the policy stands. Checks run against the real tree: tools/check-build.mjs (the conformance run on a built binary), the commit gate, and the parity harness.

## Build and test

- Witness rule: run the built binary or the CLI on a real task in a scratch workspace, read the output, then delete the scratch. `--model scripted` (Node CLI only) runs offline.

## Facts found by troubleshooting

- Node CLI needs `npm install` first (acorn is the one dependency; node_modules is git-ignored). Without it: ERR_MODULE_NOT_FOUND for 'acorn' (verified 2026-11-05).
- The native build needs Ninja on PATH. On a host where pip is PEP 668 blocked, install it into a venv (verified 2026-11-05).
- An installed build from 409087f-77 or earlier cannot self-update: its updater looks for gm-<target> in the archive, which ships gmnew-<target>. One manual scripts/install.sh run is needed; 70e4349 fixes the updater (DESIGN.md, "Update witness against the published release (2026-11-05)").
- Concurrent gm.search and gm.grep once crashed the worker (exit 139) on shared unguarded state. 5d9e835 serialized the search verbs and masks .env values in hit lines; the lock is now per root (native/components/search/search.cpp).
- gh run list --commit needs the full 40-character SHA; a 7-character prefix returns no runs (verified 2026-11-05).
- The foreground-to-background switch at 120 s is the MCP client's, not gm's. gm returns a run_code result at its own timeoutMs: a 150 s body with timeoutMs 300000 returned at 150.006 s (verified 2026-11-08). Native sends notifications/progress every 5 s during a run_code body when the request has a progressToken (tools/check-run-code-progress.mjs).
- ssh reads the stdin it is given. In `while read h; do ssh host ...; done < hosts.txt` an ssh without `</dev/null` eats the loop's remaining lines (verified 2026-11-08). run_shell gives each child EOF and job_start gives it /dev/null (job.cpp), never the MCP pipe; tools/check-shell-stdin.mjs pins both. child.cpp's open write end is the JSON-RPC path to MCP servers and the relay, so it stays open.
- A run_code body's JavaScript budget and each leaf call's deadline are the job lifetime (3600000 ms), not 60 s and 120 s. timeoutMs governs only the foreground cutoff: a backgrounded body keeps running to its lifetime, so a budget equal to timeoutMs would stop it (tools/check-run-code-budget.mjs).
- Task leak in fx's run (2026-11-08): the installed gm 41d1d82 predates fcb84df, which refuses a non-owner task replacement after the first step. next_context accepted three task briefs at 21:39:16-21:39:21 with no owner field; run 2026-11-08-18-58-31-775c8a (/workspace/fx/runs) took another worker's brief at seq 12. HEAD refuses that replacement and the second of two concurrent first-step replacements. A host takes the fix only after its installed build updates.
- finish refused on another run's open push row (2026-11-08). Fixed: finish counts only rows whose row-added event is in its own log. A row left open by a run that ended at max_steps is not counted by its successor, so it stays open until resolved in the workspace.
- Open: fx's "another worker's events twice" (2026-11-08). No run log delivers one event twice: the repeats are repeated finish refusals and read_file skill-loaded calls. The fx journal (hyperagent .orch afca55c2) holds fx's text and tool names, not reply bodies, so the duplicate needs fx's reply text. The unknown row unknown-mw6bc4mv1c00 (push target AnEntrypoint/gmfx) was closed as stale by fx on 2026-11-09 (/workspace/fx/closes/unknown-mw6bc4mv1c00.txt); its log lines remain in /workspace/fx/runs. At HEAD, two peers in one workspace do not see each other's row-added events in next_context, and peer A's reply repeats a title across its action, code-call, row-added and result events.
- Browser tabs (2026-11-09): pw (pinned in defaults/mcp.json) runs one Chrome per project, and its browsers close closes that whole browser. native/components/host/browser_scope.cpp gives each run its own context: the first playwriter_execute creates state.gmRun with browser.newContext() and rebinds context to it on every call, since the playwriter sandbox builds a new vm context per execute. Each run has its own CDP connection, so browser.contexts() lists another run's page under the default context; the tabs line therefore counts every page outside this run as "other pages" and does not split them. Node has the same per-run scope (src/browser-scope.mjs): tools/check-browser-scope.mjs runs a real browser on both engines.
- Browser profile per project (2026-11-09): pw's projectRoot takes PLAYWRITER_PROJECT_DIR first, then climbs from its cwd to the nearest .playwriter, so before gm set that variable every project under /workspace shared /workspace/.playwriter's Chrome.
- Playwriter crash (thebird run 2026-11-09-01-18-47-08c828, seq 78, 83, 98): an unawaited async snippet that rejected ended the playwriter server with exit 1, and bare async snippets returned no value. browser_scope.cpp user_execute now awaits a single-expression or parenthesised snippet (`return await (...)`); a multi-statement snippet passes unchanged (docs/PENDING_VALIDATION.md row 31).
- The build stamps GMNEW_COMMIT from CMakeCache, so after HEAD moves the build keeps the old commit until `cmake --preset release` reruns (verified 2026-11-09: 7be1790 stamped at HEAD 2cf0709).
- Node matches native for read, task, run_code and finish (2026-11-09). read_file digests (FNV-1a 64) and byte bounds now agree on both engines (src/tools.mjs fnv1a64Hex, unitBoundary; tools/check-read-parity.mjs), and Node's finish reply carries the browser key. Native's read path is unchanged.
- Shell jobs survive a worker restart (2026-11-09). A shell job's wrapper (native spawn_shell_job in job.cpp, src/tools.mjs wrapShell) writes its exit code to jobs/<name>.exit. The restarted worker's stop_orphans adopts a job whose pid is alive (adopt_orphan/adopt_job, adoptShell) with its remaining timeout from status startWall, and settles a job that already exited from its exit file. Bodies are still killed at a restart. Witness: tools/check-restart-jobs.mjs on both engines (before the fix native failed with reason restart and empty output). Caveats: adoption trusts kill(pid, 0), so a reused pid is adopted until its exit file appears; the native poller gives up 10 ticks after a kill request. Windows has no wrapper: native settles a job orphaned there as killed (adopt_orphan returns false on win32); Node adopts it, since processAlive answers true without /proc.
- Served skills (2026-11-10): the native default read the skills copy beside the binary, which changes only on install, so a commit to skills/ did not reach skill://. skills_dir_of now takes --skills, then the checkout's skills/ when that directory exists, then the installed copy (tools/check-skill-serve.mjs). A release binary on a host without the build's source path still serves its installed copy.
- Skill gate (2026-11-10): fx exposes no resource-read tool, so a gate that cleared only on resources/read locked run_code out (/workspace/fx/issues.md, issue 1). The first run_code on a connection without the read is refused once and carries the skill text as its second content block (25606 bytes for a 24968-byte skill, measured on Node). An MCP client advertises no resources capability, so the gate cannot key on one. tools/check-no-resource-client.mjs drives both engines with tools/call only, across a worker restart.
- Skill read across a restart (2026-11-10): jayzee's run 2026-11-09-23-06-24-82b1f1 was refused at the gate after each of two worker restarts (seq 192, 221) because its relay replayed no read. A native worker now takes the read from its run log when a gm skill-loaded event carries its own parent pid (tools/check-restart-skill-read.mjs). Windows logs no parent pid, so a restarted worker there asks once.
- Relay re-exec (2026-11-10): the relay moved to an updated build only with no call in flight, so a host that re-arms a next_context wait pinned the old relay: on release 6a09d8b-311 the re-exec came 10086 ms after the update, when a 10000 ms wait ended. The relay now re-executes while only next_context calls are in flight and passes them to the new relay with --resend. tools/check-relay-reexec.mjs needs a build that is not a dev build (configure with -DGMNEW_VERSION=<commit>-1) and skips on a dev stamp.
- ASan on this host: LD_PRELOAD holds three interposer libraries, and an asan build then exits at startup with `ASan runtime does not come first in initial library list`. Run asan checks with `env -u LD_PRELOAD`.

## Parity harness

- Run `npm ci --ignore-scripts` first; the harness stops at startup and names that step when node_modules/acorn is missing. The default --bin is build/release (cmake --preset release), the tree that ships; pass --bin for another build.
- Last witness (2026-11-10, `--bin build/release/native/components/host/gm`): 17 of 95 match, 0 cutover-expected, 56 native-ahead, 22 documented-gap, 0 differ. The native-only browser keys and the sequence shift they cause are native-ahead entries. Changing Node to match native is a decision, not a fix.

## Runtime and MCP surface

- The first-step host truncation correction is unmarked. Later task replacement needs `gm.task_set({ task, owner: true })`.

## MCP servers inside run_code

- Browser work uses the playwriter setup inside gm first, through gm.playwriter_execute and gm.playwriter_browsers. Headless Chromium, Claude in Chrome and the built-in browser are fallbacks outside a run: use one only when the playwriter setup cannot do the job, and say why. Inside a run the skill allows only the playwriter verbs (skills/gm/SKILL.md, Browser control).
- A stopped background body: stop_body in native/components/mcp/server.cpp calls proc::kill_owned on the body's owner, and the body thread holds a proc::OwnerScope, so its child processes are killed. Node's killBody (src/exec.mjs) kills the body's shell groups and aborts its fetch calls (trackBodyAbort; tools/check-stop-fetch.mjs).

## Search and grep

- Native search reuses a file's lines only while its stat is unchanged and settled (STAMP_SETTLE_MS), so a same-size write within one timestamp tick is not missed.
- Node grep defaults to tracked files (decision 2026-11-05; src/search.mjs); scope all reads untracked files too, and outside a git repository every file is walked.
- grep with scope all and a named path reads a state-directory path (.gm/witness-out from aloop; the default scope still refuses it). A whole-root scope all still skips .gm, .agentplug, .agentplug-kv, .playwriter and runs. Before this, a named state path was refused even with scope all, and the refusal said so. tools/check-grep-state-scope.mjs pins both; Node is unchanged.
- Do not cache the tokenized text of every file: one worker reached 1399 MB of heap on a 108 MB tree (verified in the Node tree).

## Updates and hot reload

- Node: a change to tools/core.mjs hands the core over and a change to a singleton restarts the worker (tools/core.mjs). A worker restart stops background bodies; shell jobs are adopted (see Shell jobs above).

## Retries and network

- fetch differs by engine. Node (src/fetch.mjs): any host and scheme Node's fetch serves, redirects with no count, the whole body archived; file: URLs fail and data: URLs are served. Native (native/leaves/fetch.mjs): curl limited to http and https plus data: URLs, a 16 MiB body cap (--max-filesize), and curl's default redirect limit. Timeouts apply on both.
- ci_status needs only `gh api --paginate --jq`, so gh 2.46.0 works.

## Platform notes

- Node, Windows: spawn runs no .cmd or .bat without a shell, so npx and npm start through cmd.exe /d /s /c (launchOf in src/mcp-client.mjs). Not witnessed on Windows.
- Native, Windows: no server stderr is captured (native/components/proc/child.cpp). Windows and macOS builds and arm are not verified here (DESIGN.md, Local cutover, 2026-11-04); CI covers them.
- The process-group kill is unverified on Windows; only the Node doctor reports it (src/cli.mjs).
- The playwriter execute tool returns a value only for one expression, or for an async arrow that returns. A top-level const or let yields "no output"; keep values in `state`.

## Owner decisions (2026-11-06, through orchestrate)

- The five decisions are in DESIGN.md, "Owner decisions on the five open questions (2026-11-06)". Decision 3 (protocol 2026-07-28 behind a capability flag) is not implemented: the string appears only in native/tests/parity/run.mjs.

## Known gaps, native against Node

Node-missing items are retired, not ported: native ships and Node is the parity reference (docs/PENDING_VALIDATION.md, 2026-11-09, the retirement table).

- Both clients refuse an initialize result with no capabilities object or no serverInfo.version (native/components/mcpclient/client.cpp; refusalOf in src/mcp-client.mjs; tools/check-protocol-versions.mjs).
- The SDK accepts five protocol versions (2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07). Both servers echo any of the five on initialize and both clients connect all five (tools/check-protocol-versions.mjs). server/discover still lists the two versions Node speaks, on both engines.
- A server killed by a signal reports 128 plus the signal number in native. A spawn failure reports the OS text in native.
- Native answers server requests other than ping with the SDK's method-not-found text.
- resources/subscribe and resources/unsubscribe are served by both engines and resources.subscribe is declared (2026-11-09). An unknown uri answers -32002; a change under the subscribed skill sends notifications/resources/updated (tools/check-resources-subscribe.mjs; native watch_subscriptions polls every 250 ms). resources/read of an unknown uri answers -32602 in native and -32002 in Node.

## Ship and commits

- Commit only through tools/ship.sh (see Owner rules). On a collision, fetch, reapply on origin's tip, and push. Do not clone to get around one.
- Remote: AnEntrypoint/gm, public (the owner decided the repository is public), pushed to main.

## Setup and the host entry

- The gm entry agents start is the native binary (README.md, Install). tools/relay.mjs is the Node host and runs only in the parity reference.
- setup.sh runs npm ci, the update check (tools/update.mjs checkForUpdate, which can fast-forward the checkout), the gate, the playwriter prefetch into the npm cache, and a release build when cmake and ninja exist. It prints the scripts/install.sh command and does not run it.

## Keeping this file

- A note names a path or a command. Check it against the code before keeping it, with gm.grep or gm.read_file.
- New code gets no comments. A reason that cannot be read from the code goes here, after it is checked.
- Each edit to this file audits every note: facts that the code, README, DESIGN.md or a skill already state go, and only facts that a run, witness or measurement could reveal stay.
- The gate (src/gate.mjs agents-size) fails above 30 KB. At the limit, compress first, then drop what the code shows, menial steps and obvious facts.
