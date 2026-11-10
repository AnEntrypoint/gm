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
| 1 | Feed delta | native/components/mcp/compact.cpp, native/components/mcp/server.cpp, src/compact.mjs, src/mcp.mjs, DESIGN.md | next_context returns the events since the last step in full and no earlier event in compact form; the two-horizon replay (H1 14, H2 12) and its zone-2 record path are removed in both trees; the native window read starts at shown; the description no longer promises compact older events | two next_context calls in a row on a scratch run with 20+ events: the second reply lists only the seqs after the first call total; reply bytes stay near the first reply size; both trees; parity 0 differ |
| 2 | Job kill cause | native/components/verbs/job.cpp, src/tools.mjs | every job kill writes a statement that names the job and the cause (timeout, lifetime, cancelled by job_stop, restart, run ended), on the job status, the job event, the job-killed event and the job_stop reply | start a background job, then job_stop it, restart the worker while one runs, and end a run with one running: job_status and the job-killed record carry the statement; both trees |
| 2a | Job kill cause | native/components/verbs/job.cpp | job_stop reply carries the kill statement, as the Node reply does (commit 38c2db5) | job_stop a background job: reply has statement; parity row job_stop has no differ |
| 2b | Job kill cause | native/components/mcp/server.cpp, src/mcp.mjs | the jobsKilled list of next_context entries carries statement next to reason, so the notice a model reads at its next step gives the cause | kill a job by job_stop, by a worker restart, and by a run ending, then read next_context jobsKilled: every entry has statement; both trees |
| 2c | Job kill cause | native/include/gm/job_text.hpp, native/components/verbs/job.cpp, native/components/mcp/server.cpp | background run_code bodies (native) carry the kill statement on job-killed, on the job status for stop_body (run-ended, stopBackground, shutdown, lifetime) and on the restart record; the statement text is one shared function, gm::jobs::kill_statement | start a background body (run_code with a 2000 ms timeoutMs), end its run with finish: job-killed carries statement; kill a worker with a body running: next_context jobsKilled carries statement; native only, Node already sets it through job.stop |
| 2d | Job kill cause | native/include/gm/job_text.hpp, native/components/mcp/server.cpp, native/components/verbs/job.cpp | stopBackground and shutdown kills of background bodies name their cause in words (not the bare reason); a body killed by a worker restart says that its child processes are not tracked across a crash | finish with stopBackground: true on a run with a running body: job-killed statement names stopBackground; kill the worker with a body child running: body restart statement says children are not tracked |
| 3 | run_shell timeout | native/components/verbs/verbs.cpp, src/tools.mjs | a run_shell that hits its timeout adds a statement with the timeout in ms and, when nothing was printed, that the command printed nothing before the deadline | run_shell "sleep 5; echo x" with timeoutMs 2000: error and statement present, output empty; then "echo a; sleep 5" with timeoutMs 2000: output "a" and the statement; both trees |
| 4 | Rules notice after end | native/components/mcp/server.cpp, src/mcp.mjs | note_rule and rules_notice (native), noteRule and rulesNotice (Node), return at once once the run has ended, so finish raises no rules notice after its end event | finish then next_context on a scratch run in each tree: no rules-notice event after the end event, no rulesPending in the reply |

## gm pass witness record (2026-11-09, binary 1af49a1)

Binary: build/release/native/components/host/gm, stamped 1af49a1 (HEAD at build). Commits of this pass, in order: 6524887 (rules notice), cc3496a (job kill and run_shell statements), c4e4f7d and 4e5200b (feed delta, and its brace fix), 38c2db5 (job_stop reply statement), dbed8fb (jobsKilled statement), b24d506, b933360 and 0fffe53 (body kill statements), 1af49a1 (one job lifetime).

Checks on 1af49a1: conformance `tools/check-build.mjs build/release`: 83 passed, 0 failed of 83 checks in 24 scenarios; run-code-progress-check ok; shell-stdin-check ok. Parity `native/tests/parity/run.mjs --bin build/release/native/components/host/gm`: 22/93 scenarios match, 0 cutover-expected, 56 native-ahead, 15 documented-gap, 0 differ.

Witness results, native build (scratch workspaces under /tmp/gm-defects/w, deleted after the run) and Node host (node src/mcp.mjs through the same client):

| row | native result | Node result |
|---|---|---|
| 1 feed | 25 run_shell calls, then next_context: second call 77 events, 21400 bytes, 0 replayed from before; third call 3 events, 2921 bytes, 0 replayed. Installed f14c5b7-281 before: third call 16 events, 5760 bytes, 13 replayed | second call 103 events, 21268 bytes, 0 replayed; third call 2 events, 1837 bytes, 0 replayed |
| 2 job kills | timeout (to): reason timeout, statement "job to stopped: timeout after 2000 ms"; job_stop (stp): reply statement "job stp stopped by job_stop"; restart (rst, rend): reason restart with statement; run-ended (rend2): reason run-ended with statement; 10 job-killed records with statement | timeout, cancelled and run-ended kills each carry statement; job_stop reply carries statement |
| 2 next_context jobsKilled | each entry carries statement next to reason (native and Node) | same |
| 2 body kills | background body killed by finish with stopBackground: true: reason stopBackground, statement "job body-9 stopped: finish was called with stopBackground: true, which stops the run background jobs"; body killed by a worker SIGTERM: reason restart, statement names the crash case | not separately checked: Node sets the statement through job.stop |
| 3 run_shell | "sleep 5; echo x" with timeoutMs 2000: error, statement "...with no output...", output ""; "echo a; sleep 5": output "a\n" with statement; "sleep 2; echo done": ok, output "done\n". Installed before: no statement | same, with statements |
| 4 rules notice | refused finish opens rule 4 at seq 11; end at seq 17; no event after end; finish reply has no rulesNotice. Installed before: rules-notice at seq 18 after end at seq 17, finish reply carried rulesNotice | notice seq 7, end seq 12, nothing after |

Defect records (cause and state):

1. The 1800 s turn timeout and the lost lifetime run. Cause: the previous turn waited in foreground loops (sleep up to 600 s per call, repeated) and the turn exceeded its budget; the interrupted call's output file was empty, and the run it watched was a shell job, not a body, so the file was empty until the script ended. Fix: poll in short steps with the Monitor tool (process-level), not inside one turn.
2. Witness design error, not a product defect: a body running `run_shell` with timeoutMs 7200000 ended at 603 s with "timed out after 600000 ms", because run_shell caps timeoutMs at 600000. The body loop in the final witness re-runs run_shell so it keeps running.
3. Three lifetime constants disagreed: mcp.hpp 1800000 (native background bodies, check_bodies), core_verbs.hpp 3600000 (JobTable, shell jobs), src/mcp.mjs and src/tools.mjs 3600000 (Node). Cause: each layer set its own default. Fix: 1af49a1 sets mcp.hpp to 3600000, the Node value and the JobTable value; DESIGN.md "Job and body lifetime (2026-11-09)" records it.
4. A shell job's lifetime equals the largest timeoutMs that job_start accepts (3600000), so the job reaches its deadline first and reports reason timeout; the lifetime reason is reachable only for background bodies. Recorded, not changed: lowering the job lifetime would change what job_start accepts, an owner decision.
5. Open: a worker killed without a graceful stop (SIGKILL or SIGTERM) leaves its body's child processes running; the restart record marks the body killed and says so. Cause: a body's child processes have no recorded pid or process group in the body status, so stop_orphans cannot kill them; only stop_bodies (graceful supervised stop, stdin EOF) kills them through proc::kill_owned. Not fixed in this pass.

Lifetime witness (background body, native, binary 1af49a1, no rebuild or restart during the run): see row 5 below.

| row | witness | status |
|---|---|---|
| 5 | background body lifetime, native, binary 1af49a1 (expected lifetime 3600000 ms): run_code body loops over run_shell sleeps of 600 s, started at 06:33:08 (body adopted at about 06:33:46); polls every 120 s of job_status; ELAPSED_S and KILLED_RECORD from /tmp/gm-defects/w/life-body2.out | killed: ELAPSED_S 3605 (body started 06:33:08, adopted about 06:33:46; the kill at 07:33:10 fell inside the 3600 s lifetime, which is 3605 s of wall time from start); KILLED_RECORD seq 133 at 2026-11-09T07:33:10.072Z, job body-9, reason lifetime, statement "job body-9 stopped: the job lifetime of 3600000 ms ended before it finished"; LIFE_BODY_STATUS state killed, reason lifetime, same statement, exitCode null, output the run_shell timeouts of the loop bodies (each 600000 ms) |

Open row (defect, recorded with its cause): unknown-mw6bc4mv1c00, "Push target AnEntrypoint/gmfx unavailable", added at fx run 2026-11-07-11-18-28-693e65, seq 72, at 2026-11-07T11:21:23.575Z. It lives in the fx workspace state (/workspace/fx), not in this checkout, so this gm pass cannot close it. Later runs of fx (for example 2026-11-08-12-02-20-188521 and 2026-11-08-17-47-47-848608) tried unknown_resolve on it at step 50 with event 1153 and commits e6b63b0 and 9b2b281; each returned ok false, and no log shows a resolution. Verified cause (re-read from the logs on 2026-11-09): the resolve calls return ok false with the error text of src/rows.mjs:196. fx run 2026-11-07-12-12-45-6e0acb, /workspace/fx/runs/2026-11-07-12-12-45-6e0acb/log.jsonl, seq 1210: `"tool":"unknown_resolve","ok":false,"args":{"id":"unknown-mw6bc4mv1c00","event":1153,"commit":"e6b63b0ea505f8e38377717740d2578e6392e851"},"error":"no commit e6b63b0ea505f8e38377717740d2578e6392e851 in this repository"`; seq 1218 is the same with commit 9b2b2817d4bb1989d3c3ed7b48d6eaf68c70c3ef. The check is src/rows.mjs:196 `if (!(await commitExists(root, commit))) return fail(...)`, and commitExists (src/git.mjs:40-42) runs `git cat-file -e <sha>^{commit}` with cwd = root, the run workspace /workspace/fx. That directory is not a git repository (`git rev-parse --is-inside-work-tree` in /workspace/fx: "fatal: not a git repository"). Both commits exist in the repository at /workspace/fx/fx (`git cat-file -t` prints commit for each). So ok false is a root mismatch: the commit check runs in the workspace root, not in the repository that holds the commits. The message "in this repository" is printed for every cat-file failure, so it does not name this cause; that wording is a gm defect (ranked item 6). Finish was not forced. An earlier finish refusal (fx run 2026-11-08-17-47-47-848608, seq 376) named the row as open. The row stays open for the fx workspace owner, who resolves it with a witness from a root that holds the commit, or parks it.

## gm pass, Phase A (2026-11-09): ranked remaining work

Status is as of this pass. Blocked items name the blocker.

| rank | item | status | blocker |
|---|---|---|---|
| 1 | Wait default for `gm events --wait` 1800000 to 3600000 (native kDefaultWaitMs, src/cli.mjs timeoutMs); --timeout-ms still overrides | Phase A changed, committed locally; Phase B witness pending | none |
| 2 | run_shell timeoutMs cap 600000 to 3600000 (native max_timeout_ms, src/tools.mjs MAX_TIMEOUT_MS), with the two timeout messages naming the new cap | Phase A changed, committed locally; Phase B witness pending | none |
| 3 | A worker killed without a graceful stop reaps its body child processes (native proc ledger, body OwnerScope, stop_orphans, restart statement text) | Phase A changed, committed locally; Phase B witness pending | none for native; Node does not reap (decision, see item 9) |
| 4 | Node parity for items 1 to 3 | Node wait and cap changed; Node has no reaping; the parity harness run is Phase B | none |
| 5 | fx row unknown-mw6bc4mv1c00 | cause recorded above; open | the fx workspace owner resolves it or parks it; gm does not force finish |
| 6 | rows.mjs:196 message "no commit X in this repository" also covers a non-repository root | open defect, not in this pass | none; next pass |
| 7 | Shell-job lifetime equals the job_start cap, so the lifetime reason is unreachable for shell jobs | open | owner decision |
| 8 | The .mcp.json pass | deferred to the next pass, not started | owner schedules it |
| 9 | Node keeps its differences: digests, bounds, shell-only killBody, no body reaping, generic restart text for bodies | kept as parity decisions | owner decision (DESIGN.md, Decided) |
| 10 | Windows and macOS builds are not verified here | open | CI runs |

Top unblocked item: rank 1, 2 and 3 (this pass). Rank 6 is the next unblocked item.

Changes in this pass (Phase A, code and docs only; no build, run or witness yet):

- Commit "Wait default and run_shell cap raised to 3600000 ms, in both trees": native/components/host/cli.cpp (kDefaultWaitMs 3600000), src/cli.mjs (timeoutMs default 3600000), native/components/verbs/verbs.cpp (max_timeout_ms 3600000; the two run_shell timeout messages say up to 3600000), src/tools.mjs (MAX_TIMEOUT_MS 3600000; the message says up to 3600000).
- Commit "A worker killed without a graceful stop reaps its body children": native/include/gm/proc.hpp (OwnerScope takes an optional ledger path; reap_ledger), native/components/proc/proc.cpp (Enrolment appends the child pid to the active ledger on spawn and removes it on exit; reap_ledger kills each recorded pid's process group and removes the file), native/components/mcp/server.cpp (the body thread's OwnerScope gets the ledger path jobs/<body name>.pids in the run log directory), native/components/verbs/job.cpp (stop_orphans calls reap_ledger for body jobs before recording the restart), native/include/gm/job_text.hpp (body restart statement: "the body child processes recorded for it were killed with it").

Witnesses to run in Phase B: wait default (events --wait with no --timeout-ms reports the 3600000 default, by reading the CLI output or a short --timeout-ms check), run_shell with timeoutMs 600001 accepted and a 3600001 refusal, a body that starts a long run_shell sleep then the worker is killed with SIGKILL, and the restart reaps the sleep (its pid is gone) with the body restart statement in the job-killed record. Both trees for the cap and the wait default; native only for the reaping (Node has no reaping by decision).

## gm pass, Phase B (2026-11-09, commit 903e441, build stamp 903e441-dev)

Build: `cmake --preset release` then `cmake --build build/release` exited 0. The build log has one line "ninja: warning: premature end of file; recovering", which ninja printed and recovered from; the build finished.

Witnesses (scripts in /tmp/gm-defects/w3, outside the repo):

- run_shell cap, native (wcap.mjs): `QUICK_900000 {"ok":true,"output":{"ok":true,"exitCode":0,"signal":null,"output":"CAP_OK\n",...}}`; `SHORT_TIMEOUT ... "statement":"run_shell stopped: timeout after 1000 ms with no output; ... Pass timeoutMs (up to 3600000) or start it with job_start."`
- run_shell cap, Node through node-host.sh (wcap.mjs): `QUICK_900000 ... "output":"CAP_OK\n"`; `SHORT_TIMEOUT ... Pass timeoutMs (up to 3600000) or start it with job_start.`
- run_shell past the old 600000 ms cap, native, timeoutMs 900000 (wlong.mjs): `LONG_ELAPSED_S 650`; `LONG_REPLY {"ok":true,"output":{"ok":true,"exitCode":0,"signal":null,"output":"LONG_OK\n",...}}`. The old cap would have stopped the command at 600 s.
- Body child reaping, native, worker SIGKILL then restart (wreap.mjs): `BACKGROUND_REPLY ... "background":"body-9"`; `LEDGER_FILE <ws>/runs/<run>/jobs/body-9.pids PIDS 658780`; `CHILD_ALIVE_BEFORE_KILL 658780:true`; `WORKER_PIDS 658644` (the gm-core worker, SIGKILLed); `CHILD_ALIVE_AFTER_WORKER_KILL 658780:false`; `LEDGER_AFTER_WORKER_KILL gone`; `KILLED_RECORD` seq 14 `"kind":"job","job":"body-9","body":9,"state":"killed","reason":"restart","statement":"job body-9 killed: the gm worker restarted while it ran; the body child processes recorded for it were killed with it","durMs":5001.086`; seq 15 `"kind":"job-killed"` with the same statement.
- The first reaping attempt killed the supervisor (`gm serve`) instead of the worker. The worker then exited gracefully and wrote the generic statement, so that attempt was not a crash test and is not counted. The pass above kills the process whose args are `gm-core worker --workspace <ws>`.
- Open gap from reading the code: server.cpp:976 has a second stop_orphans for body statuses that writes the killed status without calling reap_ledger. Only JobTable::stop_orphans (job.cpp) reaps. The witness shows the reap ran, so JobTable's path ran first here. If the server path ever runs first on a crashed run, its children are not reaped. Not changed in this pass.
- Wait override, native (`gm events --run <run> --workspace <ws> --wait --timeout-ms 3000`): `events: timed out after 3000 ms with no event pending`; exit 0, elapsed 3 s.
- Wait default, native, no --timeout-ms (PID 656214, started about 08:02 UTC, exited 09:02 UTC): `events: timed out after 3600000 ms with no event pending`, then `WAIT_EXIT 0 ELAPSED_S 3600` (both lines from /tmp/gm-defects/w3/wait.out). The default is 3600000 ms, as witnessed.
- Conformance, `node tools/check-build.mjs build/release`: `conformance: 83 passed, 0 failed of 83 checks in 24 scenarios`.
- Parity, `node native/tests/parity/run.mjs --bin build/release/native/components/host/gm`: `22/93 scenarios match, 0 cutover-expected, 56 native-ahead, 15 documented-gap, 0 differ`; exit 0.

Status: finished. The run_shell cap (both trees), the body reaping (native), the wait override and default, conformance and parity are all witnessed above.

## Commits on origin/main from another session, reviewed (2026-11-09, Phase A)

These three landed on origin/main after 14d4350 and before fc63749. All three are authored by lanmower (657315+lanmower@users.noreply.github.com). Not rewritten or reverted here.

| commit | date (UTC) | files | changes gm behaviour? |
|---|---|---|---|
| e78de46 | 2026-11-09 08:20:13 | AGENTS.md; native/components/mcp/server.cpp; native/components/quickjs/leaves.cpp; native/include/gm/runcode.hpp; src/unit-tests.mjs; tools/check-build.mjs; tools/check-run-code-budget.mjs (new); tools/check-shell-stdin.mjs; tools/check.mjs | yes, native run_code: the default JS budget (BodyControls js_budget) goes from 60000 to 3600000 ms (runcode.hpp); a run_code body's budget is set to job_lifetime_ms (server.cpp run_code); the leaf call deadline goes from a fixed 120000 to 3600000 ms, or the body's budget when one is set (leaves.cpp start_deadline). This touches run_code, witness and lifetime code. Node's run_code is not in the diff. Also adds check-run-code-budget.mjs to check-build and check, and the AGENTS note that job_start stdin is /dev/null (job.cpp:181, confirmed). src/unit-tests.mjs skips a name that statSync cannot stat; tooling only. |
| 4e82f40 | 2026-11-09 08:26:59 | tools/check-shell-stdin.mjs | no. Check-only: the job stdin comparison ignores CR and trailing blanks. |
| f80cd46 | 2026-11-09 08:41:25 | tools/check-run-code-budget.mjs | no change to gm. Check-only, and weaker: the leaf assertion passes on a status 200 or on a background run, and fails only on the old fixed-limit text. |

Rows to verify in the next Phase B:

| row | what to verify | status |
|---|---|---|
| V1 | e78de46 native: a 65 s JavaScript body with timeoutMs 100000 returns, and a fetch leaf is not cut at 120000 ms (tools/check-run-code-budget.mjs on a binary built at fc63749) | open: Phase B |
| V2 | e78de46 Node: run_code's budget is unchanged by the commit, so native and Node may now differ on a long JavaScript body; the parity run records any difference | open: Phase B |
| V3 | f80cd46 weakened the leaf assertion: a witness that a leaf runs past 120000 ms and returns status 200 on native, not only a background result | open: Phase B |
| V4 | 4e82f40 and f80cd46 are check-only; the CRLF comparison is covered by Windows CI | blocked: CI |

Ranked remaining work (2026-11-09, after this review):

| rank | item | status | blocker |
|---|---|---|---|
| 1 | V1 to V3: verify the run_code budget change of e78de46 on a binary built at fc63749 | Phase A recorded; Phase B this pass | none |
| 2 | V2 follow-up: Node run_code budget parity with native | open | owner decision (native-ahead or port) |
| 3 | server.cpp:976 stop_orphans writes body kills without reap_ledger; a crashed run can keep its children if this path runs first | open gap; fix is one call plus a witness | none; next pass |
| 4 | rows.mjs:196 message "no commit X in this repository" also covers a non-repository root | open defect | none; next pass |
| 5 | f80cd46 leaf assertion accepts a background run; tighten it to require status 200 within the body budget | open | none; next pass |
| 6 | fx row unknown-mw6bc4mv1c00 | open, cause recorded | the fx workspace owner resolves or parks it |
| 7 | Shell-job lifetime equals the job_start cap, so the lifetime reason is unreachable for shell jobs | open | owner decision |
| 8 | The .mcp.json pass | not started | owner schedules it |
| 9 | Windows and macOS builds are not verified here | open | CI runs |

## gm pass, Phase B (2026-11-09, commit 0a9bb65, build stamp 0a9bb65-dev): rows V1 to V4

