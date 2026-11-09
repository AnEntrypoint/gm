# Pending validation

Phase A changes, not yet built, tested or witnessed. Each row names the file and the witness Phase B runs. Owner policy: no test files; witnesses run through the built binary or the CLI, and the parity harness.

| # | Commit | File | Change | Witness needed |
|---|---|---|---|---|
| 1 | Node read and artifact | src/tools.mjs | read_file with neither offset nor limit returns the whole file up to 1048576 bytes (wholeFileReply), fails above it with the byte size; skill:// reads the same way; storeArtifact writes the full redacted text and digests it; headChars and redactArtifact exported | `node src/cli.mjs` read_file on a 28800-byte file: output length 28800, truncated false; a 1200001-byte file: the over-the-cap error; parity `read_file` rows |
| 2 | Node read and artifact | src/runcode.mjs | a run_code value over 20000 chars returns its first 20000 chars inline with outputPath, totalChars, digest, offset 0, next, truncated true and a notice to read on | run_code body returning a 30010-char string: output 20000 chars, next 20000, totalChars 30010, and the paged read at offset 20000 ends with next null |
| 3 | Node task and finish | src/mcp.mjs | next_context and the child reply bound the task to 4000 characters, with taskChars, taskTruncated and taskNotice; finish counts only open rows whose row-added event is in its own run log; read_file description matches the native text | a 62889-char task: task length 4000, taskChars 62889, taskTruncated true; two runs in one workspace, the second finishes while the first has an open push row, and is not refused |
| 4 | Docs | AGENTS.md | records the fx item 3 reproduction, the task leak evidence, and the Node parity change with its remaining differences | read AGENTS.md; no code witness |
| 5 | Docs | docs/PENDING_VALIDATION.md | this list | read it |

Phase B results (2026-11-09, HEAD 2cf0709, build stamp 2cf0709): conformance 83 passed, 0 failed of 83 checks in 24 scenarios (CONFORM_EXIT=0); parity 23/93 scenarios match, 0 cutover-expected, 47 native-ahead, 23 documented-gap, 0 differ (PARITY_EXIT=0); gate {"ok":true,"failed":[]} with 13 checks; Node witnesses read, loud, outpage, artifact, taskpage, bigtask, seq, race, finishrow, isolate all as in rows 1-3; installed 37871f3-269 seq refused:true, race twoRefused:true (previous 41d1d82: refused:false).

Phase B also runs: `node tools/check-build.mjs build/release` (conformance), `node native/tests/parity/run.mjs --bin build/release/native/components/host/gm` (parity: Node changed, so the count must be re-read, not assumed), the commit gate through src/gate.mjs runGate, and the installed-build witness of the fx task refusal.

## Browser tabs and the context journal (2026-11-09, Phase A)

Phase B (2026-11-09, build stamp 0797aff, HEAD 0797aff). Rows 6-10 are built and witnessed on build/release/native/components/host/gm:

- Conformance: `node tools/check-build.mjs build/release`: 83 passed, 0 failed of 83 checks in 24 scenarios (exit 0).
- W1 (tabs closed at end): run A created RunA-one and RunA-two; finish replied browser.closedPages 2; the pw page list after finish holds only about:blank. Project B's ProjB-keep survived.
- W2 (served verb table): playwriter_browsers close from run A2 replied closedPages 1 and left run R's RunR-keep; browser_close_machine without confirm true was refused.
- W3 (next_context tabs): step 2 read "tabs: 2 in this run, safe to close on finish: [1] about:blank \"RunA-one\"; [2] about:blank \"RunA-two\""; step 3 read "tabs: unchanged, 2 in this run".
- W4 (other pages): the tabs line reads "not this run and not closable by it: N other pages". It replaced a split into "project default" and "other run", which was wrong: each run has its own CDP connection, so the other run's page is listed under the default context. Witnessed: run R with one tab and run A2 with one tab reads "1 in this run ... 2 other pages" (A2's tab and about:blank).
- J1 (journal): two next_context steps journal two context-reply events, the first with a tabs field.
- Dup (fx item): peer A's reply repeats its title within its own step's events; peer B's next_context shows none of them. Recorded in AGENTS.
- Served skill text: read_file skill://gm/SKILL.md (whole file, 19870 chars) contains "Browser control", the run context, browser_close_machine and tabs.
- Regression witnesses on the same binary: seq refused:true; race twoRefused:true; finishrow peer B finish refused:false; outpage inline 20000, next 20000, totalChars 30010, page next null; read 28800 bytes truncated false; loud over-cap error at 1200001 bytes; taskpage taskTruncated true, total 62889.
- Parity: `node native/tests/parity/run.mjs --bin build/release/native/components/host/gm`: 22/93 match, 0 cutover-expected, 56 native-ahead, 15 documented-gap, 0 differ (exit 0). The new native-only keys (tabs, browser on finish, context-reply and browser-closed event kinds, the seq and actionSeq shift they cause) are NATIVE_AHEAD entries, each with its reason.

