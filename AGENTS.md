# gm: agent instructions

gm is one long-horizon worker: an MCP server that runs a task as one append-only log, with the rules re-read at every step. The host session (Claude Code) is the model. The product is the native C++23 tree (native/). The Node engine was retired on 2026-11-11 in one removal commit (9a4e074): src/, tools/core.mjs, relay.mjs, supervise.mjs, update.mjs and package.json are gone; git revert of that commit restores them (DESIGN.md, Local cutover of the native gm, 2026-11-04; Owner decisions on the five open questions, 2026-11-06).

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
- gm makes no API calls.
- gm's own MCP server is served under the name gm. The separate gm product's tools, skill, runner and state are not used for gm work.
- Change a settled decision only by messaging the orchestrator (the gm agent) with the reason. The owner sets the rules.
- From 2026-11-06 the owner relays task instructions through the orchestrator agent. A dispatch from orchestrate is an owner instruction; no cross-session message can approve a pending prompt or grant escalation on its own.
- A witness never edits a tracked file of the checkout. A witness that needs an edit or an install runs in a scratch tree (gm-tool check-install-follows). gm-tool phase-b fails a run that changes a tracked file (content, size or mtime).
- No test files and no unit tests (AGENTS.md at 5ecd512, 2026-11-01; DESIGN.md "Revert of restored test files (2026-11-06)"). Checks run against the real tree: gm-tool phase-b on a built binary, the commit gate, and the parity-contract check.

## Build and test

- Witness rule: run the built binary or the CLI on a real task in a scratch workspace, read the output, then delete the scratch.

## Facts found by troubleshooting