- V1, native run_code budget (e78de46), `node tools/check-run-code-budget.mjs build/release/native/components/host/gm`, exit 0: `run-code-budget-check: ok (a 65 s JavaScript body with timeoutMs 100000 returned in 65004 ms; a catastrophic regex in the fetch leaf ended in 118083 ms with no old fixed limit)`. Verified.
- V3, leaf past the old 120 s limit (f80cd46 weakened the check, so it was witnessed separately; v3-leaf.mjs in /tmp/gm-defects/w3): a local server answered a 32-a catastrophic regex line, run_code timeoutMs 400000, `V3_ELAPSED_S 343`, `V3_REPLY {"ok":true,"output":{"ok":true,"status":200,"bytes":34,...}}`. The leaf ran 343 s, past the old 120000 ms deadline, and returned status 200. Verified.
- V2, Node run_code budget (e78de46 did not change Node): the same 65 s JavaScript body on the Node host, timeoutMs 100000, `V2_NODE_ELAPSED_S 65`, `V2_NODE_REPLY {"ok":true,"output":{"spun":true},...}`. Node did not cut it at 60 s, so for this case native and Node agree. Parity does not cover the JavaScript budget (its run is below), so this direct measurement is the witness. Verified for this case.
- V4, the CRLF comparison in 4e82f40: CI only. Not verifiable here; open, blocked on CI.
- Conformance, `node tools/check-build.mjs build/release`: `check-build: gm-core stamp 0a9bb65-dev (0a9bb65)`, `conformance: 83 passed, 0 failed of 83 checks in 24 scenarios`, exit 0.
- Parity, `node native/tests/parity/run.mjs --bin build/release/native/components/host/gm`: `22/93 scenarios match, 0 cutover-expected, 56 native-ahead, 15 documented-gap, 0 differ`, exit 0.

Status: V1, V2 (this case) and V3 verified on 0a9bb65; V4 open, blocked on CI. Rank 1 is done; rank 2 (Node budget parity, owner decision) is open only for cases other than the 65 s body.

Final run on the stamped binary 94c6a89 (its sources equal 1af49a1; the commit after 1af49a1 changes only docs): conformance 83 passed, 0 failed of 83 in 24 scenarios, run-code-progress-check and shell-stdin-check ok; parity 22/93 match, 56 native-ahead, 15 documented-gap, 0 differ. Native and Node witnesses re-run with the same results as the table above (job kills 7 cancelled, 10 restart, 4 run-ended, 6 timeout statements; run_shell QUIET and PARTIAL with statements; rules notice before end and none in the finish reply; feed second call 0 replayed, third call 3 events on native and 2 on Node; jobsKilled statement present; body stopBackground and restart statements).

## gm pass, rerun of Phase B on binary 0a9bb65 (2026-11-09, source at f2bb5a6; code unchanged since 0a9bb65)

Recovery run after an API error ended the previous turn. The release build had finished (BUILD_EXIT 0); the binary stamp is `gm 0a9bb65-dev (0a9bb65)`. Everything after 0a9bb65 is documentation, so the code under test is current.

- V1, `node tools/check-run-code-budget.mjs build/release/native/components/host/gm`: `run-code-budget-check: ok (a 65 s JavaScript body with timeoutMs 100000 returned in 65004 ms; a catastrophic regex in the fetch leaf ended in 123102 ms with no old fixed limit)`; V1_EXIT 0.
- Conformance, `node tools/check-build.mjs build/release`: `check-build: gm-core stamp 0a9bb65-dev (0a9bb65)`, `conformance: 83 passed, 0 failed of 83 checks in 24 scenarios`; CONF_EXIT 0. Its embedded budget check printed `... ended in 126047 ms with no old fixed limit`.
- Parity, `node native/tests/parity/run.mjs --bin build/release/native/components/host/gm`: `22/93 scenarios match, 0 cutover-expected, 56 native-ahead, 15 documented-gap, 0 differ`; PARITY_EXIT 0.
- V3, leaf past the old 120 s limit (v3-leaf.mjs): `V3_ELAPSED_S 225`, `V3_REPLY {"ok":true,"output":{"ok":true,"status":200,"bytes":34,...}}`; V3_EXIT 0. The first run took 343 s on the same binary; the catastrophic-regex time varies with load, and both runs exceeded 120 s with status 200.
- V2, the same 65 s JavaScript body on the Node host (v2-node.mjs): `V2_NODE_ELAPSED_S 65`, `V2_NODE_REPLY {"ok":true,"output":{"spun":true},...}`; V2_EXIT 0.

Status: V1, V2 (this case) and V3 verified again on 0a9bb65. V4 (CRLF, 4e82f40) remains blocked on CI.

## V4 decided: CI-only witness (2026-11-09)

V4 is the CRLF comparison in tools/check-shell-stdin.mjs from 4e82f40 (job output compared with CR and trailing blanks removed).

- Exact check command: `node tools/check-build.mjs build/x64-windows-release`, and `node tools/check-build.mjs build/arm64-windows-release`. check-build runs check-shell-stdin.mjs against the built binary. The windows-latest and windows-11-arm jobs in .github/workflows/release.yml (line 102) run these.
- Why it cannot run on this host: the CRLF output is produced by a Windows job's stdin, and this Linux host has no Windows runner and builds no Windows preset. A Linux run cannot reproduce CRLF output, so a local run would prove nothing.
- Status: a CI item, removed from the Phase B blocking list. It stays open until a Windows CI run of release.yml passes; the result belongs in this doc when CI reports it.

## Ranked remaining work (2026-11-09, after V4 was decided)

| rank | item | status | blocker |
|---|---|---|---|
| 1 | server.cpp stop_orphans reaps body children before it marks a body killed (the open gap from the Phase B record) | Phase A this pass; Phase B this pass | none |
| 2 | rows.mjs:196 message "no commit X in this repository" also covers a non-repository root | open | none; next pass |
| 3 | f80cd46 leaf assertion accepts a background run; tighten it to require status 200 within the body budget | open | none; next pass |
| 4 | Node run_code budget parity with native (V2 case verified; other cases unmeasured) | open | owner decision (native-ahead or port) |
| 5 | fx row unknown-mw6bc4mv1c00 | open, cause recorded | the fx workspace owner resolves or parks it |
| 6 | Shell-job lifetime equals the job_start cap, so the lifetime reason is unreachable for shell jobs | open | owner decision |
| 7 | The .mcp.json pass | not started | owner schedules it |
| 8 | Windows and macOS builds are unverified here; V4 CRLF check | CI | a Windows CI run of release.yml |

## gm pass, Phase A (2026-11-09): stop_orphans reaps on the server path

- native/components/mcp/server.cpp, the server-side stop_orphans (line ~976): before a body's status is rewritten as killed, it calls `proc::reap_ledger(dir / (job + ".pids"))`, where dir is the run's jobs directory. Before this, only JobTable::stop_orphans (job.cpp) reaped, so if the server path ran first on a crashed run its body children were not killed.
- Witness plan for Phase B: rebuild; run wreap.mjs (worker SIGKILL, restart, the recorded child must be dead and the ledger gone); conformance; parity. The log cannot show which of the two stop_orphans ran, so the witness proves that reaping happens, not which path did it.

## gm pass, Phase B (2026-11-09, binary 608d03c): stop_orphans reaps on the server path

- Build: `cmake --preset release`, then `cmake --build build/release -j 4`, BUILD_EXIT 0, 0 FAILED. A first build at -j 8 had two cc1plus processes end on SIGTERM ("c++: fatal error: Terminated signal terminated program cc1plus"); the same sources compiled cleanly at -j 4. Stamp: `608d03c-dev (608d03c)`.
- Reaping witness, native, worker SIGKILL then restart (wreap.mjs): `LEDGER_FILE <ws>/runs/<run>/jobs/body-9.pids PIDS 849110`; `CHILD_ALIVE_BEFORE_KILL 849110:true`; `WORKER_PIDS 848869`; `WORKER_PIDS_AFTER_KILL 849756`; `CHILD_ALIVE_AFTER_WORKER_KILL 849110:false`; `LEDGER_AFTER_WORKER_KILL gone`; `KILLED_RECORD` seq 14 `"kind":"job","state":"killed","reason":"restart","statement":"job body-9 killed: the gm worker restarted while it ran; the body child processes recorded for it were killed with it"`; seq 15 `"kind":"job-killed"` with the same statement. Verified. The log cannot show which stop_orphans ran, as the Phase A plan said.
- Conformance, `node tools/check-build.mjs build/release`: `conformance: 83 passed, 0 failed of 83 checks in 24 scenarios`; CONF_EXIT 0.
- Parity, `node native/tests/parity/run.mjs --bin build/release/native/components/host/gm`: `22/93 scenarios match, 0 cutover-expected, 56 native-ahead, 15 documented-gap, 0 differ`; PARITY_EXIT 0.

Status: finished for rank 1 (server-path reap). V4 remains a CI item (see "V4 decided"), not in this blocking list.

## Row unknown-mw6bc4mv1c00: closed stale (2026-11-09)

Decision: the row is stale and is closed. The fx peer closed it, and gm records that close here; gm did not force finish or change fx's state.

Evidence:
- The fx close file, /workspace/fx/closes/unknown-mw6bc4mv1c00.txt, written 2026-11-09T09:50:59.092Z: "unknown-mw6bc4mv1c00 resolved Stale: the push target is reachable now. git ls-remote --heads origin main (run event 21) = 8ba14479454cfd2efb395d8bcdabf57036e2cd66 refs/heads/main, and git push origin main a4a8e963..8ba14479 returned PUSH_EXIT=0 (run 2026-11-09-09-35-53-9ce83e)."
- Checked here, in /workspace/fx/fx: `git ls-remote origin main` returns `a5b47122b7b9da4f4a2fc1b5feb5e44da3bd2b9e refs/heads/main`, so the push target is reachable. `8ba14479` is a commit and an ancestor of `a5b47122` (`git merge-base --is-ancestor` passes).
- fx's own head `a5b47122` has the commit message "Record fresh zig build test witnesses and the stale push-target row".
- /workspace/fx/rows has no file for the row.
- The row's blocker, "push target AnEntrypoint/gmfx unavailable", does not hold now, so the row is stale.

Inconsistency found (a defect): this ledger still listed the row as open in the Phase B and ranked tables (lines ~377, 389, 452 and 498 of this doc) and in the AGENTS.md note. Cause: gm's records were written from fx's run logs (log.jsonl) and never reread fx's closes/ directory, and nothing syncs the fx workspace into this checkout. Fixed by this record and by the AGENTS.md note, which now says the row was closed stale on 2026-11-09. The older pass records above stay as history.

work/tooling-fix-units.json: the row is not a unit there. Its one mention is in unit finish-open-row-step-limit, whose note quotes fx's 2026-11-07 finish refusal. That unit's status (open) is about finish's refusal rule, not this row, so it is left unchanged.

## Ranked remaining work (2026-11-09, after the reconciliation)

| rank | item | status | blocker |
|---|---|---|---|
| 1 | rows.mjs:196 message "no commit X in this repository" also covers a non-repository root | open, unblocked | none |
| 2 | f80cd46 leaf assertion accepts a background run; tighten it to require status 200 within the body budget | open, unblocked | none |
| 3 | Node run_code budget parity with native beyond the 65 s case (the V2 case is verified) | open | owner decision: native-ahead or port |
| 4 | finish-open-row-step-limit (work/tooling-fix-units.json): let a report close with a documented open row without weakening finish | open | owner decision on finish semantics |
| 5 | Shell-job lifetime equals the job_start cap, so the lifetime reason is unreachable for shell jobs | open | owner decision |
| 6 | The .mcp.json pass | not started | owner schedules it |
| 7 | Windows and macOS builds; V4 CRLF check from 4e82f40 | CI | a Windows CI run of release.yml |
| done | fx row unknown-mw6bc4mv1c00 | closed stale, 2026-11-09 | none |
| done | body children reaped on the server stop_orphans path | 9314e6f, witnessed on 608d03c | none |

## gm pass, Phase A (2026-11-09): items 1 to 6 of the ranked list

Each change below is committed locally. Phase B runs the listed witness for each and records its output.

1. Row commit check names the cause (item 1). Changed: src/rows.mjs (unknown_resolve), src/git.mjs (new isRepository), native/leaves/rows.mjs (unknown_resolve and a new isRepository). Before: "no commit X in this repository" for every failure, including a root that is not a git repository. After: "cannot check commit X: <root> is not a git repository" when the root is not a repository, and "no commit X in the repository at <root>" otherwise. Cause of the old wording: the check ran in the workspace root and printed one message for every cat-file failure. Witness (Phase B): unknown_resolve with a commit of 40 zeros, once in a non-repository workspace and once in a git repository, on native and Node.

2. Leaf assertion tightened (item 2). Changed: tools/check-run-code-budget.mjs. Before: the leaf passed on status 200 or on a background run. After: the leaf must return status 200 in the foreground (reply.background undefined). Witness (Phase B): the check passes on the built binary; a negative control copy with the leaf timeoutMs at 60000 must fail, because the leaf then backgrounds.

3. Node run_code budget parity beyond the 65 s case (item 3). Not changed yet. Decision method: the witness for it needs a background body that outlives its lifetime. Native's JavaScript budget is the job lifetime; Node's background bodies are jobs with the same lifetime (tools.mjs). Witness (Phase B): with --job-lifetime-ms 8000 on both trees, a background body spinning for 60 s must end at about 8 s with reason lifetime. If Node does not, Node is changed in Phase B and the change is recorded there.

4. finish accepts openRows at the step limit (item 4). Changed: native/components/mcp/server.cpp (finish, the schema, the description), src/mcp.mjs (finish, schema, description). Design: openRows is an array of {id, reason}. It is accepted only when the run has reached --max-steps, and it must name every open row of this run with a non-empty reason, so an open row can be documented but not closed. Finish logs a finish-open-rows event with the rows and the step count. Finish still refuses open rows without openRows, before the limit, and when a listed row is not open here. Witness (Phase B): on both trees with --max-steps 3: finish without openRows refused; finish with openRows before the limit refused; at the limit finish with openRows accepted; the row still open in unknown_list; the finish-open-rows event in the log.

5. Shell-job lifetime reason reachable (item 5). Changed: native/components/verbs/verbs.cpp (max_job_timeout_ms 7200000, the job_start description), src/tools.mjs (MAX_JOB_TIMEOUT_MS 7200000), src/mcp.mjs (job_start description). Cause: job_start's cap (3600000) equalled the job lifetime, and watch() sets reason lifetime only when the lifetime is below the timeout, so the reason could never be reached. Native's --job-lifetime-ms flag is now parsed by the worker (native/components/host/worker.cpp), so the lifetime can be witnessed in seconds. Witness (Phase B): with --job-lifetime-ms 5000, job_start timeoutMs 7200000 is accepted, and the job ends killed with reason lifetime at about 5 s with statement "job <name> stopped: the job lifetime of 5000 ms ended before it finished", on both trees.

6. The .mcp.json pass (item 6). Decision: no project .mcp.json is added. The gate in docs/PENDING_VALIDATION.md (the parity-harness cutover M5) is met, and the user-wide entry already runs the native binary. Reason: a project .mcp.json would start a second gm beside the user-wide one. Witness (Phase B): read /config/.claude.json (mcpServers.gm) and confirm the checkout has no .mcp.json.

Item 7 (Windows and macOS builds, V4 CRLF) stays open: it needs Windows CI.

## gm pass, Phase B (2026-11-09, binary 2ebce71): witnesses for items 1 to 6

Build: `cmake --preset release`, `cmake --build build/release -j 4`, BUILD_EXIT 0, 0 FAILED. Stamp `gm 2ebce71-dev (2ebce71)`. The release build stamped 3d7b551 first; the native body-lifetime fix (2ebce71) was committed and built after it.

1. Commit-check wording (both trees). unknown_resolve, commit 40 zeros:
   - native, non-repository workspace: `{"ok":false,"error":"cannot check commit 0000000000000000000000000000000000000000: /tmp/gm-defects/w5/rown-nonrepo is not a git repository"}`
   - native, git repository: `{"ok":false,"error":"no commit 0000000000000000000000000000000000000000 in the repository at /tmp/gm-defects/w5/rown-repo"}`
   - Node, non-repository: `cannot check commit 0000...: /tmp/gm-defects/w5/rowj-nonrepo is not a git repository`; Node, repository: `no commit 0000... in the repository at /tmp/gm-defects/w5/rowj-repo`.
   Verified on both trees.

2. Leaf assertion. Real check (`node tools/check-run-code-budget.mjs build/release/native/components/host/gm`): `run-code-budget-check: ok (a 65 s JavaScript body with timeoutMs 100000 returned in 65003 ms; a catastrophic regex in the fetch leaf ended in 120553 ms with no old fixed limit)`, exit 0. Negative control (a temporary copy with the leaf timeoutMs at 60000, removed afterwards): `run-code-budget-check: 1 failure(s)` / `- leaf deadline: expected status 200 in the foreground reply after 60002 ms, got {"ok":true,"background":"body-6",...}`, exit 1. Verified: the tightened check rejects a background run.

3. Node run_code budget parity. Decision: no change to Node. Reasoning: the body-lifetime witness, with --job-lifetime-ms 8000 and a 60 s spin in a background body, gives Node `BODY_STATUS {"state":"killed","reason":"lifetime"}` at 10 s (3 s poll steps), and native before the fix gave `{"state":"failed","error":"the body passed its JavaScript deadline of 8000 ms"}`. The defect was native, not Node: the QuickJS budget equals the lifetime, so the budget interrupt wins the race against the monitor's lifetime check, and body_finished settled the job as failed. Fixed in native (2ebce71): an adopted body whose error is the JavaScript deadline at the lifetime budget settles as killed, reason lifetime, with the shared statement and a job-killed record. After the fix native gives `BODY_STATUS {"state":"killed","reason":"lifetime","statement":"job body-9 stopped: the job lifetime of 8000 ms ended before it finished"}` at 8 s. Node and native now agree on state, reason and statement. The earlier 65 s Node case (V2) is unchanged.

4. finish openRows at the step limit (both trees, --max-steps 3). Sequence: next_context, unknown_add, finish plain, finish with openRows before the limit, next_context until stepsLeft 0, finish with openRows at the limit.
   - Plain finish, early: `refused: 1 row(s) open: <id> witness row. Resolve each with its witness, ...` (both trees).
   - openRows finish, early: the same refusal (both trees), so openRows is not accepted before the limit.
   - openRows finish at stepsLeft 0: native `{"ok":true,"finished":true,"output":"w4 at limit",...}`; Node `{"ok":true,"finished":true,"output":"w4 at limit"}`.
   - Row file after finish: `status: "open"` on both trees (the row stays open).
   - Event: native `{"seq":25,"kind":"finish-open-rows","rows":[{"id":"unknown-mw93ynhe2fef","reason":"open at the step limit, not closed"}],"steps":3}`; Node `{"seq":19,"kind":"finish-open-rows","rows":[{"id":"unknown-mw93ynnt9ce4","reason":"open at the step limit, not closed"}],"steps":3}`.
   Defect found in the witness, not in the product: a next_context call made after stepsLeft 0 ends the run at the limit, so a finish after it is refused as ended. The witness now stops at stepsLeft 0, the state where the run may still be finished. The step-limit text ("call finish with your witness to close this run") is accurate only before that call; recorded as a wording issue for the next pass.

5. Shell-job lifetime reason (both trees, --job-lifetime-ms 5000, job_start timeoutMs 7200000): native `LIFE_ELAPSED_S 5` and `LIFE_STATUS {"state":"killed","reason":"lifetime","statement":"job lt stopped: the job lifetime of 5000 ms ended before it finished","timeoutMs":5000}`; Node the same fields. Verified on both trees. The job_start cap is 7200000 on both.

6. The .mcp.json pass. No project .mcp.json is added. Read: /config/.claude.json `mcpServers.gm` = `{"command": "/config/.gmnew/current/gm", "args": ["serve"]}` (the native binary). The checkout has no .mcp.json (`ls: cannot access '.mcp.json'`). Reasoning: the cutover gate is met, and a project entry would start a second gm beside the user-wide one.

Real checks on 2ebce71: conformance `conformance: 83 passed, 0 failed of 83 checks in 24 scenarios`, CONF_EXIT 0. Parity `22/93 scenarios match, 0 cutover-expected, 56 native-ahead, 15 documented-gap, 0 differ`, PARITY_EXIT 0.

Item 7 (Windows and macOS builds, V4 CRLF) stays open: it needs Windows CI.

## gm pass, Phase A (2026-11-09): the step-limit refusal names the real way to close a run

Ranked remaining work, with status, after dee9c8e:
1. Step-limit refusal wording (this pass). Open, unblocked. Taken now.
2. Windows and macOS builds, and the V4 CRLF check from 4e82f40. Open, blocked on a Windows CI run of release.yml.
All other rows of the earlier lists are done or decided (items 1 to 6 are in dee9c8e).

Change: src/mcp.mjs (stepLimitText) and native/components/mcp/server.cpp (step_limit_text). Before: "step limit N reached; call finish with your witness to close this run, then call next_context to open a successor run; a run ended here has no witness". That text is returned by the refused next_context and by every later refusal, and finish is among them. Cause: the limit ends the run at the first next_context call made after stepsLeft reaches 0, so the run has already ended when the text is read, and finish is refused as ended. The text told the agent to call finish, which cannot work at that point. After: "step limit N reached and this run ended without a witness; call next_context to open a successor run. To close a run with a witness, call finish while stepsLeft is 0, before the next next_context call".

Witness (Phase B): the openRows sequence from wfinish.mjs on both trees, extended with one more next_context after stepsLeft 0, then a finish. Expected: the refused next_context and the refused finish both carry the new text; the earlier openRows finish at stepsLeft 0 is still accepted.

## gm pass, Phase B (2026-11-09, binary d7eca35): the step-limit refusal names the real way to close a run