| # | File | Change | Witness needed |
|---|---|---|---|
| 6 | native/components/host/browser_scope.cpp, browser_scope.hpp | new VerbTable decorator: playwriter_execute runs in the run's own browser context (state.gmRun, context rebound); browser_tabs lists the run's tabs with the project's other tabs counted, unchanged when nothing changed; browser_close_run closes the run context; playwriter_browsers close is run-scoped; browser_close_machine needs confirm true | W1: a run's tabs are closed when it ends (tabs listed before finish, then the finish reply browser.closedPages and the pw /json/list shows none of them); W3: next_context tabs field quoted at two steps, the second one unchanged |
| 7 | native/components/host/CMakeLists.txt | browser_scope.cpp added to gm_host | build succeeds |
| 8 | native/components/host/worker.cpp | the served verb table is BrowserScope over the composed verbs | W2 and W4 run through this path |
| 9 | native/components/mcp/server.cpp | next_context reply carries tabs; every reply body is appended as a context-reply event; finish closes the run context and logs browser-closed; a next_context at max_steps closes it too; next_context output schema lists tabs | W3; J1: the journal holds each reply body, read with query_log kind context-reply |
| 10 | skills/gm/SKILL.md | Browser control section describes the run context, tabs, finish close and browser_close_machine | the served skill text (read_file skill://gm/SKILL.md) contains the section |
| 11 | AGENTS.md | browser tabs fact; Node gap | read it |
| 12 | docs/PENDING_VALIDATION.md | this section | read it |

Node (src/) has no browser scope, no tabs field and no context-reply event. That is a recorded gap, not a fix: AGENTS says changing Node is a decision.

## Per-project browser profile and the memory rules (2026-11-09, Phase A)

Nothing here is built or witnessed yet. Phase A is code and docs only; nothing is pushed.

| # | File | Change | Witness needed |
|---|---|---|---|
| 13 | native/components/mcpclient/client.cpp | spawn() sets PLAYWRITER_PROJECT_DIR to the run's workspace (spec.workspace) for every stdio server, unless the server entry's env already sets it. pw's projectRoot reads that variable first, so each project root gets its own gate, Chrome and profile at <root>/.playwriter/browser-profile. Before: pw climbed from /workspace to /workspace/.playwriter and every project under /workspace shared one browser. | P1: two projects (two workspace dirs, each with a run) run gm.playwriter_execute; the report shows distinct profile paths (--user-data-dir), distinct browser pids (browser.pid) and distinct page sets (pages per debug port) |
| 14 | skills/gm/SKILL.md | Browser control: each project root has its own browser and profile; gm passes the workspace as PLAYWRITER_PROJECT_DIR unless the entry sets it. New "Memory rules" section: (a) a generalization is codified as a skill, (b) non-mundane project memory goes to AGENTS.md, (c) every AGENTS.md edit carries a full audit, (d) AGENTS.md stays under 30 KB in 99% of cases, memory tooling seldom needed. | the served text (read_file skill://gm/SKILL.md) contains "Memory rules" and "PLAYWRITER_PROJECT_DIR" |
| 15 | skills/gm-continue/SKILL.md | the notes step follows the memory rules in skill://gm/SKILL.md; a process lesson is codified as a skill, never left as a note | the served text contains "memory rules" |
| 16 | AGENTS.md | audit pass: lines the code, README, DESIGN.md or a skill already state are removed, after a grep confirmed each; the browser profile fact is recorded | read AGENTS.md; the audit numbers are in the commit message |
| 17 | docs/PENDING_VALIDATION.md | this section | read it |

## Four fixes from fx's run, and the profile on the Node path (2026-11-09, Phase A)

Nothing here is built or witnessed yet. Phase A is code and docs only; nothing is pushed.

| # | File | Change | Witness needed |
|---|---|---|---|
| 18 | native/components/mcp/server.cpp (owner_of, set_owner, connection_alive, adoptable, foreign_run_text, current_run_dir, boot, reopen), native/components/mcp/include/gm/mcp.hpp (ServerOptions::connection), native/components/host/serve.cpp (relay passes --owner), native/components/host/worker.cpp | defect 1: a connection adopts only an unowned run or one whose owner is dead; a foreign live run is refused with "this connection cannot continue it", with no task or events served. Before: a successor was followed with no owner check. Node (src/run.mjs, src/mcp.mjs reopen) is unchanged: a recorded gap. | W1: owner serve writes a reply; a second serve on the same run dir gets the refusal line `refused: run first belongs to another live connection; this connection cannot continue it`; a third serve on a second run dir gets ok true and run second |
| 19 | native/components/mcp/server.cpp (child_context, next_context refusal, schema text), src/mcp.mjs (childContext, replaceTask, nextContext) | defect 2: a child context may replace the run task with owner:true, under the owner's rules; an unmarked child replacement is still refused (a child cannot reach the first-step correction). Decision recorded in DESIGN.md. | W2: owner step 1; child next_context task "Build X" refused (no owner:true, after step 1) or accepted at step 1; child with owner:true task "Y" returns task "Y"; a child with a foreign run is refused |
| 20 | native/components/verbs/core_internal.hpp (jobs_ keyed by job_key), job.cpp (Job::dir, start, status, stop, settle, snapshot, stop_orphans), native/components/mcp/server.cpp (end_run calls close_jobs("run-ended")), mcp.hpp, host/worker.cpp | defect 3: a job name is unique per run; two runs may each start a job "build". finish, max_steps and stdin EOF now kill a run's running shell jobs (Node's endRun already does). | W3: run 1 job_start build "echo one", job_status output one; finish; run 2 job_start build "echo two" is ok true (before: "already exists"); job_status output two |
| 21 | README.md | the pin is pw#1488a92 (line 43 and the example at line 53), as in defaults/mcp.json; line 43 now names PLAYWRITER_PROJECT_DIR | read it |
| 22 | src/mcp-client.mjs | start() sets PLAYWRITER_PROJECT_DIR to spec.workspace unless spec.env sets it, as native does | P2: the profile witness with GM_BIN=/tmp/gmfix/nodegm passes |
| 23 | DESIGN.md (dated section, end of file) | records the four decisions; reverses 2d41445 for owner replacements | read it |
| 24 | AGENTS.md | the profile bullet says both paths set the variable; the Node gap is gone | read it |
| 25 | docs/PENDING_VALIDATION.md | this section | read it |

Still a gap: the run owner on Node (src/run.mjs currentRunDir, src/mcp.mjs reopen). AGENTS says changing Node is a decision.

### Phase B results (2026-11-09, build stamp 871a482, HEAD 871a482)

Rows 18-22 are built and witnessed on build/release/native/components/host/gm and, for row 22, on /tmp/gmfix/nodegm (the Node MCP path).

- P1 profile witness (native): `{"check":"profile-witness","distinctProfilePaths":true,"distinctBrowserPids":true,"distinctPageSets":true,"alphaOwnsOnlyAlphaPage":true,"bravoOwnsOnlyBravoPage":true}`.
- P2 profile witness (Node path, GM_BIN=/tmp/gmfix/nodegm): the same line, all five true.
- W1 run owner: a second serve on run first prints `refused: run first belongs to another live connection; this connection cannot continue it` and no "owner witness" text; a serve on run second replies ok true, run second.
- W2 child task: owner step 1 ok true; child next_context task "Build X" after step 1 refused with `refused: a task replacement after the first step needs owner:true`; child with owner:true task "Y" replies ok true, role child, task Y.
- W3 job names per run: run 1 job build "echo one" output "one\n"; finish ok; run 2 job build "echo two" started (ok true, not "already exists"); run 2 job_status output "two\n", logPath in run 2's jobs dir.
- Conformance: `conformance: 83 passed, 0 failed of 83 checks in 24 scenarios`; `check-build: gm stamp 871a482-dev (871a482)`; exit 0.
- Parity: `22/93 scenarios match, 0 cutover-expected, 56 native-ahead, 15 documented-gap, 0 differ` (exit 0).
- Existing gm witnesses on the same binary: seq refused:true; race twoRefused:true; finishrow peer B refused:false; outpage inline 20000 next 20000 totalChars 30010; read 28800 truncated false; loud over-cap error; taskpage taskTruncated true total 62889; tabs (A closed, closedPages 2, B kept); browsers; journal (2 context-reply events); dup; skill (served text holds Memory rules and PLAYWRITER_PROJECT_DIR); other (2 other pages).

### Phase B results (2026-11-09, build stamp 409c3f3, HEAD 409c3f3)

Rows 13-16 are built and witnessed on build/release/native/components/host/gm. Row 17 is this section.

- P1 (profile witness, /tmp/gmfix/profile.mjs, outside the repo): two project roots, each with a run that calls gm.playwriter_execute. Result: `{"check":"profile-witness","distinctProfilePaths":true,"distinctBrowserPids":true,"distinctPageSets":true,"alphaOwnsOnlyAlphaPage":true,"bravoOwnsOnlyBravoPage":true}`. alpha: browser pid 3716162, profile /tmp/gmfix-profile-alpha-CFGsfx/.playwriter/browser-profile, pages PROJECT-ALPHA-PAGE and about:blank. bravo: browser pid 3716673, profile /tmp/gmfix-profile-bravo-p84Cox/.playwriter/browser-profile, pages PROJECT-BRAVO-PAGE and about:blank.
- Conformance: `node tools/check-build.mjs build/release`: `conformance: 83 passed, 0 failed of 83 checks in 24 scenarios`; `check-build: gm stamp 409c3f3-dev (409c3f3)`; exit 0.
- Existing gm witnesses on the same binary, same results as the Phase B of the browser pass: seq refused:true; race twoRefused:true; finishrow peer B refused:false; outpage inline 20000, next 20000, totalChars 30010; read 28800 bytes, truncated false; loud over-cap error at 1200001 bytes; taskpage taskTruncated true, total 62889; tabs (A closed by finish, closedPages 2, B's tab kept); browsers (run-scoped close, machine close refused without confirm); journal (2 context-reply events); dup (peer B sees none of peer A's row events); skill (the served text holds Browser control, Memory rules and PLAYWRITER_PROJECT_DIR); other (2 other pages).
- Parity: `node native/tests/parity/run.mjs --bin build/release/native/components/host/gm`: 22/93 match, 0 cutover-expected, 56 native-ahead, 15 documented-gap, 0 differ (exit 0).
- Gate: the skills check failed twice before the Phase A commit (the gm skill named the verbs grep and search without gm.); both words were reworded, and tools/ship.sh committed 409c3f3 with gate exit 0. The Phase B push gate is recorded in the final report.

## AGENTS.md audit check (2026-11-09, Phase A)

Nothing here is built or witnessed; Phase A is docs only. The check covered the facts removed by the audit in 409c3f3 (about 140, read from `git show 409c3f3^:AGENTS.md`). About 137 are found in README.md, DESIGN.md, tools/, scripts/, CMakePresets.json, .github/workflows/, native/, src/ or skills/.

| # | File | Change | Witness needed |
|---|---|---|---|
| 26 | AGENTS.md, Owner rules | the test-file line now cites its sources: the earliest written form (AGENTS.md at 38ff9c3, 2026-11-01, "No test files and no fixtures that stand in for a real run") and DESIGN.md "Revert of restored test files (2026-11-06)". It replaces "Owner policy, permanent (2026-11-06)", which cited nothing. No owner message in this checkout states it verbatim; the source is the written record only. | read it |
| 27 | AGENTS.md, Layout | restored: the module roles of src/, tools/ and native/components/ are listed in git at 409c3f3^ and no current file states them | read it |
| 28 | AGENTS.md, Build and test | restored: the native steps are scripts/gm.sh build|test|doctor|all (GMNEW_PRESET), the presets are in CMakePresets.json, CI is release.yml and arm-diagnose.yml; README's Native build section is stale (ctest, GMNEW_BUILD_TESTS, which no CMake file defines) | read it |
| 29 | AGENTS.md, Facts found by troubleshooting | restored: the open fx row unknown-mw6bc4mv1c00 (push target AnEntrypoint/gmfx) is in several /workspace/fx/runs logs | read it |
| 30 | AGENTS.md, Owner decisions item 3 | corrected: "no 2026-07-28 string in src/ or native/" is now "in src/ or native/components/", because native/tests/parity/run.mjs names it in its reasons | read it |

Not restored, with the reason: "Component tests sit in <component>/tests/" (no such directories exist); "stop_locked" (the function is stop_body, already correct in the current file); "resources/subscribe answers -32601 in both servers" (Node still serves it, and the current Known-gaps line is correct); "rebuilt by the gate at 30 KB ... owner invariant 3" (CLAUDE.md invariant 3 is about concurrency; the gate enforces the limit, so the current text is enough).

Found, not changed (outside AGENTS.md): conformance counts disagree, DESIGN.md:478 says 56 checks in 22 scenarios while the binary reports 83 in 24; README's Native build section is stale (see row 28)

## Audit follow-up, the README and DESIGN defects, and the playwriter crash (2026-11-09, Phase A)

Nothing here is pushed until Phase B. Witnesses are run on build/release after the build.

| # | File | Change | Witness needed |
|---|---|---|---|
| 31 | native/components/host/browser_scope.cpp (user_execute) | defect: a snippet that starts async work, such as `(async () => { throw ... })()`, was sent to playwriter unawaited. Its rejection was unhandled in the playwriter process and ended it with exit 1; a bare async snippet returned "no output", so browser calls returned empty values. Cause: a parenthesised snippet was not treated as an expression, so gm did not `return await (...)` it. Fix: a snippet that starts with ( and ends with ) takes the same `return await (...)` form as a single expression. Multi-statement snippets still go through unchanged. Found in thebird run 2026-11-09-01-18-47-08c828: seq 78 and 98 ("exited with code 1"), seq 83 restart, seq 93 probe "no output" | W4: `playwriter_execute` with `(async () => { state.probe = 'ran'; return 'value-ok'; })()` returns "[return value] value-ok"; with `(async () => { throw new Error('probe-throw'); })()` returns an execute error and the server stays up; `String(state.probe ?? 'none')` then returns "ran" |
| 32 | native/components/host/browser_scope.cpp | the same rule for the profile witness, tabs, browsers and other witnesses: they go through the same wrapper | P1, tabs, browsers, other |
| 33 | README.md (Native build) | defect: the block named `cmake --preset release -DGMNEW_BUILD_TESTS=ON` and `ctest --test-dir ...`; no CMake file defines GMNEW_BUILD_TESTS, and no enable_testing or ctest exists. Now: cmake --preset release, cmake --build build/release, node tools/check-build.mjs build/release. scripts/gm.sh test is the build plus check-build.mjs; the no-unit-tests policy is stated | read it; scripts/gm.sh test is the same steps |
| 34 | DESIGN.md:478 (Conformance runner) | defect: the count 56 checks in 22 scenarios was copied from a report and marked not re-run. Now the runner's count is printed by tools/check-build.mjs and the line records the 2026-11-09 witness: 83 checks in 24 scenarios | conformance output below |
| 35 | AGENTS.md, Layout and Build and test | the two restorations from the audit check are removed: the code shows the module roles (file names and headers) and the build steps (scripts/gm.sh, CMakePresets.json, the workflows). The stale README sentence is gone with the README fix (row 33) | read it |
| 36 | AGENTS.md, Facts found by troubleshooting | one line for the thebird crash: the cause, the run id, the seq numbers, and the fix in row 31 | read it |
| 37 | AGENTS.md, Owner rules | the test-file line stays: its sources are AGENTS.md at 38ff9c3 (2026-11-01: "No test files and no fixtures that stand in for a real run") and DESIGN.md "Revert of restored test files (2026-11-06)"; tools/scan-unit-tests.mjs enforces the no-unit-tests part | read it |

Node gap, not fixed: src/ sends a playwriter snippet without the awaiting wrapper, so the same unawaited-rejection crash can happen on the Node path. A Node fix is a decision (AGENTS says changing Node is a decision)..

### Phase B results (2026-11-09, build stamp 9d4095c, HEAD 9d4095c)

- W4 playwriter crash witness (/tmp/gmfix/fix.mjs crash, outside the repo): `[return value] value-ok` for the bare async value snippet; the throwing snippet returns an execute error and the server stays up; `[return value] ran` for the state read after it.
- Browser witnesses on the same binary: profile-witness distinctProfilePaths, distinctBrowserPids, distinctPageSets, alphaOwnsOnlyAlphaPage, bravoOwnsOnlyBravoPage all true; tabs (A closedPages 2, B kept); browsers (run-scoped close, machine close refused without confirm); other (2 other pages); skill (served text holds Memory rules and PLAYWRITER_PROJECT_DIR).
- Conformance: `conformance: 83 passed, 0 failed of 83 checks in 24 scenarios`, `check-build: gm stamp 9d4095c-dev (9d4095c)`, exit 0.
- Gate: `{"gate":true,"failed":[]}`, exit 0.
- AGENTS.md: 14511 bytes, under 30 KB.

## Node awaiting wrapper and five peer-reported defects (2026-11-09, Phase A)

Nothing here is built or witnessed yet. Phase A is code and docs; nothing is pushed.

| # | File | Change | Witness needed |
|---|---|---|---|
| 38 | src/mcp-client.mjs (awaitedExecuteArgs, EXECUTE_VERB, TRAILING_FILLER; the call route) | Node gets native's awaiting rule for playwriter_execute: a single expression, or a snippet that starts with ( and ends with ), is sent as `return await (...)`. Other arguments unchanged. Finding: the crash did not reproduce on the pinned pw (1488a92) before the change, so this is parity with native, not a fix for an observed failure | W5: /tmp/gmfix/awaitwitness.mjs with GM_BIN=/tmp/gmfix/nodegm: the throwing snippet returns an error output and the server stays up; the value snippet returns value-ok; the state read returns ran |
| 39 | native/components/mcp/server.cpp (run_code kMaxTimeoutMs, schema text), src/runcode.mjs (MAX_TIMEOUT_MS, description) | defect: run_code refused timeoutMs above 300000, while the job cap is 3600000 (verbs.cpp:87, src/tools.mjs MAX_JOB_TIMEOUT_MS). The run_code limit now equals the job cap, read from the code. Default 180000 unchanged. The manual (docs/index.html) states the new maximum | W6: run_code with timeoutMs 400000 is accepted (before: refused with "from 1 to 300000") |
| 40 | native/components/verbs/job.cpp (settle, Job::timeout_ms, start), src/tools.mjs (killReason, finish) | defect: a job that hit its timeout ended silently. Now the status file, the job settle event and the job_status reply carry timedOut true, timeoutMs, and statement "job <name> stopped: timeout after N ms". Node: the timeout had no killReason and no job-killed event; it now has reason timeout | W7: job_start build "sleep 10" with timeoutMs 2000; job_status after 3 s: timedOut true, reason timeout, statement "job w stopped: timeout after 2000 ms" |
| 41 | native/components/verbs/verbs.cpp (store_artifact, cut_shell_output, run_shell reply), src/tools.mjs (condenseShell, cutShellOutput), src/mcp.mjs and src/prompt.mjs (run_shell description) | defect: run_shell replies were uncapped with raw:true (bounded only by the 200000-character capture), and store_artifact wrote a middle-omitted copy while reporting the full total. Now a run_shell reply carries at most 20000 characters inline (core output page), with outputPath, totalChars, digest, offset 0, next 20000, truncated true. The artifact file holds the full text. The condensed default is unchanged | W8: run_shell `cat PENDING_VALIDATION.md` (22087 bytes) in a scratch workspace: default compressed true, originalChars 22087; raw:true inline exactly 20000 characters, next 20000, totalChars 22087, file holds 22087 characters |
| 42 | native/components/verbs/job.cpp (job_status truncated), src/tools.mjs (job_status truncated) | defect found in the same review: a tail read cut at its start reported truncated false. Now truncated is from > 0 or end < total, as run_code's paging already does | covered by W7's job_status reply and a tail read (offset omitted on a job with more than one page) |
| 43 | native/components/mcp/pending.cpp (is_pending_event, enqueue_pending), native/components/mcp/internal.hpp, native/components/mcp/server.cpp (append_to, attach_job_output, context with waiting, the wait closure), src/log.mjs, src/mcp.mjs (context with waiting) | defect A: a next_context wait replayed about 23 to 25 KB of history per call. A wait that wakes with a pending event now returns a small reply: rulesPath (not the rules), pending, witness, prefixSha, total, tabs and the query fields, with no feed or older events; a non-wait call is unchanged. defect B: the job "running" event woke a wait with no output; a running job no longer counts as pending, and an exited or killed job's pending record carries its output (output, total, truncated, offset, next, logPath). Decision for the owner: a wait that wakes with an event still counts as a step, and the rules are referenced by path rather than repeated, which the AGENTS rule "rules re-read at every step" does not cover for a wait. Node: mirrored, and the Node timeout path still takes a step | W9: next_context {} then next_context {waitMs: 3000} (about 200 bytes, progress); job_start "sleep 2; echo gate-done" then next_context {waitMs: 20000}: wakes at about 2 s, output "gate-done\n", about 1 KB, no rules, task or feed fields |

Node gap, closed by row 44 in the next section: a timed-out wait on the Node path took a step and returned the full reply, where native returns progress.

### Phase B results (2026-11-09, build stamp 08286e7, code commit 08286e7)

- W5 Node awaiting (GM_BIN=/tmp/gmfix/nodegm, /tmp/gmfix/awaitwitness.mjs): throwing snippet returns an error output (`Error: probe-throw`), value snippet `[return value] value-ok`, state read `[return value] ran`, alive-after-steps true, serverExited false.
- W6 run_code limit: `run_code` with timeoutMs 400000 returns `{"ok":true,"output":"1"}`.
- W7 job timeout: `{"state":"killed","reason":"timeout","timedOut":true,"timeoutMs":2000,"statement":"job w stopped: timeout after 2000 ms","signal":"SIGTERM"}`.
- W8 run_shell cap (cat of PENDING_VALIDATION.md, 26633 characters): default `compressed` true, inline 8339 characters, `truncated` true, `totalChars` 26633, `next` 0, outputPath on disk; raw:true inline exactly 20000 characters, `next` 20000, `truncated` true, `totalChars` 26633; the artifact file holds 26633 characters.
- W9 next_context waits: quiet wait 124 bytes (progress, no step used); job wait 1144 bytes, the reply holds the gate output "gate-done", and has no rules or events fields (keys: ok, step, run, stepsLeft, maxSteps, rulesPath, witness, prefixSha, total, pendingCommands, query, jobsEnded, remaining, pending, tabs).
- Tail read (job_status with 43893 characters of output, no offset): `total` 43893, `offset` 23893, 20000 characters, `truncated` true (before the fix: false).
- Regression witnesses on the same binary: seq refused:true; race twoRefused:true; finishrow peer B refused:false; outpage inline 20000, next 20000, totalChars 30010; read 28800 bytes, truncated false; loud over-cap error; taskpage taskTruncated true, total 62889; profile-witness all true; journal, dup, browsers, tabs, skill, other as before.
- Conformance: `conformance: 83 passed, 0 failed of 83 checks in 24 scenarios`, `check-build: gm stamp 08286e7-dev (08286e7)`, exit 0.
- Parity: `22/93 scenarios match, 0 cutover-expected, 56 native-ahead, 15 documented-gap, 0 differ`, exit 0.

## Node timed-out wait returns progress; the mcp-parity brief maximum (2026-11-09, Phase A)

Nothing here is built or witnessed yet. Phase A is code and docs; nothing is pushed.

| # | File | Change | Witness needed |
|---|---|---|---|
| 44 | src/mcp.mjs (nextContext) | defect: a timed-out next_context wait on the Node path took a step and returned the full reply; native returns progress with no step. Now the wait runs inside the action, before the step is counted. A timed-out wait that started from a live run returns { ok, progress: "no event pending after N ms; no step was used, call next_context again to keep waiting", steps }. The step, the owner marker and the task replacement run after the wait, in native's order. The summarizer passes progress through | W10: a Node and a native next_context {waitMs: 3000} after step 1 return the same progress reply (same keys, same text, same steps) |
| 45 | tasks/rewrite/mcp-parity.md (item 4) | defect: the brief stated the run_code maximum as 300000. It now states 3600000, with the cause: run_code's limit was set to the job cap (native/components/mcp/server.cpp kMaxTimeoutMs, src/runcode.mjs MAX_TIMEOUT_MS), 2026-11-09 | read it |

| 46 | src/mcp.mjs (act, perform, nextContext) | defect: with the wait moved into the action, the Node action event for next_context logged the step before the count (0 on the first call), where native logs steps + 1 (native act is called with ahead 1). act and perform take an ahead offset; nextContext passes 1; the step on the action and result events is steps + ahead. The parity row next_context events[2].step (Node 0, native 1) is the witness | parity: 0 differ |

Node and native now use the same progress text and the same keys. A timed-out wait that wakes with an event still takes a step, on both paths.

### Phase B results (2026-11-09, build stamp 8b5116b, code commit 8b5116b)

- Timed-out wait (`next_context` with waitMs 3000 after step 1), native and Node: `{"ok":true,"progress":"no event pending after 3000 ms; no step was used, call next_context again to keep waiting","steps":1}`, 124 bytes each, byte-identical. Witness: /tmp/gmfix/p2.mjs wait with GM_BIN set to the release binary and to the Node wrapper.
- Job wait (gate job started with run_code, next_context waitMs 20000), native: 1143 bytes, output "gate-done\n" in both jobsEnded and pending. Node: 950 bytes, output "gate-done\n" in jobsEnded (exitCode 0); pending carries the job record without output. Documented difference, not changed: the output is delivered on both paths; the Node pending record is the one without it.
- Conformance: `conformance: 83 passed, 0 failed of 83 checks in 24 scenarios`, `check-build: gm stamp 8b5116b-dev (8b5116b)`, exit 0.
- Gate (tools/ship.sh, src/gate.mjs runGate): `{"gate":true,"failed":[]}`, `gate exit code: 0`.
- Parity: `22/93 scenarios match, 0 cutover-expected, 56 native-ahead, 15 documented-gap, 0 differ`, exit 0. The one differ from the Phase B run before row 46 (next_context events[2].step, Node 0, native 1) is gone.

## Node-missing native-ahead items: retired, not ported (2026-11-09, Phase A)

Decision: retire. The 56 native-ahead scenarios of the parity harness are Node-missing items on the Node reference. They are not ported to Node and are no longer defects.

Reading of the brief: it names native as the host that replaces Node. Its gate is the cutover, "cutover (M5, .mcp.json points at the native binary) only after the parity harness (M3) shows no diffs on the verb groups and the MCP script" (tasks/rewrite/PLAN.md, Gates line). DESIGN.md "Rewrite on deoxidene (2026-11-04)", decision 2, says Node stays the live runtime until native reaches parity and is witnessed, and that cutover is one commit that points .mcp.json at the native binary. The owner decision "Native ships; Node stays the parity reference" (AGENTS.md, owner decisions, item 1) makes Node the reference, not the shipping host. The served host is already native: the user-wide mcpServers.gm entry in /config/.claude.json runs /config/.gmnew/current/gm serve, and that binary does not spawn Node (native/components/host/serve.cpp). Parity has 0 differ (row 46 witness), so the gate holds.

Cause for every row: tasks/rewrite/PLAN.md Gates line plus AGENTS.md owner decision 1. The per-row cause is the parity harness reason (native/tests/parity/run.mjs) for the field that differs. Reversal is one decision: porting a row means reopening it here.

Kept as-is: the Node job_start default of 60000 (row 38) was an owner choice in DESIGN.md (job_status note, 2026-11-06); retirement does not change it, so the default stays 60000 on Node.

| # | scenario | differing field | cause (harness reason) |
|---|---|---|---|
| 1 | initialize | `.result.capabilities.resources.subscribe` | SUBSCRIPTIONS: native no longer advertises resources.subscribe, since subscriptions/listen replaces it; Node still advertises it |
| 2 | resources/read missing | `.error.code` | ERRCODE: native answers a missing resource with -32602 and data.uri; Node answers -32002 |
| 3 | resources/subscribe | `.result` | SUBSCRIPTIONS: native removed resources/subscribe and answers -32601; Node still serves it |
| 4 | read_file | `.result.content[0].text.output.digest` | DIGEST: native paging digests are FNV-1a 64 and Node sha256 cut to 12 hex (kept difference, AGENTS.md) |
| 5 | read_file offset | `.result.content[0].text.output.digest` | DIGEST: native paging digests are FNV-1a 64 and Node sha256 cut to 12 hex (kept difference, AGENTS.md) |
| 6 | read_file missing | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 7 | write_file | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 8 | edit_file | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 9 | edit_file no match | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 10 | stat_file | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 11 | list_dir | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 12 | run_shell | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 13 | run_shell exit | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 14 | search | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 15 | grep literal | `.result.content[0].text.output.scanCursor.fileIndex` | SCAN: native grep returns a scan cursor (fileIndex, byteOffset, scannedFiles, scannedBytes) that Node does not return |
| 16 | grep regex | `.result.content[0].text.output.scanCursor.fileIndex` | SCAN: native grep returns a scan cursor (fileIndex, byteOffset, scannedFiles, scannedBytes) that Node does not return |
| 17 | grep word | `.result.content[0].text.output.scanCursor.fileIndex` | SCAN: native grep returns a scan cursor (fileIndex, byteOffset, scannedFiles, scannedBytes) that Node does not return |
| 18 | query_log | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 19 | query_log js | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 20 | git_status | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 21 | git_log | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 22 | prd_add | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 23 | prd_list | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 24 | prd_resolve | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 25 | task_set owner | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 26 | prd_receipt | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 27 | prd_refute reopen | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 28 | query_log field | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 29 | output artifact fields | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 30 | grep fields | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 31 | next_context owner task | `.result.content[0].text.prefixSha` | SEQ: one extra resources/subscribe error shifts the native event sequence and the prefix hash |
| 32 | unknown_add | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 33 | unknown_list | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 34 | unknown_resolve | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 35 | fetch | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 36 | fetch refused | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 37 | job_start | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 38 | job_status | `.result.content[0].text.output.timeoutMs` | TIMEOUT: native job_start default is 300000; Node 60000 kept by the owner (DESIGN.md, job_status note, accepted as native-ahead) |
| 39 | job_stop | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 40 | job_status unknown | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 41 | run_code syntax error | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 42 | run_code background | `.result.content[0].text.logged[0].seq` | SEQ: native logs the extra resources/subscribe error, so background body sequence numbers are higher |
| 43 | job_status background | `.result.content[0].text.output.body` | SEQ: native logs the extra resources/subscribe error, so background body sequence numbers are higher |
| 44 | run_code background shell | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 45 | run_code write project module | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 46 | mcp initialize | `.result.capabilities.resources.subscribe` | SUBSCRIPTIONS: native no longer advertises resources.subscribe, since subscriptions/listen replaces it; Node still advertises it |
| 47 | mcp mcp echo | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 48 | mcp mcp browsers | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 49 | mcp mcp fail | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 50 | mcp mcp denied | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 51 | mcp mcp hang | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 52 | mcp mcp crash | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 53 | mcp mcp restart | `.result.content[0].text.actionSeq` | SEQ: native logs one more event than Node (the resources/subscribe error) and journals each next_context reply as a context-reply event, so its action sequence numbers are higher |
| 54 | mcp finish | `.result.content[0].text.browser` | BROWSER: native finish reports the closed run browser context; Node has no browser scope (AGENTS.md recorded gap) |
| 55 | mcp notifications | `[0]` | NOTIFY: native announces its tool list first when its MCP servers are ready; Node announces resources first |
| 56 | mcp log event kinds | `.count.context-reply` | JOURNAL: native journals each next_context reply body as a context-reply event; Node has none |

Retired by: tasks/rewrite/PLAN.md Gates line and AGENTS.md owner decision 1 for all 56 rows.

### Phase B results (2026-11-09, build stamp 251503b, code commit 251503b)

- Conformance: `conformance: 83 passed, 0 failed of 83 checks in 24 scenarios`, `check-build: gm stamp 251503b-dev (251503b)`, exit 0.
- Gate (tools/ship.sh, src/gate.mjs runGate): `{"gate":true,"failed":[]}`, `gate exit code: 0`.
- Parity before the retirement: `22/93 scenarios match, 0 cutover-expected, 56 native-ahead, 15 documented-gap, 0 differ`.
- Parity after the retirement (same tree, same harness): `22/93 scenarios match, 0 cutover-expected, 56 native-ahead, 15 documented-gap, 0 differ`. The counts do not change because no source changed and the harness classifies diffs, not retirement; the retirement is the 56-row table above.

## Native cutover of the gm entry (2026-11-09, Phase A)

Decision (owner): native ships and Node stays the parity reference. The gm entry that a new setup registers now runs the native binary. Before this change, setup.sh printed `npx add-mcp ... "node <checkout>/tools/relay.mjs" -n gm -g -a claude-code`, so a fresh install started the Node host. The live user entry in /config/.claude.json already ran `/config/.gmnew/current/gm serve` (ae4ef46-278) when this change was made; the change makes every new install do the same, and it leaves the Node host in place as the reference.

Parity gate, before the cutover: `22/93 scenarios match, 0 cutover-expected, 56 native-ahead, 15 documented-gap, 0 differ` (native/tests/parity/run.mjs, Node reference from HEAD).

| # | File | Change | Witness needed |
|---|---|---|---|
| 47 | setup.sh | step 5 prints `sh "<checkout>/scripts/install.sh"` (the native release install, which runs `gm install`) instead of the three add-mcp commands; the Node relay is no longer registered. Step 6 is the native build for the parity reference. Comments removed (AGENTS invariant 2); the facts they carried are in AGENTS.md "Setup and the host entry" | Phase B fresh install into a scratch HOME: the entry it writes launches native and answers initialize |
| 48 | README.md (install section) | the add-mcp sentence now says earlier add-mcp installs registered the Node relay, and that running the install again replaces it with the native binary | read it |
| 49 | src/registration.mjs | the INSTALL_HINT names one command (the install command setup.sh prints) instead of remove and install | gate |
| 50 | DESIGN.md "Question: is playwriter set up on every gm install" | the setup.sh sentence states what setup printed before and after the cutover | read it |
| 51 | AGENTS.md | new section "Setup and the host entry": the entry agents start is the native binary; setup writes only the playwriter fetch outside the checkout | read it |

### Phase B results (2026-11-09, build stamp dac6dab, code commit dac6dab)

- Fresh install (the command setup.sh now prints, `sh <checkout>/scripts/install.sh`, run with HOME set to an empty scratch directory): installed `gmnew ae4ef46-278 (x64-linux)`, and `gm install` wrote `mcpServers.gm = {"command": "<scratch>/.gmnew/current/gm", "args": ["serve"]}` into the scratch `.claude.json`. The scratch directory was removed afterwards.
- Launch of that entry as a fresh stdio host (command and args taken from the file, cwd a new empty workspace): the process is an x86-64 ELF; `--version` prints `ae4ef46-278 (ae4ef46)`; initialize answers serverInfo gm, protocolVersion 2025-11-25; tools/list answers the code surface `next_context`, `finish`, `run_code`.
- The live user entry in /config/.claude.json was not written by this change. It already runs `/config/.gmnew/current/gm serve`.
- Conformance: `conformance: 83 passed, 0 failed of 83 checks in 24 scenarios`, `check-build: gm stamp dac6dab-dev (dac6dab)`, exit 0.
- Gate (tools/ship.sh, src/gate.mjs runGate): `{"gate":true,"failed":[]}`, `gate exit code: 0`.
- Node-reference parity (native/tests/parity/run.mjs, Node reference from HEAD): `22/93 scenarios match, 0 cutover-expected, 56 native-ahead, 15 documented-gap, 0 differ`, exit 0. Unchanged from before the cutover, as expected: the Node host is untouched.
- Left open, not changed: /config/.gemini/settings.json and /config/.config/zed/settings.json register `node /workspace/gm-new/tools/relay.mjs` for gm. /workspace/gm-new does not exist, so those entries do not start at all. They are other hosts' configs and need the owner's decision.

## Gemini and Zed gm entries point at the native host (2026-11-09)

The "left open" note in the Phase B results above is superseded by this section.

Before: both entries ran `node /workspace/gm-new/tools/relay.mjs --mcp-config /config/.gm-new/mcp.json`. /workspace/gm-new does not exist, so neither host ever started gm.

After: both entries run `/config/.gmnew/current/gm serve`, the same entry shape as the Claude Code entry in /config/.claude.json. The `--mcp-config /config/.gm-new/mcp.json` layer is no longer passed. That layer only added a playwriter server from /workspace/pw with PLAYWRITER_NO_SANDBOX=1. The Claude Code entry never passed it, so these hosts now get the same playwriter setup as Claude Code (defaults/mcp.json).

| # | File | Backup (copied before the edit, cp -p) | Before | After |
|---|---|---|---|---|
| 52 | /config/.gemini/settings.json, mcpServers.gm | /config/.gemini/settings.json.bak-2026-11-09T051916 | `{"command":"node","args":["/workspace/gm-new/tools/relay.mjs","--mcp-config","/config/.gm-new/mcp.json"]}` | `{"command":"/config/.gmnew/current/gm","args":["serve"]}` |
| 53 | /config/.config/zed/settings.json, context_servers.gm | /config/.config/zed/settings.json.bak-2026-11-09T051916 | `{"source":"custom","command":"node","args":["/workspace/gm-new/tools/relay.mjs","--mcp-config","/config/.gm-new/mcp.json"],"env":{}}` | `{"source":"custom","command":"/config/.gmnew/current/gm","args":["serve"],"env":{}}` |

Witness: each entry was read back from disk, then its command and args were launched as a stdio host from a new empty workspace. Both answered the same:
- initialize: protocolVersion 2025-11-25, serverInfo name gm, title "gm run worker", version 0.1.0 (MCP protocol level; the build is ae4ef46-278).
- tools/list: next_context, finish, run_code.

The backups are byte-identical to the originals (cmp).

## Cross-project browser isolation on the installed native host (2026-11-09)

Phase A: nothing to fix. The isolation held on every check, so no code changed. The first probe failed only in the witness helper (it did not split Chromium's rewritten argv); the product was not at fault.

Host witnessed: `/config/.gmnew/current/gm` (`ae4ef46-278 (ae4ef46)`), the entry agents start. Each project was run with `gm serve --workspace <project>` from its own cwd. Each run called `gm.playwriter_execute` with a page titled per project.

Real project cwds (live gates and browsers of the running workers were reused; each run's own tab was closed with `gm.playwriter_browsers({ action: 'close' })`, which is run-scoped):

| project | browser profile (from /proc cmdline) | browser pid | page list (from /json/list) |
|---|---|---|---|
| thebird | /workspace/thebird/.playwriter/browser-profile | 3998103 | "ISO-THEBIRD-mw8psvnm", "about:blank" |
| jayzee | /workspace/jayzee/.playwriter/browser-profile | 4095470 | "ISO-JAYZEE-mw8psvnm", "about:blank" |

Checks: distinct profile paths, distinct pids, each page set holds only its own project's tab. After the witness both browsers had the same pids and only "about:blank" again.

Close check, on scratch roots /tmp/iso/close/thebird and /tmp/iso/close/jayzee (not the live projects, because a whole-browser close would kill a running worker's tabs):

| root | browser profile | browser pid | pages before close |
|---|---|---|---|
| /tmp/iso/close/thebird | /tmp/iso/close/thebird/.playwriter/browser-profile | 4118278 | "ISO-CLOSE-THEBIRD-mw8puk1m", "about:blank" |
| /tmp/iso/close/jayzee | /tmp/iso/close/jayzee/.playwriter/browser-profile | 4119366 | "ISO-CLOSE-JAYZEE-mw8puk1m", "about:blank" |

`gm.browser_close_machine({ confirm: true })` in the thebird run closed pid 4118278 (not alive afterwards). Pid 4119366 stayed alive and its tab "ISO-CLOSE-JAYZEE-mw8puk1m" was still listed. The jayzee browser was then closed the same way and confirmed gone.

Phase B: the witness scripts ran in /tmp/iso (outside the repo) and were removed after this record.

## gm defects from jayzee (2026-11-09, Phase A)

Phase A: the four defects fixed at their cause, rows numbered as in the owner list (1 feed, 2 job kill, 3 run_shell, 4 rules notice), one commit per defect where the files allow. The job-kill and run_shell statements share src/tools.mjs, so rows 2 and 3 share one commit. Nothing pushed; Phase B builds, witnesses and pushes.

| # | Commit | File | Change | Witness needed |
|---|---|---|---|---|
| 4 | Rules notice after end | native/components/mcp/server.cpp, src/mcp.mjs | note_rule and rules_notice (native), noteRule and rulesNotice (Node), return at once once the run has ended, so finish raises no rules notice after its end event | finish then next_context on a scratch run in each tree: no rules-notice event after the end event, no rulesPending in the reply |
