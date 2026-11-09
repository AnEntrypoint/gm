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