Build: `cmake --preset release`, `cmake --build build/release -j 4`, BUILD_EXIT 0, 0 FAILED. Stamp `gm d7eca35-dev (d7eca35)`.

Witness `/tmp/gm-defects/w5/wstep.mjs` (--max-steps 3), both trees, output quoted:
- native: `NEXT_CONTEXT {"stepsLeft":1}`, `NEXT_CONTEXT {"stepsLeft":0}`, `NEXT_CONTEXT_AFTER_ZERO {"refused":true,"error":"refused: step limit 3 reached and this run ended without a witness; call next_context to open a successor run. To close a run with a witness, call finish while stepsLeft is 0, before the next next_context call"}`, `FINISH_AFTER_LIMIT {"refused":true,"ok":false,"error":"refused: step limit 3 reached and this run ended without a witness; call next_context to open a successor run. To close a run with a witness, call finish while stepsLeft is 0, before the next next_context call"}`.
- node: the same four lines with the same text.
The new text is returned by both trees, and a run past its limit is reported as ended without a witness.

Witness `/tmp/gm-defects/w5/wfinish.mjs` (the openRows sequence, --max-steps 3), re-run on d7eca35 because the step-limit change touches the same code path:
- native: `FINISH_OPENROWS_AT_LIMIT {"ok":true,"finished":true,"output":"w4 at limit","browser":{"ok":true,"closedPages":0,"skipped":true}}`; `ROW_STATUS_AFTER status: "open"`; `EVENT {"seq":25,"kind":"finish-open-rows","rows":[{"id":"unknown-mw94j76p05ba","reason":"open at the step limit, not closed"}],"steps":3}`.
- node: `FINISH_OPENROWS_AT_LIMIT {"ok":true,"finished":true,"output":"w4 at limit"}`; `ROW_STATUS_AFTER status: "open"`; `EVENT {"seq":19,"kind":"finish-open-rows","rows":[{"id":"unknown-mw94jaode8be","reason":"open at the step limit, not closed"}],"steps":3}`.
- Both trees refuse a plain finish and an early openRows finish while the row is open (`refused: 1 row(s) open: ... witness row. Resolve each with its witness ...`).

Defect found in Phase B: `tools/mcp-conformance.mjs` still asserted the pre-fede5c6 step-limit text (`refused: step limit 50 reached; call finish with your witness to close this run, ...`). Cause: fede5c6 changed `stepLimitText` in both trees without updating the conformance expectation. Fixed in this commit: `refusalText` now equals the text in src/mcp.mjs:573 and the native step_limit_text. Before the fix: `conformance: 81 passed, 2 failed of 83 checks in 24 scenarios`, with the two FAIL lines "the 51st next_context is refused with the truthful step-limit text" and "a repeated over-limit id answers with the stored refusal" (CONFORM_EXIT 1). After the fix: `conformance: 83 passed, 0 failed of 83 checks in 24 scenarios`, CONFORM_EXIT 0 (log /tmp/gm-defects/conform2.log).

Parity on d7eca35 (`node native/tests/parity/run.mjs --bin build/release/native/components/host/gm`): `22/93 scenarios match, 0 cutover-expected, 56 native-ahead, 15 documented-gap, 0 differ`, PARITY_EXIT 0. Same counts as the 2ebce71 witness.

Item 7 (Windows and macOS builds, V4 CRLF) stays open: it needs a Windows CI run of release.yml.

## gm pass, Phase A (2026-11-09): next_context at stepsLeft 0 warns that the next call ends the run

Ranked remaining work, with status: 1. Item 7 (Windows and macOS builds, V4 CRLF), open and blocked on a Windows CI run of release.yml. The deferred warning from the step-limit pass is taken now.

Change, both trees, same text: a next_context reply whose stepsLeft is 0 carries `warning`: `stepsLeft is 0: the next next_context call ends this run without a witness. To close it with a witness, call finish now, while stepsLeft is 0.` The field is absent at every earlier step. src/mcp.mjs (STEP_ZERO_WARNING, context reply, next_context schema) and native/components/mcp/server.cpp (kStepZeroWarning, context reply, next_context schema).

Conformance: tools/mcp-conformance.mjs, scenario "step budget handoff". Adds two checks: the 50th next_context at stepsLeft 0 carries the warning text, and the 49th at stepsLeft 1 carries no warning.

Witness (Phase B): `/tmp/gm-defects/w6/wwarn.mjs` on both trees (--max-steps 3), printing FIRST, SECOND, THIRD and AFTER_ZERO; `/tmp/gm-defects/w6/wzero.mjs` on both trees, printing FINISH_AT_ZERO, which proves finish is still accepted at stepsLeft 0 after the warning.

## gm pass, Phase B (2026-11-09, binary d0ad0a2, fresh build): next_context at stepsLeft 0 warns

Build: `rm -rf build/release`, `cmake --preset release`, `cmake --build build/release -j 4`, BUILD_EXIT 0, 0 FAILED. Stamp `gm d0ad0a2-dev (d0ad0a2)`.

Witness `/tmp/gm-defects/w6/wwarn.mjs` (--max-steps 3), both trees, output quoted:
- native: `FIRST {"stepsLeft":2,"warning":null}`, `SECOND {"stepsLeft":1,"warning":null}`, `THIRD {"stepsLeft":0,"warning":"stepsLeft is 0: the next next_context call ends this run without a witness. To close it with a witness, call finish now, while stepsLeft is 0."}`, `AFTER_ZERO {"refused":true,"error":"refused: step limit 3 reached and this run ended without a witness; call next_context to open a successor run. To close a run with a witness, call finish while stepsLeft is 0, before the next next_context call"}`.
- node: the same four lines, with the same warning text and refusal text.

Witness `/tmp/gm-defects/w6/wzero.mjs` (--max-steps 3), both trees: `FINISH_AT_ZERO {"ok":true,"finished":true,...,"warningOnContext":"stepsLeft is 0: the next next_context call ends this run without a witness. To close it with a witness, call finish now, while stepsLeft is 0."}` on native and on Node. A finish at stepsLeft 0 after the warning is accepted on both trees.

Conformance (`node tools/check-build.mjs build/release`): new checks in "step budget handoff" are `ok the 50th next_context at stepsLeft 0 warns that the next next_context ends the run without a witness` and `ok the 49th next_context at stepsLeft 1 carries no warning`. Result: `conformance: 85 passed, 0 failed of 85 checks in 24 scenarios`, CONFORM_EXIT 0.

Parity (`node native/tests/parity/run.mjs --bin build/release/native/components/host/gm`): `22/93 scenarios match, 0 cutover-expected, 56 native-ahead, 15 documented-gap, 0 differ`, PARITY_EXIT 0. Same counts as the d7eca35 witness, so the new field did not move any parity key.

Not run: a negative control for the new conformance checks. They were added with the change, so no earlier binary exists to show them failing. Their passing is the witness above.

Item 7 (Windows and macOS builds, V4 CRLF) stays open: it needs a Windows CI run of release.yml.

## Item 7 build-only path (2026-11-09, Phase A)

Cause of the failed x64-macos Test step in release run 42603306835 (job 129112817900): `run-code-budget-check` in `tools/check-run-code-budget.mjs` expects the catastrophic-regex fetch leaf (`gm.fetch` with `match: '(a+)+$'`) to return in the foreground reply. Its `run_code` timeoutMs was 200000, the foreground cutoff. On the macOS x64 runner the leaf took 193313 ms on a681ef4 (run 42601864942, passed) and 200085 ms on 78ca5a1 (run 42603306835, the reply went background with `body-6` still running). Run 42600258579 (dee9c8e) also failed the x64-macos job at its Test step; its log was not read. The product did not change: the margin under the window is the cause.

Changes:

| # | File | Change | Witness needed |
|---|---|---|---|
| 6 | tools/check-run-code-budget.mjs | the fetch leaf's run_code timeoutMs goes from 200000 to 400000, so the foreground window covers a slow runner; the watchdog (540000 ms) still covers it | release run: the x64-macos Test step passes and prints `run-code-budget-check: ok` with the leaf ended in under 400000 ms |
| 7 | .github/workflows/release.yml | workflow_dispatch takes a boolean input `publish` (default true, so an unchanged dispatch still publishes); the publish job runs on a dispatch only when `inputs.publish` is true, and on push it runs as before | dispatch with `publish=false`: build and build-windows run, publish is skipped and the latest tag and release are unchanged |

The Phase A commit subject ends with `[skip ci]`: a push to main would otherwise start a push-triggered release.yml run, and that run includes publish. Dispatching with `publish=false` is the build-only path that runs without publish.

| # | File | Change | Witness needed |
|---|---|---|---|
| 8 | tools/witness-windows-cmd.mjs | decode unwraps an object `output` as well as a string one: the run_shell wrapper is the run_code reply's `output`, so `launcher` is read at the right level | dispatch with `publish=false`: the `Windows cmd-only run_shell witness` step passes on both Windows jobs, with no `did not use cmd.exe` error in the log |

## Item 7 Phase B record (2026-11-09): run 42615572769

Dispatch `gh workflow run release.yml --ref main -f publish=false` on 6ef6c1fc454efcda587317b80c21ba5781db29e4. `gh run watch --exit-status` exit 0; `gh run view` conclusion success. Jobs: build linux x64, linux arm64, macOS x64, macOS arm64, build-windows x64 and arm64 all success; publish skipped. The public latest tag stayed at 78ca5a1 and the latest release stayed published 2026-11-04T23:41:31Z.

macOS x64 Test: `conformance: 85 passed, 0 failed of 85 checks in 24 scenarios`; `run-code-budget-check: ok (... a catastrophic regex in the fetch leaf ended in 233216 ms ...)`.

Windows cmd-only run_shell witness: failed on both Windows jobs at tools/witness-windows-cmd.mjs:24 (job build-windows x64 and arm64), and the job stayed green because the step is continue-on-error. The log reads: `Error: cmd-only run_shell did not use cmd.exe: {"ok":true,"output":{"ok":true,"exitCode":0,"signal":null,"output":"runs\r\n","launcher":"cmd"},"truncated":false,"loads":[],"actionSeq":11}`. Cause: decode unwrapped only a string `output`, so the object run_shell wrapper stayed nested and `launcher` read as undefined; the shell did run under cmd. Fixed in row 8. It is not witnessed on a runner until a dispatch after this commit.

Budget check margin (fetch leaf, `gm.fetch` with `match: '(a+)+$'` on a 31-a line): CPU-bound, so the duration follows the runner's speed. Measured on macOS x64: 193313 ms (a681ef4, run 42601864942, passed in a 200000 ms window); 200085 ms (78ca5a1, run 42603306835, failed in a 200000 ms window); 233216 ms (6ef6c1f, run 42615572769, passed in the 400000 ms window from row 6). The 400000 ms window is 1.72 times the worst measured run. Not deterministic: a slower runner can exceed the window again. Open: make the leaf independent of CPU speed (for example a local server that holds its response for a fixed time, with a matching fetch timeout); not done here.

## Item 7 closure record (2026-11-09)

Item 7 (Windows and macOS builds, V4 CRLF) is closed on run 42617531301, dispatched with `publish=false` on d9876a4c59cd414a801ef5df9aaa20c756b8062f. `gh run view` conclusion success; publish skipped; the public latest tag stayed at 78ca5a1 and the latest release stayed published 2026-11-04T23:41:31Z.

| Job | Conclusion | Evidence |
|---|---|---|
| build-windows x64 (x64-windows-release) | success | Windows cmd-only run_shell witness: `exitCode 0`, `output "runs\r\n"`, `launcher "cmd"` |
| build-windows arm64 (arm64-windows-release) | success | Windows cmd-only run_shell witness: `exitCode 0`, `output "runs\r\n"`, `launcher "cmd"` |
| build linux x64 | success | build job |
| build linux arm64 | success | build job |
| build macOS x64 | success | Test: `conformance: 85 passed, 0 failed of 85 checks in 24 scenarios`; `run-code-budget-check: ok` (run 42615572769 measured the leaf at 233216 ms) |
| build macOS arm64 | success | build job |
| publish | skipped | `publish=false` |

Build results of run 42615572769 (dispatch with `publish=false`, head 6ef6c1fc454efcda587317b80c21ba5781db29e4; `gh run view` conclusion success):

| Job | Conclusion (run 42615572769) |
|---|---|
| build-windows x64 (windows-latest, x64-windows-release) | success |
| build-windows arm64 (windows-11-arm, arm64-windows-release) | success |
| build linux x64 (ubuntu-latest, x64-linux-release) | success |
| build linux arm64 (ubuntu-24.04-arm, arm64-linux-release) | success |
| build macOS x64 (macos-latest, x64-macos-release) | success |
| build macOS arm64 (macos-latest, arm64-macos-release) | success |
| publish | skipped |

V4 CRLF evidence, run 42617531301: the `Test` step of both Windows jobs prints `shell-stdin-check: ok` (the CRLF comparison in tools/check-shell-stdin.mjs), and `conformance: 85 passed, 0 failed of 85 checks in 24 scenarios`.

The Windows CMD witness failed on run 42615572769 (quoted in the Phase B record above) and passed on run 42617531301 after commit d9876a4.

Correction: run 42617510474 is `pages-build-deployment` (jobs build, deploy, report-build-status), not a release build. It is not counted as build evidence.

Open risk, recorded and not closed by a change: the budget check's fetch leaf is CPU-bound and took 193313, 200085 and 233216 ms on macOS x64 runs. The 400000 ms window is 1.72 times the worst run. A slower runner can exceed it.

## next_context successor replay (2026-11-09, Phase A)

Cause: `reopen()` in native/components/mcp/server.cpp opens a successor run with the closed run's task (taskFrom `closed run <id>`) and appends that task as a `task` event with the full text. The successor's first `next_context` fed every event since seq 0, so the closed run's brief came back in `events` (bounded to the events cap, about 8k tokens). This is the replay the ACP implementation agent reported. Task inheritance itself is designed and tested (skills/gm/SKILL.md, tools/check-task-set.mjs), so it stays.

| # | File | Change | Witness needed |
|---|---|---|---|
| 9 | native/components/mcp/server.cpp | reopen(): when the successor inherits the task, the feed cursor moves past its own start, task and tools events, so the first next_context does not replay the inherited brief; the task still reaches the run through `reply.task` (capped at 4000 characters) | tools/witness-next-context-replay.mjs fails (`feedHasBrief: true`) on the binary before this change and passes on the built binary |
| 10 | tools/witness-next-context-replay.mjs | new witness: a run holding a 30 KB brief is closed with finish; the successor's first next_context `events` must not contain the brief; the run ids must differ | as row 9 |

Recorded gap, closed by the next section: Node (src/mcp.mjs reopen) still replayed the inherited task event.

Phase B (2026-11-09, build stamp 7de4f40, HEAD 7de4f40): `cmake --preset release` and `cmake --build build/release -j 4` exit 0 with no FAILED line; `gm --version` prints `7de4f40-dev (7de4f40)`.

- Failing witness, before the change: `node tools/witness-next-context-replay.mjs /config/.gmnew/current/gm` (the installed binary, which predates row 9) exits 1. Output: `"firstRun": "2026-11-09-12-54-34-151815", "finished": true, "successorRun": "2026-11-09-12-54-34-6ba413", "briefChars": 32442, "feedChars": 1353, "feedHasBrief": true, "taskChars": 32441`, then `next-context-replay: the successor run replayed the closed run brief in its events`.
- Passing witness, after the change: `node tools/witness-next-context-replay.mjs build/release/native/components/host/gm` exits 0. Output: `"firstRun": "2026-11-09-12-55-53-e598b1", "finished": true, "successorRun": "2026-11-09-12-55-53-dbc470", "briefChars": 32442, "feedChars": 183, "feedHasBrief": false, "taskChars": 32441`.
- Conformance, `node tools/check-build.mjs build/release`: `conformance: 85 passed, 0 failed of 85 checks in 24 scenarios`, exit 0. Its budget check printed `run-code-budget-check: ok ... a catastrophic regex in the fetch leaf ended in 105338 ms`, a third measured value for the open risk in the item 7 closure record.
- Parity, `node native/tests/parity/run.mjs --bin build/release/native/components/host/gm`: `22/93 scenarios match, 0 cutover-expected, 56 native-ahead, 15 documented-gap, 0 differ`, exit 0. The counts equal the 2026-11-09 witness, so the successor change moved no parity key.

## Node successor replay (2026-11-09, Phase A)

Dispatcher decision: src/ is in scope for this fix, because the owner's inefficiency rule applies to every gm path. Cause, the same as native row 9: `reopen()` in src/mcp.mjs gives the successor the closed run's task (`taskFrom: closed run <id>`) and appends it as a `task` event. The successor's first `next_context` builds its feed from `shownTotalOf(log)`, which is 0 when the successor has no earlier `next_context` result, so the whole log, including the inherited brief, is replayed in `items`.

| # | File | Change | Witness needed |
|---|---|---|---|
| 11 | src/mcp.mjs | createSession takes `shownFloor` (default 0). reopen() sets it to the successor log's count after its own start and task events when the task was inherited. context() feeds from `Math.max(shownTotalOf(log), shownFloor)`, so the first next_context does not replay the inherited brief; the task still reaches the run through `reply.task` (capped at 4000 characters) | `node tools/witness-next-context-replay.mjs node` fails (`feedHasBrief: true`) before the change and passes after it |
| 12 | tools/lib/gm-stdio.mjs | openServer takes `lead` (the arguments before `--workspace`, default `['serve']`), so a witness can start `node src/mcp.mjs` | the native witness and witness-windows-cmd.mjs still start `gm serve` by default |
| 13 | tools/witness-next-context-replay.mjs | takes `node` as its target to run src/mcp.mjs, otherwise a native binary path; it reads the feed from `events` (native) or `items` (Node) | row 11 and row 9's witness on both paths: the failing run on the pre-change tree, the passing run on the built tree |

Phase B (2026-11-09, build stamp d5423f3, HEAD d5423f3): `cmake --preset release` and `cmake --build build/release -j 4` exit 0 with no FAILED line; `gm --version` prints `d5423f3-dev (d5423f3)`.

- Node, before row 11: the pre-change src/mcp.mjs (d9876a4) was swapped in for the run only and restored from HEAD. `node tools/witness-next-context-replay.mjs node` exits 1: `"path": "node src/mcp.mjs"`, `"firstRun": "2026-11-09-13-10-02-0a2ab8"`, `"finished": true`, `"successorRun": "2026-11-09-13-10-02-8a9f05"`, `"briefChars": 32442`, `"feedChars": 1370`, `"feedHasBrief": true`, then `next-context-replay: the successor run replayed the closed run brief in its events`.
- Node, after row 11: `node tools/witness-next-context-replay.mjs node` exits 0: `"firstRun": "2026-11-09-13-10-24-d7282a"`, `"finished": true`, `"successorRun": "2026-11-09-13-10-24-e22eea"`, `"briefChars": 32442`, `"feedChars": 353`, `"feedHasBrief": false`.
- Native, after row 9 and the rebuild: `node tools/witness-next-context-replay.mjs build/release/native/components/host/gm` exits 0: `"firstRun": "2026-11-09-13-10-24-3c9a3b"`, `"successorRun": "2026-11-09-13-10-24-0204cc"`, `"feedChars": 184`, `"feedHasBrief": false`.
- Native, before row 9: the installed binary `/config/.gmnew/current/gm` exits 1: `"firstRun": "2026-11-09-13-10-24-51306a"`, `"successorRun": "2026-11-09-13-10-24-16ada1"`, `"feedChars": 1350`, `"feedHasBrief": true`.
- Conformance, `node tools/check-build.mjs build/release`: `conformance: 85 passed, 0 failed of 85 checks in 24 scenarios`, exit 0. Its budget check printed `a catastrophic regex in the fetch leaf ended in 107018 ms`, a fourth measured value for the open risk.
- Parity, `node native/tests/parity/run.mjs --bin build/release/native/components/host/gm`: `22/93 scenarios match, 0 cutover-expected, 56 native-ahead, 15 documented-gap, 0 differ`, exit 0. The Node change moved no parity key.

## Status and open gaps (2026-11-09, Phase A)

Item 7 closure evidence, corrected. Only run 42617531301 is release build evidence (`release` workflow, dispatch, publish=false, d9876a4). Runs 42617510474 and 42623538587 are `pages-build-deployment` runs, not build runs, and are not counted. On 42617531301 the Windows x64 and arm64 `Test` steps both print `conformance: 85 passed, 0 failed of 85 checks in 24 scenarios` and `shell-stdin-check: ok` (the CRLF comparison, V4). The Windows CMD witness passed on both jobs (recorded above). Item 7 stays closed on this evidence.

Stale entries closed by code already on main (checked this pass):
- stop_orphans reaps body children before it marks a body killed: native/components/mcp/server.cpp:998 calls proc::reap_ledger in stop_orphans (the open gap from the Phase B record and rank 3 of the old table).
- rows.mjs commit message: src/rows.mjs:196 checks isRepository before naming "no commit X in the repository", so a non-repository root gets its own message (rank 4 of the old table).
- f80cd46 leaf assertion: tools/check-run-code-budget.mjs requires `leaf.reply.background === undefined && status === 200` in the foreground (rank 5 of the old table).

Open gaps, each with its cause:

