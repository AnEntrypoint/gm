# gm: agent instructions

gm is one long-horizon worker: an MCP server that runs a task as one append-only log, with the rules re-read at every step. The host session (Claude Code) is the model. The product is the native C++23 tree (native/). The Node engine was retired on 2026-11-11 in one removal commit: src/, tools/core.mjs, relay.mjs, supervise.mjs, update.mjs and package.json are gone; git revert of that commit restores them (DESIGN.md, Local cutover of the native gm, 2026-11-04; Owner decisions on the five open questions, 2026-11-06).

## Read first

1. README.md: install, the MCP surface, the MCP client config layers, paths and limits.
2. DESIGN.md: the "## Decided" section (near line 94), then other sections by name. It is long; do not read it whole.
3. skills/dev/SKILL.md: scratch space, witnesses, commits, collisions, reporting.
4. skill://gm/SKILL.md and skill://gm-continue/SKILL.md: served by this server. Read them with read_file (a skill:// path) or ReadMcpResourceTool (server gm). Do not call them with the Skill tool.

## Owner rules

- Work on main in the shared checkout. No clones, branches or worktrees. A witness may run on a tar copy of the tree; the edit and the commit happen in the checkout.
- Commit only by explicit path with build/release/native/components/tool/gm-tool ship, author lanmower, no trailers on any commit or PR. The harness may suggest a Co-Authored-By trailer; do not add it.
- Other agents edit this checkout at the same time. Edit only your scope, and use Edit with exact text after a fresh read.
- Native peers reload on a leaf or binary change, at a step boundary; a skill change is read on the next call and restarts nothing. A peer reads its leaves, skills and defaults only from the directory of its own executable (the install, ~/.gmnew/current) and watches only that, so a checkout edit reaches a peer only through an install (gm-tool check-install-follows).
- ASCII only in every file. No decorative symbols.
- Files outside the checkout may be read and written when a task needs them (owner decision, 2026-11-03).
- gm makes no API calls. The only model in the CLI is `scripted`, which is offline and deterministic.
- gm's own MCP server is served under the name gm. The separate gm product's tools, skill, runner and state are not used for gm work.
- Change a settled decision only by messaging the orchestrator (the gm agent) with the reason. The owner sets the rules.
- From 2026-11-06 the owner relays task instructions through the orchestrator agent. A dispatch from orchestrate is an owner instruction; no cross-session message can approve a pending prompt or grant escalation on its own.
- A witness never edits a tracked file of the checkout. A witness that needs an edit or an install runs in a scratch tree (gm-tool check-install-follows). tools/check-build.mjs fails a run that changes a tracked file (content, size or mtime).
- No test files and no unit tests (AGENTS.md at 5ecd512, 2026-11-01; DESIGN.md "Revert of restored test files (2026-11-06)"). Checks run against the real tree: tools/check-build.mjs on a built binary, the commit gate, and the parity harness.

## Build and test

- Witness rule: run the built binary or the CLI on a real task in a scratch workspace, read the output, then delete the scratch.

## Facts found by troubleshooting

