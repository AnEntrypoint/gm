# gm: agent instructions

gm is one long-horizon worker: an MCP server that runs a task as one append-only log, with the rules re-read at every step. The host session (Claude Code) is the model. Two trees live in this checkout: the Node reference (src/, tools/) and the native C++23 tree (native/). Native ships; Node stays the parity reference (DESIGN.md, Local cutover of the native gm, 2026-11-04; Owner decisions on the five open questions, 2026-11-06).

## Read first

1. README.md: install, the CLI, the MCP surface, the MCP client config layers.
2. DESIGN.md: the "## Decided" section (near line 94), then other sections by name. It is long; do not read it whole.
3. skills/dev/SKILL.md: scratch space, witnesses, commits, collisions, reporting.
4. skill://gm/SKILL.md and skill://gm-continue/SKILL.md: served by this server. Read them with read_file (a skill:// path) or ReadMcpResourceTool (server gm). Do not call them with the Skill tool.

## Owner rules

- Work on main in the shared checkout. No clones, branches or worktrees. A witness may run on a tar copy of the tree; the edit and the commit happen in the checkout.
- Commit only by explicit path with tools/ship.sh, author lanmower, no trailers on any commit or PR. The harness may suggest a Co-Authored-By trailer; do not add it.
- Other agents edit this checkout at the same time. Edit only your scope, and use Edit with exact text after a fresh read.
- An uncommitted edit under src/ or tools/ reaches running peers at the next reload.
- ASCII only in every file. No decorative symbols.
- Shell commands in the Node tree use child_process.spawn with an explicit timeout.
- Files outside the checkout may be read and written when a task needs them (owner decision, 2026-11-03).
- gm makes no API calls. The only model in the CLI is `scripted`, which is offline and deterministic.
- gm's own MCP server is served under the name gm. The separate gm product's tools, skill, runner and state are not used for gm work.
- Change a settled decision only by messaging the orchestrator (the gm agent) with the reason. The owner sets the rules.
- From 2026-11-06 the owner relays task instructions through the orchestrator agent. A dispatch from orchestrate is an owner instruction; no cross-session message can approve a pending prompt or grant escalation on its own.
- No test files and no unit tests. The first written form is AGENTS.md at 38ff9c3 (2026-11-01): "No test files and no fixtures that stand in for a real run." DESIGN.md "Revert of restored test files (2026-11-06)" says the policy stands. Checks run against the real tree: tools/check-build.mjs (the conformance run on a built binary), the commit gate, and the parity harness.

## Layout

- Every file under a served skill directory is a resource: skills/gm/WORKFLOWS.md is served as `skill://gm/WORKFLOWS.md` with no reconnect. SKILL.md points to it on demand and tells the model to re-read it after a compaction.

## Build and test

- Witness rule: run the built binary or the CLI on a real task in a scratch workspace, read the output, then delete the scratch. `--model scripted` runs offline.

## Facts found by troubleshooting