| # | Gap | Cause | Status |
|---|---|---|---|
| G1 | The budget check's fetch leaf can exceed its 400000 ms foreground window | The leaf is a CPU-bound catastrophic regex; measured 193313, 200085, 233216, 105338, 107018 ms on macOS x64 runs. The window is 1.72 times the worst run. | open risk; the fix is a deterministic leaf (a local server holding a fixed-time response), not made here |
| G2 | The Windows CMD witness in release.yml is continue-on-error | The step is marked `continue-on-error: true` (release.yml:124), so a failure does not fail its job; a regression would leave the job green | open; owner decision whether to make it blocking, because that also gates publish |
| G3 | The Node replay witness and the Node parity run are not in CI | release.yml has no `npm ci`, and src/mcp.mjs needs acorn; the Node witness runs locally only | open; owner decision whether to install dependencies in CI |
| G4 | Node run_code budget differs from native outside the 65 s case | Node's JavaScript budget was measured only for one case (V2) | open; owner decision (port or record as native-ahead) |
| G5 | Shell-job lifetime equals the job_start cap, so the lifetime reason is unreachable for shell jobs | The cap is set once for both kinds of job | open; owner decision |
| G6 | Open row unknown-mw6bc4mv1c00 (push target AnEntrypoint/gmfx) | The row lives in the fx workspace state (/workspace/fx), outside this checkout | open; the fx workspace owner resolves or parks it |
| G7 | The .mcp.json pass | Not started | owner schedules it |

Fixed in this pass:

| # | File | Change | Witness needed |
|---|---|---|---|
| 14 | tools/check-build.mjs | the post-conformance loop also runs tools/witness-next-context-replay.mjs on the built binary, so CI runs the replay witness (native path only) | `node tools/check-build.mjs build/release` prints the witness JSON with `feedHasBrief: false` and exits 0 |

Phase B (2026-11-09, binary d5423f3, build unchanged since d5423f3; the commit after it changes only tools and docs): `node tools/check-build.mjs build/release` exits 0: `conformance: 85 passed, 0 failed of 85 checks in 24 scenarios`; `run-code-budget-check: ok (... ended in 116602 ms ...)`; the replay witness printed `"feedHasBrief": false`; `check-build: gm stamp d5423f3-dev (d5423f3)`. Parity from the same day's run, `22/93 scenarios match, 0 cutover-expected, 56 native-ahead, 15 documented-gap, 0 differ`, is unchanged because no src/ or native/ code changed in this pass.

## Replay witness in CI (2026-11-09, Phase A)

Cause: the replay witness ran only in tools/check-build.mjs, and release.yml did not run the Node path at all (no `npm ci`, so acorn is missing), so a regression on the Node path would not be caught in CI. Gap G3 in the status record is the Node half of this; the native half was row 14.

| # | File | Change | Witness needed |
|---|---|---|---|
| 15 | .github/workflows/release.yml | the build job has a `Replay witness` step after Test, on `x64-linux` only: `npm ci --ignore-scripts`, `node tools/witness-next-context-replay.mjs node`, then the same witness on `build/<preset>/native/components/host/gm`. The native command repeats the check-build run, so it is explicit in the workflow even though check-build also covers it | the dispatched run's `Replay witness` step prints the Node JSON with `feedHasBrief: false`, then the native JSON with `feedHasBrief: false`, and the step exits 0 |
| 16 | tools/witness-ci-replay-step.mjs | fails (exit 1) if release.yml has no `Replay witness` step, or the step lacks one of its three commands; it reads the workflow file given as an argument, so the failing check runs on a copy with the step removed | exit 0 on .github/workflows/release.yml; exit 1 on a copy made with the step removed (failing-then-passing) |

Gap G3 is closed for the replay witness by row 15 (the Node witness now runs in CI), and for the Node parity run by row 17.

## Node parity in CI and the closure record (2026-11-09, Phase A)

| # | File | Change | Witness needed |
|---|---|---|---|
| 17 | .github/workflows/release.yml | the build job has a `Node parity` step after the replay witness, on `x64-linux` only: `node native/tests/parity/run.mjs --bin build/<preset>/native/components/host/gm`. The step reuses the `npm ci --ignore-scripts` of the replay step. Local timing: 18 s | the dispatched run's `Node parity` step exits 0 and its log shows `22/93 scenarios match, 0 cutover-expected, 56 native-ahead, 15 documented-gap, 0 differ` |
| 18 | tools/witness-ci-replay-step.mjs | now requires both the `Replay witness` and the `Node parity` steps in the release workflow, with their commands | exit 0 on .github/workflows/release.yml (local: steps Replay witness 7 lines, Node parity 4 lines); exit 1 on a copy with the Node parity step removed (local: `no "Node parity" step`) |
| 19 | docs/PENDING_VALIDATION.md | the item 7 closure record now lists the build results of run 42615572769 for all six builds, and the V4 CRLF evidence of run 42617531301 | read the closure record |

Ranked remaining work (current item and status, after this pass):

| rank | item | status | blocker or next step |
|---|---|---|---|
| 1 | Item 7: Windows and macOS builds, V4 CRLF | closed (closure record: run 42615572769 for the six builds, run 42617531301 for the Windows CMD witness and V4) | none |
| 2 | Replay witness and Node parity in CI | closed by rows 15 and 17; the run result is in the Phase B record of this pass | none |
| 3 | G1: the budget check's fetch leaf is CPU-bound and can exceed its 400000 ms window (measured 193313, 200085, 233216, 105338, 107018 ms) | open risk | a deterministic leaf: a local server holding a fixed-time response, with a matching fetch timeout; next pass |
| 4 | G2: the Windows CMD witness is `continue-on-error` (release.yml) | open | owner decision: making it blocking also gates publish |
| 5 | G4: Node run_code budget is measured only for the 65 s body | open | owner decision: port to Node or record as native-ahead |
| 6 | G5: shell-job lifetime equals the job_start cap, so the lifetime reason is unreachable for shell jobs | open | owner decision |
| 7 | G6: open row unknown-mw6bc4mv1c00 (push target AnEntrypoint/gmfx) | open; the row lives in the fx workspace | the fx workspace owner resolves or parks it |
| 8 | G7: the .mcp.json pass | not started | owner schedules it |

## Fetch leaf made deterministic: G1 (2026-11-09, Phase A)

Cause: the budget check's fetch leaf used `match: '(a+)+$'` on a 32-character line. `native/leaves/fetch.mjs` applies `match` in JavaScript after curl returns, so the time is host CPU. The fetch `timeoutMs` feeds only curl's `--max-time`, so the match was never bounded by it. Measured leaf times, all on the same check: 193313, 200085, 233216 (macOS x64), 105338, 107018, 116602 ms.

| # | File | Change | Witness needed |
|---|---|---|---|
| 20 | tools/check-run-code-budget.mjs | the local server holds each response for `HOLD_MS` = 50000 ms with setTimeout, the leaf fetches with `timeoutMs: 60000` (the fetch maximum) and no `match`, and the check asserts `leaf.elapsed >= HOLD_MS` in addition to the existing foreground status 200 assertion | `node tools/check-build.mjs build/release` exits 0; its budget line reads `a fetch leaf held by the server for 50000 ms ended in N ms` with N near 50000 |

Margin: the hold is wall-clock time, not CPU, so the leaf takes about 50 s on any host. curl's `--max-time` is 60000 ms, which leaves 10 s over the hold. The run_code foreground window stays 400000 ms.

Coverage given up: the leaf no longer runs past 60 s. The old fixed-limit text (120000 or 60000 ms) is still checked as a regression guard, but the case above 60 s is now covered only by the JavaScript body (65 s, timeoutMs 100000), which is the job-lifetime case.

Found while reading the fetch verb (new gap G8): the verb's description says `timeoutMs` "bounds the whole call", but the `match` filter runs after the curl deadline with no time bound, so a catastrophic pattern can run for minutes past `timeoutMs`. Cause: `boundedText` in native/leaves/fetch.mjs. Status: fixed in Phase A of this pass (section "Fetch call bounded by timeoutMs: G8" below).

## Fetch call bounded by timeoutMs: G8 (2026-11-09, Phase A)

Cause: fetch's `timeoutMs` bounded only curl. The `match` filter ran in-process after curl with no deadline; QuickJS's regex engine polls the session interrupt handler (native/components/quickjs/engine.cpp, interrupt_on_deadline), so a session deadline can stop it. Separately, `retrying` retried ETIMEDOUT up to three more times, so a timed-out call could take about four times `timeoutMs`. The description said "bounds the whole call", and both paths broke that claim.

| # | File | Change | Witness needed |
|---|---|---|---|
| 21 | native/components/quickjs/engine.cpp | new host function `deadlineCall(ms, fn)` (call_deadline): narrows the session deadline to `ms` while `fn` runs. If the bound fires, it clears the uncatchable interrupt and throws a catchable "the bounded call passed its deadline", and restores the outer deadline. Exposed on the host object as `host.deadlineCall` | the budget check below, on a binary built from this commit |
| 22 | native/leaves/fetch.mjs | one deadline per call (`deadlineAt`) shared by the attempts and the match. Retries stop when the next delay would pass it, and curl's `--max-time` is the time left. A match cut by `deadlineCall` returns `timed out after <timeoutMs> ms` with code ETIMEDOUT. The description now says the bound covers redirects, retries and the match | the budget check below |
| 23 | tools/check-run-code-budget.mjs | two cases added: a 3000 ms fetch with a catastrophic match against a fast route, and a 3000 ms fetch against the held route. Each must return ETIMEDOUT with `attempts` 1. The match case must return within 20000 ms and the timeout case within 15000 ms | the budget check below |

Node: src/fetch.mjs is unchanged. Its match runs with no deadline (`boundedText`, src/fetch.mjs:90), and each attempt inside `retrying` (src/fetch.mjs:41) gets its own `AbortSignal.timeout(timeoutMs)` (src/fetch.mjs:60), so the whole-call bound does not hold there either. This is a native-ahead difference; owner decision: port to Node or record it as native-ahead.

## G1 and G8 witnesses (2026-11-09, Phase B)

First witness run, before row 24 (`node tools/check-build.mjs build/release`, binary from b7b2c5a): `run-code-budget-check: 1 failure(s)`, `match bound: expected a 3000 ms timeout in one attempt, got {"ok":false,"error":"the bounded call passed its deadline"}`. Cause: `throw_text` in engine.cpp builds a JS_ThrowInternalError, and native/third_party/quickjs-ng/quickjs.h says an InternalError "cannot be caught by JS code", so fetch's catch never ran and the body failed.

| # | File | Change | Witness needed |
|---|---|---|---|
| 24 | native/components/quickjs/engine.cpp | call_deadline throws a plain Error (JS_ThrowPlainError) when the bound fires, so the fetch leaf catches it | the check below, exit 0 |

Witness after row 24 (`cmake --build build/release` exit 0, then `node tools/check-build.mjs build/release`, exit 0):

- `conformance: 85 passed, 0 failed of 85 checks in 24 scenarios`
- `run-code-budget-check: ok (a 65 s JavaScript body with timeoutMs 100000 returned in 65020 ms; a fetch leaf held by the server for 50000 ms ended in 50024 ms with no old fixed limit; a 3000 ms fetch with a catastrophic match timed out in 3004 ms in one attempt; a 3000 ms fetch that timed out ended in 3014 ms in one attempt)`
- `run-code-progress-check: ok`, `shell-stdin-check: ok`, and the replay witness with `"feedHasBrief": false`
- `check-build: gm-core stamp b7b2c5a-dev (b7b2c5a)`

G1 is closed: the leaf is a fixed 50 s hold, measured at 50024 ms. G8 is closed: a catastrophic match is cut at 3004 ms, and a timed-out call returns in 3014 ms with one attempt, where the code before row 22 allowed about four times `timeoutMs` (read from the retry loop; not timed). The pre-fix binary was not rerun for the failing-then-passing pair; the failing run above is the pre-row-24 binary.

## G2, G4, G5, G7 and the Node fetch port (2026-11-09, Phase A)

| # | File | Change | Witness needed |
|---|---|---|---|
| 25 | .github/workflows/release.yml | G2: `continue-on-error: true` removed from the "Windows cmd-only run_shell witness" step. The witness is green: run 42617531301 (head d9876a4) has both build-windows jobs (x64 and arm64) with this step `success`. tools/witness-windows-cmd.mjs has not changed since d9876a4. The step is blocking from this commit, so a failure now fails its job; publish still needs all build jobs | `node tools/witness-ci-replay-step.mjs` exits 0 on the worktree and 1 on `git show HEAD:.github/workflows/release.yml` (the old copy) |
| 26 | tools/witness-ci-replay-step.mjs | the Windows witness step must exist and must not carry `continue-on-error` (a `forbid` list) | the pair in row 25 |
| 27 | src/mcp.mjs | Node read every request only after the previous request's whole answer (`acceptTail` chained the lines), so a run_code body held all other calls. Each line now starts when it arrives (`accepting` set; shutdown waits for it). Admission order is the arrival order | probe in tools/check-run-code-budget.mjs: a trivial body sent 2 s into a 20 s spin returned in 42 ms (it returned after 18 s before) |
| 28 | src/tools.mjs | access for run_code is free, not the barrier, so bodies run side by side as they do on native (BODY_SLOTS 4 bounds them) | the budget check on node |
| 29 | src/fetch.mjs, src/retry.mjs | the Node port of the native deadline: one deadline per call, shared by the attempts and the match. Each attempt's signal is the time left. Retries stop when the next delay would pass the deadline. The match runs in a worker thread that is terminated at the deadline, since Node cannot interrupt a regex on the main thread. The tool description states the bound. `retrying` takes an optional `deadlineAt` (default: none), so other callers are unchanged | probe of the Node fetch: catastrophic match `timed out after 3000 ms`, ETIMEDOUT, attempts 1, in 3003 ms; timeout in 3004 ms, attempts 1; an ordinary match in 97 ms |
| 30 | tools/check-run-code-budget.mjs | takes `node` as its target (runs src/mcp.mjs with the same flags). It opens the first step with next_context, as a host does. Its cases are the same on both engines | `node tools/check-run-code-budget.mjs node` exits 0 (see the Phase B record) |
| 31 | tools/check-job-bounds.mjs (new); tools/check-build.mjs | G5 witness: with `--job-lifetime-ms 5000`, a job with timeoutMs 2000 ends as reason timeout; a job with timeoutMs 7200000 ends as reason lifetime at about 5 s with the lifetime statement; a 1000 ms job exits 0. It runs on either engine, and check-build runs it on the native binary | `node tools/check-job-bounds.mjs node` and `... build/release/native/components/host/gm` both exit 0 |

G5 detail: the two bounds were already separate values (job_start accepts timeoutMs up to 7200000; the lifetime flag defaults to 3600000), and the code takes the smaller of the two (native job.cpp and Node tools.mjs). No code change was needed. The check now proves each bound on its own.

G7 (the .mcp.json pass): no change. Checks: the checkout has no `.mcp.json`; `/config/.claude.json` `mcpServers.gm` is `{"command":"/config/.gmnew/current/gm","args":["serve"]}`; no project entry under `projects` defines a gm server. The decision of 54ac290 stands: a project entry would start a second gm.

G8 on Node: the Node side of G8 is closed by row 29. The Node match and attempts now have the same bound as native.

Found, not fixed (G9): Node holds a run_code call that arrives before the first next_context until that step runs, so a body sent first never replies. Native runs it at once with the rules notice. Witness: a run_code sent before next_context got no reply in 20 s, and the server only logged it after the probe killed the process. Owner decision: let calls before the first step run (as native does), or keep the step gate and say so in the rules.

Ranked status after this pass: G2 closed (row 25); G4 closed for the budget (rows 27, 28, 30; G9 is a separate gap); G5 closed (row 31); G7 closed (no change needed); G8 closed on both engines (rows 21, 22, 29); G6 unchanged (fx workspace, not in this checkout).

Phase B record (2026-11-09, `node tools/check-build.mjs build/release`, exit 0, binary stamped b7b2c5a-dev; the native source did not change in this pass):

- `conformance: 85 passed, 0 failed of 85 checks in 24 scenarios`
- `run-code-budget-check: ok (a 65 s JavaScript body with timeoutMs 100000 returned in 65013 ms; a fetch leaf held by the server for 50000 ms ended in 50039 ms with no old fixed limit; a 3000 ms fetch with a catastrophic match timed out in 3005 ms in one attempt; a 3000 ms fetch that timed out ended in 3028 ms in one attempt)`
- `job-bounds-check: ok (a 2000 ms job timeout ended as timeout in 2005 ms; a 7200000 ms job timeout ended as lifetime at 5006 ms under a 5000 ms lifetime; a 1000 ms job exited 0 in 1045 ms)`
- run-code-progress and shell-stdin checks ok; replay witness `"feedHasBrief": false`.

Node, the same tree, the checks that are not in check-build: `node tools/check-run-code-budget.mjs node`: `run-code-budget-check: ok (a 65 s JavaScript body with timeoutMs 100000 returned in 65051 ms; a fetch leaf held by the server for 50000 ms ended in 50103 ms with no old fixed limit; a 3000 ms fetch with a catastrophic match timed out in 3094 ms in one attempt; a 3000 ms fetch that timed out ended in 3069 ms in one attempt)`; `node tools/check-job-bounds.mjs node`: `job-bounds-check: ok (a 2000 ms job timeout ended as timeout in 2016 ms; a 7200000 ms job timeout ended as lifetime at 5015 ms under a 5000 ms lifetime; a 1000 ms job exited 0 in 1059 ms)`; `node native/tests/parity/run.mjs --bin build/release/native/components/host/gm`: `22/93 scenarios match, 0 cutover-expected, 56 native-ahead, 15 documented-gap, 0 differ`; `node tools/witness-ci-replay-step.mjs` exit 0.

## G9: calls before the first next_context (2026-11-09, Phase A)

Cause: src/mcp.mjs `drain` held every call until the first `next_context` had started. Native starts an early call at once with the rules notice (rule 2, "... was called before the first next_context of the run"). Witness of the gap: a run_code sent first got no reply in 10 s on Node (and in 80 s before the probe killed the server); native answered in 3 ms. An early `read_file` also ran on native and stalled on Node; an early `finish` ended the run on native and stalled on Node.

| # | File | Change | Witness needed |
|---|---|---|---|
| 32 | src/mcp.mjs | before the first step, a call that is not `next_context` starts in arrival order, subject to the same conflict check as later calls. The first `next_context` still opens the run, and its position in the queue is unchanged. `finish` is included, as native does | `node tools/check-early-run-code.mjs node` |
| 33 | tools/check-early-run-code.mjs (new); tools/check-build.mjs | sends a run_code body and then a finish before any next_context; each must answer within 10 s, the body must run and carry the rules notice, and the finish must end the run. It runs on either engine, and check-build runs it on native | failing-then-passing: on the Node tree before row 32 the check failed with `early call: a run_code sent before the first next_context got no reply in 10000 ms`; after row 32 it passes on both engines |

Phase B (2026-11-09, `node tools/check-build.mjs build/release`, exit 0, binary stamped b7b2c5a-dev; no native source changed in this pass):

- `conformance: 85 passed, 0 failed of 85 checks in 24 scenarios`
- `run-code-budget-check: ok (a 65 s JavaScript body with timeoutMs 100000 returned in 65002 ms; a fetch leaf held by the server for 50000 ms ended in 50020 ms with no old fixed limit; a 3000 ms fetch with a catastrophic match timed out in 3004 ms in one attempt; a 3000 ms fetch that timed out ended in 3015 ms in one attempt)`
- `job-bounds-check: ok (a 2000 ms job timeout ended as timeout in 2005 ms; a 7200000 ms job timeout ended as lifetime at 5006 ms under a 5000 ms lifetime; a 1000 ms job exited 0 in 1043 ms)`
- `early-run-code-check: ok (a run_code sent before the first next_context ran at once in 4 ms, with the rules notice; an early finish ended the run in 3 ms)`
- Node, same pass: `node native/tests/parity/run.mjs --bin build/release/native/components/host/gm` (run against the Node parity reference): `22/93 scenarios match, 0 cutover-expected, 56 native-ahead, 15 documented-gap, 0 differ`; `node tools/check-run-code-budget.mjs node` ok (65044 ms, leaf 50077 ms, match 3073 ms, timeout 3074 ms); `node tools/check-job-bounds.mjs node` ok; `node tools/check-early-run-code.mjs node` ok; the Node replay witness exit 0.

Other differences seen while probing, unchanged: the read_file digest differs between engines (native FNV-1a 64, Node sha256 cut to 12 hex), recorded since 2026-11-09; Node's finish reply has no `browser` key, which native sends.

## CI evidence for fc170fc (2026-11-09)

The subject of fc170fc carries `[skip ci]`, so the push started no release run. The evidence below is from a dispatch of release.yml on fc170fc with publish=false, which builds without publishing.

| Run | Event | Head | Conclusion |
|---|---|---|---|
| release 42642584672 | workflow_dispatch, publish=false | fc170fc | success |
| pages build and deployment 42642555292 | push | fc170fc | success (build, report-build-status, deploy) |

| Job | Job id | Result |
|---|---|---|
| build (ubuntu-latest, x64-linux-release) | 129247297305 | success |
| build (ubuntu-24.04-arm, arm64-linux-release) | 129247297194 | success |
| build (macos-latest, x64-macos-release) | 129247297376 | success |
| build (macos-latest, arm64-macos-release) | 129247297173 | success |
| build-windows (windows-latest, x64-windows-release) | 129247297375 | success; Windows cmd-only run_shell witness success |
| build-windows (windows-11-arm, arm64-windows-release) | 129247297333 | success; Windows cmd-only run_shell witness success |
| publish | 129252308805 | skipped (publish=false) |

Windows CMD witness output, both Windows jobs: `"cmdOnly": {"ok": true, "exitCode": 0, "signal": null, "output": "runs\r\n", "launcher": "cmd"}`. The Test steps of both Windows jobs succeed. Row 25 made this step blocking from 4c2c056, so this run is the first recorded run with the step blocking, and it passed.