- The native build needs Ninja on PATH. On a host where pip is PEP 668 blocked, install it into a venv (verified 2026-11-05).
- An installed build from 409087f-77 or earlier cannot self-update: its updater looks for gm-<target> in the archive, which ships gmnew-<target>. One manual scripts/install.sh run is needed; 70e4349 fixes the updater (DESIGN.md, "Update witness against the published release (2026-11-05)").
- gh run list --commit needs the full 40-character SHA; a 7-character prefix returns no runs (verified 2026-11-05).
- The MCP client backgrounds a call still running at 120 s (its notice says so). A run_code body that outlives its timeoutMs returns its job id; hold with next_context waitMs. gm returns a run_code result at its own timeoutMs: a 150 s body with timeoutMs 300000 returned at 150.006 s (verified 2026-11-08).
- ssh reads the stdin it is given. In `while read h; do ssh host ...; done < hosts.txt` an ssh without `</dev/null` eats the loop's remaining lines (verified 2026-11-08). run_shell gives each child EOF and job_start gives it /dev/null (job.cpp), never the MCP pipe; gm-tool check-shell-stdin pins both. child.cpp's open write end is the JSON-RPC path to MCP servers and the relay, so it stays open.
- A run_code body's JavaScript budget and each leaf call's deadline are the job lifetime (3600000 ms), not 60 s and 120 s. timeoutMs governs only the foreground cutoff: a backgrounded body keeps running to its lifetime, so a budget equal to timeoutMs would stop it (gm-tool check-run-code-budget). Time in host calls does not count against it on either engine (tools/check-run-code-lifetime.mjs).
- Task leak (fx's run, 2026-11-08): the installed gm 41d1d82 predates fcb84df, which refuses a non-owner task replacement after the first step. Until the installed build updates, a host can take another worker's task brief; HEAD refuses it.
- Open: fx's "another worker's events twice". No run log delivers one event twice; the repeats are repeated finish refusals and read_file skill-loaded calls. The duplicate needs fx's reply text. At HEAD, two peers in one workspace do not see each other's row-added events in next_context.
- Browser tabs: the tabs line counts every page outside this run as "other pages", because a run's context lists other runs' pages under the default context. Splitting them needs a page-identity design (gm-tool check-browser-scope runs a real browser).
- The build stamp is computed on every build by cmake/gmnew_stamp.cmake (the always-run target gmnew_stamp): the first 12 hex digits of SHA-256 over the git tree ids of HEAD:native, HEAD:src and HEAD:defaults, written to gmnew/gmnew_build_info.hpp only when it changes. A stamp is `<tree12>-dev`, so a push that changes only docs, tests or skills keeps the stamp. A stamp is replaced only when GMNEW_VERSION starts with the short HEAD sha; `-DGMNEW_VERSION=<sha>-1` is the CI shape. gm-tool installed computes the same hash from the checkout. tools/phase-b.sh fails when the built gm --version differs from the tree's stamp.
- Body children at a restart (2026-11-10): proc::run records each body child's pid and start time in jobs/body-<action>.pids, and a restart reaps every *.pids ledger by pid, skipping a pid whose start time changed (tools/check-restart-body-orphan.mjs). A foreground body's shell and sleep survived a restart before this.
- Shell jobs survive a worker restart (2026-11-09). A shell job's wrapper writes its exit code to jobs/<name>.exit; the restarted worker adopts a job whose pid is alive, with its remaining timeout, and settles a job that already exited from its exit file. Bodies are still killed at a restart. Witness: gm-tool check-restart-jobs. Caveats: adoption trusts kill(pid, 0), so a reused pid is adopted until its exit file appears; the native poller gives up 10 ticks after a kill request. Windows has no wrapper: native settles such a job as killed, and Node adopts it.
- Skill gate (2026-11-10): fx exposes no resource-read tool, so a gate that cleared only on resources/read locked run_code out (/workspace/fx/issues.md, issue 1). The first run_code on a connection without the read is refused once and carries the skill text as its second content block, and asks for no second read. An MCP client advertises no resources capability, so the gate cannot key on one (gm-tool check-no-resource-client).
- Skill read across a restart (2026-11-10): a native worker takes the read from its run log when a gm skill-loaded event carries its own parent pid (gm-tool check-restart-skill-read). Windows logs no parent pid, so a restarted worker there asks once.
- Relay re-exec (2026-11-10): on release 6a09d8b-311 the relay re-executed 10086 ms after an update, because a host held a next_context wait for 10000 ms and the relay moved only with no call in flight. The relay now re-executes while only next_context calls are in flight and passes them to the new relay with --resend (gm-tool check-relay-reexec skips on a dev stamp).
- ASan on this host: LD_PRELOAD holds three interposer libraries, and an asan build then exits at startup with `ASan runtime does not come first in initial library list`. Run asan checks with `env -u LD_PRELOAD`.
- A body's load-error frame (2026-11-10): the vendored quickjs-ng (7b5f588) prints `at <anonymous> (<body>:L:C)`, where QuickJS-NG printed `at <body>:L:C`. load_error in native/components/quickjs/runcode.cpp matches `<body>:`; the parity row `run_code syntax error` checks the line (DESIGN.md, "Embedded txiki.js runtime (2026-11-10)").
- Do not cache the tokenized text of every file: one worker reached 1399 MB of heap on a 108 MB tree.

## Parity harness

- Last witness (2026-11-10, at 91d4fab, `--bin build/release/native/components/host/gm`): 20 of 97 match, 0 cutover-expected, 55 native-ahead, 22 documented-gap, 0 differ. The native-only keys and the sequence shifts they cause are native-ahead entries. Changing Node to match native is a decision, not a fix.

## Known gaps, native (the Node figures are in docs/PENDING_VALIDATION.md)

Node-missing items are retired, not ported: native ships; the Node engine was removed 2026-11-11 (docs/PENDING_VALIDATION.md, 2026-11-09, the retirement table).

- Both clients refuse an initialize result with no capabilities object or no serverInfo.version (native/components/mcpclient/client.cpp; gm-tool check-protocol-versions).
- The SDK accepts five protocol versions (2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07). Both servers echo any of the five on initialize and both clients connect all five (gm-tool check-protocol-versions). server/discover still lists the two versions Node speaks, on both engines.
- A server killed by a signal reports 128 plus the signal number in native. A spawn failure reports the OS text in native.
- Native answers server requests other than ping with the SDK's method-not-found text.
- resources/subscribe and resources/unsubscribe are served by both engines and resources.subscribe is declared. An unknown uri answers -32002 on both engines (resources/read, skills/get and subscriptions/listen; decided 2026-11-10).
- fetch (the fetch verb (native/components/verbs/fetch.cpp)) allows http, https and data URLs, caps the body at 16 MiB, and uses curl's default redirect limit. Timeouts apply on both.
- ci_status needs only `gh api --paginate --jq`, so gh 2.46.0 works.

## Platform notes

- Native, Windows: child.cpp does not capture server stderr under _WIN32. Windows, macOS and arm64 builds are not verified here, because this checkout has no such host (DESIGN.md, Local cutover, 2026-11-04). The txiki and libuv build on them is unbuilt for the same reason, and MSVC keeps QuickJS-NG (GMNEW_TXIKI OFF, native/components/quickjs/CMakeLists.txt). Hosted CI builds them and is not watched here.
- The process-group kill is unverified on Windows.
- The playwriter execute tool returns a value only for one expression, or for an async arrow that returns. A top-level const or let yields "no output"; keep values in `state`.

## Owner decisions (2026-11-06, through orchestrate)

- The five decisions are in DESIGN.md, "Owner decisions on the five open questions (2026-11-06)". Decision 3 (protocol 2026-07-28 behind a capability flag) is not implemented: both engines negotiate only the 2025 versions. The 2026-11-10 decision to follow native applies the 2026-07-28 result fields on both: ttlMs and cacheScope on list, discover and read results.

## Ship and commits

- Commit only through gm-tool ship (see Owner rules). On a collision, fetch, reapply on origin's tip, and push. Do not clone to get around one.

## Keeping this file

- A note names a path or a command. Check it against the code before keeping it, with gm.grep or gm.read_file.
- New code gets no comments. A reason that cannot be read from the code goes here, after it is checked.
- Each edit to this file audits every note: facts that the code, README, DESIGN.md or a skill already state go, and only facts that a run, witness or measurement could reveal stay.
- The gate (gm-tool gate, agents-size) fails above 30 KB. At the limit, compress first, then drop what the code shows, menial steps and obvious facts.