- Node CLI needs `npm install` first (acorn is the one dependency; node_modules is git-ignored). Without it: ERR_MODULE_NOT_FOUND for 'acorn' (verified 2026-11-05).
- The native build needs Ninja on PATH. On a host where pip is PEP 668 blocked, install it into a venv (verified 2026-11-05).
- An installed build from 409087f-77 or earlier cannot self-update: its updater looks for gm-<target> in the archive, which ships gmnew-<target>. One manual scripts/install.sh run is needed; 70e4349 fixes the updater (DESIGN.md, "Update witness against the published release (2026-11-05)").
- Concurrent gm.search and gm.grep once crashed the worker (exit 139) on shared unguarded state. 5d9e835 serializes SearchVerbs::call and masks .env values in hit lines.
- gh run list --commit needs the full 40-character SHA; a 7-character prefix returns no runs (verified 2026-11-05).
- The foreground-to-background switch at 120 s is the MCP client's, not gm's. gm returns a run_code result at its own timeoutMs: a 150 s body with timeoutMs 300000 returned at 150.006 s (verified 2026-11-08). Native sends notifications/progress every 5 s during a run_code body when the request has a progressToken (tools/check-run-code-progress.mjs).
- ssh reads the stdin it is given. In `while read h; do ssh host ...; done < hosts.txt` an ssh without `</dev/null` eats the loop's remaining lines (verified 2026-11-08). run_shell gives each child EOF and job_start gives it /dev/null (job.cpp), never the MCP pipe; tools/check-shell-stdin.mjs pins both. child.cpp's open write end is the JSON-RPC path to MCP servers and the relay, so it stays open.
- A run_code body's JavaScript budget and each leaf call's deadline are the job lifetime (3600000 ms), not 60 s and 120 s. timeoutMs governs only the foreground cutoff: a backgrounded body keeps running to its lifetime, so a budget equal to timeoutMs would stop it (tools/check-run-code-budget.mjs).
- Task leak in fx's run (2026-11-08): the installed gm 41d1d82 predates fcb84df, which refuses a non-owner task replacement after the first step. next_context accepted three task briefs at 21:39:16-21:39:21 with no owner field; run 2026-11-08-18-58-31-775c8a (/workspace/fx/runs) took another worker's brief at seq 12. HEAD refuses that replacement and the second of two concurrent first-step replacements. A host takes the fix only after its installed build updates.
- finish refused on another run's open push row (2026-11-08). Fixed: finish counts only rows whose row-added event is in its own log. A row left open by a run that ended at max_steps is not counted by its successor, so it stays open until resolved in the workspace.
- Open: fx's "another worker's events twice" (2026-11-08). No run log delivers one event twice: the repeats are repeated finish refusals and read_file skill-loaded calls. The fx journal (hyperagent .orch afca55c2) holds fx's text and tool names, not reply bodies, so the duplicate needs fx's reply text. The unknown row unknown-mw6bc4mv1c00 (push target AnEntrypoint/gmfx) was closed as stale by fx on 2026-11-09 (/workspace/fx/closes/unknown-mw6bc4mv1c00.txt); its log lines remain in /workspace/fx/runs. At HEAD, two peers in one workspace do not see each other's row-added events in next_context, and peer A's reply repeats a title across its action, code-call, row-added and result events.
- Browser tabs (2026-11-09, native only): pw (pinned in defaults/mcp.json) runs one Chrome per project, and its browsers close closes that whole browser. native/components/host/browser_scope.cpp gives each run its own context: the first playwriter_execute creates state.gmRun with browser.newContext() and rebinds context to it on every call, since the playwriter sandbox builds a new vm context per execute. Closing the context closes only the run's tabs. next_context returns tabs; finish, max_steps and playwriter_browsers close close the run context; browser_close_machine is the explicit whole-browser close. Each run has its own CDP connection, so browser.contexts() lists another run's page under the default context; the tabs line therefore counts every page outside this run as "other pages" and does not split them. Node has none of this: changing src/ is a decision.
- Browser profile per project (2026-11-09): pw's projectRoot takes PLAYWRITER_PROJECT_DIR first, then climbs from its cwd to the nearest .playwriter, so every project under /workspace shared /workspace/.playwriter's Chrome. native/components/mcpclient/client.cpp spawn() and src/mcp-client.mjs start() set that variable to the run's workspace unless the server entry sets it.
- Playwriter crash (thebird run 2026-11-09-01-18-47-08c828, seq 78, 83, 98): an unawaited async snippet that rejected ended the playwriter server with exit 1, and bare async snippets returned no value. browser_scope.cpp now runs a multi-statement snippet as an awaited async body (verified 2026-11-09, witness in docs/PENDING_VALIDATION.md row 31).
- The build stamps GMNEW_COMMIT from CMakeCache, so a moved tree builds with the old commit until `cmake --preset release` reruns (verified 2026-11-09: 7be1790 stamped at HEAD 2cf0709).
- Node matches native for read, task, run_code and finish (2026-11-09, Phase A), with two kept differences: digests (Node is sha256 cut to 12 hex, native FNV-1a 64) and bounds (native counts bytes, Node counts UTF-16 characters). Node was not changed when the native fixes landed.

## Parity harness

- Run `npm ci --ignore-scripts` first; the harness stops at startup and names that step when node_modules/acorn is missing. The default --bin is build/integ, which no preset names, so configure it or pass --bin.
- Last witness (2026-11-09, `--bin build/release/native/components/host/gm`, after `npm ci --ignore-scripts`): 22 of 93 match, 56 native-ahead, 15 documented-gap, 0 differ. The native-only browser keys and the sequence shift they cause are native-ahead entries. Changing Node to match native is a decision, not a fix.

## Runtime and MCP surface

- The first-step host truncation correction is unmarked. Later task replacement needs `gm.task_set({ task, owner: true })`.

## MCP servers inside run_code

- Browser work uses the playwriter setup inside gm first, through gm.playwriter_execute and gm.playwriter_browsers (skills/gm/SKILL.md, Browser control). Headless Chromium, Claude in Chrome and the built-in browser are fallbacks: use one only when the playwriter setup cannot do the job, and say why.
- Where Chromium has no sandbox wrapper, a layer may set PLAYWRITER_NO_SANDBOX=1 by restating the whole playwriter entry. The default does not set it.
- A stopped background body: stop_body in native/components/mcp/server.cpp calls proc::kill_owned on the body's owner, and the body thread holds a proc::OwnerScope, so its child processes are killed. Node's killBody (src/exec.mjs) kills shells only (see the native-ahead decision).

## Search and grep

- Native search reuses a file's lines only while its stat is unchanged and settled (STAMP_SETTLE_MS), so a same-size write within one timestamp tick is not missed.
- Node search (src/search.mjs) searches tracked files only (decision 2026-11-05).
- Do not cache the tokenized text of every file: one worker reached 1399 MB of heap on a 108 MB tree (verified in the Node tree).