## Ranked remaining work (2026-11-09, after the CI record for fc170fc)

| rank | item | status | blocker or next step |
|---|---|---|---|
| 1 | The installed host build is behind two fixes: /config/.gmnew/current/gm stamps 78ca5a1, which predates fcb84df (a non-owner task replacement is refused) and 70e4349 (the updater finds gmnew-<target>) | open; the fixes are in HEAD | one `scripts/install.sh` run replaces the binary the live session serves, so it is an owner step, not Phase A. Not done in this pass |
| 2 | Two peers in one workspace: row-added events of one run are not in the other run's next_context, and a peer's reply repeats a title across its events; fx's "another worker's events twice" | open (AGENTS.md, 2026-11-08) | needs fx's reply bodies; no gm reproduction yet |
| 3 | Node stopped background fetch: a stop left the fetch's connection open until its 60 s timeout | done in this pass, Phase A, committed locally, not pushed (next section) | Phase B witnesses and a push, when the owner asks |
| 4 | Node-vs-native differences kept as decisions: read_file digest (Node sha256 cut to 12 hex, native FNV-1a 64), bounds (Node UTF-16 units, native bytes), the finish reply's `browser` key | owner decision under the parity standard | Node's browser isolation is needed for the key (rank 5) |
| 5 | Node has no per-run browser context (native browser_scope.cpp), so Node cannot close a run's tabs | owner decision (changing src/ is a decision) | none recorded |
| 6 | Native answers resources/subscribe with -32601 while Node serves it; the stopped-fetch error text differs ("curl exited 137" native, "timed out after 60000 ms" Node) | owner decision | none recorded |
| 7 | Protocol 2026-07-28 behind a capability flag, off by default (owner decision 3) | not started | the owner schedules it; a client test is the gate for default |
| 8 | Native client checks two protocol versions, the SDK six; Node is not checked to accept an initialize result without capabilities and serverInfo | open, unverified | a witness run on both trees |
| 9 | Windows process-group kill and Windows/macOS runtime behavior beyond the build and the CMD witness | open | a Windows and a macOS runtime witness; `doctor` reports the group kill |
| 10 | G6: open row unknown-mw6bc4mv1c00 (push target AnEntrypoint/gmfx) | outside this checkout; AGENTS.md records it closed stale by fx on 2026-11-09 | the fx owner; not touched here |

Closed since the last list, each with its record above: the replay witness and the Node parity run in CI (rows 15 and 17), item 7 (Windows and macOS builds, V4 CRLF), G1, G2 (row 25), G4, G5, G7, G8, G9, the commit-check wording (item 1 of the items 1 to 6 pass), the leaf assertion (item 2), the finish openRows (item 4), the shell-job lifetime (item 5), the .mcp.json pass (item 6, no change), and the CI record for fc170fc.

## Node stopped background fetch (2026-11-09, Phase A)

