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

### Phase B results (2026-11-09, build stamp 409c3f3, HEAD 409c3f3)

Rows 13-16 are built and witnessed on build/release/native/components/host/gm. Row 17 is this section.

- P1 (profile witness, /tmp/gmfix/profile.mjs, outside the repo): two project roots, each with a run that calls gm.playwriter_execute. Result: `{"check":"profile-witness","distinctProfilePaths":true,"distinctBrowserPids":true,"distinctPageSets":true,"alphaOwnsOnlyAlphaPage":true,"bravoOwnsOnlyBravoPage":true}`. alpha: browser pid 3716162, profile /tmp/gmfix-profile-alpha-CFGsfx/.playwriter/browser-profile, pages PROJECT-ALPHA-PAGE and about:blank. bravo: browser pid 3716673, profile /tmp/gmfix-profile-bravo-p84Cox/.playwriter/browser-profile, pages PROJECT-BRAVO-PAGE and about:blank.
- Conformance: `node tools/check-build.mjs build/release`: `conformance: 83 passed, 0 failed of 83 checks in 24 scenarios`; `check-build: gm stamp 409c3f3-dev (409c3f3)`; exit 0.
- Existing gm witnesses on the same binary, same results as the Phase B of the browser pass: seq refused:true; race twoRefused:true; finishrow peer B refused:false; outpage inline 20000, next 20000, totalChars 30010; read 28800 bytes, truncated false; loud over-cap error at 1200001 bytes; taskpage taskTruncated true, total 62889; tabs (A closed by finish, closedPages 2, B's tab kept); browsers (run-scoped close, machine close refused without confirm); journal (2 context-reply events); dup (peer B sees none of peer A's row events); skill (the served text holds Browser control, Memory rules and PLAYWRITER_PROJECT_DIR); other (2 other pages).
- Parity: `node native/tests/parity/run.mjs --bin build/release/native/components/host/gm`: 22/93 match, 0 cutover-expected, 56 native-ahead, 15 documented-gap, 0 differ (exit 0).
- Gate: the skills check failed twice before the Phase A commit (the gm skill named the verbs grep and search without gm.); both words were reworded, and tools/ship.sh committed 409c3f3 with gate exit 0. The Phase B push gate is recorded in the final report.