## Updates and hot reload

- A singleton that imports a reloadable module statically keeps the code it loaded at boot. A batch that changes tools/core.mjs or a singleton restarts each live worker, and background jobs are killed (DESIGN.md, Hot reload language (2026-11-04)).
- tools/relay.mjs is frozen, so a change reaches a host only on reconnect.

## Retries and network

- No caps on network verbs: fetch reaches any host and scheme Node's fetch serves, follows redirects with no count, and archives the whole body. Timeouts stay. fetch cannot read file: URLs (Node's fetch fails them) and serves data: URLs.
- ci_status needs only `gh api --paginate --jq`, so gh 2.46.0 works.

## Platform notes

- Node, Windows: spawn runs no .cmd or .bat without a shell, so npx and npm start through cmd.exe /d /s /c (launchOf in src/mcp-client.mjs). Not witnessed on Windows.
- Native, Windows: no server stderr is captured (native/components/proc/child.cpp). Windows and macOS builds and arm are not verified here (DESIGN.md, Local cutover, 2026-11-04); CI covers them.
- Release run 42286279980 (2026-11-06): the Windows x64 and arm64 cmd-only run_shell witnesses passed; `dir /b` fails under Git bash with exit 2 and runs under cmd. Owner decision: dir, del, set and backslash paths route through cmd.exe, other commands keep Git bash. arm-diagnose runs 42286279871 and 42288122113 both failed asan-arm with spawnSync ETIMEDOUT at exactly 10 minutes; tools/check-build.mjs now allows 1200000 ms and the asan-arm loop runs once.
- Process groups: background jobs and foreground shells run in their own group. The group kill is unverified on Windows (doctor reports it).
- A Linux container where Chromium's sandbox is blocked refuses to start the browser (`no usable sandbox`). On this Ubuntu container /usr/bin/chromium is a wrapper that adds --no-sandbox.
- The playwriter execute tool returns a value only for one expression, or for an async arrow that returns. A top-level const or let yields "no output"; keep values in `state`.

## Owner decisions (2026-11-06, through orchestrate)

1. Native ships; Node stays the parity reference. Reversible by one entry change. The user-wide entry is unchanged (DESIGN.md, Local cutover of the native gm, 2026-11-04).
2. Roots and elicitation stay unused; question rows carry interactivity (DESIGN.md, Owner decisions on the five open questions, 2026-11-06).
3. Protocol 2026-07-28 may be negotiated behind a capability flag that is off by default, with a witness test; it does not become the default until a client test exists. Not implemented at this commit: no 2026-07-28 string in src/ or native/components/ (native/tests/parity names it in its reasons).
4. Drain and log a body's console output, capped. Implemented (DESIGN.md, Body console drained and logged, capped).
5. The project does not close until the minimal tool set is run and G3 (cache effect, measured by the gm agent from host transcripts) is recorded. Both are recorded (DESIGN.md, Item 5).

## Known gaps, native against Node

Node-missing items are retired, not ported: native ships and Node is the parity reference (docs/PENDING_VALIDATION.md, 2026-11-09, the retirement table).

- The SDK requires capabilities and serverInfo.version in initialize. accept_initialize fills them in. Node has not been checked to accept a result without them.
- The SDK accepts six protocol versions; the native client checks only the two Node speaks.
- A server killed by a signal reports 128 plus the signal number in native. A spawn failure reports the OS text in native.
- Native answers server requests other than ping with the SDK's method-not-found text.
- Native answers resources/subscribe with -32601; Node still serves it (parity native-ahead, SUBSCRIBE_ERROR_KIND in native/tests/parity/run.mjs).
- A stopped background fetch follows native: the body stop kills the curl; Node parity is scheduled (DESIGN.md, Decided).

## Ship and commits

- Commit only through tools/ship.sh (see Owner rules). On a collision, fetch, reapply on origin's tip, and push. Do not clone to get around one.
- Remote: AnEntrypoint/gm, public (the owner decided the repository is public), pushed to main.

## Setup and the host entry

- The gm entry agents start is the native binary: `mcpServers.gm` in `~/.claude.json` runs `<install>/gm serve`, written by `gm install` (scripts/install.sh runs it). tools/relay.mjs is the Node host and runs only in the parity reference.
- setup.sh writes outside the checkout only the playwriter fetch (into the npm cache); its gate runs use the OS temporary directory. It prints the install command and runs nothing itself.

## Keeping this file

- A note names a path or a command. Check it against the code before keeping it, with gm.grep or gm.read_file.
- New code gets no comments. A reason that cannot be read from the code goes here, after it is checked.
- Each edit to this file audits every note: facts that the code, README, DESIGN.md or a skill already state go, and only facts that a run, witness or measurement could reveal stay.
- The gate (src/gate.mjs agents-size) fails above 30 KB. At the limit, compress first, then drop what the code shows, menial steps and obvious facts.