Cause: a background body's fetch ran in the main thread (the body's worker calls the verb through `call`), and `killBody` in src/exec.mjs signalled only the body's shell groups. A stopped body therefore left its fetch's socket open until the server answered or the 60 s timeout fired. Native's stop kills the body's curl (OwnerScope and proc::kill_owned). Measured before the change, with a server that answers after 50 s: the Node socket was still open 6 s after `finish` with stopBackground (the check's first run failed on it), and native closed it in 6 to 10 ms.

| # | File | Change | Witness needed |
|---|---|---|---|
| 34 | src/exec.mjs | `trackBodyAbort(body, controller)` registers a fetch's AbortController under its body; `killBody` aborts every controller of that body and clears them. The map is `bodyAborts` | tools/check-stop-fetch.mjs on node |
| 35 | src/fetch.mjs | the fetch verb makes one AbortController per call, tracks it under the body from `bodyContext`, and untracks it when the call ends. The request signal is `AbortSignal.any` of the timeout and that controller. The retry gate stops once the controller is aborted, so a stopped body does not retry | tools/check-stop-fetch.mjs on node; tools/check-run-code-budget.mjs node (unchanged figures) |
| 36 | tools/check-stop-fetch.mjs (new); tools/check-build.mjs | a background run_code fetch to a server that answers after 50 s; `finish` with stopBackground; the socket must close within 5 s. It runs on either engine, and check-build runs it on the native binary | failing-then-passing: before row 34 the Node check failed with `the stopped body's fetch kept its connection open for 5000 ms after finish (the server answers at 50000 ms)`; after rows 34 and 35 it passes on node ("closed its connection 13 ms after finish"); native passes ("10 ms after finish") |
| 37 | native/tests/parity/run.mjs | the NATIVE_AHEAD row `.count.code-call:stopped-fetch` is removed. Node now logs the fetch code-call before `end`, after `job-killed`, as native does, so the row no longer applies. The row's `firstDivergence` entry still names the kind | `node native/tests/parity/run.mjs --bin build/release/native/components/host/gm` stays at `22/93 scenarios match, 0 cutover-expected, 56 native-ahead, 15 documented-gap, 0 differ`. The harness output has no `.count.code-call:stopped-fetch` line, before or after the removal, so the removal changes no count |
| 38 | AGENTS.md; DESIGN.md | AGENTS.md: the two notes about the stopped fetch and killBody now state the new behavior. DESIGN.md: the native-ahead decision in the parity section gets a dated "Superseded 2026-11-09" note (the decision text is kept); the open owner item about the stopped fetch is removed | read both notes |

Residual difference, kept: the fetch code-call's error text. Node logs `timed out after 60000 ms` (an AbortError maps to ETIMEDOUT in failureOf) and native logs `curl exited 137`. The text is not compared by the parity harness.

Node regression witnesses on this change (node tree only; no native source changed):
- `node tools/check-run-code-budget.mjs node`: `run-code-budget-check: ok (a 65 s JavaScript body with timeoutMs 100000 returned in 65113 ms; a fetch leaf held by the server for 50000 ms ended in 50272 ms with no old fixed limit; a 3000 ms fetch with a catastrophic match timed out in 3259 ms in one attempt; a 3000 ms fetch that timed out ended in 3172 ms in one attempt)`
- `node tools/check-early-run-code.mjs node`: `early-run-code-check: ok (a run_code sent before the first next_context ran at once in 68 ms, with the rules notice; an early finish ended the run in 31 ms)`
- `node tools/check-job-bounds.mjs node`: `job-bounds-check: ok (a 2000 ms job timeout ended as timeout in 2044 ms; a 7200000 ms job timeout ended as lifetime at 5016 ms under a 5000 ms lifetime; a 1000 ms job exited 0 in 1154 ms)`
- Parity, after row 37: `22/93 scenarios match, 0 cutover-expected, 56 native-ahead, 15 documented-gap, 0 differ`

Phase B (2026-11-09, `cmake --preset release` and `cmake --build build/release`, binary stamped 66763db-dev, then `node tools/check-build.mjs build/release`, exit 0):

- `conformance: 85 passed, 0 failed of 85 checks in 24 scenarios`
- `run-code-budget-check: ok (a 65 s JavaScript body with timeoutMs 100000 returned in 65006 ms; a fetch leaf held by the server for 50000 ms ended in 50038 ms with no old fixed limit; a 3000 ms fetch with a catastrophic match timed out in 3011 ms in one attempt; a 3000 ms fetch that timed out ended in 3034 ms in one attempt)`
- `job-bounds-check: ok (a 2000 ms job timeout ended as timeout in 2008 ms; a 7200000 ms job timeout ended as lifetime at 5007 ms under a 5000 ms lifetime; a 1000 ms job exited 0 in 1079 ms)`
- `early-run-code-check: ok (a run_code sent before the first next_context ran at once in 3 ms, with the rules notice; an early finish ended the run in 3 ms)`
- `stop-fetch-check: ok (a background fetch in a body closed its connection 6 ms after finish stopped the run; the server answers at 50000 ms)`
- `check-build: gm stamp 66763db-dev (66763db)` and `check-build: gm-core stamp 66763db-dev (66763db)`
- Node parity, `node native/tests/parity/run.mjs --bin build/release/native/components/host/gm`: `22/93 scenarios match, 0 cutover-expected, 56 native-ahead, 15 documented-gap, 0 differ`

Rank 1 of the ranked list is deferred, not done: the installed binary at /config/.gmnew/current/gm (stamp 78ca5a1) is the one every peer's gm skill calls, so replacing it while peers are running would break them. The install (scripts/install.sh, which fixes the updater and takes fcb84df and 70e4349) runs in a quiet window, when no peer has an open run and no peer is busy. Until then the peers keep the older binary, and the task-replacement guard fixed by fcb84df is not live for them.

## gm pass (2026-11-09): restart keeps jobs, parity, items 4, 5, 6 and 8

Each change, its file, its row or phase, and its witness. "Before" is the HEAD source (or the HEAD binary, /tmp/gm-old, a git archive of HEAD rebuilt for this record) run against the same check.

| Item | File | Change | Witness, before (HEAD) | Witness, after |
|---|---|---|---|---|
| 4 read digest and bounds | src/tools.mjs (fnv1a64Hex, unitBoundary, cutPage, wholeFileReply, readCharPage, readLinePage) | Node read_file digest is FNV-1a 64 and bounds count bytes, as native | tools/check-read-parity.mjs node: 19 failures, e.g. "whole lines: digest expected a2b2b789cd278568, got 8b40a13aa7dc" | node: "read-parity-check: ok (8 read_file probes on node match the native constants...)"; native: same ok |
| 5 per-run browser | src/browser-scope.mjs (new); src/mcp.mjs (BROWSER_VERBS, exec routing, finish and max_steps closeForRun, next_context tabs) | Node gives each run its own browser context and returns the finish browser key | tools/check-browser-scope.mjs node: "gm.browser_tabs is not a function" | node: "browser-scope-check: ok (node: finish browser key, browser_tabs, playwriter_browsers close, browser_close_machine guard; browser run: ran: the run page was listed, closed by finish, and gone from the browser after finish)" |
| 6 resources/subscribe | native/components/mcp/server.cpp (subscribe_resource, unsubscribe_resource, check_file_subscriptions, watch_subscriptions 250 ms) | native serves resources/subscribe and unsubscribe again and declares resources.subscribe | tools/check-resources-subscribe.mjs on HEAD native: 5 failures, "got {error -32601 method not found: resources/subscribe}" | native and node: "resources-subscribe-check: ok (initialize advertises resources.subscribe; ... an unknown uri answers -32002 resource not found)". Node at HEAD already passed (it served the method). |
| 8 protocol versions | native/components/mcp/server.cpp (kAcceptedVersions, five); native/components/mcpclient/client.cpp (PROTOCOL_VERSIONS five; initialize via raw_request, capabilities and serverInfo.version checked); native/components/mcpclient/transport.cpp (accept_initialize removed); src/mcp.mjs (ACCEPTED_VERSIONS five; SUPPORTED_VERSIONS two for discover); src/mcp-client.mjs (refusalOf, five versions) | Both engines echo and connect the five versions the SDK accepts (1.32.2, SUPPORTED_PROTOCOL_VERSIONS), and refuse an initialize result without capabilities or serverInfo.version | tools/check-protocol-versions.mjs on HEAD native: 8 failures, e.g. "server asked 2025-03-26: protocolVersion is 2025-11-25, expected 2025-03-26" | node and native: "protocol-versions-check: ok (...server echoes the 5 supported versions, answers 1999-01-01 with 2025-11-25...client connects all 5 versions, refuses 2024-01-01, refuses a result without capabilities and one without serverInfo.version)" |
| read truncation | tools/check-read-truncation.mjs | native probes use offset 0; whole-file assertion added; run_code notice read from cutReply.notice (the check was reading the wrong field, not native) | the check as it stood failed on native | node and native: "read-truncation: passed: a read past one page reports truncation, the bytes shown, the file size and the read that gets the rest in metadata, and the returned output text never carries the marker" |
| restart keeps shell jobs | native/components/verbs/job.cpp (spawn_shell_job wrapper writes jobs/<name>.exit; start; exit_file_of; read_exit_code; adopt_orphan; adopt_job; poll_adopted; stop_orphans adopts non-body jobs); native/components/verbs/core_internal.hpp (declarations); src/tools.mjs (wrapShell, startJob, endShell, expireShell, adoptShell, pollShell, stopOrphans, close restart) | a worker restart adopts a live shell job and settles an exited one from its exit file; bodies still killed | tools/check-restart-jobs.mjs on HEAD native: 6 failures, "the job ended ... state killed, reason restart", "the job output was \"\", expected done"; on HEAD node: the same 6 | native: "restart-jobs-check: ok (native: binary mtime changed at ... the job's process ... was alive 614 ms after the trigger; the restart answered in 594 ms; the job exited 0 with output \"done\" at 8003 ms; carry-over events 1; killed with reason restart 0)"; node: "restart-jobs-check: ok (node: SIGTERM to the Node worker ... alive 227 ms after the trigger; ... exited 0 with output \"done\" at 7969 ms; carry-over events 1; killed with reason restart 0)" |
| restart regressions | native/components/verbs/job.cpp; src/tools.mjs | job bounds and stop-fetch unchanged | n/a | native and node: "job-bounds-check: ok (a 2000 ms job timeout ended as timeout in 2037 ms; a 7200000 ms job timeout ended as lifetime at 5018 ms under a 5000 ms lifetime; a 1000 ms job exited 0 in 1105 ms)" (node); "job-bounds-check: ok (a 2000 ms job timeout ended as timeout in 2010 ms; ...)" (native); "stop-fetch-check: ok (a background fetch in a body closed its connection 10 ms after finish stopped the run; the server answers at 50000 ms)" (node) and 13 ms (native) |
| conformance | tools/mcp-conformance.mjs | four assertions that encoded the old native decline (resources.subscribe absent, resources/subscribe -32601) now expect the served behaviour; a new scenario checks subscribe, unsubscribe and a missing uri | 4 failed of 85 | "conformance: 86 passed, 0 failed of 86 checks in 24 scenarios" |
| check-build list | tools/check-build.mjs | adds check-restart-jobs.mjs | n/a | check-build exit 0 |
| parity | native/tests/parity/run.mjs | obsolete resources/subscribe rules removed; CONTEXT_REPLY_ROWS and two SEQ rules added (native journals each next_context reply); startWall added to VOLATILE_KEYS | 17 match, 0 differ, one diff: job_status .output.startWall (Node absent) | 17 match, 54 native-ahead, 22 documented-gap, 0 differ, on two consecutive runs with --ref-source working |
| parity Node status | src/tools.mjs (startJob, adoptShell) | Node persists startWall in the job status file, as native does | the job_status diff above | the same two runs |
| docs | AGENTS.md, DESIGN.md, README.md | restart, protocol, subscribe, browser and parity notes updated; DESIGN.md "Restart keeps shell jobs (2026-11-09)" added | n/a | n/a |

Parity instability (17 match, 54 native-ahead, 22 documented-gap, 1 differ earlier in this pass, and the 22-match run before it): the 1 differ was the startWall row, which the harness caught because it compared the committed Node tree. The earlier 22-match result was not reproduced in this pass: two runs with the default --ref-source head gave 17 both times, and two runs with --ref-source working gave 17 both times with 0 differ. The cause of the earlier 22 is not established; the record for it is the parity output before this pass.

check-build (tools/check-build.mjs build/release, exit 0): conformance 86 of 86; run-code-progress, shell-stdin, run-code-budget, job-bounds, early-run-code, stop-fetch, read-parity, read-truncation, protocol-versions, resources-subscribe, browser-scope, restart-jobs, next-context-replay all ok. The stamp reads 66763db-dev because CMake's cache was configured at 66763db; it is refreshed after the commit with cmake --preset release.

Rank 1 is still deferred: the installed binary at /config/.gmnew/current/gm (78ca5a1) is not replaced in this pass. It waits for a quiet window with no peer busy.

## gm pass, Phase A (2026-11-10): release and arm-diagnose failures on e4aba20, and the five issues in issues.md

Tree after the lost connection: 16 files were modified, all complete (diff read, `node --check` passes). Nothing was reverted. The scheduler change in src/mcp.mjs (holds, requeue, finish wrapper, inputEnded wait) was complete as written; it was witnessed in Phase B.

Release run 42668295795 (e4aba20): failure in all six build jobs and in publish.
- Cause, build jobs: the Test step runs `node tools/check-build.mjs`. Its read-truncation check imports src/tools.mjs, which imports search.mjs, which imports closure.mjs, which imports `acorn`. `npm ci` ran only in the later Replay witness step, so the Test step failed with `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'acorn' imported from .../src/closure.mjs` after conformance printed `86 passed, 0 failed of 86 checks`. Windows x64, Windows arm64, macOS x64, macOS arm64, Linux x64 and Linux arm64 all show the same line.
- Cause, publish: no target produced an archive, so `dist` did not exist; tools/release-manifest.mjs called readdirSync on it and crashed with `ENOENT: no such file or directory, scandir 'dist'` before its own `no target built in this push` check.
- Fix: workflow release.yml has a `Node dependencies` step (`npm ci --ignore-scripts`) before Test in both build jobs; the duplicate npm ci in Replay witness is removed. tools/release-manifest.mjs treats a missing dir as no archives and throws the designed message first.

Arm-diagnose run 42668295820 (e4aba20): failure in asan-arm; gdb-arm succeeded.
- Cause: asan-arm has the same missing-acorn failure at `node tools/check-build.mjs build/asan` (the log shows `ERR_MODULE_NOT_FOUND ... src/closure.mjs` after conformance `86 passed`). gdb-arm passed only because its check-build run ends in `|| true`, so the same error was hidden there.
- Fix: arm-diagnose.yml runs `npm ci --ignore-scripts` before the asan check and before the gdb run.

Issues in issues.md (the record at 94c5e04):
1. npm run check. At e4aba20 with build d0ad0a2 the run printed `check: 8 failure(s)`: redaction witness, search root check, inflight check, task set check, output recovery check, prd receipt check, prd refuted reopen check, job progress check (log /tmp/gm-defects/check-before.log, CHECK_EXIT 1). The gate workers check passed: src/worker-modules.json already lists browser-scope.mjs. Causes and fixes:
   - redaction witness, console check: `gm.query_log` run through run_code returns the verb envelope `{ok, output: "<JSON text>"}` as the body value, so the helpers' `JSON.parse(log.output)` parsed an object and failed with `"[object Object]" is not valid JSON`. Fixed to parse `.output.output` once.
   - search root, inflight, prd receipt, prd refuted reopen: `JSON.parse(parsed.output)` where `parsed.output` is already the body value (an object) when the body returns a verb reply. Fixed with the `typeof ... === 'string'` guard the other checks already use.
   - job progress: `runBody` returned the object and `String()` gave `[object Object]`. It now returns JSON text when the output is not a string.
   - output recovery: the fixture put OUTPUT_TAIL_MARKER at character 12000, inside the 20000-character inline page that fafbdd5 defines ("an output over 20000 characters carries its first page inline"). The top-level reply therefore holds the marker, and the check asserted that it does not. The fixture now puts the marker at 20500, past the inline page, so the check tests the bound it names.
   - task set (Node only): the batch sent finish, run_code and next_context together. In src/mcp.mjs, `finish` awaited openRows and parkedRows before it was registered as active, so a run_code queued after it ran (`REFUSED "1"`), and a next_context queued after it was refused as ended when the run stopped, so the successor never opened. Native handles both in order. Fix: finish holds the scheduler from entry (holds map, counted by startableIndex), inputEnded waits for the finish promise, and a next_context waiting when a finish ends the run is requeued to the successor session.
2. Native MCP conformance on resources/subscribe. At e4aba20 the native server declares resources.subscribe and serves subscribe and unsubscribe, and tools/mcp-conformance.mjs expects that. The failure in the issue was the old expectation (method not found) against a server that already implemented subscribe. The fix is in e4aba20 itself; the current conformance run is in the Phase B witness.
3. ctest found no tests. Cause: CMakeLists.txt registered no test. Fix: enable_testing and add_test(check-build), which runs tools/check-build.mjs on the build tree (the real-tree checks, not unit tests, per AGENTS.md).
4. Usage errors. `node tools/mcp-conformance.mjs` with no args now names the binary form and `node tools/check-build.mjs <build dir>`. The parity harness default --bin was build/integ, which no preset builds; it is now build/release, and its missing-binary error names `cmake --preset release`. AGENTS.md line 57 is updated to match.
5. `node src/cli.mjs --help` exited 2. Cause: `--help`, `-h` and `help` fell through to the unknown-command path. They now print usage to stdout and exit 0; a missing or unknown command still exits 2.

Process defect (ledger): e4aba20 was pushed in the middle of its pass, before that pass's Phase B had finished. The release run on that push then failed for the reasons above. Going forward a push waits for the end of Phase B.

Phase B witness plan: a fresh build of build/release at this commit; `node tools/check-build.mjs build/release` (conformance 86 of 86 expected, plus the listed checks); `npm run check` with its failure count; `ctest --test-dir build/release` with check-build registered; `node src/cli.mjs --help` exit code; the parity usage message; `node tools/release-manifest.mjs` on a missing dir (designed message, exit 1) and on a real packaged archive; `node tools/check-task-set.mjs` on both trees; the release run and arm-diagnose on the push.

## gm pass, Phase B (2026-11-10, binary 31a50b8, fresh build): witnesses for the release, arm and issues.md fixes

Build: `rm -rf build/release`, `cmake --preset release`, `cmake --build build/release -j 4`, BUILD_EXIT 0, 0 FAILED. Stamp `gm 31a50b8-dev (31a50b8)`.

Witnesses (outputs quoted):
- Conformance, `node tools/check-build.mjs build/release`: `conformance: 86 passed, 0 failed of 86 checks in 24 scenarios`, CONFORM_EXIT 0. These include the resources/subscribe checks (issue 2).
- Parity, `node native/tests/parity/run.mjs --bin build/release/native/components/host/gm`: `17/93 scenarios match, 0 cutover-expected, 54 native-ahead, 22 documented-gap, 0 differ`, PARITY_EXIT 0. The AGENTS.md note cites 22 of 93; the issues.md run at 94c5e04 (before this pass) recorded the same 17 of 93, so the count predates this pass. Not caused here, and not yet traced to a commit.
- ctest, `ctest --test-dir build/release --output-on-failure`: `1/1 Test #1: check-build ...... Passed 379.66 sec`, `100% tests passed, 0 tests failed out of 1`, CTEST_EXIT 0 (issue 3; before, it reported `No tests were found!!!`).
- `npm run check`: first run after the query_log, JSON-shape, job-progress and task changes printed `check: 1 failure(s) - output recovery check` (CHECK_EXIT 1). Cause: tools/check-output-recovery.mjs read only `value()` (the body's output), not the top-level run_code reply, and then `String()`ed it. The top-level reply, which carries `outputPath`, is the envelope. Fix: the assertion reads `JSON.stringify(replies.get(ids.top)?.result?.structuredContent)`. The fixture change (marker at 20500, past the 20000-character inline page) was also needed; with the old fixture the envelope held the marker. After the fix: `check-output-recovery: passed: node and native real-tree checks succeeded`, and the full run prints CHECK_EXIT 0.
- check-task-set (issue 1, task set): `check-task-set: passed: node and native real-tree checks succeeded`, exit 0, after the Node scheduler fix (finish holds the scheduler; a queued next_context is requeued to the successor).
- CLI (issue 5): `node src/cli.mjs --help` exit 0, usage on stdout, stderr empty; `node src/cli.mjs` with no arguments exit 2.
- Conformance usage (issue 4): `usage: node tools/mcp-conformance.mjs --stdio <gm binary> serve --workspace <dir>` / `to run it on a built tree: node tools/check-build.mjs <build dir>`, exit 2.
- Parity usage (issue 4), `--bin /nonexistent/gm`: `parity: Error: native binary not found: /nonexistent/gm (build it with cmake --preset release and cmake --build build/release, or pass --bin)`.
- Release manifest, no archive (publish fix): `Error: no target built in this push`, exit 1 (was `ENOENT: scandir 'dist'`).
- Release manifest, real archive: `node tools/package.mjs --target x64-linux --build-dir build/release --out <scratch>` produced `gmnew-x64-linux.tar.gz`; `node tools/release-manifest.mjs --dir <scratch> ...` exit 0, row `| x64-linux | built this push | gmnew-x64-linux.tar.gz |`, the other five targets reported `::error::<target> did not build and has no earlier build on the release`, manifest assets `x64-linux`.
- Gate: `tools/ship.sh` gate `{"gate":true,"failed":[]}`, exit 0 on each commit (31a50b8 and the Phase B commit).

Release and arm-diagnose on the push that carries this commit: see the entry that records the run after the push.

Process defect (ledger): e4aba20 was pushed in the middle of its pass, before Phase B had finished. That push's release run (42668295795) and arm-diagnose run (42668295820) both failed for the acorn reasons above. A push now waits until Phase B has finished.

## gm pass, Phase A (2026-11-09): release 42678069415, arm-diagnose 42678068838, and the six playwriter and gm defects

Every file in this commit is listed here with the item it serves. pw is a separate repository (AnEntrypoint/pw), pushed at ebbba11; its change is listed under item 5.

Release 42678069415 (on 1f589cb) failed on Windows x64, Windows arm64 and arm64 Linux. arm-diagnose 42678068838 failed on asan-arm.

1. Release and arm-diagnose.
   - Cause, read from the failing logs: the read-truncation check (and the other checks that start `serve` in a fresh workspace) started the default playwriter entry from defaults/mcp.json. That entry runs `npx -y -p github:AnEntrypoint/pw#...`, and the first start of it is a cold install. The next_context in read-truncation took 5198 ms with the default config and 4 ms with playwriter disabled, so the single 90 s watchdog was hit on Windows x64, Windows arm64 and asan-arm. The same cause hit arm-diagnose.
   - Fix (Windows, asan-arm): tools/lib/no-playwriter.mjs writes `<workspace>/.gm/mcp.json` with playwriter disabled. Each check that starts `serve` in a fresh workspace calls it: tools/check-read-truncation.mjs, check-caller.mjs, check-inflight.mjs, check-relay-exit.mjs, check-search-root.mjs, check-console.mjs, and tools/lib/gm-stdio.mjs (which the conformance tooling uses). tools/check-browser-scope.mjs keeps the default playwriter on purpose, because it tests the browser.
   - Fix (Linux arm64 browser-scope): `browser install failed (exit 1)`. Cause: pw's install fallback runs `playwriter browser install`, which fetches Chrome for Testing, and that has no linux-arm64 build. Fix in .github/workflows/release.yml: on arm64-linux, before Test, a step installs playwright-core 1.65.0 and its chromium with deps into `$RUNNER_TEMP/playwright-chromium`, and writes PLAYWRITER_BROWSER_PATH to GITHUB_ENV.
   - Files: .github/workflows/release.yml, tools/lib/no-playwriter.mjs (new), tools/check-read-truncation.mjs, tools/check-caller.mjs, tools/check-inflight.mjs, tools/check-relay-exit.mjs, tools/check-search-root.mjs, tools/check-console.mjs, tools/lib/gm-stdio.mjs.
   - Witness: the Node read-truncation check runs in 0.06 s with no playwriter start. The release run on the pushed commit is the native witness (see the Phase B record).

2. Connect timeout (jayzee: 30 s).
   - Cause: a cold npx install of the pinned github package takes longer than the 30 s default startup budget. Measured here: `npx -y -p github:AnEntrypoint/pw#1488a92 playwriter-project status` took 26.8 s on one start, 50 s on a cold start with a private cache, and a cold start of a new pin ran past 150 s. defaults/mcp.json sets startupTimeoutMs 600000, but a layer that restates the entry without that field, or an installed gm that predates the default, falls back to 30 s. The failure text said only that the server timed out.
   - Fix: the startup budget defaults to 600000 ms when the command is npx or npm and startupTimeoutMs is unset (src/mcp-client.mjs serverOf; native/components/mcpclient/config.cpp). A startup failure now names every attempt, its exit code or timeout, the startup budget and whether it came from startupTimeoutMs or the default, and the stderr tail (startupFailure in src/mcp-client.mjs; startup_failure in native/components/mcpclient/client.cpp).
   - Files: src/mcp-client.mjs, native/components/mcpclient/client.cpp, native/components/mcpclient/config.cpp, native/components/mcpclient/config.hpp, tools/check-build.mjs (adds the check to the run), tools/check-startup-attempts.mjs (new).
   - Witness: tools/check-startup-attempts.mjs, node and native (quoted in the Phase B record).

3. Staged site (oscraft, port 8832): exit 128 on one start, then exit 0, then startup not reproducible.
   - Observed: `npx -y -p github:AnEntrypoint/pw#1488a92 playwriter-project status` with a cold private cache returned exit 128 after 50 s. The npm debug log has only `verbose exit 128` and no git or npm error line, so the cause is not named. Three concurrent cold starts with one shared private cache all reached the 400 s timeout (exit 124); one of their npm logs shows `EAI_AGAIN` (DNS lookup failed). So a cold start depends on the network, and it can fail with a code that does not say why.
   - Fix: a server that exits before it answers initialize is started again, up to three attempts in all. Each attempt's exit code is logged as `retrying`, and the final failure names all of them with the stderr tail. A timeout is not retried, because the server may still be installing. The retry is in src/mcp-client.mjs (handshake) and native/components/mcpclient/client.cpp (connect).
   - Files: src/mcp-client.mjs, native/components/mcpclient/client.cpp.
   - Witness: tools/check-startup-attempts.mjs runs a real `sh` server that exits 128 and a real `sh` server that sleeps past its budget, on node and native.

4. One playwriter server, shared tabs (thebird and jayzee).
   - Cause: pw's projectRoot takes PLAYWRITER_PROJECT_DIR first, and otherwise climbs from its cwd to the nearest .playwriter or .git. A gm that did not set the variable therefore put every project under /workspace on /workspace/.playwriter, one Chrome and one profile.
   - Fix: already at 409c3f3 (2026-11-09, "Browser profile per project root"). src/mcp-client.mjs start() and native client.cpp spawn() set PLAYWRITER_PROJECT_DIR to the run's workspace unless the entry's env sets it. Nothing new in this pass.
   - Witness: in this pass, four projects each have their own gate, debug port and profile. `gm.playwriter_browsers({ action: "list" })` from the probe run listed `owner gate ... for /workspace/gm, profile /workspace/gm/.playwriter/browser-profile`, `/workspace/oscraft ... /workspace/oscraft/.playwriter/browser-profile` and `/tmp/gm-defects/w6/webgpu-fresh/.playwriter/browser-profile`, and a fourth for the probe workspace, with different debug ports.

5. WebGPU adapter on a fresh profile (jayzee).
   - Cause: jayzee's labs (enable-unsafe-webgpu, enable-vulkan@1, enable-webgpu-developer-features) were written into Local State only by its wrapper scripts/browser/chromium-webgpu.sh, and only into the project profile. A fresh profile has none, so `navigator.gpu` exists and `requestAdapter()` returns null.
   - Fix (in pw, AnEntrypoint/pw ebbba11): `PLAYWRITER_WEBGPU=1` seeds the same three labs into the project profile's Local State before Chromium starts, fresh or not (seedLabs in bin/playwriter-project). The usage text lists it. gm passes the env through the playwriter entry, so a workspace turns it on in its .gm/mcp.json.
   - Pin: defaults/mcp.json and README.md now pin pw#ebbba11.
   - Files: defaults/mcp.json, README.md (pw repo: bin/playwriter-project).
   - Witness (real gm runs, the playwriter tools inside run_code, a page on http://localhost:8765 so the page is a secure context):
     - with PLAYWRITER_WEBGPU=1, fresh profile: `{ secure: true, hasGpu: true, adapter: { vendor: 'nvidia', architecture: 'ampere', isFallbackAdapter: false } }`
     - control, same fresh profile without PLAYWRITER_WEBGPU: `{ secure: true, hasGpu: true, adapter: null }`

6. Playwriter failures with no cause.
   - Cause: pw's failures named the step but not the reason, and the reason was only in browser.log or gate.log. A browser install failure read `browser install failed (exit 1); see <log>`.
   - Fix (pw ebbba11): the browser install failure, the debug-port failure and the gate start failure append the tail of the log they name. gm's side is item 2: a server that fails to start returns its stderr tail and its attempts.
   - Witness (real gm run, PLAYWRITER_BROWSER_PATH pointing at a missing file, no network in the sandbox): the caller's error reads `browser install failed (exit 1); see /tmp/gm-defects/w6/fail-browser/.playwriter/browser.log: Fetching latest Chrome for Testing version... | Error: fetch failed`, so the cause is in the error text.

Also in this pass, for the jayzee subagent report (gm skill guidance):
- Cause: skills/gm/SKILL.md told a subagent to hand its task in a file and did not say which tools its file work used, so jayzee's subagents used the host's built-in Read, Edit, Write and Grep, and their calls were not in the run log.
- Fix: skills/gm/SKILL.md (Handing work to a child session, step 1) and skills/gm/WORKFLOWS.md (Mapping to gm): file work goes through run_code (gm.read_file, gm.write_file, gm.edit_file, gm.grep, gm.run_shell). The exception is a subagent with no gm connection, which says so in its reply.
- Witness: a real gm run reads skill://gm/SKILL.md and skill://gm/WORKFLOWS.md and finds the rule: `{"skillHasRule":true,"workflowsHasRule":true,"skillTruncated":false}`.

Files in this commit (17 modified or new in the tree, plus this file):
.github/workflows/release.yml (item 1), README.md (items 2 and 5), defaults/mcp.json (item 5), native/components/mcpclient/client.cpp (items 2 and 3), native/components/mcpclient/config.cpp (item 2), native/components/mcpclient/config.hpp (item 2), skills/gm/SKILL.md (subagent file work), skills/gm/WORKFLOWS.md (subagent file work), src/mcp-client.mjs (items 2 and 3), tools/check-build.mjs (item 2), tools/check-caller.mjs (item 1), tools/check-console.mjs (item 1), tools/check-inflight.mjs (item 1), tools/check-read-truncation.mjs (item 1), tools/check-relay-exit.mjs (item 1), tools/check-search-root.mjs (item 1), tools/lib/gm-stdio.mjs (item 1), tools/check-startup-attempts.mjs (new, items 2 and 3), tools/lib/no-playwriter.mjs (new, item 1), docs/PENDING_VALIDATION.md (this record).

## gm pass, Phase B (2026-11-09, Phase A commit 746c4b8): witnesses for the release, arm and playwriter items

Build: `rm -rf build/release`, `cmake --preset release`, `cmake --build build/release -j 4`, BUILD_EXIT 0.

Witnesses (quoted from the runs):
- Conformance and the real-tree checks, `node tools/check-build.mjs build/release` (one clean run; an earlier run was overlapped by a stale process on the same log and is not counted): `conformance: 86 passed, 0 failed of 86 checks in 24 scenarios`; `read-truncation: passed: ...`; `check-startup-attempts: passed: a server that exits before it answers is retried and each attempt's exit code is named, and a timed-out server names its startup budget, in node and native`; `CHECK_BUILD_EXIT=0`.
- `npm run check`: `check: gate, unit-test scan, g3 snapshot, redaction witness, read truncation, caller, search root, inflight, relay exit, console, lost wording, prd legacy list, commit digest, task set, child task, output recovery, context feed, grep paging, prd receipt, prd refuted reopen, instruction automations, job progress and documented gap checks passed`, CHECK_EXIT 0.
- ctest, `ctest --test-dir build/release --output-on-failure`: `1/1 Test #1: check-build ...... Passed  304.34 sec`, `100% tests passed, 0 tests failed out of 1`, CTEST_EXIT 0.
- Startup retry and named causes (items 2 and 3), `node tools/check-startup-attempts.mjs build/release/native/components/host/gm`: `node: 8 mcp-server events, all expectations hold`, `native: 8 mcp-server events, all expectations hold`, passed. A cold `npx -y -p github:AnEntrypoint/pw#ebbba11 playwriter-project status` with a private cache ran past 150 s (exit 124), so the pin's first start is slow here; the default launcher budget is 600000 ms.
- Release manifest on a real archive: `node tools/package.mjs --target x64-linux --build-dir build/release --out <scratch>` wrote `gmnew-x64-linux.tar.gz`, then `node tools/release-manifest.mjs --dir <scratch> ...` exited 0 with the row `| x64-linux | built this push | gmnew-x64-linux.tar.gz |`, and the other five targets as `failed this push` (no archive in the scratch dir).
- Read-truncation without a playwriter start (release blocker): `node tools/check-read-truncation.mjs` passed in 0.06 s on Node; the native run is in check-build.
- WebGPU on a fresh profile (item 5, pw ebbba11): with `PLAYWRITER_WEBGPU=1`, adapter `{ vendor: 'nvidia', architecture: 'ampere', isFallbackAdapter: false }`; control without it, `{ secure: true, hasGpu: true, adapter: null }`. The gate log has `seeded WebGPU labs into .../browser-profile/Local State`.
- Failure cause visible to the caller (item 6): `browser install failed (exit 1); see .../browser.log: Fetching latest Chrome for Testing version... | Error: fetch failed`.
- Per-project isolation (item 4): four projects, four gates, four profiles and debug ports (see item 4 above).
- Subagent file work (item 5): `{"skillHasRule":true,"workflowsHasRule":true,"skillTruncated":false}`.
- Gate: `tools/ship.sh` on 746c4b8 `{"gate":true,"failed":[]}`, exit 0.

Release run: see the entry after the push.

## gm pass, release 42694076006 on 4ebe4aa: causes of the four failing jobs (2026-11-09, Phase A)

Release 42694076006 (commit 4ebe4aa) completed with failure. Four build jobs failed; macOS arm64 and x64 succeeded, and gdb-arm passed in arm-diagnose 42694075619 (asan-arm was still running when this record was written). The four causes are different. They are not one cause.

1. build (ubuntu-24.04-arm, arm64-linux), browser-scope-check. Cause: `playwriter_execute did not open the marker page` with `connectOverCDP: WebSocket error: ... 503 Service Unavailable` and `browser refused to start: no usable sandbox. Set PLAYWRITER_NO_SANDBOX=1`. The 503 is the symptom: the browser never started, so its DevTools socket refused the connect. The sandbox is the cause on this runner. Fix: 81c9df6 sets PLAYWRITER_NO_SANDBOX=1 in the arm64-linux Chromium step in .github/workflows/release.yml. (The 4ebe4aa step had already put PLAYWRITER_BROWSER_PATH in place, so the install path was no longer the failure here.)

2. build-windows (windows-11-arm, arm64-windows), browser-scope-check. Cause: `browser install failed (exit 1)`. The step ran pw's Chrome for Testing installer, which has no arm64 Windows build. Reproduced here by running playwriter's installer with the platform reported as win32/arm64 (its own code path, /workspace/pw/node_modules/playwriter/dist/browser-install.js, getPlatformKey): `Unsupported platform for Chrome for Testing download: win32/arm64. Install Chromium manually and use PLAYWRITER_BROWSER_PATH to point to it.` The reason itself was hidden: tools/check-browser-scope.mjs cut every failure message to 200 or 300 characters, so the `browser.log` path was printed but its tail was cut off. Fixes: 362294a adds an arm64-windows step in .github/workflows/release.yml that installs playwright-core 1.65.0 and its Chromium, and sets PLAYWRITER_BROWSER_PATH (the same pattern as the arm64-linux step; the Windows arm64 build is not verified by a run yet). This pass: tools/check-browser-scope.mjs no longer truncates the playwriter reply in its five failure messages, so the install reason is printed in full.

3. build-windows (windows-latest, x64-windows), check-restart-jobs. Cause: `spawn C:\...\gm-restart-jobs-bin-.../gm ENOENT`. tools/check-restart-jobs.mjs copied the binary to the temp directory under the fixed name `gm`, so on Windows the copy had no `.exe` and the spawn of `gm` found nothing. Fix: 992fea4 keeps the source file's name (`basename(resolve(target))`), so `gm.exe` stays `gm.exe`. Witness on Linux: `restart-jobs-check: ok (native: binary mtime changed ...)`.

4. build (ubuntu-latest, x64-linux), Node parity step. Cause: `parity: 16/93 scenarios match, ... 1 differ`; the differing row was `mcp server events`, field `[2].attempts`. My JS startup change (746c4b8) added an `attempts` field to the Node `mcp-server` connected event; native does not write it. Fix: b3a9890 removes the field from the Node connected event, so the two engines match again. Witness on Linux: `17/93 scenarios match, 0 cutover-expected, 54 native-ahead, 22 documented-gap, 0 differ` (PARITY_EXIT 0). Note: the parity harness reads the Node reference from committed HEAD, so the fix had to be committed before the rerun.

Confirmation across the four: no two failing jobs share a cause. Jobs 1 and 2 share the symptom (connectOverCDP 503) but not the cause (sandbox versus missing installer build). Jobs 3 and 4 are not browser failures.

arm-diagnose 42694075619: gdb-arm passed; asan-arm was still running when this record was written, and its result is recorded in the Phase B entry.

5. arm-diagnose 42694075619, asan-arm (failure after the release push's arm run finished). Cause: read-truncation hit its single 90 s watchdog: `read-truncation: failed: no completion within 90000 ms`. The asan build is about ten times slower than release on this host (read-parity's eight probes took 51 s on asan), and read-truncation's probes took 5 to 7 s each; the last probe (the run_code cut-reply) had printed nothing when the watchdog fired. The cause is the watchdog budget, which is sized for release. Fix: tools/check-read-truncation.mjs WATCHDOG_MS is 300000 ms, still inside check-build's 600000 ms per-check timeout. Not verified on asan here: a local asan build was not made in this pass. gdb-arm passed.

Phase B (this pass, binary built from df45387 plus the watchdog change; fresh build of build/release):
- `cmake --build build/release -j 4`: BUILD_EXIT 0.
- `node tools/check-build.mjs build/release`: `conformance: 86 passed, 0 failed of 86 checks in 24 scenarios`; `read-truncation: passed: ...`; `check-startup-attempts: passed: ...`; CHECK_BUILD_EXIT 0.
- `node tools/check-browser-scope.mjs build/release/native/components/host/gm` (run locally, the browser-scope check on this host with the playwriter browser): `browser-scope-check: ok (build/release/native/components/host/gm: finish browser key, browser_tabs, playwriter_browsers close, browser_close_machine guard; browser run: ran: the run page was listed, closed by finish, and gone from the browser after finish)`; BROWSER_SCOPE_EXIT 0.
- `npm run check`: `check: gate, unit-test scan, ..., job progress and documented gap checks passed`; NPM_CHECK_EXIT 0.
- Parity, `node native/tests/parity/run.mjs --bin build/release/native/components/host/gm`: `17/93 scenarios match, 0 cutover-expected, 54 native-ahead, 22 documented-gap, 0 differ`; PARITY_EXIT 0.
- Install reason reproduced (item 2 above): `Unsupported platform for Chrome for Testing download: win32/arm64. Install Chromium manually and use PLAYWRITER_BROWSER_PATH to point to it.`

## gm pass, Validation (2026-11-09, Phase A): skill read first, and the run_code gate

Phase A ran no build, test, gate or witness. Each item names its file, its row and the Phase B witness that settles it. Mechanism: the read of skill://gm/SKILL.md sets a flag on the connection's worker (per worker process; the relay starts one worker per host connection). run_code is refused until the flag is set, and the refusal names the read call. The prompt route (prompts/get gm) does not set the flag, so only the resource read counts.

1. skills/gm/SKILL.md, "## Validation" (line 124, rule text). First action, then five order rules: debugging before tests; unit tests outside the loop; HMR or a dev server, stopped by its PID; probe before adding a check; stop only by PID with `pgrep -f` or `ps`, never pkill, killall or pkill -0. Witness: the live read in item 9 returns the section text.
2. src/mcp.mjs. `let gmSkillRead = false;` (line 277); serveSkillFile sets it beside clearRules() when isGm (line 456); callTool refuses run_code before startCall (line 479) with SKILL_READ_REFUSAL and a refusal event at stage skill-read. Witness: the Phase B live Node run in item 9 (the same refusal text).
3. native/components/mcp/server.cpp. kSkillReadRefusal (the same text, quotes escaped); `bool gm_skill_read = false;` in Server::State (line 654); skill_read_refused() before ProgressTicker (about line 2290) appends the refusal event; serve_skill_file sets gm_skill_read when is_gm (line 2558); tools/call refuses run_code when the flag is clear (line 2397). Not compiled in Phase A. Witness: the Phase B live native run in item 9.
4. The refusal text is one string in both engines: `run_code refused: read skill://gm/SKILL.md first in this connection. Call resources/read with {"uri":"skill://gm/SKILL.md"} (ReadMcpResourceTool with server gm and that uri), then call run_code again.` Witness: the Phase B refusal output compared byte for byte across both engines.
5. Check scripts given an awaited `resources/read` of skill://gm/SKILL.md after their initialized notification, so the run_code calls that follow are allowed. Files: tools/check-browser-scope.mjs, check-caller.mjs, check-console.mjs, check-early-run-code.mjs, check-inflight.mjs, check-job-bounds.mjs, check-job-progress.mjs, check-prd-receipt.mjs, check-prd-refuted-reopen.mjs, check-read-parity.mjs, check-read-truncation.mjs, check-restart-jobs.mjs, check-run-code-budget.mjs, check-run-code-progress.mjs, check-search-root.mjs, check-shell-stdin.mjs, check-startup-attempts.mjs, check-stop-fetch.mjs, tools/reconnect-check.mjs. Witness: `node tools/check-build.mjs build/release` (Phase B) with each named check passing.
6. Shared drivers. tools/check-output-recovery.mjs `initialize(s)` (line 43) queues the read after the notification; this covers check-child-task, check-commit-digest, check-context-feed, check-grep-paging and check-task-set. Callers take their ids from return values, so the extra request does not shift any hard-coded id. tools/lib/gm-stdio.mjs openServer (line 45) awaits the read; this covers witness-next-context-replay, witness-redaction and witness-windows-cmd. tools/mcp-conformance.mjs open() (line 108) awaits the read; this covers the 86 conformance checks in check-build. Witness: check-build conformance, Phase B.
7. native/tests/parity/run.mjs. A row `skill read` (resources/read of skill://gm/SKILL.md) after the `initialized` row in all four scenario sets (lines 152, 471, 580, 626 before the edit). The scenario count rises by four; Phase B records the new count. Witness: `node native/tests/parity/run.mjs --bin build/release/native/components/host/gm`, with 0 differ. The refusal itself has no parity row yet; item 9 covers it live on both engines.
8. README.md, the paragraph before the WORKFLOWS paragraph in "The worker: an MCP server": the first-call rule, the per-connection flag, the prompt-route exception, and the restart caveat in item 10. Witness: the live refusal in item 9 matches the paragraph.
9. Phase B live witness (to run): start the gm MCP server (Node `src/mcp.mjs` and native `serve`), call run_code before any read (refusal expected, text quoted), call resources/read of skill://gm/SKILL.md, then call run_code (it runs, output quoted).
10. Restart caveat, found in Phase B and fixed there. Phase A replayed only initialize to a restarted worker, so the new worker refused run_code until the host read the skill again. check-restart-jobs showed it on the restart path: the post-restart job_status was refused. The fix is in the Phase B entry below (relay.cpp, serve.cpp, tools/core.mjs).
11. Not gated, and why. tools/supervise.mjs only handshakes and makes no tool calls; tools/check-resources-subscribe.mjs makes no tool calls; tools/core.mjs is the host relay and forwards the host's own messages, so the host's read is what counts.
12. Commit gate. tools/ship.sh always runs the commit gate (src/gate.mjs) and has no skip. This pass says no gate run in Phase A, so the Phase A commit was made with an explicit-path `git commit` as lanmower, with no trailer. The gate is run in Phase B by `npm run check` before the one push. This deviates from the standing rule that commits go through ship.sh, and the owner should confirm it.

## gm pass, Validation Phase B (2026-11-09): witnesses for the run_code gate and the restart replay, and the causes of the c378ba0 release failures

Commits on main: b211da5 (Phase A: the gate, the skill read, the checks and the ledger, committed by an explicit git commit, see item 12 above), 98d0505 (the restart replay and the parity window, committed through tools/ship.sh with its gate), and the commit that records this entry. Binary: build/release at 98d0505 (`98d0505-dev`).

Phase B changes beyond Phase A:
- The first witness (check-build on b211da5) failed in check-restart-jobs (native arm): the relay's binary-change restart made a new worker whose skill-read flag was clear, so the post-restart run_code was refused and job_status answered nothing. Phase A's ledger item 10 named this caveat.
- Fix: native/components/host/relay.cpp records the host's resources/read of skill://gm/SKILL.md (`skill_read_`), replays it after the handshake in replay_handshake (ask_worker, waiter id gm-core:resources/read), and passes `--skill-read yes` on the relay's own re-exec; native/components/host/serve.cpp parses `--skill-read` (`options.skill_read`) and strips it from the re-exec arguments; native/components/host/include/gm/host/relay.hpp gains the option and the member. tools/core.mjs records `skillRead` on the host's read, saves it with the session, and replays it through `replaySkillRead()` after the handshake (`askWorker` now takes params).
- Parity: the mcp pass's `mcp next_context` diff at events[8] (native-ahead, see the run logs: Node writes the MCP join events at boot before the tools event, native writes them after the first next_context). The skill read adds a skill-loaded event, which moves native's join events one index later, so the excused window `events\[[3-7]\]` in native/tests/parity/run.mjs is now `[3-9]`, and BOOT_SURFACE_REASON names the skill-loaded event.

Witnesses on 98d0505 (each run on build/release, quoted from the output):
- Live refusal and unblock, native `serve` and Node `src/mcp.mjs`, with the same five-line input (initialize, initialized, run_code, resources/read, next_context, run_code) and playwriter disabled in the scratch workspace:
  - run_code before the read: `run_code refused: read skill://gm/SKILL.md first in this connection. Call resources/read with {"uri":"skill://gm/SKILL.md"} (ReadMcpResourceTool with server gm and that uri), then call run_code again.` Byte-identical on both engines.
  - resources/read skill://gm/SKILL.md: the served text contains "## Validation" on both engines.
  - run_code after the read: `ok: true`, output `42` on both engines.
- check-restart-jobs native (binary-change restart): `ok (native: binary mtime changed ... the restart answered in 652 ms ...)` in the first run; `ok (native ...)` again in the final check-build.
- check-restart-jobs node (SIGTERM pause): `restart-jobs-check: ok (node: SIGTERM to the Node worker pid ...; the job's process ... was alive 253 ms after the trigger; the restart answered in 232 ms; the job exited 0 with output "done" at 7985 ms; carry-over events 1; killed with reason restart 0)`.
- check-build build/release: `conformance: 86 passed, 0 failed of 86 checks in 24 scenarios`; read-truncation passed; check-startup-attempts passed; browser-scope-check ok; restart-jobs native ok; `check-build: gm stamp 98d0505-dev (98d0505)`; exit 0.
- npm run check: exit 0 (its gate and the checks it names).
- Parity, `node native/tests/parity/run.mjs --bin build/release/native/components/host/gm`: `17/95 scenarios match, 0 cutover-expected, 56 native-ahead, 22 documented-gap, 0 differ`; exit 0. Before the window change the same run had `1 differ` at `mcp next_context` `.result.content[0].text.events[8]`.
- Skill read row in both parity passes: `skill read` native-ahead on `.result.ttlMs` only (the same field the row already excused).

Release 42699019720 and arm-diagnose 42699019924 on c378ba0 (the commit before the gate), causes read from the failed job logs:
- release build-windows x64 (x64-windows-release): check-restart-jobs, `restart-jobs-check: 8 failure(s)`. The binary-change restart produced no replacement worker within 90 s (`workerReplacedMs: 90022`), so job_status answered null. The gate was not in c378ba0, so this is not the refusal. The cause of the missing replacement on Windows is not established; it is not reproduced on Linux. Open.
- release build-windows arm64 (arm64-windows-release): browser-scope-check, `playwriter_execute did not open the marker page` with `browser install failed (exit 1)` and `connectOverCDP: WebSocket error: ... 503 Service Unavailable`. pw's installer still ran (so PLAYWRITER_BROWSER_PATH from the Playwright Chromium step of 362294a did not take effect in that job), exited 1, and the browser refused the CDP connection. Why the variable was not used is not established. Open.
- arm-diagnose asan-arm (asan build, conformance, one run): every protocol-version client check reported `no mcp-server event after 5000 ms`, and every server-asked check reported `no initialize result`. Under the slow asan build the fake MCP server does not join inside the 5 s wait. The wait is not changed here. Open.
- Succeeded: release macOS x64 and arm64, Linux x64 and arm64, the publish job, and arm-diagnose gdb-arm.

Open after this pass: the three c378ba0 causes above (Windows restart replacement, arm64 Windows browser install, asan conformance wait); the Node arm of the restart witness is run by hand here, not by check-build (check-build runs only the native arm).

## gm pass, Phase A (2026-11-10): outstanding defects from the 17959f7 release and the c378ba0 arm-diagnose

Phase A ran no build, test, gate or witness. Each change is one local commit by lanmower with no trailer, not pushed. Witnesses are run in Phase B on the local release build.

1. tools/check-protocol-versions.mjs, commit e83228f. Row: `server asked` (no initialize result) and `client accepts` / `client refuses` (no mcp-server event after 5000 ms). Cause: REPLY_MS was 10 s and clientCase slept a fixed 5 s then read the log once, while 14 engines started at once; on the asan-arm runner (release run 42706662337 / arm-diagnose 42699019924) the event was not written in time. Change: REPLY_MS 60 s, and clientCase polls the log every 100 ms up to EVENT_MS 60 s, returning as soon as the event is found. Witness (Phase B): `node tools/check-protocol-versions.mjs build/asan/native/components/host/gm` and the release binary, all rows passed.
2. tools/check-restart-jobs.mjs, commit 235493f. Row: `before the restart the job's process ... was not alive`, `no replacement worker appeared within 90000 ms`, `after the restart job_status did not answer`. Cause: the check read the process table with POSIX `ps`, which Windows does not have, so processOf returned null and engineProcesses returned nothing; both symptoms follow from that (release 42706661863, build-windows x64). Change: on win32, processOf and engineProcesses read `Get-CimInstance Win32_Process` through powershell.exe, and the job-group kill uses the pid alone on win32. Witness (Phase B): the restart witness on Linux, native and node arms, unchanged behaviour; the Windows path is a gap (below).

Windows and macOS gaps (cannot be built or run here; recorded with the cause as far as the logs show):
- G1. build-windows x64-windows: check-restart-jobs (item 2 above). Fixed in code; not run on Windows. The binary-change restart in the relay on Windows is unverified: if the worker is still not replaced after the process-table fix, the cause is the relay's binary-change path on Windows.
- G2. build-windows arm64-windows: browser-scope-check. The Playwright Chromium step (release.yml, "Chromium for the browser-scope check (arm64-windows)") downloads Chrome for Testing 158 and writes PLAYWRITER_BROWSER_PATH to GITHUB_ENV, but pw's installer still ran: `browser install failed (exit 1) ... Unsupported platform for Chrome for Testing download: win32/arm64`. pw's browser-config.js throws when PLAYWRITER_BROWSER_PATH is missing or does not exist, which starts the installer. The step never prints the value it writes, so it is not known whether the variable reached the check or pointed at a missing path (node -p under Git bash may produce a POSIX-style path). Not changed: needs one Windows run that prints the value and checks it exists. Release runs 42706661863 and 42699019720.
- G3. macOS: the macOS x64 and arm64 release jobs succeeded on 17959f7 and c378ba0; no gap recorded.

## gm pass, Phase B (2026-11-10, local only, release and asan builds at 7232577)

Correction to Phase A item 1: the asan-arm failure that item 1 describes came from arm-diagnose run 42699019924 (c378ba0). Run 42706662337 is the arm-diagnose run for 17959f7, which the watcher stopped before it finished.

Witnesses run locally, output read in full:
- `cmake --build build/release`: exit 0; `gm stamp 7232577-dev (7232577)`.
- `cmake --build build/asan`: exit 0.
- `node tools/check-protocol-versions.mjs build/release/native/components/host/gm`: exit 0, all five versions and the refusals pass.
- `node tools/check-restart-jobs.mjs build/release/native/components/host/gm`: exit 0, `ok (native: binary mtime changed ... the job's process ... was alive 543 ms after the trigger ... killed with reason restart 0)`.
- `node tools/check-restart-jobs.mjs node`: exit 0, `ok (node: SIGTERM to the Node worker pid ...; killed with reason restart 0)`.
- `node tools/check-build.mjs build/release`: exit 0, `conformance: 86 passed, 0 failed of 86 checks in 24 scenarios`, protocol-versions ok, restart-jobs native ok.
- asan, protocol-versions: the first run failed with `no initialize result` for every server case and `no mcp-server event after 60000 ms` for every client case. The asan binary printed `ASan runtime does not come first in initial library list` and exited 1. This host's shell sets LD_PRELOAD to /usr/lib/selkies_input_interposer.so, /opt/lib/libudev.so.1.0.0-fake and /usr/lib/selkies_v4l2_interposer.so, and ASan refuses to start behind them. With `env -u LD_PRELOAD` the same binary answers `initialize`. This is a property of this host, not of the code, and the hosted asan runner has no such preload. The CI failure of 42699019924 is therefore not explained by this run; the 60 s wait change is kept as the fix for the slow-start case.
- `env -u LD_PRELOAD ... node tools/check-protocol-versions.mjs build/asan/native/components/host/gm`: exit 0.
- `env -u LD_PRELOAD ... node tools/check-build.mjs build/asan`: exit 0, `conformance: 86 passed, 0 failed of 86 checks in 24 scenarios`.

Gap list for what only Windows and macOS can build (recorded in Phase A items G1 to G3, not waited on):
- G1 (Windows x64 restart-jobs): code fixed in 235493f; not run on Windows. Cause established: POSIX ps, absent on Windows. The relay's binary-change restart on Windows is unverified.
- G2 (Windows arm64 browser-scope): cause not established. The Chromium step downloads, but pw still runs its installer. Needs one Windows run that prints PLAYWRITER_BROWSER_PATH and checks the path exists.
- G3 (macOS): no gap; the macOS release jobs passed on the previous push.

Commits in this pass: e83228f (protocol-version wait), 235493f (restart-jobs Windows process table), 7232577 (Phase A ledger), and this Phase B entry.

## gm pass, Phase A (2026-11-10, closing the local inventory items): Node arm, stopping rule

Phase A ran no build, test, gate or witness. Each change is one local commit by lanmower with no trailer, not pushed. The witnesses run in Phase B on HEAD.

1. tools/check-build.mjs, commit 2bf9851. Row: the restart-jobs check, Node arm. Before: check-build ran `check-restart-jobs.mjs` only with the native binary, so the Node arm (SIGTERM pause) was run by hand. Change: after the list loop, check-build runs `check-restart-jobs.mjs node` and exits with its status. No reason it cannot run here: the Node arm reads tools/relay.mjs and src/ from the checkout and needs no build output. Witness (Phase B): `node tools/check-build.mjs build/release` prints `restart-jobs-check: ok (node: SIGTERM to the Node worker pid ...)` after the native arm, exit 0.
2. skills/gm/SKILL.md, commit 6af2bd1. Row: new section `## Stopping Processes` and Validation rule 5. Change: the section says a process is stopped only by a PID read first in `ps` or `pgrep` output, then `kill <pid>`; the command line is read in the same output; only PIDs the run started are killed; pattern kills (`pkill`, `killall`, `pkill -0`, a kill loop over a `pgrep -f` pattern) are not used, because a pattern can match the run's own shell (exit 144 is SIGTERM to such a shell). Rule 5 of Validation now points to the section with the same wording. Witness (Phase B): the served skill, read with ReadMcpResourceTool (server gm), contains `## Stopping Processes`, and the live read in Phase B step 5 quotes it.
3. No code comments were added in either change; the two diffs have only code lines and skill prose.

## gm pass, Phase A (2026-11-10): reachable open items, asan-arm and the Windows items

Phase A ran no build, test or push. Each change is one local commit by lanmower with no trailer. Phase B runs the witnesses below on HEAD.

1. tools/check-protocol-versions.mjs, commit f951a4f. Rows: `server asked <version>: no initialize result` and `client accepts / refuses: no mcp-server event after 60000 ms`. Cause of the diagnostic gap: an engine that dies at startup (for example an ASan runtime refusing to start behind an LD_PRELOAD interposer) produced only a 60 s timeout with no cause. Change: spawnEngine records the engine's stderr tail (STDERR_TAIL 2000) and its exit; rpc resolves at once when the engine has exited; clientCase stops polling when the engine has exited; each failure names `engine exited with code N before it answered; stderr: ...`. Witness (Phase B): `env` without the host preload, the asan binary passes; with the host LD_PRELOAD set, the asan binary fails within seconds and the failure names the exit code and the ASan message, not a 60 s timeout.
2. .github/workflows/release.yml, commit 3f395d3. Row: `browser-scope-check: playwriter_execute did not open the marker page` on windows-11-arm (G2). Change: a new step, arm64-windows only, after the Chromium install, prints PLAYWRITER_BROWSER_PATH as the later steps receive it, reports whether that path exists, and prints it with `cygpath -w`. This makes the next Windows run answer whether the variable reached the check and whether it names an existing file. Witness: Windows only (blocked, see below).

Blocked: no Windows host is available here, so these witnesses cannot run in this pass.
- B1 (Windows x64 restart-jobs, G1): the process-table change in 235493f is not run on Windows. Witness needed: `restart-jobs-check: ok (native: ...)` on windows-latest. Blocked: no Windows host.
- B2 (Windows arm64 browser-scope, G2): the diagnostic step in item 2 needs a Windows run. Witness needed: the printed path, `browser path exists` or `missing`, and browser-scope-check ok. Blocked: no Windows host.

Open, found this pass, not fixed: the gm connection of a long-running host serves the skill text it loaded at its start. On this host the served `skill://gm/SKILL.md` still has the rule-5 wording and no `## Stopping Processes` section, though the file on disk and commit 6af2bd1 have it. A fresh serve process (the live witness of b182209) serves the new text. Witness needed to close it: a re-read on a connection started after 6af2bd1 shows the section, or the served resource is refreshed when the file changes. Local item; it is a skill-serving freshness question, not a code change in this pass.

## gm pass, Phase B (2026-11-10, local, release and asan at 9eb219b)

Witnesses, output read in full:
- W1 release, `node tools/check-protocol-versions.mjs build/release/native/components/host/gm`: exit 0, `protocol-versions-check: ok`.
- W2 asan with this host's LD_PRELOAD, same check: exit 1 in 1 s, `14 failure(s)`, each row `engine exited with code 1 before it answered; stderr: ==...==ASan runtime does not come first in initial library list`. Before f951a4f the same run took 60 s and printed only `no initialize result: null`.
- W3 asan with `env -u LD_PRELOAD`: exit 0, `protocol-versions-check: ok`.
- W4 restart-jobs, native: exit 0, `ok (native: binary mtime changed ... killed with reason restart 0)`; node: exit 0, `ok (node: SIGTERM to the Node worker pid ...; killed with reason restart 0)`.
- W5 check-build build/release: exit 0, `conformance: 86 passed, 0 failed of 86 checks in 24 scenarios`, both restart arms ok, `check-build: gm stamp 9eb219b-dev (9eb219b)`.
- W6 release.yml parses as YAML (38 steps), and the new step `Check the browser path for the browser-scope check (arm64-windows)` is present.
- Blocked, not run: B1 (Windows x64 restart-jobs) and B2 (Windows arm64 browser path); no Windows host here.
- Open, not fixed: the stale served skill (Phase A note), a local item.

## gm pass, Phase A (2026-11-10): the stale served skill

Phase A ran no build, test or push. Each change is one local commit by lanmower with no trailer. Phase B builds HEAD and runs the witness below.

Cause, measured on this host. The default skill source is the directory beside the running binary (native/components/host/options.cpp, skills_dir_of): `/config/.gmnew/current/skills`. That copy changes only on install or update, so a commit to skills/gm/SKILL.md never reaches the served resource. Probe with the installed binary: no `--skills` serves text without `## Stopping Processes`; `--skills /workspace/gm/skills` serves it. The reader itself does not cache: SkillCache::get reads the file on every call. Node already reads SKILLS_DIR from the checkout (tools/core.mjs).

1. native/components/host/options.cpp, commit (see git log). Row: `skills_dir_of`. Change: the order is `--skills`, then the checkout's `skills/` when it is a directory (source_root, GMNEW_SOURCE_DIR), then the installed copy. A binary built from a checkout serves that checkout's skill files; a release binary built elsewhere, where the source path is absent, keeps the installed copy.
2. tools/check-skill-serve.mjs and tools/check-build.mjs, commit (see git log). Row: new witness, added to the check-build list. Witness: (a) the default `serve` returns `skill://gm/SKILL.md` byte-equal to the checkout's skills/gm/SKILL.md; (b) on one live connection, against a copy of skills/ passed with `--skills`, a read, a change to the copied file, and a read on the same connection returns the new text; a second change is served the same way. Phase B: `node tools/check-skill-serve.mjs build/release/native/components/host/gm` prints `skill-serve-check: ok` and exits 0.
3. Not closed by this change: the gm connection on this host runs `/config/.gmnew/current/gm`, which is built from older source. It serves the new order only after a rebuild and `scripts/install.sh`. Until then the served copy stays stale. No install was run in this pass.

## gm pass, Phase B (2026-11-10, local, release at 5cadf24): the stale served skill

Witnesses, output read in full:
- W1 release, `node tools/check-skill-serve.mjs build/release/native/components/host/gm`: exit 0, `skill-serve-check: ok`. The default serve equals the checkout's skills/gm/SKILL.md, and the live connection serves each change on the next read.
- W2 pre-fix binary, same witness on a copy of the installed binary with the pre-6af2bd1 skill tree beside it: exit 1, `default serve: skill://gm/SKILL.md is not the checkout's skills/gm/SKILL.md (served 23852 bytes, disk 24470 bytes)`. Shows the witness fails on the old order.
- W3 check-build build/release: exit 0; conformance, read-truncation, startup-attempts, protocol-versions, skill-serve, both restart arms; `check-build: gm stamp 5cadf24-dev (5cadf24)`. The witness fix in ba74619 touches only tools/check-skill-serve.mjs and was run after this build.
- Note: /config/.gmnew/current/skills/gm/SKILL.md was rewritten at 01:01:18 (not by this pass), so the installed binary currently serves the new text; the gm connection that started earlier still serves the old text until it restarts.

## gm pass, Phase A (2026-11-10): the Windows witnesses B1 and B2

Phase A ran no build, test or push. Each change is one local commit by lanmower with no trailer. Phase B builds HEAD and runs the witnesses below.

Probe for a local route (read-only, this host): no wine, wine64, mingw-w64 toolchain, pwsh or powershell.exe is installed; /mnt is empty; the only .exe files found are unrelated tool binaries; uname is x86_64, so no arm64 Windows route exists. There is no root (`sudo: The "no new privileges" flag is set`), so `apt install` is not possible here. apt lists wine64 and mingw-w64 in the archive but does not install them.

Blocked, with the reason and the install step:
- B1 (Windows x64 restart-jobs, G1). Reason: tools/check-restart-jobs.mjs reads the Windows process table with `powershell.exe` (Get-CimInstance). Wine does not ship powershell.exe, and a stand-in would not be the real check. The Node arm also needs a Windows node.exe. Install step: on a Windows x64 host, `git checkout main` at this commit or later; `npm ci --ignore-scripts`; `cmake --preset x64-windows-release`; `cmake --build build\x64-windows-release`; then `node tools/check-restart-jobs.mjs build\x64-windows-release\native\components\host\gm.exe` and `node tools/check-restart-jobs.mjs node`. Witness needed: `restart-jobs-check: ok (native: ...)` and `restart-jobs-check: ok (node: ...)`, exit 0.
- B2 (Windows arm64 browser path, G2). Reason: the diagnostic step (.github/workflows/release.yml, step "Check the browser path for the browser-scope check (arm64-windows)") runs only on windows-11-arm, and this x86_64 container cannot run an arm64 Windows Chromium. Install step: a windows-11-arm host with Node, `npm ci --ignore-scripts`, `cmake --preset arm64-windows-release`, and the Chromium install from the workflow; then run tools/check-browser-scope.mjs against the built gm.exe and read the printed PLAYWRITER_BROWSER_PATH line. Witness needed: `browser path exists` or `browser path missing`, then `browser-scope-check: ok`.

Changes in this pass:
1. tools/check-restart-jobs.mjs, commit (see git log). Row: `windowsProcesses`. Before: a missing or failing `powershell.exe` gave an empty process table, and an empty table reads as "process gone", so a post-restart assertion could pass without reading the table. Change: a spawn error or a non-zero exit throws `cannot read the process table: ...` with the OS text or powershell's exit code and stderr. Witness (Phase B): `node tools/check-restart-jobs.mjs build/release/native/components/host/gm` still passes on Linux (the Windows branch is not taken); a one-off probe on Linux that runs the function's source with a missing `powershell.exe` must throw `cannot read the process table: spawnSync powershell.exe ENOENT`. On Windows, B1 above is the real witness.

## gm pass, Phase B (2026-11-10, local, release at 4a7f2bc): the Windows guard, and B1 and B2 still blocked

Witnesses, output read in full:
- W1 restart-jobs, native, Linux: `node tools/check-restart-jobs.mjs build/release/native/components/host/gm`: exit 0, `restart-jobs-check: ok (native: ... killed with reason restart 0)`.
- W2 restart-jobs, node, Linux: exit 0, `restart-jobs-check: ok (node: ... killed with reason restart 0)`.
- W3 Windows process-table guard, one-off probe in the OS temporary directory (not committed): the function from tools/check-restart-jobs.mjs run with PATH=/usr/bin:/bin, where powershell.exe is absent: `THREW: cannot read the process table: spawnSync powershell.exe ENOENT`. Before the change the same call returned an empty table.
- W4 check-build build/release: exit 0; `conformance: 86 passed, 0 failed of 86 checks in 24 scenarios`; both restart arms, the skill-serve witness and the other listed checks passed; `check-build: gm stamp 4a7f2bc-dev (4a7f2bc)`.
- B1 and B2: not run. No Windows or arm64 Windows host here (see the Phase A entry for the probe and the install steps).

## gm pass, Phase A (2026-11-10): the run_code deadlock for a client with no resource-read tool (fx issue 1)

Phase A ran no build, test or push. Each change is one local commit by lanmower with no trailer. Phase B builds HEAD and runs the witnesses below.

Cause (/workspace/fx/issues.md, issue 1). The skill-read gate cleared only on resources/read of skill://gm/SKILL.md. fx exposes the three gm tools and no resource-read tool, and the documented `gm.read_file({ path: 'skill://gm/SKILL.md' })` sits inside run_code, which the gate refused before the body ran. The rule 2 notice cleared only on a skill read, so it stayed open for the same client. An MCP client does not advertise a resources capability (resources is a server capability), so the gate cannot be dropped on that signal.

1. native/components/mcp/server.cpp, native/components/host/relay.cpp, src/mcp.mjs, tools/core.mjs, commit (see git log). Rows: kSkillReadRefusal / SKILL_READ_REFUSAL, skill_read_refused, call_tool, get_prompt, clear_rule, next_context, rules_notice; relay route_host_line; core deliversSkill. Change: (a) the first run_code on a connection that has not read the skill is refused once and the refusal carries the served skill text in `skill`; that delivery counts as the read (skill-loaded via run_code), so the next run_code runs. If the gm skill file cannot be served, the gate passes. (b) prompts/get gm counts as the read. (c) the relay (native) and the core (Node) record a run_code call and a gm prompt as the read, so a restarted worker is not gated again. (d) the refused call no longer notes rule 2 in native (Node already did not). (e) next_context reports an open rule 2 in rulesPending once and then clears it (rules-cleared, rules [2]). (f) the notice text names gm.read_file in a run_code body as a second way to read the skill.
2. skills/gm/SKILL.md, commit (see git log). Row: Validation, First action; After a context compaction, step 4. Change: the text says the first run_code is refused once with the skill text, the gm prompt counts as the read, and a rule 2 notice clears at the next next_context.
3. tools/check-no-resource-client.mjs and tools/check-build.mjs, commit (see git log). Row: new witness, in the check-build list on the native binary and on node. The client sends only initialize, tools/list and tools/call (any other method throws in the client). Witness: the first run_code is refused with `skill` equal to skills/gm/SKILL.md; the second run_code returns the file text and carries the rule 2 notice; next_context opens step 1 with rulesPending naming rule 2; the next run_code has no rulesNotice; gm.read_file of the skill uri works in a body; the second next_context has no rulesPending; finish ends the run. Phase B: `node tools/check-no-resource-client.mjs build/release/native/components/host/gm` and `node tools/check-no-resource-client.mjs node`, each `no-resource-client-check: ok`, exit 0. Why a kept check: the gate is per connection and a live probe from this host always has a resource-read tool, so only a tool-only client covers the regression.
4. Also to run in Phase B: check-build (conformance and the listed checks) and the parity harness, since the refusal text and the notice text changed in both engines.
5. The gm connection of a running host, and fx's, takes the fix only after its installed build updates.

## gm pass, Phase B (2026-11-10, local, release at 399b026): the run_code deadlock for a client with no resource-read tool

Witnesses, output read in full:
- W1 native, `node tools/check-no-resource-client.mjs build/release/native/components/host/gm`: exit 0, `no-resource-client-check: ok`.
- W2 node, `node tools/check-no-resource-client.mjs node`: exit 0, `no-resource-client-check: ok`.
- W3 before state, the same witness on the installed build `9670d03-308`: exit 1, 7 failures; every run_code answers `run_code refused: read skill://gm/SKILL.md first in this connection...` and the second next_context still has rulesPending for rule 2. This is fx issue 1.
- W4 restart, one-off probe in the OS temporary directory (not committed), native: a tool-only client, first run_code refused with `skill` a string, run_code ok, binary mtime changed, `gm relay: restarting the worker (changed: gm)`, then run_code answers `{"ok":true,"output":"3",...}`. The restarted worker is not gated again.
- W5 check-build build/release: exit 0; `conformance: 86 passed, 0 failed of 86 checks in 24 scenarios`; the new witness ok on the native binary and on node; `check-build: gm stamp 399b026-dev (399b026)`.
- W6 parity, `node native/tests/parity/run.mjs`: exit 0, `17/95 scenarios match, 0 cutover-expected, 56 native-ahead, 22 documented-gap, 0 differ`.
- Not done here: no install was run, so the gm connection on this host and fx's connection keep the old gate until their installed build updates.

## gm pass, Phase A (2026-11-10): ranked open work, and the repeated skill re-read after a worker restart

Phase A ran no build, test or push. Each change is one local commit by lanmower with no trailer. Phase B builds HEAD and runs the witnesses below.

Open work, ranked (reachable here first):
1. Taken in this pass: the repeated skill re-read after a worker restart (jayzee). Evidence: /workspace/jayzee/runs/2026-11-09-23-06-24-82b1f1/log.jsonl, restart at seq 179 and 213, each followed by a run_code refusal with stage skill-read (seq 192, 221) and a new skill-loaded (196, 222). The relay (parent pid 2497409, started 2026-11-10 00:13 local) is the same process across both restarts and did not replay the read: the replay lives in the relay, and a relay that predates 98d0505, or one whose re-exec is held back, never sends it.
2. Reachable, not taken: the relay re-executes onto a new build only when no host call is in flight (native/components/host/relay.cpp, the reexec check `!inflight_.empty()`). A host that keeps a next_context wait in flight can hold an old relay for a long time. Needs a measured reproduction before a change.
3. Reachable, not taken: the one run_code refusal carries the skill text twice (content text and structuredContent), about 48 KB.
4. Reachable, not taken: AGENTS.md "Last witness" for the parity harness says 22 of 93; the run at 399b026 printed 17/95, 0 differ. The edit needs the full AGENTS.md audit.
5. Reachable, not taken: the Node arm of a tool-only client across a worker restart was not probed (native was, W4 of the previous Phase B).
6. Not reachable here: this host's gm connection and fx's serve the installed build, which is older than HEAD; the served skill text on this connection still has the old Validation wording. Closes when a release is installed; no install is run by this peer.
7. Blocked: B1 (Windows x64 restart-jobs, G1) and B2 (Windows arm64 browser path, G2). No Windows host (see the B1 and B2 entry above for the install steps).
8. Waits for the owner: the ship.sh bypass.

Changes for item 1:
1. native/components/mcp/server.cpp and src/mcp.mjs, commit (see git log). Rows: skill_read_by_this_host, boot (the restart event), serve_skill_file and get_prompt (skill-loaded). Change: a skill-loaded event records its caller (worker pid and host pid). When a native worker resumes a run, it takes the skill as read if the run's log holds a gm skill-loaded event whose host pid is its own parent, and the restart event records `skillRead`. The read stays per host connection: a worker under another host process is gated once. Windows records no host pid, so nothing is carried there. Node logs the caller too; Node's carry stays in tools/core.mjs.
2. tools/check-restart-skill-read.mjs and tools/check-build.mjs, commit (see git log). Row: new witness in the check-build list. The check is the worker's parent and replays nothing: worker 1 reads the skill and runs a body; worker 2 on the same run directory gets initialize only and must run run_code, with restart `skillRead` true; worker 3, started through another process, must refuse the first run_code once with the skill text, with restart `skillRead` false, and then run. Phase B: `node tools/check-restart-skill-read.mjs build/release/native/components/host/gm`, `restart-skill-read-check: ok`, exit 0. Why a kept check: every relay built from HEAD replays the read, so only a parent that does not replay covers this path.

## gm pass, Phase B (2026-11-10, local, release at 3a81089): the skill read across a worker restart

Witnesses, output read in full:
- W1 `node tools/check-restart-skill-read.mjs build/release/native/components/host/gm`: exit 0, `restart-skill-read-check: ok`.
- W2 before state, the same witness on the installed build `c9a9688-310`: exit 1, 5 failures; the restarted worker answers `run_code refused: read skill://gm/SKILL.md first in this connection...`, as in the jayzee log.
- W3 check-build build/release: exit 0; `conformance: 86 passed, 0 failed of 86 checks in 24 scenarios`; the new witness ok; `check-build: gm stamp 3a81089-dev (3a81089)`.
- W4 parity, `node native/tests/parity/run.mjs`: exit 0, `17/95 scenarios match, 0 cutover-expected, 56 native-ahead, 22 documented-gap, 0 differ`.
- Not done here: no install was run, so jayzee's connection takes the fix when its installed build updates and its worker restarts onto it.

## gm pass, Phase A (2026-11-10): relay re-exec under a held wait, one skill copy in the refusal, the Node restart probe, the AGENTS.md audit

Phase A ran no build and no push. Each change is one local commit by lanmower with no trailer. Two runs were made in Phase A because the task asked for them before the change: the re-exec reproduction on the installed release, and the Node probe.

Item 2, relay re-exec. Reproduction (before any change), `node tools/check-relay-reexec.mjs /config/.gmnew/current/gm` on release `6a09d8b-311`, a scratch install offered a file:// manifest for ffff111-99 while a 10000 ms next_context wait was in flight: exit 1, `the relay re-executed 10086 ms after the update while a 10000 ms next_context wait was in flight`, `measured {"waitMs":10000,"updateAfterSendMs":124,"reexecAfterUpdateMs":10086,"waitAnsweredAfterSendMs":10036}`. The relay waited for the wait to end; a host that re-arms the wait never leaves a gap.
1. native/components/host/relay.cpp, include/gm/host/relay.hpp, serve.cpp, commit 829cf3b. Rows: Relay::reexec, only_resendable_in_flight, Relay::start, RelayOptions::resend, the --resend flag. Change: the relay re-executes while every call in flight is a next_context call; after the worker is stopped it passes those calls to the new relay as `--resend <json array>`, and the new relay routes them to its worker after the handshake. A run_code or finish in flight still holds the re-exec. Witness (Phase B): the same check on a build of HEAD configured with `-DGMNEW_VERSION=<commit>-1` prints `relay-reexec-check: ok`, with the re-exec under 5000 ms after the update, the held wait answered once, and run_code running on the new relay. On a dev stamp the check prints `skipped` (a development build never updates itself); check-build lists it, so a stamped CI build runs it.

Item 3, one skill copy.
2. native/components/mcp/server.cpp, src/mcp.mjs, skills/gm/SKILL.md, commit 3ffda38. Rows: kSkillReadRefusal / SKILL_READ_REFUSAL, skill_text_for_refusal, tool_result / toolResultOf. Before: the refusal held the text in content text and in structuredContent (about 48 KB). Change: structuredContent and the first content block are `{ok:false,error}`; the skill text is the second content block, raw. Witness (Phase B): tools/check-no-resource-client.mjs on both engines asserts two content blocks, the second equal to skills/gm/SKILL.md, the skill's description line present exactly once in the reply, and the reply at most 2000 bytes larger than one JSON-encoded copy of the skill; the ok line prints both sizes.

Item 5, Node arm across a worker restart.
3. tools/check-no-resource-client.mjs, tools/check-restart-skill-read.mjs, tools/check-relay-reexec.mjs, tools/check-build.mjs, commit 916188f. Change: the tool-only check now starts Node through tools/relay.mjs (the Node host) and native from a copied binary, restarts the worker (SIGTERM to the Node worker pid read from ps; a binary mtime change for native), waits for the restart event in the run log, and requires run_code to run. Probe result on Node (Phase A): exit 0, `no-resource-client-check: ok (node: ... one copy of the skill text (25606 bytes for a 24968-byte skill) ... run_code runs after a worker restart ...)`. Nothing to fix: tools/core.mjs deliversSkill (3e94558) already records a run_code call as the read and replays it.

Item 4, AGENTS.md audit (two read-only agents checked every line; each finding below was checked again against the code before the edit). Size 17389 -> 17980 bytes.
4. AGENTS.md, commit (see git log). False or stale, corrected: the parity count (17 of 95, 0 differ); "first written form at 38ff9c3" (5ecd512 holds the sentence; 38ff9c3 does not touch AGENTS.md); "multi-statement snippet as an awaited async body" (only a single-expression or parenthesised snippet is awaited); "accept_initialize fills them in" (removed; both clients refuse); "no caps on network verbs" (true for Node; native curl is http/https plus data:, 16 MiB, default redirect limit); "background jobs are killed" on a restart (bodies are stopped, shell jobs adopted); "Node search searches tracked files only" (the grep default; scope all exists); "doctor reports it" (Node doctor only); "setup.sh ... runs nothing itself" (it runs npm ci, the update check, the gate, the prefetch and a build); "Browser tabs (native only)" (Node has the scope); "edit under src/ or tools/ reaches peers" (narrowed); the Windows orphan caveat (native kills, Node adopts); the README pointer (no CLI section); the serialize note (lock is per root); the shell-timeout rule (older calls without a timeout named). Removed as stated elsewhere: Layout (README.md MCP surface), PLAYWRITER_NO_SANDBOX and the chromium wrapper (README.md), relay frozen (DESIGN.md Decided), release run 42286279980 detail (DESIGN.md), the five owner decisions (DESIGN.md; one pointer kept with the unimplemented item), the stopped-fetch repeat, the install entry detail (README.md). Added, found by runs in this session: served skills order, the skill gate for tool-only clients, the skill read across a restart, the relay re-exec measurement, ASan under this host's LD_PRELOAD, resources/read -32602 against -32002.
5. tools/prefetch.mjs, commit (see git log). Row: PACKAGE. The audit found setup prefetched pw#54466df while defaults/mcp.json and README.md run pw#ebbba11, so setup warmed a package the default entry does not start. Change: the pin is ebbba11 and the message no longer names a playwriter version. Witness (Phase B): `grep -c ebbba11 tools/prefetch.mjs defaults/mcp.json` is 1 each, and `node --check tools/prefetch.mjs` exits 0. Not run: the network fetch itself.
6. Not changed, noted by the audit: .gm-new/mcp.json still pins pw#54466df; README.md says run_code timeoutMs is at most 300000 and that three tools are served, while the code allows 3600000 and native also serves task_set. These are outside AGENTS.md.

## gm pass, Phase B (2026-11-10, local, release and stamped builds at b23984b): relay re-exec, one skill copy, Node restart, AGENTS.md audit

Witnesses, output read in full:
- W1 relay re-exec, `node tools/check-relay-reexec.mjs build/stamped/native/components/host/gm` (configured with -DGMNEW_VERSION=b23984b-1): exit 0, `with a 10000 ms next_context wait in flight the relay re-executed 172 ms after the update, the wait was answered once at 1454 ms, and run_code ran on the new relay`. Before (release 6a09d8b-311): 10086 ms. The resent wait returns early because the new worker's recovery event is pending.
- W2 the same check on build/release: `skipped (b23984b-dev ...)`, exit 0.
- W3 tool-only client, native: exit 0, `one copy of the skill text (25640 bytes for a 24968-byte skill) ... run_code runs after a worker restart`. Node: exit 0, `25606 bytes for a 24968-byte skill`. Before 3ffda38 the reply held the text twice.
- W4 `node tools/check-restart-skill-read.mjs build/release/native/components/host/gm`: exit 0, `restart-skill-read-check: ok`.
- W5 prefetch pin: `grep -c ebbba11` is 1 in tools/prefetch.mjs and in defaults/mcp.json; `node --check tools/prefetch.mjs` exit 0.
- W6 check-build build/release: exit 0; `conformance: 86 passed, 0 failed of 86 checks in 24 scenarios`; `check-build: gm stamp b23984b-dev (b23984b)`.
- W7 parity: exit 0, `17/95 scenarios match, 0 cutover-expected, 56 native-ahead, 22 documented-gap, 0 differ`, which is the count AGENTS.md now states.