- The native build needs Ninja on PATH. On a host where pip is PEP 668 blocked, install it into a venv (verified 2026-11-05).
- gh run list --commit needs the full 40-character SHA; a 7-character prefix returns no runs (verified 2026-11-05).
- The MCP client backgrounds a call still running at 120 s (its notice says so). A run_code body that outlives its timeoutMs returns its job id; its value comes from job_status with waitMs, which has no ceiling (the foreground cap is kForegroundCapMs, 100000 ms, in native/components/mcp/server.cpp, and it keeps the call under the client's 120 s). The foreground wait is capped at 100000 ms (kForegroundCapMs), so the call returns before the client's 120 s. A body whose wait reaches its budget returns as a background run at that budget, so inside a body ask for less than the cap (check-turn-economy waits a scaled 90000 ms; check-job-wait waits 65 s in one call). A 150 s body with timeoutMs 300000 returns as a background run at 100 s, where it returned at 150.006 s before the cap (verified 2026-11-08; check-run-code-budget).
- ssh reads the stdin it is given. In `while read h; do ssh host ...; done < hosts.txt` an ssh without `</dev/null` eats the loop's remaining lines (verified 2026-11-08). run_shell gives each child EOF and job_start gives it /dev/null (native/components/verbs/job.cpp); gm-tool check-shell-stdin pins both. child.cpp's open write end is the JSON-RPC path to MCP servers and the relay, so it stays open.
- run_shell reaps its command when the shell exits: after the shell's exit the command's process group gets SIGKILL, so a background child with redirected output does not outlive the call (native/components/proc/proc.cpp, shell only; proc::run keeps its children, which the browser checks use to start servers). A command killed by a signal reports exitCode null and its signal name (measured 2026-11-12). Witness: gm-tool check-run-child-reap. The reap is POSIX only.
- A run_code body's JavaScript budget is the job lifetime, unset by default, so a body has no budget unless --job-lifetime-ms is given (zero means none, native/components/quickjs/engine.cpp); a leaf call outside a body has leaf_call_deadline, 3600000 ms (native/components/quickjs/leaves.cpp). timeoutMs governs only the foreground cutoff: a backgrounded body keeps running to its lifetime, so a budget equal to timeoutMs would stop it (gm-tool check-run-code-budget). Time in host calls does not count against it (gm-tool check-run-code-lifetime).
- Task leak (fx's run, 2026-11-08): the installed gm 41d1d82 predates fcb84df, which refuses a non-owner task replacement after the first step. Until the installed build updates, a host can take another worker's task brief; HEAD refuses it.
- Two gm serve processes in one workspace: the default run directory is runs/check, which a live connection owns, so the second is refused as belonging to another live connection. A second connection needs its own --run-dir (check-browser-scope does this, 2026-11-12).
- Open: fx's "another worker's events twice". No run log delivers one event twice; the repeats are repeated finish refusals and read_file skill-loaded calls. The duplicate needs fx's reply text. At HEAD, two peers in one workspace do not see each other's row-added events in next_context.
- Browser contexts: a run's pages and the project page live in the browser's default context (native/components/host/browser_scope.cpp). A context made with browser.newContext() is created with disposeOnDetach (playwright-core under the playwriter pin, lib/server/chromium/crBrowser.js), so Chrome disposes it when the connection that made it closes, and a gate SIGKILL closes that connection. Scenario 2 of check-browser-first-open passes on the pin a41c6af with pw's patch, and on f26b5ce without it.
- The gate stops Chrome when no lease is held and no caller page is open for GRACE_MS (5 s, pw/bin/playwriter-project). The executor then keeps its dead browser object (pw's executor.js ensureConnection checks isConnected only in headless mode), so the next call fails in the wrapper's recovery. The wrapper throws gm-browser-gone-before-body before the body runs, and the host resends that call up to five times with backoff (browser_scope.cpp user_execute). A body that already ran is never resent.
- Browser ownership (2026-11-19): a tab's owner is its run: runs/<run>/browser-pages.txt holds "owner <pid> <start>" then the target ids the run opened through its context view, and the run id is the directory name. browser_tabs lists this run's tabs by targetId and counts other runs' tabs with their run id, pid and running state (check-browser-tabs-owner). browser_close_tab closes one of this run's tabs by targetId and refuses others. Each playwriter_execute reports its own tab ids at start and end. Raw browser.newPage() calls are not recorded. Raw playwriter_execute code still reaches every page through context.pages() and browser.contexts(); browser_close_run on a restarted serve of the same run closes a dead executor's pages (check-browser-dead-executor).
- Kill identity (2026-11-13): check-browser-scope stops only the processes its own serve started, by pid and start time (serve_tree, stop_owned; witness check-browser-scope-identity). A search of the process table for the home path is not a kill root, because a foreign process that mentions the path would be stopped (docs/PENDING_VALIDATION.md, round 2026-11-13, Item 2).
- Killing from a shell (2026-11-19): a loop that SIGTERMs every process whose command line holds a path also SIGTERMs the shell that runs it, when the path is written literally in that shell's command. The harness then reports "Exit code 144" and the rest of the command does not run (reproduced 2026-11-13 and 2026-11-19; docs/PENDING_VALIDATION.md, eleventh stretch). Kill by the recorded pid and start time, skip $$, and match on the first word's basename (the rule chromium_command applies), never on a substring of the command line.
- The build stamp: cmake/gmnew_stamp.cmake runs on every build (the gmnew_stamp target; usage: cmake -DSOURCE_DIR=<tree> -DOUTPUT=<header> [-DOVERRIDE=<version>] -P gmnew_stamp.cmake) and hashes the tree the build compiles: HEAD read into a temporary index, the working native and defaults trees staged over it, then git write-tree. The repo index is not touched, so a dirty tree has its own stamp and a build made before a commit keeps the stamp of what it compiled. It writes the stamp into gmnew/gmnew_build_info.hpp only when it changes. A stamp is `<tree12>-dev`, so a change to docs, tests or skills keeps it. A stamp is replaced only when GMNEW_VERSION is the short HEAD sha, or starts with it and a dash; `-DGMNEW_VERSION=<sha>-1` is the CI shape. gm-tool installed and gm-tool ship run gm --version on the built binary (native/components/tool/installed.cpp, ship.cpp).
- Body children at a restart (2026-11-10): proc records each body child's pid and start time in jobs/body-<action>.pids, and a restart reaps every .pids ledger by pid, skipping a pid whose start time changed. A foreground body's shell and sleep survived a restart before this; check-body-reap SIGKILLs a worker mid-body and requires the next serve to reap both.
- Shell jobs survive a worker restart (2026-11-09). A shell job's wrapper writes its exit code to jobs/<name>.exit; the restarted worker adopts a job whose pid is alive, with its remaining timeout, and settles a job that already exited from its exit file. Bodies are still killed at a restart. Witness: gm-tool check-restart-jobs. Caveats: adoption trusts kill(pid, 0), so a reused pid is adopted until its exit file appears; the poller gives up 10 ticks after a kill request. Windows has no wrapper: native settles such a job as killed.
- Skill gate (2026-11-10; dispatcher decision 2026-11-12): fx exposes no resource-read tool, so a gate that cleared only on resources/read locked run_code out (/workspace/fx/issues.md, issue 1). Every run_code on a connection that has not read the gm skill is refused on every call; no refusal credits the read. The refusal is one line. It names the reads that clear the gate (resources/read, ReadMcpResourceTool with server gm, the gm prompt) and the skill's path on disk (SkillFile.disk, set in native/components/mcp/skills.cpp) as a pointer to the rules, and says that a host's own file read of that path does not clear the gate. An MCP client advertises no resources capability, so the gate cannot key on one (gm-tool check-no-resource-client).
- Known limit (dispatcher decision, 2026-11-12): hosts without resource reads are out of scope. A host's file read does not clear the gate: gm cannot observe it, and every peer here reads resources. Such a host can open the path the refusal names, but every run_code is still refused.
- Skill read across a restart (2026-11-10): a native worker takes the read from its run log when a gm skill-loaded event carries its own parent pid (gm-tool check-restart-skill-read). Windows logs no parent pid, so a restarted worker there asks once.
- Relay re-exec (2026-11-10): on release 6a09d8b-311 the relay re-executed 10086 ms after an update, because a host held a next_context wait for 10000 ms and the relay moved only with no call in flight. The relay now re-executes while only next_context calls are in flight and passes them to the new relay with --resend (gm-tool check-relay-reexec skips on a dev stamp).
- check-relay-reexec, hosted x64 Linux (2026-11-12): one failure, "the relay re-executed only after the next_context wait had answered" (13.7 s); arm64 Linux passed. On a release stamp here (73ccd2c-1) it passed 3 times (re-exec 20 to 200 ms after the update, the wait answered once at 1625 to 2027 ms, after the re-exec). The cause is not known. Ruled out: a supervised worker's reply on stdin close (a gm-core worker with a 45 s next_context wait open gave no reply within 8 s of EOF in 3 of 3 probes, 2026-11-12); four concurrent local runs on the committed code (re-exec 40 to 140 ms after the update, the wait answered at 2613 to 3117 ms) did not fail. The failure now names the reply that answered the wait, which settles it on the next hosted failure.
- check-build-handover (2026-11-13): its relays run with GMNEW_AUTO_UPDATE=0, so the check never downloads. A build whose commit is not the published release starts a release download when auto-update is on; before 2026-11-13 the install pointer was read only between update passes, so a hand-over waited up to 900 s. The relay now reads the pointer on its own thread (watch_install_loop) and cancels an in-flight download before it re-executes (check-handover-in-flight: ok in 4.4 s on the fix; on the same stamp with the pre-fix host code, 4 failures, no re-exec, download alive).
- Update order (2026-11-13): when the running build and the published asset both carry a commit time (unix seconds; `gm --version` prints it after the commit id, and gm-tool release-manifest writes `committed` from git log), the older commit is kept and the other is taken. Otherwise a running build with serial 1 (a local -1 build) or with no numeric serial refuses the published build with status "refused ...: cannot be ordered against this build"; other builds compare serials. check-update-order (about 0.4 s) witnesses four legs: older kept, equal and newer taken, no commit time refused. Its serials run against commit order, so a serial-only ordering (3971b52) fails all four legs; a build that prints no commit time gets its time from git.
- Install re-exec waits for every call but next_context (2026-11-13): a pw host's job_status wait of 90 s held the re-exec of an install for 55 s, and the re-exec followed 0.27 s after the answer (the pw run log restart event). The relay's say lines reach the host log only at startup, so the run log's restart event is the record of when a relay moved.
- Body jobs and re-exec (2026-11-13): the worker sends gm/bodies with the count of background body jobs when one starts or ends (publish_bodies, native/components/mcp/server.cpp). A relay built with this gate holds an install-pointer re-exec while the count is above 0 and says so once. A relay built before it re-execs at once and kills any body still running, so check the live workers for running bodies before an install. check-body-reexec witnesses the hold and the re-exec at the body's end.
- Relay check offers (2026-11-13): check-relay-reexec and check-handover-in-flight offer versions ffff111-9999999999 and ffff222-9999999999 with a commit time of 4102444800 (2100-01-01), so a CI serial cannot pass them. phase-b fails a row whose output reads "ok (skipped (" unless the skip is for a platform, so a gating row that a dev-stamp build skips cannot pass the set; build the set with -DGMNEW_VERSION=<sha>-1. clock-mutations is outside the default set (GM_CHECK_MUTATIONS=1 runs it).
- check-browser-first-open discovery (2026-11-12): Chromium comes from PLAYWRITER_BROWSER_PATH, then /opt/google/chrome/chrome, /usr/lib/chromium/chromium.real, the macOS app bundles, or PATH; the check passes it, with PLAYWRITER_IDLE_MS=20000, to the launcher and its sessions. Hosted CI sets PLAYWRITER_BROWSER_PATH to Playwright's Chromium, which stays up after its last page closes, so the default 300000 ms start hold kept it past the 60 s release window. Reproduced here with a wrapper that adds --no-startup-window: unfixed "browser was not released" in 114.4 s; fixed, ok in 64.9 s; default discovery ok in 56.0 s.
- ASan on this host: LD_PRELOAD holds three interposer libraries, and an asan build then exits at startup with `ASan runtime does not come first in initial library list`. Run asan checks with `env -u LD_PRELOAD`. On the arm64 asan build, ASan's stack use-after-return detector (fake stacks) costs about 4 s per run_code (3757899: 4254 ms back-to-back with it on, 25 ms with detect_stack_use_after_return=0). The asan-arm job runs with the detector off, so its timing budget is real; asan-arm-stackuse runs the same checks with the detector on, so that coverage is kept. Turning the detector off loses its use-after-return reports on that job, which asan-arm-stackuse still runs.
- WebGPU in a playwriter headless session (pw d81a22d, PLAYWRITER_CHROMIUM_ARGS): with /dev/nvidia0 present, /usr/local/bin/chrome is a wrapper that drops --use-angle and --use-gl and adds --use-angle=gl, so no flag set gave an adapter through it. With PLAYWRITER_BROWSER_PATH=/usr/bin/chromium and PLAYWRITER_CHROMIUM_ARGS=["--enable-unsafe-webgpu","--enable-features=Vulkan","--use-vulkan=swiftshader","--enable-unsafe-swiftshader"], navigator.gpu.requestAdapter() returned an adapter (measured 2026-11-16 on a localhost page, which is a secure context; about:blank has no navigator.gpu).
- A body's load-error frame (2026-11-10): the vendored quickjs-ng (7b5f588) prints `at <anonymous> (<body>:L:C)`, where QuickJS-NG printed `at <body>:L:C`. load_error in native/components/quickjs/runcode.cpp matches `<body>:`; the parity row `run_code syntax error` checks the line (DESIGN.md, "Embedded txiki.js runtime (2026-11-10)").
- A gm relay stopped by a termination signal prints the signal and then tears its worker down before it exits (check-serve-signal-reason, check-relay-hup-gate), so the worker's MCP servers and their playwriter gate release; a second signal, a crash signal or SIGKILL exits at once. A host connects to `gm serve` over stdio only: no port or socket is involved.
- Do not cache the tokenized text of every file: one worker reached 1399 MB of heap on a 108 MB tree.

## Parity harness

- The 97-row count, measured 2026-11-12: 20 of 97 match, 0 cutover-expected, 52 native-ahead, 15 documented-gap, 10 differ. It runs the pre-removal harness (native/tests/parity/run.mjs at 9a4e074^) in a scratch tree against the native build. The command, its setup and the 91d4fab record it replaces are in docs/PENDING_VALIDATION.md, round 2026-11-12. The Node engine is removed, so the 97 rows are not a gate.
- The native witness is the parity-contract check (gm-tool check <binary> parity-contract; 18 of 18 witnesses on 2026-11-12). It does not use Node and does not count the 97 rows. The native-only keys and the sequence shifts they cause are native-ahead entries.

## Known gaps, native

- Node-missing items are retired, not ported: native ships; the Node engine was removed 2026-11-11 (docs/PENDING_VALIDATION.md, 2026-11-09, the retirement table).
- The native client refuses an initialize result with no capabilities object or no serverInfo (native/components/mcpclient/client.cpp:326-327; gm-tool check-protocol-versions).
- The SDK (native/third_party/cxxmcp/include/cxxmcp/protocol/serialization.hpp) lists six protocol versions: 2024-11-05, 2025-03-26, 2025-06-18, 2025-11-25, 2026-07-28 and DRAFT-2026-v1. The native server accepts five on initialize (2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07; kAcceptedVersions in native/components/mcp/server.cpp), and server/discover lists two (2025-11-25 and 2025-06-18; kSupportedVersions). With `--protocol-2026-07-28 on` (off by default) both also take 2026-07-28 (kFlaggedVersion), and an unknown version still answers 2025-11-25 (check-protocol-flag).
- Native answers an unknown request method with JSON-RPC error -32601 (measured 2026-11-12: "method not found: nonexistent/method").
- resources/subscribe and resources/unsubscribe are served, and resources.subscribe is declared (check-resources-subscribe). An unknown uri answers -32002 (measured 2026-11-12 on resources/read: "resource not found", with data.uri; decided 2026-11-10 for resources/read, skills/get and subscriptions/listen).
- fetch (native/components/verbs/fetch.cpp): check-fetch (ok, 6.4 s on 2026-11-12) witnesses data URLs (text, cut and match), refuses base64 data URLs and invalid input, rejects timeoutMs below 1 (no upper bound; the timeout is unset by default), and retries an unreachable http host 3 times before it reports exhaustion. check-fetch-transport (17a9571) witnesses https with a local certificate, a 3-hop redirect chain, a 31-hop loop refused as ETOOMANYREDIRECTS (kMaxRedirects 30), a 16777216-byte body accepted and a larger one refused as EFBIG, and file: refused.

## Platform notes

- Windows, macOS and arm64 builds are not verified here. Measured 2026-11-12: this host is Linux x86_64, and no Windows, macOS, arm64 or clang toolchain is on PATH (x86_64-w64-mingw32-g++, aarch64-linux-gnu-g++, xcrun and clang++ are all absent). Hosted CI builds them: .github/workflows/release.yml has windows- and macos- runners, and gh run list shows its runs.
- The process-group kill is unverified on Windows.
- Install writes no harness settings file (2026-11-12, owner decision): gm install and gm uninstall take no --config, and they print the server entry and the files they touched under ~/.gmnew. The earlier registration wrote ~/.claude.json and printed a Claude Stop-hook entry; both were Claude-specific, so they went. Witness: check-cli-flags.
- Turn-end release is an MCP event (2026-11-12, owner decision): ServerOptions::release_leases(reason, run_end) releases every idle lazy MCP server when a run ends (mcp/server.cpp end_run, reason "released when the run ended", run_end true) and when the transport closes (input_ended, reason "released when the session closed", run_end false). A server whose config sets releaseAtRunEnd false is kept across a run end and released at session close only: defaults/mcp.json sets it for playwriter, because Chrome disposes the contexts a connection made when the connection closes, and a run end that closed it closed other runs' side contexts (check-browser-scope, 2026-11-12). The Stop-hook path (gm turn-end, a marker under ~/.gmnew/turn-end, --release-at-turn-end) is gone, because a Stop hook exists only in Claude Code. Witness: check-turn-end-release, which checks each reason in the run log.
- A pid ledger line is killed only when its recorded start time is positive and equals the process's current start time (proc.cpp reap_ledger). A line with unknown identity, or a reused pid, survives. Witness: check-reap-identity.
- check-lazy-browser kills only the processes it started, by pid and start time. A gate that another project started survives it (witness: check-lazy-browser).
- The playwriter execute tool returns a value only for one expression, or for an async arrow that returns. A top-level const or let yields "no output"; keep values in `state`.

## Owner decisions (2026-11-06, through orchestrate)

- The five decisions are in DESIGN.md, "Owner decisions on the five open questions (2026-11-06)". Decision 3 (protocol 2026-07-28 behind a capability flag) is built as the serve flag `--protocol-2026-07-28 on|off`, off by default (aecbd8c, 2026-11-17); it stays off by default until a client test exists. The 2026-11-10 decision to follow native applies the 2026-07-28 result fields: ttlMs and cacheScope on list, discover and read results. resources/list, and resources/read of a skill file or a run log, are volatile (ttlMs 0); server/discover, tools/list, prompts/list and resources/templates/list carry ttlMs 3600000 and cacheScope "public" (owner decision 2026-11-11).

## Ship and commits

- Commit only through gm-tool ship (see Owner rules). On a collision, fetch, reapply on origin's tip, and push. Do not clone to get around one.

## Keeping this file

- A note names a path or a command. Check it against the code before keeping it, with gm.grep or gm.read_file.
- New code gets no comments. A reason that cannot be read from the code goes here, after it is checked.
- Each edit to this file audits every note: facts that the code, README, DESIGN.md or a skill already state go, and only facts that a run, witness or measurement could reveal stay.
- The gate (gm-tool gate, agents-size) fails above 30 KB. At the limit, compress first, then drop what the code shows, menial steps and obvious facts.

## Vendored txiki notes (moved from source comments)

These notes were in comments in native/third_party/txiki/txiki/src and were moved here when the comments were swept (invariant 2). Each was checked against the code when it was moved.

### mod_channel.c

- The file is the in-process transport for MessagePort, MessageChannel and BroadcastChannel: it provides cross-thread wakeups and structured-clone (de)serialization, while the Web API shape is implemented in JS rather than here.
- Messages are serialized with JS_WriteObject2, whose buffer is js_malloc'd in the sender runtime, so channel_msg_build copies the bytes into tjs__malloc storage and frees the original because a message may be freed on the receiving thread.
- Payloads are deserialized with JS_ReadObject2 only in the owner's context (port_dispatch_one and broadcast_dispatch_one).
- Each SharedArrayBuffer is tjs__sab_dup'd when a message is produced and released by channel_msg_free for every message, delivered or dropped, while the read path takes its own dups for the reconstructed buffers.
- channel_msg_dup copies no transferred ports, because only one endpoint may receive a given port.
- port_post drops a message that transfers a port whose receive mailbox is the destination itself, because that mailbox would have no remaining owner to drain it and the message would leak.
- Cross-thread access is limited to the mailbox message list and receiving_port, which are only touched under the mailbox lock, while port state and recv_mb are changed only on the owning loop thread.
- tjs_port_postmessage refuses the whole transfer when any buffer is immutable, before any port moves, because JS_DetachArrayBuffer ignores the immutable flag and would free memory that a pending native write still reads.
- tjs_port_postmessage reads the port and buffer values into a snapshot before the immutability check and the detach, and runs no JS between them, so a getter cannot pin a buffer that is about to be detached.
- tjs_port_postmessage allocates the transfer list before moving any port, so an allocation failure cannot strand a half-transferred port.
- port_build_ports on allocation failure leaves the ports on the message so channel_msg_free reclaims them, and delivers with an empty port list.
- port_dispatch_one delivers a bare messageerror when the payload cannot be reconstructed, discarding the underlying exception because MessageEvent has no field for it.
- port_dispatch_one is only reached for started ports, since an unstarted port has no receiving_port and its async is only signalled once tjs_port_start has set one.
- tjs_port_start wakes the async once after becoming the owner so that messages buffered before start() are flushed, and an empty wake is harmless.
- tjs_port_finalizer always closes the async handle because it is created in the constructor, and the struct is freed in the close callback.
- tjs_new_port creates its async unreferenced so an unstarted port does not keep the loop alive, and its only failure paths occur before the mailbox refs are taken.
- tjs_new_port_from_ref takes its own refs before dropping the refs carried by the message, and destroys the channel if wrapping fails so it does not leak.
- tjs_channel_new throws out-of-memory itself because mailbox_new sets no JS exception.
- mailbox_close clears receiving_port and drains buffered messages under one lock hold, then frees them outside the lock because freeing a message can close other mailboxes.
- mailbox_destroy runs only at refcount zero, so it can drop buffered messages without taking the lock.
- port_ref_destroy closes the receive side so the former peer's sends are dropped.
- channel_msg_release_sabs is idempotent: it clears the SAB list and count after releasing them.
- tjs__channel_mailbox_pair gives each mailbox a reserved ref, and worker.c releases them with tjs__channel_mailbox_unref once both sides are wrapped.
- tjs__channel_port_unref leaves a worker-channel port started, so posts to a closed peer are dropped rather than thrown.
- tjs__channel_port_post_error is best-effort and swallows its own failures so that it never masks the original error.
- tjs__channel_port_close disentangles a worker-channel port so the loop can exit on terminate, and leaves the handle valid for the finalizer.
- broadcast_new leaves its async unreferenced so an open BroadcastChannel does not keep the loop alive, and buffered messages are still delivered while the loop runs for other reasons.
- broadcast_do_close takes broadcast_registry_lock itself, so callers must not hold it.
- tjs_broadcast_finalizer frees the struct with tjs__free because broadcast_async_close_cb can run after the runtime is torn down.
- tjs_broadcast_postmessage serializes once and enqueues an independent copy per target, skipping a target whose copy cannot be allocated so that no message is delivered without matching SAB dups.

### vm.c

vm.c:93 The 64-bit ref_count at the start of TJSSABHeader keeps buf 8-byte aligned, as 8-byte typed arrays require.
vm.c:175 tjs__js_post_worker_error (exposed to JS as postWorkerError) forwards the error through tjs__worker_post_error, which returns at once on the main thread.
vm.c:188 The draining_microtasks flag makes a nested drain return early, which prevents unbounded JS_ExecutePendingJob nesting when a microtask dispatches another event.
vm.c:389 dispatch_event_func is set to undefined at the start of TJS_FreeRuntime, so tjs__dispatch_event becomes a no-op during teardown.
vm.c:405 error_event_ctor is cleared at the start of TJS_FreeRuntime, so tjs__worker_handle_uncaught returns without dispatching once teardown has begun.
vm.c:411 The worker-scope error event is created cancelable, so a self.onerror handler that calls preventDefault() stops the error from being forwarded to the parent.
vm.c:455 uv__maybe_idle starts the idle handle while rejections are pending, so the loop runs another iteration and the check phase can dispatch unhandledrejection from inside a libuv callback.
vm.c:485 Rejections are recorded and only processed after microtasks drain, so a rejection handled synchronously (for example Promise.reject(x).catch(fn)) never fires an event.
vm.c:546 tjs__global_init runs through uv_once in TJS_NewRuntimeInternal, so it executes once per process and before any runtime touches mbedtls or lws.
vm.c:597 jobs.prepare runs uv__prepare_cb, which starts or stops the jobs.idle handle according to whether jobs or rejections are pending.
vm.c:601 jobs.idle is started only while jobs or rejections are pending, which stops uv_run from blocking on I/O at that point.
vm.c:605 jobs.check runs uv__check_cb, which executes pending jobs and then updates the idle handle.
vm.c:609 qrt->stop is a uv_async handle that TJS_Stop signals, which is safe from other threads.
vm.c:667 handle_pins holds the native-handle self-pins that TJS_FreeRuntime detaches and releases during teardown.
vm.c:682 The pin is detached and cleared before its reference is dropped, because that drop can finalize the wrapper synchronously and the finalizer asserts the pin is already released.
vm.c:698 After tjs__release_pins clears the pin, later releases only decrement the count, and unpinning an idle pin is a no-op because pin->obj is undefined.
vm.c:707 tjs__detach_handles runs each pin detach hook at teardown start and in every drain round, and the fswatch and process hooks begin closing their libuv handles so the close no longer depends on the GC.
vm.c:732 tjs__release_pins moves handle_pins onto a local list before releasing each entry, so a finalizer that touches handle_pins cannot disturb the traversal.
vm.c:749 tjs__lws_teardown is safe to run again, and tjs__reap_late_resources runs it on every drain round while qrt->lws.ctx is set.
vm.c:797 A worker runtime is freed on a different thread from the one that created it, so JS_UpdateStackTop re-anchors the QuickJS stack check before the drain runs JS.
vm.c:802 Handles are detached before anything else is dismantled, so no handle callback can run into a half-torn-down runtime.
vm.c:808 The rejection tracker and the dispatch and error-event builtins are cleared before the drain, so the C paths that use them become no-ops instead of running JS in a half-torn-down runtime.
vm.c:835 The keepalive handle is closed here, so ref and unref calls from a lws context recreated during the drain act on a closed handle, which libuv ignores.
vm.c:842 The lws context is destroyed before JS_FreeContext, so remaining WSI_DESTROY callbacks can still release GC references.
vm.c:846 The teardown drain runs at most 32 rounds and then stops microtasks, blocks in UV_RUN_ONCE while threadpool requests are in flight, and so makes teardown wait for running native work, which can hang if that work never finishes.
vm.c:917 qrt is freed only after JS_FreeRuntime, because finalizers run then and look up class ids through the runtime opaque.
vm.c:920 Requests left uncompleted by an abnormal exit can leave pins behind, so tjs__free_buf_pins runs after the engine is freed.
vm.c:949 The assert on lws.log_cx.refcount requires every lws object bound to the log context to have been finalized inside lws_context_destroy.
vm.c:962 The Windows invalid-parameter handler is a no-op, so CRT calls return an error instead of terminating the process.
vm.c:985 TJS_Initialize copies argv into tjs__argv because uv_setup_args only copies argv on Unix and not when its allocation fails, and runtimes created later read tjs__argv.
vm.c:1021 The Windows error mode flags suppress the WER crash dialog and the OS critical-error message box, so the CLI never blocks on GUI error dialogs.
vm.c:1074 In a worker, an uncaught error is reported to the parent and the pending exception is re-thrown so it still reaches stderr.
vm.c:1091 Rejections are deferred until microtasks drain (tjs__process_deferred_rejections) so a rejection caught synchronously never fires unhandledrejection.
vm.c:1112 If constructing the PromiseRejectionEvent throws (for example after user code overwrote a global it uses), the rejection is treated as unhandled and aborts.
vm.c:1145 In a worker, an aborting unhandled rejection also forwards its reason to the parent, because the unhandledrejection event was already dispatched at the worker global or could not be constructed.
vm.c:1183 An exception raised while dispatching beforeunload is left pending, so TJS_Run reports it and exits with an error.
vm.c:1203 The stop handle is unreferenced only in the main runtime, so a worker stays alive while the stop handle is referenced.
vm.c:1227 A fatal error leaves an exception pending, which skips beforeunload and is reported after the loop.
vm.c:1239 After beforeunload is prevented, the loop runs again only while jobs are pending or the loop is alive, otherwise uv_run would return at once and spin forever.
vm.c:1257 TJS_FreeRuntime closes stop before the drain can run JS that calls TJS_Stop, and libuv forbids sending to a closing handle, so TJS_Stop checks uv_is_closing first.
vm.c:1344 QuickJS JS_Eval needs the buffer to be NUL-terminated, so the terminator is written while the length passed to JS_Eval excludes it.
vm.c:1360 The native path is used as the module name, so import.meta and relative imports resolve as if the path were given directly.
vm.c:1381 The buffer is NUL-terminated for JS_Eval while the length passed excludes the terminator.

### mod_fs.c

The readFile worker fills a TBuf that tbuf_init(NULL, ...) leaves without a runtime, so it grows through the untracked tjs__realloc and the completion callback must copy it into a js_malloc buffer before TJS_NewUint8Array, because ArrayBuffer transfer reallocates through QuickJS malloc_state.

### mod_process.c

- tjs_process_detach begins closing the uv process handle when runtime teardown runs the TJSHandlePin detach hook (tjs__detach_handles in vm.c), so the handle closes without waiting for GC to finalize the wrapper.
- A pinned Process holds a JS reference to itself via tjs__handle_pin (which dups the object), so its finalizer can only run after the pin is released on exit or teardown, which the CHECK asserts.
- uv_spawn leaves the handle on the loop queue (uv__handle_init) even when it fails, so the failure path must uv_close the handle and let uv__close_cb free it instead of freeing it directly.

### mod_sys.c
- tjs_buffer_is_pinned: a buffer pinned by an in-flight native request is marked immutable by tjs_buf_ref_get in utils.c, and JS_DetachArrayBuffer ignores that flag and would free memory the request still reads, so tjs_detachArrayBuffer must refuse such buffers.

### private.h
- TJSHandlePin: `obj` is a GC-invisible duplicate of the handle wrapper held only while a libuv operation is in flight, and `detach` runs at the start of teardown (tjs__detach_handles in vm.c) so that lws-backed handles only clear their JS callbacks (lws closes them later in lws_context_destroy) while libuv-backed handles begin closing via maybe_close, without touching the pin itself.
- TJSReqPin: a counted self-pin held while libuv write, shutdown and send requests are in flight, kept separate from the handle read, listen and connect pin.
- lws log context (TJSRuntime.lws.log_cx): each runtime owns its own lws_log_cx_t because lws refcounts its log context without a lock (that claim is lws behaviour and is not checked in this tree), and TJS_FreeRuntime asserts its refcount is zero (vm.c), so it must outlive every lws context, vhost and wsi of that runtime.
- handle_pins: the list of TJSHandlePin self-pins that tjs__release_pins drops at teardown so the final GC can collect the wrappers and close their handles.
- buf_pins: a hash table keyed by ArrayBuffer pointer whose entries exist only while a TJSBufferRef holds a count (utils.c).
- tjs__class_register: returns 0 without re-registering when the class is already registered in this runtime, and returns -1 with a pending exception when registration fails (vm.c).
- tjs__handle_pin and tjs__handle_unpin: pinning duplicates obj and links the pin into the runtime handle_pins list only while the pin is idle, and unpinning an idle pin is a no-op (vm.c).
- tjs__req_pin_acquire: the first in-flight request pins obj, and an undefined obj is only counted without pinning (vm.c).
- tjs__req_pin_release: the last release unpins, which can finalize the wrapper synchronously, so it must be the last action of a request callback, and after tjs__release_pins releases only decrement the count (vm.c).
- tjs__detach_handles: runs each registered pin detach hook at the start of teardown and again in the late-resource reap, so no handle callback runs into a half-torn-down runtime (vm.c).
- Worker mailbox pair (tjs__channel_mailbox_pair): the parent creates two mailboxes, each with one reserved ref, wraps one side per loop as a port, and releases both reserved refs with tjs__channel_mailbox_unref once the ports exist (mod_channel.c, worker.c).
- tjs__worker_post_error: a no-op unless the runtime is a worker with a live internal_message_pipe, and it forwards an uncaught worker error to the parent (worker.c).
- tjs__worker_handle_uncaught: a no-op unless the runtime is a worker with an error_event_ctor, it dispatches a cancelable ErrorEvent on the worker global scope and forwards the error to the parent only when that event was not canceled (vm.c).
- tjs__file_url_to_path: returns a js_malloc-ed path, or NULL with a pending TypeError when the URL has an unsupported host or an empty path (modules.c).

## Vendoring txiki, quickjs-ng and libuv (shared by gm, thebird and fx)

- One pin file, one script: tools/txiki/pins.json holds the archives with their sha256, the file selections, the patches and the browser-port pins; tools/txiki/vendor.mjs does the work. A consumer vendors into its own tree with node tools/txiki/vendor.mjs --target <dir>; --browser --glue <c file> adds the browser port and its generated stubs (gm and thebird); --verify rechecks a tree against its MANIFEST.sha256 without network.
- The script downloads each archive, refuses a sha256 that differs from the pin, copies the selection with non-ASCII characters in comments written as ASCII, applies the patches in order after checking each patch's sha256, and writes VERSION.txt and MANIFEST.sha256 (one sha256 per vendored file). Re-running it on the same pins reproduces the tree byte for byte; check-txiki-vendor checks that in the registry.
- tools/txiki/patches/txiki-gm.patch is every change gm made to six txiki sources (syncReadFile, setExitCode, evalInNewRealm, compileScript, extra spawn stdio, the readdir slot, and the sweep of the comments); tools/txiki/patches/quickjs-async-frame.patch gives the runtime one async frame that a promise reaction captures when it is registered and restores while it runs (JS_GetAsyncFrame, JS_SetAsyncFrame). A change to a vendored file is made as a patch in this directory with its sha256 in pins.json, never by editing the vendored file alone.
- gm's own additions to the core binding (tjs:internal/core) are in native/components/quickjs/core_extras.cpp, installed into every run_code runtime: spawnSync (blocking, over proc::run), vmCreateContext and vmRunInContext (a context whose globals sync with a sandbox object), and asyncFrame (the value that follows awaits and promise chains).
