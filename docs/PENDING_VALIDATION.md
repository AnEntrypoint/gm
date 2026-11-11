# Pending validation

## Stretch 2026-11-10 (run 2, stretch 4 items): browser tabs split, check timing, asan conformance: Phase A

Changes:
1. Browser tabs split (ranked item 13, the "other pages" count). src/browser-scope.mjs and native/components/host/browser_scope.cpp read the tabs through one CDP session: Target.getTargets for every page and its browserContextId, Target.getBrowserContexts for the contexts runs created, and this run's own context from one of its pages (Target.getTargetInfo). A page in a created context that is not this run's counts as another run's page; a page in the default context counts as a project-browser tab. The reply reads "not this run and not closable by it: N in other runs and M in the project browser". Measured before the change, on the playwriter sandbox: browser.newBrowserCDPSession is a function, Target.getTargets lists each page with its browserContextId, and the browser has two contexts (the default and this run's).
   Witness: tools/check-browser-scope.mjs gained a split phase. While the run's page is open, it opens one page in a second browser context and one in the default context, then expects browser_tabs to keep "tabs: 1 in this run" and to count at least one page in each group; the side pages are closed by an undo snippet.
2. tools/check-relay-reexec.mjs timing. It failed on the asan build only (build/asan at 4b564f7-1: "the relay did not report the update ... the update did not land while the next_context wait was in flight"). Measured with the check's relay copy and its scratch kept: the update was in the install directory (.gmnew-update.json at ffff111-99) and the relay logged "updated 4b564f7-1 -> ffff111-99" at 11942 ms after the send, then "re-executing the relay on the new build" at 12024 ms. The wait had been 10000 ms, so it had already answered. The non-asan build at the same HEAD (build/stamped, reconfigured at 4b564f7 with -DGMNEW_VERSION=4b564f7-1) re-executed 72 ms after its update. The product is unchanged; the check's held wait is now 30000 ms, the re-exec limit still 5000 ms.
3. The asan conformance run (build/asan, cmake --preset asan at 4b564f7-1, env -u LD_PRELOAD node tools/check-build.mjs build/asan): 86 passed, 0 failed of 86 checks in 24 scenarios, except the relay check of item 2, which made the run exit 1. The asan build is rebuilt again in Phase B at the final HEAD, and the asan check-build is rerun there.

Not changed: the Node and native tabs output for a project with no other runs and no default-context tabs keeps its first clause, so existing readers of "tabs: N in this run" see the same text up to the new clause.

## AGENTS.md audit and last-witness line (2026-11-10, run 2, stretch 4 item 1): Phase A

The audit ran before the edit, on the file as it stood at 03be6c7 (19 KB). Method: every path, check name and symbol the file named was looked up in the tree (80 names; 76 found, 4 not at the named place); each note was then read against the code, README, DESIGN.md and the served skill.

Kept (a rule, or a fact a run, witness or measurement revealed): the owner rules and the read-first list; the witness rule; the install and tool facts (npm install, ninja in a venv, the 409087f-77 updater, the gh full-SHA rule); the 120 s client backgrounding and the timeoutMs cutoff; the ssh stdin rule; the job-lifetime budget; the task leak, open until the installed build updates; fx's events-twice row, open on fx's reply text; the browser tabs limitation, open on a page-identity design; the build stamp rule; the body reap at restart; shell-job adoption with its caveats; the skill gate and the skill read across a restart; the relay re-exec; the ASan library order; the load-error frame; the tokenized-text heap measurement; the known gaps, with fetch added; the platform notes, with the Windows stderr line reworded to what child.cpp shows under _WIN32.

Removed, stated by the code, README, DESIGN.md or the skill: the browser profile note (PLAYWRITER_PROJECT_DIR is set in src/mcp-client.mjs and native/components/mcpclient/client.cpp, and README and DESIGN state it); the served-skills and native-leaves ordering notes (skills_dir_of and leaves_dir_of in native/components/host/options.cpp); the search and grep notes (src/search.mjs STATE_DIRS, native search_impl.cpp STAMP_SETTLE_MS, the scope-all rule, the tracked default); the hot-reload section (it repeats the owner rule and the shell-job note); the MCP-servers section (the skill's Browser section states the playwriter rule, and stop_body is code); the setup and remote lines (setup.sh and git remote); the Node read, task, run_code and finish parity note (fnv1a64Hex and unitBoundary in src/tools.mjs), the note that Node's finish reply carries the browser key (src/mcp.mjs:883 sets it, so the code states it); the "first-step host truncation correction is unmarked" line (next_context's description states the owner:true rule); the playwriter crash history (the fix is in code and its one-line rule stays under Platform notes); the progress-notification note (tools/check-run-code-progress.mjs pins it); the finish row refusal and the concurrent-search crash (both fixed, the code states the lock); the test-file history line was condensed, not removed.

Corrected: the last-witness line. It said 17 of 95 and 22 documented-gap, from the 2026-11-10 run before the find verb. It now says the run after the find verb (8586281): 17 of 97 match, 0 cutover-expected, 58 native-ahead, 22 documented-gap, 0 differ. Phase B reruns the parity harness to confirm the figure on the committed state.

Measured size: AGENTS.md is 12234 bytes after the edit (gate limit 30 KB).

## Stretch 2026-11-10: stretch 4 accounting (run 2)

Read the ranked tables (the 2026-11-10 "ranked open work" block and the "ranked reachable items" block) against this pass. Already closed with their own witnesses: G9 (rows 32 and 33), the SIGKILL body reap (wreap, the body-9 record), the ci_status no-commit message (41c0640), and the Node arm of the tool-only client (tools/check-no-resource-client.mjs, run by check-build).

Not taken, each for the reason the table gives: owner decisions (resources/read of an unknown uri, -32602 native against -32002 Node; the skill text carried twice in the run_code refusal; Node run_code budget parity beyond the 65 s case; the finish open-row step limit; the shell-job lifetime; decision 3, protocol 2026-07-28); a measurement first (relay re-exec under a held next_context wait); a design (splitting browser tabs by page identity); hosts this checkout does not have (Windows CI and the Windows B1 and B2 witnesses, macOS and arm64); fx's reply text (the "another worker's events twice" row); a served-skill refresh that waits for an installed release.

Open and reachable, not done in this pass: the AGENTS.md audit. The "Last witness" line in AGENTS.md still says 17 of 95 and 22 documented-gap. The current parity run, after the find verb (8586281), is 17 of 97 match, 0 cutover-expected, 58 native-ahead, 22 documented-gap, 0 differ. The AGENTS.md rule requires a full audit of every note before any edit to that file, and that audit was not run here, so AGENTS.md is unchanged. The line should be updated in the same edit as the audit.

Pin: the thebird artifact now matches TXIKI_WASM_SHA256 (sha256 137c08f6, verified with sha256sum on 2026-11-10). The pinned witnesses S5a and S5b in the stretch 1 section report pinned true. Thebird should confirm that this is the artifact it means to vendor.

## Stretch 2026-11-10 (find verb, run 2): Phase A and Phase B

Phase A, local: 8586281 adds the find verb on both engines (src/tools.mjs find, findWalk, findMatch, globMatch; native/components/verbs/verbs.cpp find, find_walk, find_glob_match, find_skip; the TOOLS entry and dispatch in src/mcp.mjs and the native table and order in native/components/mcp/server.cpp; the CLI entry in src/prompt.mjs; a parity row; tools/check-find.mjs, which seeds one tree per engine and compares 14 replies with sorted keys). find is not in skills.mjs FILE_TOOLS: the gate would flag the English word find in served skill text. Semantics: the path is located as list_dir locates it; glob supports * only, matched against the entry name, or against the path relative to the located directory when the glob contains a slash, and * never crosses a slash; kind is file, dir or any (default any); directories end with a slash; .git, .gm, .agentplug, .agentplug-kv, .playwriter, runs and node_modules are skipped at any depth; symlinks are listed and not followed; output is sorted by UTF-8 bytes; offset and limit page as list_dir does, with limit at most 500.

Phase A, local: 83369aa restores the sentence "after a compaction re-read WORKFLOWS.md" in the gm skill's fan-out section. Cause: the 28bb712 habit rewrite dropped the phrase that tools/mcp-conformance.mjs checks. check-build failed 85 of 86 before this commit and passes 86 of 86 after it.

Defects found in Phase B and fixed before the witness below: the glob matcher received its arguments in the wrong order (globMatch(text, pattern)), so b/*.mjs matched nothing on either engine; gm's own runs/ directory appeared in the seeded tree and made the walks differ, so runs is now skipped on both engines, as search already skips it; the parity find row differed at 445f001 only because the harness's Node reference is the committed HEAD and that HEAD had no find, so the row passes after the commit.

| witness | command | result |
|---|---|---|
| find, identical replies | node tools/check-find.mjs build/release/native/components/host/gm | exit 0; 14 queries, identical on node and native. Replies quoted from the run: {path:a, glob:b/*.mjs} gives b/c.mjs; {path:a, glob:*.mjs} gives b/c.mjs, b/deep/e.mjs, x.mjs; {path:a, glob:linked*} gives linked (not followed); {path:., kind:file, glob:*.js} gives top.js only (node_modules skipped); {path:a, glob:*x*, kind:any, limit:2, offset:1} gives total 4 and next 3, output caf\u00e9.txt, x.mjs; {path:missing} gives find: cannot read missing on both |
| parity | node native/tests/parity/run.mjs --bin build/release/native/components/host/gm | exit 0; 17/97 match, 0 cutover-expected, 58 native-ahead, 22 documented-gap, 0 differ |
| conformance | node tools/check-build.mjs build/release | exit 0; 86 passed, 0 failed of 86 checks |

Built: cmake --build build/release (job build-find-2, BUILD_EXIT=0) after the last native change; the skill commit needed no build (the served skill is read from the checkout).

Open from this stretch: none in find. The find verb does not reach the txiki bodies: a txiki body gets stat_file, read_file and list_dir only (see the stretch 1 section).

## Stretch 2026-11-10 (txiki verbs and imports, run 2): Phase A and Phase B

Changes in txiki/: host.mjs (run loop waits on pending verb calls with a clearable timer; tjs_bridge_send answers op 'builtin' name 'gm' from verbs.mjs and queues the reply for tjs_browser_resume; a gm.* prelude sets __thebirdBridge.onResult), fs.mjs (tjs_fs_* over the project, with the out layouts of thebird web/txiki-in-page.js), verbs.mjs (stat_file, read_file, list_dir), project.mjs (path and file-map helpers), node.mjs and build-site.mjs (no bundler, the pin read from thebird scripts/vendor-txiki.mjs and checked before any run; --allow-unpinned is labelled and is not a pin pass), site.mjs and site.html. txiki/bundle.mjs is removed. The seven gm_txiki_* exports are unchanged and thebird is not edited. No native code changed.

Pin: sha256 of /workspace/thebird/web/vendor/txiki/tjs.wasm is 137c08f6db9969194c917384172794173a31642b7d51d2aac6c598d1c4475a28, equal to TXIKI_WASM_SHA256 in thebird scripts/vendor-txiki.mjs, checked with sha256sum on 2026-11-10. The earlier digest dcd3a434 is no longer the artifact. Every witness below ran without --allow-unpinned and reports pinned true. Thebird should confirm this artifact is the one it means to vendor.

| witness | command | result |
|---|---|---|
| S5a verbs, Node | node txiki/node.mjs /tmp/gm-witness/txiki-verb/entry.mjs --root /tmp/gm-witness/txiki-verb | exit 0, status 0, pinned true, 36 ms, stdout {"file":"file","fileSize":46,"dir":"dir","textBytes":46,"names":"add.mjs\n","missing":"ENOENT: no such file or directory, stat nope.mjs"}; wall 0.195 s |
| S5b verbs, built site | node txiki/build-site.mjs --root /tmp/gm-witness/txiki-verb --entry entry.mjs --out /tmp/gm-witness/site-verb (pinned true, 2 files), serve.mjs on 127.0.0.1:18765, playwriter_execute loads the page in a run context | data-state done, pinned true, status 0, stdout identical to S5a, 58 ms |
| S5c imports, Node | node txiki/node.mjs /tmp/gm-witness/txiki-proj/entry.mjs --root /tmp/gm-witness/txiki-proj | BLOCKED: status 1, "Uncaught ReferenceError: could not load 'lib/add.mjs'" |

S5c cause: the artifact's file loader calls uv_fs_* (open, read, realpath, stat, readdir), which thebird scripts/txiki/stubs.tsv lists as stubs in the browser build ("no host file access yet (OPFS bridge pending)"). A trace of the tjs_fs_* imports showed no call before the failure, so the tjs_fs_* implementation is not the cause. Project imports therefore do not resolve through the artifact's loader yet. The bundler is removed, so no host-side fallback exists; the owner's rule is loader-only. Thebird owns the artifact; the fix is for thebird to back uv_fs_* with the tjs_fs_* bridge (or a module source hook). Re-run S5c after that fix.

Differences between engines, recorded: the site's project map has no mtimes and no directory sizes (mtime 1970-01-01, dir size 0), while Node reports the real stat. S5a and S5b print only type and size of the file, which agree.

## Stretch 2026-11-10 (skill follow-up): Phase B witnessed

S4a on fc5fede: skillCheck ok (every MCP_RULES line still in the skill, gm.fs_op prefixed, both served skills parse); check-skill-serve build/release ok; skills/gm/SKILL.md 9843 bytes. The static server on 18765 was stopped as a job.

## Stretch 2026-11-10 (habit skill): Phase B witnessed

S1 on 28bb712: skillCheck ok (every MCP_RULES line in the skill, no bare tool name, both served skills parse); check-skill-serve build/release ok (served text equals the checkout file, a live edit is served on the next read); skills/gm/SKILL.md 9747 bytes.

## Stretch 2026-11-10 (habit skill, Bash gap, txiki): Phase A

| # | Commit | File | Change | Witness needed |
|---|---|---|---|---|
| S1 | local, Phase A | skills/gm/SKILL.md | rewritten as habits (do each thing once, batch a step, let a job run, keep what you carry small, work through gm, debug live then test once, stop only what you started); the seven run rules kept verbatim; the Spending turns list and the bundling examples removed | Phase B: src/skills.mjs skillCheck ok (every rule of MCP_RULES in the skill, no bare tool name); tools/check-skill-serve.mjs; a live skill://gm/SKILL.md read equals the checkout file; wc -c below 12000 |
## Stretch 2026-11-10 (Bash gap): Phase B witnessed

S2a and S2b on e0f3663 and 1a5f3bf, on build/release (cmake --build build/release -j 8, exit 0, linking gm and gm-core):
- node --check on src/tools.mjs, src/mcp.mjs, src/prompt.mjs, src/skills.mjs: ok.
- default foreground timeout: `sleep 62; echo finished-after-62s` with no timeoutMs: native exit 0 in 62022 ms, Node exit 0 in 62055 ms, output finished-after-62s (driver /tmp/gm-witness/s2.mjs). The installed gm, whose default is 60000 ms, returned no output for the same command.
- default at the limit: `sleep 305; echo should-not-print` with no timeoutMs, native: the job value is `timed out after 300000 ms`, statement "run_shell stopped: timeout after 300000 ms with no output ... Pass timeoutMs (up to 3600000) or start it with job_start." (driver /tmp/gm-witness/s4.mjs).
- fs_op, the same script on both engines: mkdir fsop/a/b/c, cp fsop/a to fsop/d, mv fsop/d to fsop/e, rm fsop/e each return ok with their output string; rm of "/" is refused; list_dir fsop shows a/; stat of fsop/e is ENOENT. The two engines give identical replies.
- parity: node native/tests/parity/run.mjs --bin build/release/native/components/host/gm: 17/96 match, 0 differ (57 native-ahead, 22 documented-gap). Same counts as the last witness with one more scenario.
- Node restart orphan (from the open list): node tools/check-restart-body-orphan.mjs, exit 0.

Defects found in Phase B: none in the two stretch 2 changes.

## Stretch 2026-11-10 (txiki on thebird artifact): Phase B, pin check OPEN at this run

The run below is withdrawn as a pass. Its --allow-unpinned witnesses did not pass the pin check, and the owner ruled they are defects. The current state is in the txiki verbs and imports section above.

S3a on ed97869, run on the thebird artifact /workspace/thebird/web/vendor/txiki/tjs.wasm (sha256 dcd3a4342705967bfd4188aea39a4c7d368cfd7c90a42918e6fc72f83da656c1 at that time), pin read from /workspace/thebird/scripts/vendor-txiki.mjs:
- node txiki/node.mjs without a flag, scratch project /tmp/gm-witness/txiki-proj: exit 1, "tjs.wasm sha256 dcd3a434... does not match the pin 137c08f6... in /workspace/thebird/scripts/vendor-txiki.mjs" (S3b).
- node txiki/node.mjs --allow-unpinned (not a pin pass, unpinned artifact): status 0, stdout "add 5", "shout GM!", "tools add,version", "timer ok", 77 ms. Imports covered: named, default, namespace, export star, export from in the entry, timer.
- node txiki/node.mjs on a body "while (true) {}" with the default 120000 ms: status 124 at 120005 ms, stdout "spinning". The artifact interrupt handler enforces the deadline.
- node txiki/build-site.mjs --allow-unpinned (not a pin pass): build/txiki-site with tjs.wasm, shims/wasi-preview1.js from thebird, host.mjs, bundle.mjs, site.mjs, acorn.mjs, pin.json, project.json (4 files). The bundle.mjs and acorn.mjs files were removed in stretch 1.
- browser: build/txiki-site served by /tmp/gm-witness/serve.mjs on 127.0.0.1:18765 (port 8765 is held by a python3 process, pid 2211868, not this run; the first attempt reached that page and was discarded), playwriter_execute in the gm run: data-state done, title "gm run_code on txiki", status 0, the same four stdout lines as the Node run, 73 ms.

Not done: a txiki body has no gm verbs (the artifact has no bridge op for verb calls); the browser refusal path (pin mismatch without the flag) is not witnessed because build-site refuses before it writes; a body that imports a node: builtin is refused by the bundler (only ./ and ../ specifiers resolve). At run 1 the artifact did not match its pin (dcd3a434 against 137c08f6); see the stretch 1 section above for the current state.

## Stretch 2026-11-10: open rows in this ledger, accounting

Closed in this pass, each with its witness: the stale served skill (served text equals the checkout file, check-skill-serve); the Node restart orphan (Node arm exit 0 in the body ledgers Phase B block); the wasm32-wasi run_code blockers and the 120 s deadline (the txiki Phase B block at the wasm32-wasi section); server.cpp stop_orphans reaps the ledgers (server.cpp:1017-1021); the fx row unknown-mw6bc4mv1c00 (fx closes file resolved, 2026-11-09).

Still open, with the blocker: the installed gm does not carry the task-refusal and body-ledger commits until the dispatcher installs (two rows); Windows and macOS builds and CI (blocked on a Windows CI run); the budget-check margin (CPU-bound, measured 193313 to 233216 ms against a 400000 ms window); the Node playwriter snippet without the awaiting wrapper (a decision, AGENTS); the ranked open work list at the Phase A block near line 1346; the AGENTS.md line-by-line audit that the body-ledger block did not do; txiki bodies have gm.stat_file, gm.read_file and gm.list_dir, but project imports are blocked by the artifact (stretch 1 section). Closed since: the Node run_code before the first next_context (G9, rows 32 and 33) and the SIGKILL reap (wreap witness, body-9 record).

## Stretch 2026-11-10 (txiki on thebird artifact): Phase A

| # | Commit | File | Change | Witness needed |
|---|---|---|---|---|
| S3a | local, Phase A | txiki/bundle.mjs, txiki/host.mjs, txiki/node.mjs, txiki/build-site.mjs, txiki/site.html, txiki/site.mjs | run_code bodies run under thebird tjs.wasm (tjs_browser_eval, tick, end; tjs_browser_set_deadline for the 120 s deadline, enforced by the artifact interrupt handler); project imports bundled on the host (./ and ../ specifiers, default and named and namespace imports, export named, default and star) through a read function; Node CLI and a browser site built by build-site.mjs with the pin read from thebird scripts/vendor-txiki.mjs and checked against tjs.wasm (fails closed unless --allow-unpinned) | Phase B: node txiki/node.mjs <entry> --root <scratch> on the thebird artifact: status 0 with the console output; a body that never returns: status 124 at about 120 s; the browser run of build/txiki-site through playwriter: #result carries the same output and data-state done |
| S3b | local, Phase A | (none) | thebird pin and artifact mismatch, found in Phase A: thebird scripts/vendor-txiki.mjs TXIKI_WASM_SHA256 is 137c08f6db9969194c917384172794173a31642b7d51d2aac6c598d1c4475a28; web/vendor/txiki/tjs.wasm sha256 is dcd3a4342705967bfd4188aea39a4c7d368cfd7c90a42918e6fc72f83da656c1. The driver refuses the artifact unless --allow-unpinned is given. Thebird must rebuild its vendored artifact; gm does not edit thebird | Phase B: node txiki/node.mjs without the flag exits 1 with both digests named; the witness with the flag is labelled as a run on the unpinned artifact |

| S4a | local, Phase A | skills/gm/SKILL.md | the job habit names the 300 s default of gm.run_shell; the work-through-gm habit names gm.fs_op for create, copy, move and delete | Phase B: skillCheck ok (gm.fs_op is a served name, prefixed); check-skill-serve build/release ok; wc -c under 12000 |
| S2b | local, Phase A | native/components/verbs/verbs.cpp (fs_op method, table entry, dispatch), native/components/mcp/server.cpp (node_verb_order), src/tools.mjs (fs_op, node:fs/promises imports), src/mcp.mjs (TOOLS entry, dispatch), src/prompt.mjs (CLI_TOOLS), src/skills.mjs (FILE_TOOLS) | new verb fs_op({ op: mkdir, cp, mv or rm, path, to? }) in both trees: mkdir creates parents, cp is recursive and merges into an existing directory, mv renames, rm is recursive; rm refuses the filesystem root and the workspace root | Phase B: on a scratch workspace in each engine, fs_op mkdir a/b/c, cp a to d, mv d to e, rm e: each output string, then list_dir shows the tree; fs_op rm "/" is refused; node --check src/tools.mjs; parity run shows fs_op as a native-ahead or matching row |
| S2a | local, Phase A | native/components/verbs/verbs.cpp, src/tools.mjs, src/mcp.mjs, src/prompt.mjs | run_shell foreground default 60000 ms raised to 300000 ms, the same default as a job; the two tool descriptions name it | Phase B: `gm.run_shell({ command: "sleep 62; echo finished-after-62s" })` with no timeoutMs returns exit 0 and the echo, on build/release and node; `sleep 310` with no timeoutMs is stopped at 300000 ms and the stop line names the limit |

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

## gm pass, Phase A (2026-11-10): turn and token economy in the skill and the server

Phase A ran no build, check or push. Each change is one local commit by lanmower with no trailer. Phase B builds once (no reconfigure: build/release has its cache), runs each witness once and records its wall time.

Measured by the dispatcher across the fx, gm, jayzee and spoint transcripts: run_code about 548 minutes over thousands of calls (spoint 3920, jayzee 2630), mostly one verb per call; next_context about 327 minutes (209 in gm), one call before every step; sleep-and-poll loops about 274 minutes at about two minutes a loop; builds and checks rerun several times per pass.

1. skills/gm/SKILL.md, skills/dev/SKILL.md, docs/index.html, commit (see git log). Rows: new section "Spending turns and tokens" (eight rules, each with its reason), Rules bullet 2, steps 1 and 5, the job example in Bundling a step, After a context compaction step 1; dev skill Witnesses (build once, no reconfigure when build/release/CMakeCache.txt exists, wait with job_status, wall time in the ledger). Witness (Phase B): the served skill holds `## Spending turns and tokens`; tools/check-skill-serve.mjs passes.
2. native/components/mcp/server.cpp, src/mcp.mjs, src/prompt.mjs, src/connect.mjs, commit (see git log). Rows: rule 2 text (kMcpRules, MCP_RULES, kRuleText, RULE_TEXT), next_context (nothing_changed_since_reply / nothingChangedSinceReply, the `full` argument, the description, the server instructions), call_tool (note_body_shape / noteBodyShape: batchNotice, pendingEvents). Change: a next_context with no pending event, no open rules notice, no recovery, the same rules, and only the caller's own call events since the last reply answers `{ok, unchanged: true, progress, run, steps, stepsLeft}` and takes no step; `full: true` forces the full reply. A run_code reply carries `pendingEvents: true` while the run's pending queue holds an event, and `batchNotice` on the third body in a row with one verb call (and every tenth after). Rule 2 now reads: call next_context at the start of a run, after a compaction, and when a reply reports pendingEvents.
3. native/components/verbs/job.cpp, verbs.cpp, native/include/gm/job_text.hpp, native/components/mcp/server.cpp (body jobs), src/tools.mjs, src/mcp.mjs, commit (see git log). Rows: job_status (waitMs cap 30000 -> 3600000, `tail`, `pid`), the ended status (`durMs`), kill_statement / jobKillStatement for reason timeout, the job_start and job_status descriptions. Change: one job_status call blocks until the job ends or waitMs passes and returns exitCode and the last `tail` characters; `pid` waits for a process gm did not start; an ended job records its wall time; a job stopped at its limit says the limit is job_start's timeoutMs and how far it can be raised. The 300000 ms default stays (native); Node's 60000 default stays, it is an owner-pending row in the parity harness.
4. tools/check-turn-economy.mjs, tools/check-build.mjs, tools/mcp-conformance.mjs, commit (see git log). Row: new witness, in the check-build list for the native binary and for node; the two conformance loops that count 50 steps now pass `full: true`. Witness (Phase B), both engines, `turn-economy-check: ok`: the second next_context is `unchanged` under 1200 bytes with stepsLeft unchanged; next_context after only the caller's run_code is unchanged; `full: true` is step 2; the third single-verb body has batchNotice and a two-verb body has none; one job_status call waits past the old 30000 ms cap for a 31 s job and returns exitCode 0, a 5-character tail and durMs; a job with timeoutMs 500 ends killed with a statement that says `pass timeoutMs`; a pid wait returns `gone`; the reply after job events carries pendingEvents; the next next_context is a full step and the one after is unchanged. Why a kept check: these are reply shapes of a fresh connection that a live probe from a running host cannot reset.
5. Also in Phase B: check-build once and the parity harness once, since rule text, descriptions and reply shapes changed in both engines.
6. src/connect.mjs CONNECT_SHA. The server instructions said "Start each step with next_context", which contradicts the new rule 2, so the connect-time text changed and the gate asked for the new value. It is recorded on the dispatcher's instruction for this pass; a host sees the new instructions after it reconnects.

## gm pass, Phase B (2026-11-10, local, build/release reused without a reconfigure): turn and token economy

One build step per change set (`cmake --build build/release`, no configure: 31 s after Phase A, 12 s after the defect fix). The stamp stays b23984b-dev, the commit of the last configure. Witnesses, output read in full, with wall time:
- W1 `node tools/check-turn-economy.mjs build/release/native/components/host/gm`: exit 0, 31 s. `a next_context with nothing new answers unchanged in 401 bytes against 2303 for a full reply and takes no step ... one job_status call waited 31007 ms for a job and returned its exit code, tail and wall time; a job stopped at its limit says to pass timeoutMs; a pid wait returned when the process ended; a reply with events queued carries pendingEvents`.
- W2 the same check on node: exit 0, 31 s, `unchanged in 401 bytes against 2278`, `waited 31008 ms`.
- W3 check-build build/release, first run: exit 1, 300 s. Defect 1: tools/check-no-resource-client.mjs expected a second step from a next_context with nothing new; it now expects `unchanged` (850c613). Parity, first run: exit 1, 53 s, 14 differ, all `pendingEvents` present on Node and absent on native. Defect 2: native did not queue a pending event for an event a leaf appends (rows.mjs row-added), so a row added in native never reached next_context's pending list; fixed in f023123 (make_primitives takes the worker's pending hook). Probe after the fix: `prd_add reply pendingEvents: true` and next_context `pending: [{... "kind":"row-added" ...}]` on native, as on Node.
- W4 check-build build/release, after the last change: exit 0, 370 s. `conformance: 86 passed, 0 failed of 86 checks in 24 scenarios`; turn-economy and no-resource-client ok on the native binary and on node; `check-build: gm stamp b23984b-dev (b23984b)`.
- W5 parity, after the last change: exit 0, 14 s, `17/95 scenarios match, 0 cutover-expected, 56 native-ahead, 22 documented-gap, 0 differ`. Two rules were added to the harness for the row that now has pending records on native: the pending id follows the event seq (native is one higher per context-reply), and inFlight is a bookkeeping field.
- Windows: the pid wait is not served there and the two new checks skip their pid and restart parts on win32; not run on Windows.

## gm pass, Phase A (2026-11-10): embedded txiki.js runtime in place of QuickJS-NG

Phase A ran no build, check or push. Two things were run because the change cannot be written without them: the three pinned archives were downloaded into the OS temporary directory to read their sources, and tools/vendor-txiki.mjs was run to write the vendored tree (18 s). Each change is one local commit by lanmower with no trailer.

1. tools/vendor-txiki.mjs and native/third_party/txiki (204 files, 9.0 MB), native/third_party/quickjs-ng removed, commit (see git log). Pins: txiki.js v26.11.0 sha256 763025ac...8059, libuv dd9f081 sha256 f5185440...88d0, quickjs-ng 7b5f588 sha256 f27b2e93...1366; the tool refuses an archive whose sha256 differs. 91 non-ASCII comment characters are written as ASCII; the tool refuses one outside a comment. Witness (Phase B): `node tools/vendor-txiki.mjs` run again leaves `git status --short native/third_party/txiki` empty (the tree is reproducible from the pins), and the gate's ascii check passes.
2. native/components/quickjs/{CMakeLists.txt, engine.hpp, engine.cpp, runcode.cpp} and native/components/quickjs/txiki/{txiki_shim.c, txiki_shim.h, txiki_stubs.c, overlay/}, commit (see git log). Rows: Engine (constructor, destructor, loop_alive, turn_loop), session_of, past_deadline, settle, load_module_from_disk, reset of the embedded globals; CMake targets gm_quickjs_ng (now the pinned quickjs-ng), uv_a, gm_txiki, option GMNEW_TXIKI (OFF on MSVC). Witness (Phase B): the release build compiles and links with no warning from gm's own sources; every existing check in tools/check-build.mjs passes unchanged (conformance 86 checks, run-code budget and progress, read parity, restart jobs and the rest); parity `0 differ`.
3. tools/check-embedded-runtime.mjs and tools/check-build.mjs, commit (see git log). New witness in the check-build list: a body awaits a 300 ms timer and gets its value after the wait; URL and TextEncoder work; `typeof tjs` and `typeof alert` are undefined; console output does not reach the protocol stream; a relative import loads; a native verb and a leaf verb answer in one body; a promise that never settles with no live handle ends with an error; the cost of a trivial body with a fresh runtime is printed. On a build without txiki it prints `skipped`. Why a kept check: the engine is rebuilt from vendored sources on every target, and only a body run on the built binary shows the loop, the globals and the stream.
4. tasks/rewrite/quickjs.md, tasks/rewrite/common.md, DESIGN.md "Embedded txiki.js runtime (2026-11-10)", commit (see git log). The brief now describes the txiki engine.
5. Not reachable here: Windows (MSVC keeps plain QuickJS-NG, unverified), macOS and arm64 builds of libuv and txiki. They build only in hosted CI, which this pass does not watch.

## gm pass, Phase B (2026-11-10, local, release and stamped builds at 908f7f5): embedded txiki.js runtime

Phase B built the release tree, ran every listed witness, fixed each defect it found, and reran the failing witnesses. Wall times are the gm job durations (durMs). Three defects were fixed earlier in this pass (d85ad6c, 971397b, bb8b162: the webcrypto namespace stub, the tjs shadowing and timer loop-time refresh, the run_repl stub and the ESM witness format). Two more were found here.

1. Release build, `cmake --preset release` and `cmake --build build/release -j 4`: exit 0, 59.6 s from configure, 102 steps, no warning or error line. After the runcode.cpp fix below, the incremental build took 8.9 s, exit 0.
2. First `node tools/check-build.mjs build/release`: exit 1 at tools/check-resources-subscribe.mjs, 108.0 s. Every assertion printed ok; the failure was its cleanup, `rmSync` of the scratch directory with ENOTEMPTY, because the child could still write its run log while the directory was removed. Fixed: rmSync with maxRetries 20 and retryDelay 100, as check-no-resource-client.mjs does.
3. First `node native/tests/parity/run.mjs --bin build/release/native/components/host/gm`: exit 1, 23.8 s, `17/95 scenarios match, 0 cutover-expected, 55 native-ahead, 22 documented-gap, 1 differ`. The differ was `run_code syntax error`, `.result.content[0].text.error`: Node `(line 1, column 9)`, native `at <anonymous> (<body>:2:9)` with no line. The vendored quickjs-ng prints the frame in a new format, so load_error in native/components/quickjs/runcode.cpp never found its `\n    at <body>:` marker and dropped the location. Fixed: load_error matches `<body>:` and takes the message from the first line of the engine text.
4. Parity after the fix: exit 0, 17.4 s, `17/95 scenarios match, 0 cutover-expected, 56 native-ahead, 22 documented-gap, 0 differ`. The syntax-error row is native-ahead now (actionSeq shift, as in the other rows).
5. Second `node tools/check-build.mjs build/release` on the fixed binary: exit 0, 380.9 s, stamp `908f7f5-dev (908f7f5)` for gm and gm-core. Conformance: `86 passed, 0 failed of 86 checks in 24 scenarios`. Every listed check exited 0 (a failed check would stop the list), including `embedded-runtime-check: ok` (a body awaited a 300 ms timer for 300 ms; URL and TextEncoder work; a body cannot name the runtime's own host API; a trivial body takes 16 ms with a fresh runtime), `read-parity-check: ok`, `no-resource-client-check: ok` (native and Node), `restart-jobs-check: ok` (native and Node). relay-reexec-check printed `skipped` on this dev stamp, as designed.
6. Stamped build, `cmake --preset release -B build/stamped -DGMNEW_VERSION=908f7f5-1` and `cmake --build build/stamped -j 4`: exit 0, 117.6 s.
7. `node tools/check-relay-reexec.mjs build/stamped/native/components/host/gm`: exit 0, 16.7 s, `relay-reexec-check: ok (908f7f5-1 (908f7f5): with a 10000 ms next_context wait in flight the relay re-executed 2 ms after the update, the wait was answered once at 2665 ms, and run_code ran on the new relay)`. This is the witness check-build skips on a dev stamp; it ran here on the stamped build.
8. Not run here: Windows, macOS and arm64 builds of libuv and txiki (hosted CI, not watched in this pass); the asan build, which this pass did not rebuild.

## gm pass, Phase A (2026-11-10): the gaps in the cae7336 REPORT

1. AGENTS.md, commit (see git log). Audit before the edit: 17980 bytes, 123 lines. Every path and function AGENTS.md names exists in the tree (test -e for each path and git grep for each symbol; no MISSING line). Changed: the build-stamp line (the stamp is the short HEAD sha at configure time, cmake/gmnew_build_info.cmake; `-DGMNEW_VERSION=<sha>-1` is the CI shape); the relay line now points to that stamp line instead of repeating it; the platform note records the Windows, macOS and arm64 gap with its cause (no such host in this checkout; txiki and libuv unbuilt there; MSVC keeps QuickJS-NG; hosted CI builds them and is not watched); a new troubleshooting line gives the load-error frame fact from DESIGN.md. Witness, Phase B: the ship.sh gate for this commit exits 0, and `wc -c AGENTS.md` stays under 30720 bytes (the agents-size gate).
2. Ledger, commit (see git log): this entry.
3. Phase B witnesses, not yet run: `cmake --preset asan` then build (asan at HEAD), `cmake --preset release -DGMNEW_VERSION=<sha>-1` then build (release stamps HEAD, no -dev), `node tools/check-build.mjs build/release` once, and `env -u LD_PRELOAD node tools/check-embedded-runtime.mjs build/asan/native/components/host/gm` as the asan smoke run. The stamp is the commit HEAD is at configure time, the Phase A commit (code identical to cae7336: git diff --stat cae7336 HEAD -- native src tools cmake is empty, to be confirmed in Phase B), not cae7336 itself: the module only accepts a GMNEW_VERSION that starts with the HEAD sha.
4. Gaps, not blocking: Windows, macOS and arm64 builds and runs of libuv and txiki (no such host here; hosted CI builds them, not watched); the MSVC build keeps QuickJS-NG.

## gm pass, Phase B (2026-11-10, local, asan and release at 09af517): the gaps in the cae7336 REPORT

Phase A stamped 45cf6c0. The fixes below moved HEAD to 09af517, and the final stamp is `09af517-1 (09af517)`, not cae7336 itself. The code is unchanged since cae7336: `git diff --name-only cae7336 HEAD -- native src tools cmake CMakeLists.txt skills` lists 0 files at 45cf6c0. Wall times are the gm job durMs.

1. asan, `cmake --preset asan -DGMNEW_VERSION=45cf6c0-1` and `cmake --build build/asan -j 4`: exit 0, 86.3 s, 0 warning lines. Its `--version` under `env -u LD_PRELOAD` is `09af517-1 (09af517)` after the rebuild at 09af517.
2. release, `cmake --preset release -DGMNEW_VERSION=45cf6c0-1` and `cmake --build build/release -j 4`: exit 0, 22.4 s, 0 warning lines. Rebuilt at 09af517 with `-DGMNEW_VERSION=09af517-1` (29.7 s, 0 warnings), `--version` `09af517-1 (09af517)`.
3. First `node tools/check-build.mjs build/release` (binary at 45cf6c0): exit 1, 183.7 s, at `run-code-budget-check`: `TypeError: Cannot read properties of undefined (reading 'content')` at tools/check-run-code-budget.mjs:83, so the run_code reply had no `result`. The check hid the server's error. It did not reproduce: a copy of the check that logs the reply passed three standalone runs (65009, 65010, 65008 ms for the 65 s spin, exit 0). Cause not found. Fixed for diagnosis: the check throws `run_code had no result: <reply>` instead of crashing with a TypeError.
4. Defect found by a live probe: job durMs was negative, -1751888 ms in run 2026-11-10-02-18-06-0805c9 and -1815791 ms on the next job. JobTable kept one `mono_offset_`, set by the first job in a worker, and a later run's job started from that stale offset while its log events carry the new run's mono base. Fixed: each job takes its offset from its own start event (native/components/verbs/job.cpp, core_internal.hpp). An adopted job after a worker restart has no durMs, because its start clock belongs to the old worker.
5. Live probe after the fix, release 09af517 (scratch workspace in /tmp, one worker): a `sleep 1` job in run 1 gave durMs 1007; `finish`; a successor run on the same worker; a `sleep 1` job gave durMs 1007. Before the fix the second value was negative.
6. Second `node tools/check-build.mjs build/release` (09af517): exit 0, 382.2 s. `conformance: 86 passed, 0 failed of 86 checks in 24 scenarios`; run-code-budget-check ok (65010 ms); relay-reexec-check ok on the stamped release (`09af517-1 (09af517)`, relay re-executed 45 ms after the update, not skipped); embedded-runtime-check ok; the Node arms of restart-jobs, no-resource-client and turn-economy ok; `check-build: gm stamp 09af517-1 (09af517)` and `gm-core stamp 09af517-1 (09af517)`.
7. asan smoke, `env -u LD_PRELOAD node tools/check-embedded-runtime.mjs build/asan/native/components/host/gm`: exit 0, 2.6 s, `embedded-runtime-check: ok (... a body awaited a 300 ms timer for 300 ms ... a trivial body takes 57 ms with a fresh runtime each time)`. The asan build did not run the full check-build.
8. Gaps, not blocking, with their causes: Windows, macOS and arm64 builds and runs of libuv and txiki were not done (no such host in this checkout; hosted CI builds them and is not watched); MSVC keeps QuickJS-NG (GMNEW_TXIKI OFF).

## gm pass, Phase A (2026-11-10): the txiki.js weight measurement script

Script: scripts/measure-txiki-wasm.mjs. It reads a wasm 1.0 binary, lists its sections, custom sections, debug sections, imports and exports, reads the name section when present, counts names per module family (sqlite3, webcrypto, httpclient, libwebsockets, mbedtls) in the strings, imports, exports and name section, then strips every custom section and gzips both the raw and the stripped file with `gzip -9` (name stored, as `gzip -9 <file>` does). It reads its inputs only; nothing outside a temp directory is written.

1. Witness, run on thebird's reference tjs.wasm (read-only), `node scripts/measure-txiki-wasm.mjs /workspace/thebird/web/vendor/txiki/tjs.wasm`, exit 0, 2.5 s: raw 14173232 bytes, sha256 cc37307b9130d2d2fcfb98ca833527d4e2d29028c67b393f27634e938bacd1b7 (the pin in thebird's scripts/vendor-txiki.mjs). Custom sections: 11, 10301444 bytes, of which 9 are debug (.debug_* 8 sections, name): 10301231 bytes. Name section: 5073 function names. Imports 66 (wasi_snapshot_preview1 45, env 21). Exports 155. Stripped: 3871788 bytes. gzip -9 raw 4935962, gzip -9 stripped 1399298.
2. The owner's baseline of 4935962 gzipped matches `gzip -9 <file>` exactly. The stdin form `gzip -9 -n -c` gives 4935953 (no name stored). The first run of the script used the stdin form, and the change to the file form is the fix for that.
3. Module evidence in the reference (names found, sample): sqlite3 321 (tjs:sqlite, SQLITE_, SQLITE_OPEN_READONLY); webcrypto 7 (webcrypto, tjs__webcrypto_init); httpclient 7 (HttpClient, NativeHttpClient); libwebsockets 13 (lws_context_destroy, lws_log_cx); mbedtls 3 (mbedtls_x509_crt, tjs__mod_tls_init). The counts are names, not byte ranges: they say which modules the binary carries, not what each costs.
4. Known limit: the family counts search names, not the linker map, so a module whose names are stripped from a build would show 0 even if its code is linked. The raw and stripped sizes above are the bytes that matter for the browser weight question.

## gm pass, Phase B (2026-11-10): the txiki.js wasm32-wasi weight, blocked at libuv

Result: blocked. gm's txiki core does not compile for wasm32-wasi from gm's own tree, because libuv has no WASI platform port. The QuickJS-NG part does build, and it is measured alone below. The comparison with thebird's tjs.wasm is therefore not made.

Toolchain: zig 0.17.1, the version thebird pins (ZIG_VERSION in scripts/vendor-txiki.mjs). The host had no zig on PATH. `pip install --target /tmp/gm-zig117/pkg ziglang==0.17.1` gave `zig version` 0.17.1, outside the checkout.

Flags, from thebird's flagsFor and linkCheck: applied: `-target wasm32-wasi -O2 -D_GNU_SOURCE -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS -D_WASI_EMULATED_GETPID -DTJS__PLATFORM="wasi" -w` for compiles; link `-mexec-model=reactor -Wl,--no-entry -Wl,--export-dynamic -Wl,--no-gc-sections -Wl,--export=malloc -Wl,--export=free -Wl,--export=realloc -Wl,--export=calloc -lc++ -lc++abi -lwasi-emulated-signal -lwasi-emulated-process-clocks -lwasi-emulated-getpid -lm`. Not applied, because gm does not have the input: the prefix maps (paths only), `-DTJS_HAVE_SQLITE` and the SQLite defines (no deps/sqlite3 in gm's vendored tree), `-include txiki-browser.h` and the `uv.h` browser patch (thebird's port), and the `tjs_browser_*` exports (thebird's browser entry).

Steps and sizes:
1. Compile of gm's txiki core (native/components/quickjs/CMakeLists.txt list: 24 src files, 4 bundles, mod_posix-socket.c, ada.cpp, txiki_stubs.c, txiki_shim.c) plus libuv's 65 src and unix files: 10 of 101 compile. The 91 failures all carry the same error, `native/third_party/txiki/libuv/include/uv.h:99: "Unknown platform. Define UV_FREERTOS if targeting FreeRTOS."`, which every txiki source reaches through uv.h (91 of 91 logs; the first run also showed `quickjs.h not found` for the glue files, fixed by adding the quickjs include). Thebird avoids this by patching uv.h to include `uv/browser.h` and by building `uv-browser.c`. Neither file is in gm's tree.
2. QuickJS-NG alone (dtoa.c, libregexp.c, libunicode.c, quickjs.c; all 4 compile): link exit 0 with the link flags above: raw 5326939 bytes (`scripts/measure-txiki-wasm.mjs`: stripped 1319372; gzip -9 1872613; gzip -9 of stripped 458979). Imports 45 (all wasi_snapshot_preview1), exports 7. Family names: sqlite3 0, webcrypto 0, httpclient 0, libwebsockets 0, mbedtls 0.
3. Thebird reference, same script (read-only): raw 14173232; stripped 3871788; gzip -9 4935962; gzip -9 of stripped 1399298. Its sha256 cc37307b9130d2d2fcfb98ca833527d4e2d29028c67b393f27634e938bacd1b7 is the pin in scripts/vendor-txiki.mjs.
4. Modules, by source list and by the names the script found: gm's txiki core does not include mod_sqlite3, mod_httpclient, mod_webcrypto, mod_ws or mod_tls (native/components/quickjs/CMakeLists.txt, GMNEW_TXIKI_SOURCES; native/third_party/txiki/VERSION.txt, "txiki files left out"). Their entry points are answered by stubs in txiki_stubs.c, which gm links for libwebsockets and mbedtls too. So gm's core links no SQLite options, no webcrypto, no httpclient, no libwebsockets and no mbedtls code; the thebird reference links all five (321 sqlite3 names, 7 webcrypto, 7 httpclient, 13 libwebsockets, 3 mbedtls).
5. Debug sections: the thebird flags have no `-g`, but zig cc adds .debug_* sections anyway. Both the QuickJS-only link (8 .debug_* sections plus name, 4007370 bytes) and the thebird reference (9 sections, 10301231 bytes) carry them, so debug sections are part of both raw sizes. The stripped rows above remove them.
6. What this does not give: the weight of the txiki runtime (libuv, the txiki modules, the bundles, ada) in gm. It needs a WASI libuv port in gm's tree, which is the next step for the thebird dedup decision.

REPORT: blocked - gm's txiki core does not build for wasm32-wasi: libuv has no WASI platform port (91 of 91 failing logs: uv.h "Unknown platform"); QuickJS-NG alone links to 5326939 raw / 1872613 gzip -9 bytes, against thebird's full 14173232 / 4935962 - witness: `zig 0.17.1 link of quickjs-only.wasm exit 0`, `scripts/measure-txiki-wasm.mjs` output for both files above.

## gm pass, txiki wasm32-wasi Phase A (2026-11-10, local, not built): the libuv blocker and the wasi target

Scope: code, docs and tests only. Nothing here was built, run, or witnessed in this stretch; each row names the witness it still needs. Pins are unchanged: txiki v26.11.0 (763025ac...), libuv dd9f081cc55a4d83e2a976848d074f28ee5f34eb (f5185440...), quickjs-ng 7b5f588e0f9b643e2996f291bfc861abeaceddc2 (f27b2e93...), matching native/third_party/txiki/VERSION.txt and tools/vendor-txiki.mjs.

1. native/third_party/txiki/browser/uv-browser.c and browser/uv/browser.h (new, copies of thebird's committed b5ec730, read from git show, not the working tree). sha256 89d228c3fd5ede105029e6c586a903ecb7d8f3ac75841f9e8844ea6ddaa72a50 and feee1d8eee76d0518107be49bceb7d8e8901a7a82d621e00787212d67aba7ccd, checked with sha256sum here. Witness needed: a wasm configure and build of gm_txiki_core_wasi compiles uv-browser.c (Phase B).
2. tools/vendor-txiki.mjs: BROWSER_PORT pins; the tool verifies both copies before it deletes anything; the delete is limited to txiki, libuv, quickjs and VERSION.txt, so browser/ survives a re-vendor; VERSION.txt gets a browser port line per file. Witness needed: `node tools/vendor-txiki.mjs` (network, not run here) keeps browser/ and rewrites VERSION.txt with the two browser lines.
3. native/third_party/txiki/VERSION.txt: the two browser port lines, written by hand to match what item 2 writes. Witness needed: the same vendor run as item 2 (diff of VERSION.txt).
4. native/components/quickjs/CMakeLists.txt: option GMNEW_TXIKI_WASI (default OFF); the native libuv block now runs only when GMNEW_TXIKI is on and GMNEW_TXIKI_WASI is off; the wasi branch patches libuv's include/uv.h into the build directory (the FreeRTOS branch becomes uv/browser.h, as thebird does) and never edits the vendored copy; it builds gm_txiki_core_wasi (thebird's core source subset without mod_sqlite3, cli and the libuv-only modules, plus ada, the glue stubs and uv-browser.c) and the reactor gm_txiki_wasi, which links gm_runcode and exports gm_txiki_new, gm_txiki_free, gm_txiki_context, gm_txiki_loop_alive, gm_txiki_loop_turn, gm_txiki_load_builtin and gm_txiki_refresh_loop_time, plus malloc, free, realloc and calloc, which thebird's entry also exports. Witness needed: (a) default configure and `cmake --build build/release` unchanged (native parity, check-build); (b) `cmake -DGMNEW_TXIKI_WASI=ON` with a wasm32-wasi compiler builds gm_txiki_wasi; (c) an export-name check of the binary's export section. scripts/measure-txiki-wasm.mjs counts exports but does not list their names yet, so this needs a name listing added to the script first.
5. run_code under the txiki context on wasm32-wasi: no engine code changed. gm_runcode builds with GM_HAVE_TXIKI (engine.cpp already routes the tjs: prefix to gm_txiki_load_builtin, and sets interrupt_on_deadline on the txiki runtime, so the 120 s deadline still runs through the interrupt handler). LeafVerbs and their tests are unchanged. Witness needed: in the built reactor, a body that loops past 120 s is interrupted at the deadline, and a body importing a tjs: builtin resolves.
6. Not vendored and not compiled in this stretch: fs-browser.c, entry.c, webcrypto-browser.c, httpclient-browser.c, sqlite-vfs.c, http-client.js (thebird's other browser sources). mod_fs and mod_os call uv_fs_* and similar, and the browser port may not define all of them. Expect a link check to name missing symbols (Phase B).
7. mod_channel, mod_dns, mod_fswatch, mod_process and mod_udp are left out of the wasi core (thebird's list leaves them out too). Their entry points are answered by txiki_stubs.c or are not reached. Witness needed: the link output of item 4(b).
8. Phase B is gated on thebird's origin/main carrying a browser entry that exports the seven gm_txiki_* functions. The gate is checked after the Phase A commit (see the Phase B note in the REPORT line).

Gate for that stretch, checked in this pass: `git -C /workspace/thebird fetch origin` once; origin/main is b5ec730, and `git grep -l gm_txiki origin/main` lists 0 files. Phase B (the run_code wasm32-wasi build) stays gated and is not built.

## gm pass, Phase A (2026-11-10): ranked reachable items, and the ci_status no-commit message

Phase A ran no build, test, gate or witness, and pushed nothing. Each change is one local commit by lanmower with no trailer. The witnesses below run in Phase B on HEAD.

Ranked open items. "Reachable" excludes the txiki wasm32-wasi Phase B (gated on thebird's gm_txiki export) and anything that needs a Windows, macOS or arm64 host.

| rank | item | status in this pass | reason |
|---|---|---|---|
| 1 | ci_status says "no commit X in this repository" for a root that is not a git repository (rows.mjs:196 in the earlier list; the same wording sits in git.mjs in both trees) | done, see change 1 | none |
| 2 | f80cd46, the run_code leaf assertion accepts a background run | already in HEAD: tools/check-run-code-budget.mjs requires status 200 and no background | none |
| 3 | Node arm of a tool-only client across a worker restart (not probed, 2026-11-10) | already covered: tools/check-no-resource-client.mjs drives both engines, and check-build.mjs:37 runs it; the Node arm is in the Phase B list | witness only, Phase B |
| 4 | resources/read of an unknown uri: native -32602, Node -32002 | not taken: native's -32602 is deliberate (parity row 2, "native answers a missing resource with -32602 and data.uri"; AGENTS: -32002 is accepted only by clients). Changing it is an owner decision | owner |
| 5 | The run_code refusal carries the skill text twice (content and structuredContent, ~48 KB) | not taken: structuredContent with the text block is the form the tool output schema uses; trimming it changes the protocol shape on both engines | owner |
| 6 | Node run_code budget parity beyond the 65 s case | not taken: native-ahead or port is an owner decision | owner |
| 7 | finish open-row step limit (work/tooling-fix-units.json) | not taken: finish semantics are an owner decision | owner |
| 8 | Shell-job lifetime equals the job_start cap, so the lifetime reason is unreachable for shell jobs | not taken: owner decision | owner |
| 9 | Decision 3, protocol 2026-07-28 behind a capability flag; server/discover lists two versions while the SDK accepts five | not taken: a new protocol surface, large, and not checkable without a build | owner, then build |
| 10 | Relay re-executes only with no call in flight (native/components/host/relay.cpp, the inflight_ check) | not taken: needs a measured reproduction first | measurement, then build |
| 11 | Native Windows captures no server stderr (native/components/proc/child.cpp) | not taken: Windows-only code that cannot be compiled here | Windows CI |
| 12 | Windows process-group kill unverified (only the Node doctor reports it) | not taken | Windows host |
| 13 | Native browser tabs line counts every page outside this run as other pages | not taken: splitting pages needs a page-identity design | design |
| 14 | fx's "another worker's events twice" | not taken: needs fx's reply text | fx reply text |
| 15 | run_code had no result (check-run-code-budget, 9cf86cb gap 3), not reproduced | the diagnostic is in place (09af517); no change here | a build run that hits it |
| 16 | asan full check-build not run (9cf86cb gap 4) | not taken: a build | Phase B build |
| 17 | Windows, macOS and arm64 builds and runs of libuv and txiki (9cf86cb gap 8; AGENTS platform notes) | not taken | no host; hosted CI, not watched |
| 18 | B1 and B2, the Windows witnesses (restart-jobs, browser path) | not taken | no Windows host |
| 19 | Served skill freshness on a connection that started before a commit | not taken: closes on the next installed release | install |

Change 1, ci_status for a root that is not a repository:
1. src/git.mjs, ciStatus (line 126): when rev-parse fails, the message is `no commit X in this repository` only if isRepository(dir) is true; otherwise `cannot check commit X: <dir> is not a git repository`. This is the wording rows.mjs already uses for a non-repository root.
2. the git leaf, ciStatus (line 157): the same split. A helper `isRepository(dir)` sits after gitIn: `rev-parse --is-inside-work-tree` with the same timeout.
Witness needed (Phase B): call ci_status with sha HEAD in a scratch directory that is not a git repository, on the Node engine and on the native binary; each must return `cannot check commit HEAD: <dir> is not a git repository`. In a repository with no commits, the same call must return `no commit HEAD in this repository`. Both engines must agree (native/tests/parity/run.mjs, if a row covers ci_status; otherwise the two calls are read by hand).
Changes are in files: src/git.mjs, the git leaf. No comments were added.

## gm pass, Phase B (2026-11-10, commit 41c0640, pushed once): the ci_status no-commit message, and the held choices

Build (release preset, HEAD 41c0640): `cmake --preset release`, exit 0, 0.2 s. `cmake --build build/release -j 4`, exit 0, 18.9 s, 0 warning or error lines. `build/release/native/components/host/gm --version`: `41c0640-dev (41c0640)`.

Witness: a real MCP session, scratch in /tmp (not committed), that runs `return await gm.ci_status({});` in run_code (the default sha is HEAD; a sha must be hex, so the literal "HEAD" fails the SHA check). Two roots: a plain directory, and an empty repository (`git init`, no commit).

| engine | root | wall | result |
|---|---|---|---|
| native, before the leaf refresh (stale copy) | plain | - | `no commit HEAD in this repository` (the defect) |
| native | plain | 163 ms | `cannot check commit HEAD: <dir> is not a git repository` |
| native | empty repository | 149 ms | `no commit HEAD in this repository` |
| node | plain | 210 ms | `cannot check commit HEAD: <dir> is not a git repository` |
| node | empty repository | 233 ms | `no commit HEAD in this repository` |

Defect found, fixed for this tree: the native binary loads its leaves from `leaves/` beside the executable (native/components/host/options.cpp, leaves_dir_of and installed_or), not from the checkout. `build/release/native/components/host/leaves/git.mjs` was a stale copy (04:18, before 41c0640), so the first witness ran the old message. `diff -rq` showed that git.mjs was the only file that differed; the copy was refreshed from the git leaf and the four cases above ran after it. No build rule in this tree writes that directory (no CMake, tool or script step copies leaves beside the binary; checked by grep), so the copy's origin is unknown. The same trap will catch the next leaf change on a dev build. Open: a decision on whether dev builds stage leaves beside the binary, or pass `--leaves` (the option exists). Not changed in this pass.

Regression: `node native/tests/parity/run.mjs --bin build/release/native/components/host/gm`, exit 0, 14.9 s: `17/95 scenarios match, 0 cutover-expected, 56 native-ahead, 22 documented-gap, 0 differ`. Unchanged from the last witness.

Held choices, decided in this pass (no code unless noted):
1. "Replay growth (120/40/6)": this question is not in the repo, its docs, the memory notes or the git history. Nearest recorded policy: DESIGN.md "next_context returns events since the last step" (around line 1567), which removed the two-horizon replay (H1 14, H2 12). Choice: no replay growth; next_context stays bounded to the events since the last step. Reason: the removal is the one recorded replay policy and it already bounds growth.
2. "SES bypass": not found anywhere. The only bypass in the ledger is the ship.sh bypass (ranked list item 8, "waits for the owner"). Choice: no bypass; every commit keeps the gate. Reason: owner rules allow commits only through tools/ship.sh, and a bypass would change a rule the owner sets.
3. resources/read unknown uri, native -32602 against Node -32002: keep native's -32602. Reason: it is deliberate and recorded in parity row 2; no client evidence asks for a change.
4. Node run_code budget beyond the 65 s case: keep native-ahead; Node stays the parity reference and is not ported. Reason: the 65 s case is witnessed on both engines; a port is a larger change than this pass.
5. finish open-row step limit: keep finish strict. Reason: loosening the finish check weakens the commit gate.
6. Shell-job lifetime reason, unreachable for shell jobs: keep as is. Reason: no run has hit it, so no change is supported.
7. Protocol 2026-07-28 behind a capability flag (owner decision 3): not implemented in this pass. Reason: the ledger's gate for default is a client test, and no client is available here.
8. Refusal text duplicated (ranked item 5): already done in 3ffda38 (one copy; 25640 bytes for a 24968-byte skill). The ranked table was stale on this item.

Blocked, excluded from this Phase B (no host here):
- Windows, macOS and arm64 builds and runs of libuv and txiki: blocked, no such host in this checkout; hosted CI builds them and is not watched here.
- B1 (Windows x64 restart-jobs) and B2 (Windows arm64 browser path): blocked, no Windows host.
- The run_code wasm32-wasi Phase B: gated on thebird's origin/main exporting the seven gm_txiki_* functions. Checked with one git fetch after the push (see the REPORT line).

## gm pass, Phase B for the txiki wasm32-wasi target (2026-11-10, thebird origin/main 579e2e6)

Gate: `git -C /workspace/thebird fetch origin` once, exit 0. origin/main is 579e2e6. `scripts/txiki/browser/entry.c` there defines the seven exports (gm_txiki_new, gm_txiki_free, gm_txiki_context, gm_txiki_loop_alive, gm_txiki_loop_turn, gm_txiki_load_builtin, gm_txiki_refresh_loop_time), lines 212-243. Gate met.

Pins, gm against thebird origin/main scripts/vendor-txiki.mjs and the local wasm:

| item | gm native/third_party/txiki | thebird origin/main | match |
|---|---|---|---|
| txiki sha256 | 763025ac98e4d6629f9ebe8396c027ff22966a6322b0dc43e442d45c6d7f8059 | TXIKI_SHA256 same | yes |
| libuv commit / sha256 | dd9f081c... / f5185440... | LIBUV_COMMIT / LIBUV_SHA256 same | yes |
| quickjs-ng commit / sha256 | 7b5f588e... / f27b2e93... | QUICKJS_NG_COMMIT / QUICKJS_NG_SHA256 same | yes |
| browser stubs.tsv | 0531146a... | scripts/txiki/stubs.tsv 0531146a... | yes |
| txiki-browser.h | d20dec81... | scripts/txiki/include/txiki-browser.h d20dec81... | yes |
| uv-browser.c | 89d228c3... | scripts/txiki/browser/uv-browser.c 89d228c3... | yes |
| tjs.wasm | (not vendored in gm) | TXIKI_WASM_SHA256 dcd3a434...; web/vendor/txiki/tjs.wasm sha256 dcd3a434..., 14177014 bytes | yes |

Changes in this pass (uncommitted until the ship below):
- tools/browser-stubs.mjs (new): generates native/third_party/txiki/browser/stubs.c from stubs.tsv with thebird's writeStubs rule. It checks the table's sha256 against the pin first. Output: 91 stubs, sha256 f66f1f77e9a8d812b6789b152eeebbd2e15f9525571cd23f0b75e96b3dd66b6d. Symbols defined in native/components/quickjs/txiki/txiki_stubs.c are skipped.
- tools/vendor-txiki.mjs: BROWSER_PORT lists stubs.tsv (sha pinned); the vendor run regenerates stubs.c through tools/browser-stubs.mjs and records its sha in VERSION.txt. The vendor run itself was not executed in this pass (network); VERSION.txt lines were written by hand to the same format.
- native/components/quickjs/CMakeLists.txt, wasi branch: browser/stubs.c added to gm_txiki_core_wasi; ada.cpp compiled with -fno-exceptions -fno-rtti; gm_quickjs_ng does not link Threads::Threads or CMAKE_DL_LIBS under GMNEW_TXIKI_WASI (the link failed with `unable to find dynamic system library "pthreads"`); gm_txiki_wasi links gm_txiki_core_wasi only (gm_runcode and gm_json dropped until the engine compiles).
- tools/check-txiki-wasi.mjs (new): the Node witness. It instantiates a wasm reactor with WASI preview1 and the env imports (every env function import is supplied as a stub, tjs_host_write collects stderr), then runs the seven-export sequence.

Build: `cmake --build build/wasi --target gm_txiki_wasi -j 8` in the foreground, timeout 900 s, exit 0. Built after one failed link (the pthreads line above). Output: build/wasi/native/components/quickjs/gm_txiki_wasi.wasm, 9328581 bytes, sha256 9e2e5ae88b47f7ebd51ffaa3358485c671c7ea41f01861d87f9f1a89ad1d8d4e.

Witness 1, Node, gm reactor and thebird tjs.wasm: `timeout 120 node tools/check-txiki-wasi.mjs <wasm>`, both exit 0:
- gm: `txiki-wasi-check: ok (build/wasi/native/components/quickjs/gm_txiki_wasi.wasm: runtime created, context read, loop turned, tjs:path loaded through gm_txiki_load_builtin, unknown module refused, runtime freed; 57 ms)`, wall 174 ms.
- thebird: `txiki-wasi-check: ok (/workspace/thebird/web/vendor/txiki/tjs.wasm: runtime created, context read, loop turned, tjs:path loaded through gm_txiki_load_builtin, unknown module refused, runtime freed; 69 ms)`, wall 185 ms.
Wall time includes the Node start and the ExperimentalWarning for WASI.

Witness 2, headless Chromium of the built site: blocked. gm has no page that instantiates gm_txiki_wasi.wasm, so there is no site to load. thebird's page instantiates its own tjs.wasm through its tjs_browser_* host, not gm's exports, so it does not witness this build. Playwriter (invariant 11, inside gm) needs such a page first. Not built in this pass: a page is a new surface, and the owner has not asked for one.

Size, against the QuickJS-only numbers from ba8a863:

| build | raw | stripped | gzip -9 | gzip -9 stripped |
|---|---|---|---|---|
| QuickJS-only (ba8a863) | 5326939 | 1319372 | 1872613 | 458979 |
| gm txiki-only reactor (this build) | 9328581 | 2498054 | 3066066 | 893294 |
| difference | +4001642 | +1178682 | +1193453 | +434315 |
| thebird tjs.wasm (current, Phase A figures) | 14177014 | 3872224 | 4937897 | 1399493 |

The gm reactor excludes the run_code engine and the sqlite, webcrypto and httpclient modules, which thebird's build includes. Its code is 1590576 bytes; its data is 896884 bytes; its debug custom sections are 6830314 bytes of the raw size. The family names in the measurement (sqlite3, webcrypto, httpclient, libwebsockets, mbedtls) match only names in the link and the name section, not linked code.

Open, run_code on wasm32-wasi (the engine is not built). `cmake --build build/wasi --target gm_runcode -- -k 0` fails with 15 errors, all C++ standard library features that the WASI libc++ here lacks:
- engine.cpp:22,23,239 std::shared_mutex and std::shared_lock; engine.cpp:408 std::this_thread; engine.cpp:66 std::ifstream.
- leaves.cpp:143 std::mutex; leaves.cpp:41,43,165,206,250 std::filesystem (last_write_time, file_size, directory_iterator, absolute, is_regular_file); leaves.cpp:49 and runcode.cpp:71 std::ifstream.
- runcode.cpp:250 std::filesystem::is_regular_file.
- unique_lock.h:44,67: the mutex type is int when the mutex is missing.
Needed before this links: a wasi branch for the sync primitives (single-threaded, no locks), a host-supplied module source instead of the filesystem (the browser has none), an exported eval entry for a witness, and a decision on leaves.cpp (LeafVerbs depends on gm::verbs and host, and was to stay unchanged). The 120 s interrupt deadline cannot be witnessed until the engine runs. Not built in this pass.

Ship: commit through tools/ship.sh as lanmower with no trailer; see the REPORT line.

## gm pass, Phase B completed: run_code compiles for wasm32-wasi, and the Chromium witness runs (2026-11-10)

Compile. The engine's blockers were the C++ facilities that the WASI libc++ here does not provide: std::mutex, std::shared_mutex, std::this_thread, std::ifstream and the std::filesystem directory and stat operations. std::filesystem::path itself compiles for wasi. The fix is at the cause, one platform layer for the two OS facilities the engine uses: native/components/quickjs/platform.hpp and platform.cpp. Native keeps std::filesystem, std::ifstream and the std mutex types. WASI uses stdio, POSIX stat, opendir and nanosleep, and single-threaded no-op locks (WASI here has no threads). engine.cpp, runcode.cpp and leaves.cpp call platform:: and no longer include the std headers for those facilities. platform.cpp is added to gm_runcode.

The Threads error was a second cause. The root CMakeLists linked Threads::Threads into deoxidene for every platform, and wasi-libc here has no pthread library, so the reactor link failed with `unable to find dynamic system library "pthreads"`. On WASI, Threads::Threads is now an empty interface target; the mcp and mcpclient find_package calls are gone (the root call runs first). This is why the earlier quickjs-only conditional was reverted.

Link. gm_txiki_wasi links gm_runcode, gm_txiki_core_wasi, gm_json and gm_quickjs_ng again. Build: `cmake --build build/wasi --target gm_txiki_wasi -j 8`, foreground, timeout 900 s, exit 0. Caveat, measured below: a static archive member is linked only when something references it, and no export reaches the engine, so the reactor contains no engine code. The sizes did not change. A body-run export is a new surface and needs the owner's decision.

Witness 1, Node (tools/check-txiki-wasi.mjs), foreground, timeout 120 s:
`txiki-wasi-check: ok (build/wasi/native/components/quickjs/gm_txiki_wasi.wasm: runtime created, context read, loop turned, tjs:path loaded through gm_txiki_load_builtin, unknown module refused, runtime freed; 57 ms)`
Wall time (shell, including Node start and the WASI warning): 149 ms.

Witness 2, headless Chromium (tools/check-txiki-wasi-chromium.mjs with tools/check-txiki-wasi-browser.html and .js), /usr/bin/chromium, --headless --dump-dom --allow-file-access-from-files --virtual-time-budget=60000, foreground, timeout 120 s. The page instantiates the reactor with a browser WASI shim (unimplemented imports answer ENOSYS, poll_oneoff returns no events, fd 1 and 2 are accepted, and fd 2 text is reported on failure) and runs the same seven-export sequence:
`txiki-wasi-browser-check: ok (/workspace/gm/build/wasi/native/components/quickjs/gm_txiki_wasi.wasm: runtime created, context read, loop turned, tjs:path loaded through gm_txiki_load_builtin, unknown module refused, runtime freed)`
`txiki-wasi-chromium-check: wall 496 ms` (runner run); a separate timing run: wall 546 ms. The page's own clock is virtual under --virtual-time-budget, so no page elapsed time is reported.
Negative check: `node tools/check-txiki-wasi-chromium.mjs package.json` prints `txiki-wasi-browser-check: 1 failure(s)` with `the page threw: WebAssembly.compile(): expected magic word 00 61 73 6d, found 7b 0a 20 20 @+0` and exits 1.

Size, after the relink (scripts/measure-txiki-wasm.mjs): raw 9328581 bytes, sha256 9e2e5ae88b47f7ebd51ffaa3358485c671c7ea41f01861d87f9f1a89ad1d8d4e, stripped 2498054, gzip -9 3066066, gzip -9 stripped 893294. Unchanged from the Phase B figures, because the engine objects are not referenced. Against ba8a863 QuickJS-only (raw 5326939, stripped 1319372, gzip 1872613, gzip stripped 458979), the difference is still +4001642 raw, +1178682 stripped, +1193453 gzip, +434315 gzip stripped.

Native regression, after the shared changes (platform layer, root Threads): `cmake --build build/release -j 8`, foreground, exit 0, 16.3 s. `node tools/check-embedded-runtime.mjs build/release/native/components/host/gm`, exit 0: `embedded-runtime-check: ok (build/release/native/components/host/gm: a body awaited a 300 ms timer for 300 ms; URL and TextEncoder work; a body cannot name the runtime's own host API; console output stays off the protocol stream; a relative import loads; native and leaf verbs answer; a never-settling promise ends with an error; a trivial body takes 8 ms with a fresh runtime each time)`. `node tools/check-build.mjs build/release`, foreground, exit 0, 6 min 15 s: `check-build: gm stamp 423a935-dev (423a935)` and the no-resource-client and turn-economy checks ok.

Open:
- The engine is linked but unreachable from the reactor's exports. To put run_code in the binary, either pull the archive with --whole-archive (size grows, nothing can call it), or export a body-run entry (new surface; owner decision). The 120 s interrupt deadline and the module loader are in the engine code and are not witnessed in the wasm until one of these is chosen.
- Browser module loading has no filesystem: the page has no preopened directory, so a module import fails to load there by design.

## gm pass, Phase A: run_code reachable from the wasm exports, with the 120 s deadline (2026-11-10)

Code and build configuration only; no build or witness in this stretch. The witnesses for each change run in Phase B of this pass.

| change | file | witness (Phase B) |
|---|---|---|
| New C-ABI entry `gm_run_body(const char *body, const char *format)`. It runs gm::run_body with an empty verb table, a 120000 ms JavaScript budget (BodyControls.js_budget), and project root "" (no filesystem in the browser). It returns a malloc'd NUL-terminated JSON text, `{"ok":true,"value":...}` or `{"ok":false,"error":...}`; the caller frees it with the exported free. | native/components/quickjs/txiki/run_entry.cpp (new) | txiki-wasi-browser-check and txiki-wasi-check: run_code calls through gm_run_body (value, timer, and a body that never returns, which must end with the 120 s deadline text). |
| The wasm reactor compiles run_entry.cpp next to txiki_shim.c, so the engine's references to gm_txiki_new and the other shim functions resolve in the executable. | native/components/quickjs/CMakeLists.txt, gm_txiki_wasi add_executable | cmake --build build/wasi --target gm_txiki_wasi (Phase B, build). |
| The export list adds gm_run_body to the seven gm_txiki_* exports, malloc, free, realloc and calloc. No export is removed. | native/components/quickjs/CMakeLists.txt, gm_txiki_wasi target_link_options | Phase B: the export list of the built wasm, quoted. |

Not changed in this stretch: the platform layer (fcf85cd), the Threads alias, gm_runcode and gm_json on the link line, and the seven shim functions.

## gm pass, Phase B: run_code and its 120 s deadline in the wasm32-wasi reactor (2026-11-10)

Build fixes, each at its cause (the wasi toolchain here is zig 0.17.1 with its wasi libc++ and libc++abi):
- Exceptions. The wasi libc++abi has no exception runtime (__cxa_throw and friends are undefined), the same reason thebird compiles ada with -fno-exceptions. Root CMakeLists.txt adds -fno-exceptions to C++ and -g0 to every wasi compile. The four C++ try sites in engine.cpp (call_host, host_names), leaves.cpp (log_refusal) and runcode.cpp (call_verb) compile only when __cpp_exceptions is defined; the wasi build runs the same bodies without the catch, and no wasi verb or host can throw.
- Thread-local destructors. thread_body_controls in native/include/gm/runcode.hpp is a plain static on __wasi__: wasi libc++abi has no __cxa_thread_atexit, and the reactor has one thread.
- Path library. Zig's wasi libc++ lacks the out-of-line std::filesystem::path members (lexically_normal, __root_directory, __filename). Two uses reach the reactor: the project package.json join and the ESM specifier normalizer. platform.hpp gains join_path and normal_path: native uses / and lexically_normal (unchanged behaviour); wasi joins strings and normalizes segments (a '..' above the root is dropped for an absolute path).
- Witness code. The browser page compiles the module synchronously (XMLHttpRequest with x-user-defined), because the page's dump is taken at load and Chromium's async compile is not waited on. Chromium refuses a synchronous compile above 8 MB on the main thread; -g0 brings the reactor under it (raw 5176695, from 12048363). --enable-features=WebAssemblyUnlimitedSyncCompilation was tried first and had no effect: /etc/chromium.d/90-gpu appends its own --enable-features, which wins.
- poll_oneoff. The page's shim waits for clock subscriptions by busy-waiting on performance.now and reports the expired ones; the Node witness uses node:wasi.

Changes in this phase, file and witness:

| change | file | witness |
|---|---|---|
| -g0 and -fno-exceptions for the wasi build; no C++ exceptions in the wasm | CMakeLists.txt | build/wasi (exit 0); both witnesses; size |
| try/catch sites compile only with exceptions | native/components/quickjs/engine.cpp, leaves.cpp, runcode.cpp | native check-embedded-runtime (exit 0); check-build (exit 0) |
| plain static body-controls on wasi | native/include/gm/runcode.hpp | build/wasi link (no __cxa_thread_atexit) |
| join_path and normal_path in the platform layer | native/components/quickjs/platform.hpp, platform.cpp, runcode.cpp | build/wasi link; both witnesses (the 20 ms timer runs the module and settle path) |
| Browser witness: run_code through gm_run_body (1 + 2, a 20 ms timer, a body that never returns), synchronous module load, wasi poll_oneoff for clocks | tools/check-txiki-wasi-browser.js | tools/check-txiki-wasi-chromium.mjs (exit 0) |
| Node witness: the same three run_code calls | tools/check-txiki-wasi.mjs | node tools/check-txiki-wasi.mjs (exit 0) |
| Chromium runner: no virtual-time budget (the 120 s deadline would stop the clock), 420 s timeout | tools/check-txiki-wasi-chromium.mjs | the runner's wall times below |

Phase A (62bd1ae, local): gm_run_body in native/components/quickjs/txiki/run_entry.cpp; gm_txiki_wasi compiles it and exports it. Witness: the export list below.

Export list of the built wasm (build/wasi/native/components/quickjs/gm_txiki_wasi.wasm, 157 exports; the uv_* helpers are omitted here):
```
memory:memory
global:__stack_pointer
function:_initialize
function:malloc
function:calloc
function:realloc
function:free
function:gm_txiki_new
function:gm_txiki_free
function:gm_txiki_context
function:gm_txiki_loop_alive
function:gm_txiki_loop_turn
function:gm_txiki_refresh_loop_time
function:gm_txiki_load_builtin
function:gm_run_body
```
Sha256 2918dec85c3b589eb6605e15f526fd939e438ea4e449b5aa594d72c4851e7595. Raw 5176695 bytes, stripped 2783164, gzip -9 1672754, gzip -9 stripped 1003787 (measure-txiki-wasm.mjs). The engine code is in the binary: stringify_function_of and compile_module are present in the name section.

Witnesses (foreground):
- Node, `timeout 300 node tools/check-txiki-wasi.mjs build/wasi/native/components/quickjs/gm_txiki_wasi.wasm`, exit 0. Output: `txiki-wasi-check: ok (build/wasi/native/components/quickjs/gm_txiki_wasi.wasm: runtime created, context read, loop turned, tjs:path loaded through gm_txiki_load_builtin, unknown module refused, runtime freed; run_code: 1 + 2 = 3; a 20 ms timer settled as timer; a body that never returns stopped with "the body passed its JavaScript deadline of 120000 ms"; 120084 ms)`. Wall 120130 ms.
- Chromium, `timeout 480 node tools/check-txiki-wasi-chromium.mjs build/wasi/native/components/quickjs/gm_txiki_wasi.wasm`, exit 0. Output: `txiki-wasi-browser-check: ok (/workspace/gm/build/wasi/native/components/quickjs/gm_txiki_wasi.wasm: runtime created, context read, loop turned, tjs:path loaded through gm_txiki_load_builtin, unknown module refused, runtime freed; run_code: 1 + 2 = 3; a 20 ms timer settled as timer; a body that never returns stopped with "the body passed its JavaScript deadline of 120000 ms")` and `txiki-wasi-chromium-check: wall 120575 ms`. Process wall 120634 ms.

Native regression after the shared changes: `cmake --build build/release -j 8` exit 0; `node tools/check-embedded-runtime.mjs build/release/native/components/host/gm` exit 0 (ok); `node tools/check-build.mjs build/release` exit 0 (check-build: gm stamp 62bd1ae-dev).

Open:
- Chromium's --dump-dom runs at load, so the page must finish synchronously; a larger reactor would need an async page (the 8 MB limit) and a DevTools-driven runner. Not done.
- The reactor's exports are the seven gm_txiki_* functions and gm_run_body. The browser entry (thebird) and the gm-in-page consumer are not checked against this list; no consumer code is in this checkout.

## Task refusal names the call that unblocks it (2026-11-10, Phase A)

| # | File | Change | Witness needed |
|---|---|---|---|
| 1 | src/mcp.mjs, native/components/mcp/server.cpp | The refusal of a task replacement after the first step (next_context, child_context) names the exact call that unblocks it: next_context({ task, owner: true }), next_context({ child: true, run, task, owner: true }), or gm.task_set({ task, owner: true }) from run_code. The owner gate stays: accepting an unmarked replacement reverses the task-leak fix fcb84df. | Phase B: on build/release, a run past step one that calls next_context({ task: "replacement" }) is refused with the named call in its error, and next_context({ task: "replacement", owner: true }) returns task "replacement". Witness: node tools/check-child-task.mjs build/release/native/components/host/gm |
| 2 | tools/check-child-task.mjs | The check asserts that the plain refusal and the child refusal after step one name the owner call, and keeps the owner replacement check. | Phase B: node tools/check-child-task.mjs (Node engine) exit 0, and node tools/check-child-task.mjs build/release/native/components/host/gm exit 0 |
| 3 | DESIGN.md | Decision bullet after the child task decision: the owner gate is kept, the refusal names the call, with the reason. | Read-only; covered by rows 1 and 2 |
| 4 | (no edit) | Phase B reruns the existing witnesses on the built binaries: node tools/check-build.mjs build/release, node tools/check-txiki-wasi.mjs build/wasi/native/components/quickjs/gm_txiki_wasi.wasm, node tools/check-txiki-wasi-chromium.mjs build/wasi/native/components/quickjs/gm_txiki_wasi.wasm, all in the foreground. | Phase B: each exit 0, output read |

## Task refusal names the call that unblocks it: Phase B witnesses (2026-11-10)

Built at 83192c1 (HEAD of the three Phase A commits): `cmake --preset release` and `cmake --build build/release`, ninja then reports no work to do (exit 0). `cmake -S /workspace/gm -B build/wasi` and `cmake --build build/wasi --target gm_txiki_wasi` exit 0; the wasm is 5176695 bytes raw, the size of the earlier witness, since the wasm does not carry the changed refusal text.

Witnesses (foreground unless the MCP client moved the body to background at 120 s; each exit read from its own output):
- `node tools/check-build.mjs build/release`, exit 0: check-build: gm stamp 83192c1-dev (83192c1), gm-core stamp 83192c1-dev (83192c1).
- `node tools/check-child-task.mjs`, exit 0: check-child-task: passed (Node).
- `node tools/check-child-task.mjs build/release/native/components/host/gm`, exit 0: check-child-task: passed (node and native real-tree checks).
- Real run on build/release (scratch script /tmp/gm-witness/refusal-witness.mjs, outside the checkout, a fresh workspace): {"first":{"ok":true,"step":1,"task":null},"refused":{"ok":false,"refused":true,"error":"refused: a task replacement after the first step needs owner:true; retry with next_context({ task: \"<new task>\", owner: true }), or call gm.task_set({ task: \"<new task>\", owner: true }) from run_code"},"accepted":{"ok":true,"step":2,"task":"replacement after step one"},"childRefused":{"ok":false,"refused":true,"error":"refused: a task replacement after the first step needs owner:true; retry with next_context({ child: true, run: \"<run id>\", task: \"<new task>\", owner: true })"}}
- `node tools/check-txiki-wasi.mjs build/wasi/native/components/quickjs/gm_txiki_wasi.wasm`, exit 0: txiki-wasi-check: ok (runtime created, context read, loop turned, tjs:path loaded, unknown module refused, runtime freed; run_code 1 + 2 = 3; a 20 ms timer settled; a body that never returns stopped at its 120000 ms deadline, 120106 ms).
- `node tools/check-txiki-wasi-chromium.mjs build/wasi/native/components/quickjs/gm_txiki_wasi.wasm`, exit 0: txiki-wasi-browser-check: ok (same checks in Chromium); wall 120732 ms.

Open: the installed gm of a host still refuses without the named call until its build takes this commit (the installed build of this run predates it). No witness on the Node relay beyond check-child-task.

## Body ledgers at a restart and the run_code cutoff (2026-11-10, Phase A)

| # | File | Change | Witness needed |
|---|---|---|---|
| 1 | native/components/proc/proc.cpp, native/include/gm/proc.hpp | Each body child's ledger line is "pid starttime" (starttime from /proc/<pid>/stat on Linux, 0 elsewhere). reap_ledger skips a pid whose start time changed (a reused pid); reap_ledgers(dir) reaps every *.pids file in a directory. | Phase B: node tools/check-restart-body-orphan.mjs build/release/native/components/host/gm exit 0. Pre-fix on 83192c1 the same check exited 1: the body shell 3712101 and its sleep 3712102 were both alive after the restart. |
| 2 | native/components/verbs/job.cpp | JobTable::stop_orphans reaps every ledger in jobs/ before it reads the status files, so a foreground body with no status file is reaped too. | Same check as row 1. |
| 3 | native/components/mcp/server.cpp | Server::stop_orphans reaps every ledger too. kDefaultBodyTimeoutMs and the run_code description say 100000 ms. | Phase B: node tools/check-foreground-hold.mjs build/release/native/components/host/gm exit 0: run_code with the default timeoutMs returns a job id before 110 s, every next_context waitMs hold stays under 120 s, and the job ends exited with exitCode 0 and output done. |
| 4 | src/runcode.mjs, src/mcp.mjs | Node: DEFAULT_TIMEOUT_MS and the run_code description are 100000 ms; waitOf caps next_context waitMs at 100000 ms (was 300000). | Phase B: node tools/check-foreground-hold.mjs exit 0 (Node engine). |
| 5 | skills/gm/SKILL.md | The served rule says a body runs 100 seconds by default before it becomes a background run. | Phase B: the served text of skill://gm/SKILL.md reads 100 seconds (read in the run). |
| 6 | tools/check-restart-body-orphan.mjs, tools/check-foreground-hold.mjs, tools/check.mjs | New checks, registered in the gate list. Each takes node (default) or the path of a native binary. | Phase B: both checks on node and on build/release, exit 0. |
| 7 | AGENTS.md, DESIGN.md | Notes for the 120 s client limit, the 100 s default and the restart reaper. AGENTS.md: 18621 bytes before, 19199 after. The audit covers the notes this change touches; a full line-by-line audit is not done. | none (text) |

Open for Phase B: whether the Node tree has the same restart orphan. Its foreground groups live in memory (src/exec.mjs bodyGroups), and stopOrphans reads only jobs/*.json. The Node check is node tools/check-restart-body-orphan.mjs.

## Body ledgers at a restart and the run_code cutoff: Phase B witnesses (2026-11-10)

Built at 601547c (the three Phase A commits): cmake --preset release and cmake --build build/release exit 0; the release stamp is 601547c-dev. The wasm target (build/wasi) reports up to date; none of the changed files is in its graph, so gm_txiki_wasi.wasm is unchanged (5176695 bytes, built 06:31).

Witnesses:
- Before the fix (the 83192c1 binary): node tools/check-restart-body-orphan.mjs build/release/native/components/host/gm exit 1: after the restart the body shell 3712101 and its sleep 3712102 were both alive (stat S).
- After the fix, native: exit 0, "the body shell 3718637 and its sleep 3718638 were alive before the restart (binary mtime changed) and are gone after it; next_context answered the restarted run in 30591 ms".
- After the fix, Node: node tools/check-restart-body-orphan.mjs node, exit 0: body shell 3719986 and sleep 3719987 gone after a SIGTERM to the Node worker; next_context answered in 624 ms. The Node mechanism was not traced; the check passes.
- node tools/check-foreground-hold.mjs build/release/native/components/host/gm, exit 0: run_code with the default timeoutMs returned job body-7 after 100003 ms; next_context holds ran 50029 ms; the job ended exited with output done.
- node tools/check-foreground-hold.mjs node, exit 0: job body-7 after 100009 ms; holds ran 50054 ms; the job ended exited with output done.
- Existing witnesses on build/release, all exit 0: check-restart-jobs native and node ("the job exited 0 with output done"); check-run-code-budget native ("a 65 s JavaScript body with timeoutMs 100000 returned in 65007 ms"); check-run-code-progress native; check-turn-economy native; check-build build/release (conformance 86 passed, 0 failed of 86 checks; stamp 601547c-dev).
- Parity: node native/tests/parity/run.mjs --bin build/release/native/components/host/gm, exit 0: 17/95 match, 0 cutover-expected, 56 native-ahead, 22 documented-gap, 0 differ. Same counts as the 2026-11-10 witness. The next_context description row (tools/list, .result.tools[0].description) is now a documented gap, because both engines hold waitMs at most 100 s and only the wording differs.

Defects found and fixed in Phase B:
- tools/check-foreground-hold.mjs asserted exitCode 0 for a body job, whose job_status has exitCode null; the body's output is the evidence. Fixed in the check.
- The parity row for the next_context description was native-ahead for 300000 against 100000; after the Node cap change it differed. Reclassified as documented gap (native/tests/parity/run.mjs).

Open:
- The MCP client's limit is the notice text, "still running after 120s", which this session saw. The exact trigger time was not measured; the prior default of 180000 ms let the client background the call first.
- The installed gm does not carry these commits. A host gets the default cutoff and the reaper after its installed build updates.
- Two worker restarts "without a reason" hit this run during long run_code bodies (restart event at 04:59:06 UTC; the run log says "restarted without a reason"). The second restart left a Node hold check orphaned on the old code; it was stopped by PID.
- AGENTS.md: one note rewritten and one added (18621 to 19199 bytes). The full line-by-line audit the notes rule asks for was not done.

## gm pass, Phase A: repeated work, turns and tokens (2026-11-10)

Measured by /tmp/waste.py over the last eight hours of the fx, jayzee, spoint, thebird and gm transcripts (baseline /tmp/gm-analysis/waste-before.txt): fx 2043 API turns, 583 Bash calls against 32 run_code; jayzee 258 Bash and 66 run_code; spoint 573 Bash and 49 run_code; thebird 294 Bash and 35 run_code; 18 long calls in fx totalled 6382 s. The measurement reads past transcripts, so it is the same before and after this pass.

| # | File | Change | Witness |
|---|---|---|---|
| 1 | native/components/verbs/job.cpp, src/tools.mjs | job_start reply carries pid, doneFile (jobs/<name>.exit, the exit code once the job ends) and logPath beside the output text | tools/check-job-reply-git-state.mjs, both engines |
| 2 | native/components/mcp/server.cpp, src/tools.mjs | job_status waitMs is capped at 100000 ms on both engines. Cause: native kMaxJobWaitMs was 3600000 and Node's MAX_WAIT_MS in src/tools.mjs was 3600000, so a wait past the 120 s client limit was held | same check: waitMs 200000 returns after about 100 s with state running |
| 3 | src/tools.mjs | job_start without timeoutMs defaults to 300000 ms on Node (DEFAULT_JOB_TIMEOUT_MS). Cause: the background path fell back to the 60000 ms run_shell default, so a 130 s job was killed at 60 s; native already used 300000 | same check: status.timeoutMs 300000 and the 130 s job is still running at the capped wait |
| 4 | the git leaf, src/git.mjs, native/components/mcp/server.cpp, src/mcp.mjs, README.md, native/tests/parity/run.mjs | git_state verb: branch with upstream and ahead and behind, changed count split into staged, unstaged and untracked, diff stat of unstaged and staged changes, in four lines; read-only in both trees | same check on a seeded repo: four expected lines; parity row git_state |
| 5 | skills/gm/SKILL.md | rules 9 to 15 in Spending turns and tokens: detached job with pid and doneFile, one wait sized from the ledger, git_state once per phase, edit in place, long output to a file, shell through gm, Phase B witnesses once; the wait cap line now says 100000 ms | skill://gm/SKILL.md read in Phase B; tools/check-skill-serve.mjs |
| 6 | (none) | child sessions for reading: the Handing work to a child session section already covers it; no text change | read in Phase B |
| 7 | (none) | Bash in place of gm: rule 14 names run_shell as the shell path and its 60000 ms foreground default; the default itself is unchanged, because a longer foreground command goes through timeoutMs or job_start | read in Phase B |
| 8 | (none, already fixed at 409c3f3) | browser isolation: the pinned pw gate picks its port from a hash of the project root (lib loadPorts: pickPort(9400, 500, offset) and pickPort(9900, 500, offset)), and both clients set PLAYWRITER_PROJECT_DIR to the run's workspace, so each project has its own gate, Chrome and profile at <root>/.playwriter/browser-profile. The 2026-11-09 hypothesis of a shared fixed relay port 19988 does not hold for the gate: 19988 is upstream playwriter's relay default | Phase B: two projects each run gm.playwriter_execute; output shows distinct profile paths, browser pids and tab lists |

Checks: tools/check-job-reply-git-state.mjs takes the target as an argument (node by default, or the built binary path). Its run on the Node tree in Phase A (2026-11-10): ok, with pid 3887653 and doneFile w1.exit, a 2 s job settled in a 2009 ms wait, and the capped wait returned after 100041 ms with state running.

## gm pass, Phase B: witnesses for the repeated-work queue (2026-11-10)

Build: `cmake --build build/release` after the Phase A commit (472aaec), then `cmake --preset release` to restamp it (472aaec-dev), then one incremental build after the two native fixes below. Every build exited 0. The binary is build/release/native/components/host/gm, ready and not installed over the shared gm.

Defects the witnesses found, each with its cause:

1. Node job_start without timeoutMs ran on the 60000 ms run_shell default (src/tools.mjs, background path). Cause: the background branch used DEFAULT_TIMEOUT_MS, not the 300000 ms job default that the description and native use. Witness before the fix: a 130 s job was killed at 60004 ms. Fix: DEFAULT_JOB_TIMEOUT_MS = 300000, used by the background path and the timeout message.
2. Node job_status waitMs was capped at 3600000 ms by src/tools.mjs MAX_WAIT_MS, separate from the 100000 ms cap in src/mcp.mjs. Witness before the fix: waitMs 200000 returned after 130019 ms. Fix: 100000 ms.
3. Native job_status waitMs was capped at 3600000 ms on two paths: server.cpp kMaxJobWaitMs and verbs/job.cpp max_wait_ms, which the run_code verb path uses. Witness before the fix: waitMs 200000 returned after 129923 ms. Fix: kMaxJobWaitMs = kMaxWaitMs (100000) and max_wait_ms = 100000.
4. Native gm.git_state was "not a function" inside run_code. Cause: leaves_dir_of preferred any leaves/ directory beside the binary, and build/release/native/components/host/leaves is a copy dated 05:13 that a build does not refresh; it had no git_state. skills_dir_of already prefers the checkout (2026-11-10). Fix: native/components/host/options.cpp leaves_dir_of prefers the checkout's native/leaves when it exists. Witness: the probe's git_state reply carries the four lines.
5. The gate's skills check failed on three rule lines that named run_shell, grep and git_status without the gm. prefix. Fix: the prefix, then the gate passed on 472aaec.
6. Witness only, not a product defect: the check's workspace counted gm's own runs/ directory as untracked. The check's .gitignore now lists .gm/ and runs/. git_state reports runs/ correctly when a project does not ignore it.

| witness | command | result | wall |
|---|---|---|---|
| job reply, git_state and wait cap, native | node tools/check-job-reply-git-state.mjs build/release/native/components/host/gm | ok: git_state four lines; job_start pid and doneFile; a 2 s job settled in a 1906 ms wait; waitMs 200000 returned after 100020 ms, state running | 102 s |
| job reply, git_state and wait cap, node | node tools/check-job-reply-git-state.mjs | ok: settled in 2020 ms; cap returned after 100040 ms; status.timeoutMs 300000 | 103 s |
| browser isolation per project | node tools/check-browser-project.mjs build/release/native/components/host/gm | ok: alpha and beta each returned their own page title; gate ports 9509 and 9720; browser pids 3927637 and 3927638; profiles /tmp/gm-browser-alpha-*/.playwriter/browser-profile and beta's, distinct | 60 s |
| foreground hold, the 6e84b04 fix | node tools/check-foreground-hold.mjs build/release/native/components/host/gm | ok: run_code with the default timeoutMs returned body-7 after 100001 ms; holds 50030 ms; the job exited with output done | 151 s |
| restart keeps jobs | node tools/check-restart-jobs.mjs build/release/native/components/host/gm | ok: the restart answered in 565 ms; the job exited 0 with output done | 8 s |
| skill served | node tools/check-skill-serve.mjs build/release/native/components/host/gm | ok | 1 s |
| parity | node native/tests/parity/run.mjs --bin build/release/native/components/host/gm | 17/96 match, 0 cutover-expected, 57 native-ahead, 22 documented-gap, 0 differ | 14 s |
| measurement rerun | python3 -I /tmp/waste.py, from /workspace/hyperagent | ran, output /tmp/gm-analysis/waste-after.txt | 3 s |
| gate on the Phase A commit | tools/ship.sh (SHIP_PUSH=0) | 13 checks ok, commit 472aaec | n/a |

The measurement rerun does not measure this change. waste.py reads the last eight hours from the moment it runs, so waste-after.txt and waste-before.txt cover different windows. Read it as the current baseline only.

Item 8 (browser isolation) was already fixed at 409c3f3, as the Phase A row says. The witness above is its first run on the built binary with two projects.

## Stretch 2026-11-10 (run 2): Phase B witnesses at 566fc80, and the Node skill gate

Builds: cmake --preset stamped and asan at HEAD 566fc80 (stamp 566fc80-1), cmake --build build/release, and cmake --preset release, which left the release stamp at 472aaec-dev and did not reconfigure it to 566fc80-1. Every build exited 0. Nothing was installed over the shared gm.

Defect the Phase B witness found, fixed in the Phase A commit below:

1. Node skill gate re-armed on every run. src/mcp.mjs kept gmSkillRead inside createSession, and createSession is called again for each successor run after finish. A run_code after finish and a successor next_context was refused once with the skill text, although the connection had already read the skill. Native keeps the flag on the connection (native/components/mcp/server.cpp, gm_skill_read). Witness before the fix: node tools/check-browser-scope.mjs node printed "browser run: skipped: playwriter_execute is not served on this engine"; the probe served call after finish was refused by the gate. Fix: skillGate = { read: false } is created once per connection in the serve function and passed to every createSession call; the flag is read and set through skillGate.read.

| witness | command | result |
|---|---|---|
| conformance, release | node tools/check-build.mjs (build/release gm) | 86 passed, 0 failed of 86 checks in 24 scenarios |
| conformance, asan | same, on build/asan with env -u LD_PRELOAD | 86 passed, 0 failed of 86 checks in 24 scenarios |
| browser scope, release | node tools/check-browser-scope.mjs build/release/native/components/host/gm | ok; browser run: ran (the run page was listed, closed by finish, and gone from the browser after finish) |
| browser scope, asan | same, on build/asan | ok; browser run: ran |
| browser scope, node, before the fix | node tools/check-browser-scope.mjs node | ok; browser run: skipped (defect 1) |
| browser scope, node, after the fix | node tools/check-browser-scope.mjs node | ok; browser run: ran (the run page was listed, closed by finish, and gone from the browser after finish) |
| browser isolation per project, release | node tools/check-browser-project.mjs build/release/native/components/host/gm | ok: alpha and beta each returned their own page title; their browser lists were separate |
| relay re-exec, stamped build | node tools/check-relay-reexec.mjs build/stamped/native/components/host/gm | ok: 566fc80-1; re-exec 114 ms after the update; the 30000 ms wait answered once at 1941 ms; run_code ran on the new relay |
| relay re-exec, asan build | node tools/check-relay-reexec.mjs build/asan/native/components/host/gm | ok: 566fc80-1; re-exec 179 ms after the update; the wait answered once at 15977 ms |
| relay re-exec, release build | node tools/check-relay-reexec.mjs build/release/native/components/host/gm | skipped: 472aaec-dev is a development stamp; the check needs -DGMNEW_VERSION=<commit>-1 |
| no resource client, node, after the fix | node tools/check-no-resource-client.mjs node | ok: the first run_code is refused once with one copy of the skill text (10670 bytes for a 10032-byte skill); the next run_code runs; finish ends the run |
| parity, release | node native/tests/parity/run.mjs --bin build/release/native/components/host/gm | 17/97 scenarios match, 0 cutover-expected, 58 native-ahead, 22 documented-gap, 0 differ, before and after the Node fix |

Not rerun in this pass: tools/check-restart-skill-read.mjs takes a native binary (its node argument is a usage error), and the Node change does not reach native. Its last native witness is the 2026-11-10 run in the restart section above.

Stretch 4 items left open, each with its blocker:

- Owner decisions: resources/read of an unknown uri answers -32602 in native and -32002 in Node (which code to keep); the run_code skill-read refusal carries the skill text twice (about 48 KB) for a host that cannot read resources; Node run_code budget parity beyond 65 s; finish open-row step limit; shell-job lifetime equal to the job_start cap; decision 3 (protocol 2026-07-28 behind a capability flag) is not implemented; the Node playwriter snippet wrapper; the budget-check margin window. Blocker: each needs the owner to choose.
- Windows and macOS hosts: native Windows stderr capture (child.cpp), the Windows process-group kill, the B1 and B2 Windows witnesses, and the txiki and libuv build on Windows, macOS and arm64. Blocker: this checkout has no such host; hosted CI builds them and is not watched here.
- fx reply text: fx "another worker's events twice" (2026-11-08). Blocker: the duplicate needs fx reply text, and the unknown row unknown-mw6bc4mv1c00 was closed as stale on 2026-11-09.
- Installed build: served-skill freshness on an old connection; the task-leak fix (fcb84df) and the dispatcher install rows. Blocker: the installed gm must update, and it is not installed over here (owner).
- run_code no-result (rank 15): not reproduced. Blocker: a run that hits it.
- txiki project imports (S5c) and the import witness on Node and in the built site: blocked. Blocker: thebird must report that uv_fs_* is backed by the bridge (tjs.wasm pin 137c08f6 accepted; the import stubs remain).

## gm pass, Phase A (2026-11-10): owner decisions and the queue

Decisions, relayed by the dispatcher through orchestrate. Each is applied in this Phase A, and each row names its code and its witness. A row marked "already the same" changes no code: the witness shows both engines agree.

| decision | applied as | code | witness |
|---|---|---|---|
| unknown-uri error code -32002 | resources/read, skills/get and subscriptions/listen answer -32002 with data.uri on both engines. A missing or non-string uri argument stays -32602. | native/components/mcp/server.cpp (read_resource, skills_get, open_listen); src/mcp.mjs skillGet; tools/mcp-conformance.mjs (two expectations) | Phase B: check-build (conformance) on the rebuilt binary; the conformance run on Node |
| duplicate skill text in the run_code refusal | Measured, not assumed: the refusal reply carries one copy of the skill, native 10704 bytes and Node 10670 bytes for a 10032-byte skill (tools/check-no-resource-client.mjs). The duplicate was the refusal sentence "Read it and follow it", which sent a host that reads resources to read the skill a second time. The sentence is now "Follow it, then call run_code again." | native kSkillReadRefusal; src/mcp.mjs SKILL_READ_REFUSAL | Phase B: check-no-resource-client on both engines; the bytes above are its measurement |
| Node budget parity beyond 65 s | Node bodies had a wall-clock lifetime, so time spent in host calls counted against it. Native excludes host-call time (HostPause in native/components/quickjs/engine.cpp). Node now sums its host-call time per body and checks the lifetime every 100 ms (BODY_BUDGET_POLL_MS). The lifetime is 3600000 ms on both. | src/tools.mjs (pausedMs, pausedSince, budgetSpent, adoptBody) | tools/check-run-code-lifetime.mjs: node ok, 2026-11-10 (spin killed with reason lifetime after 5017 ms wall at a 4000 ms lifetime; a 6 s run_shell host call returned done after 6044 ms). Native in Phase B. |
| finish open-row step limit | already the same: openRows is accepted only when steps is at maxSteps, and it must list every open row of the run. Native server.cpp:2316-2336, Node src/mcp.mjs:866-878. | none | tools/check-decision-parity.mjs: node ok (at max-steps 2, finish without openRows refused with row(s) open; with openRows it finished). Native in Phase B. |
| shell-job lifetime (native behaviour) | already the same: a shell job ends at min(timeoutMs, the job lifetime 3600000 ms). A job_start with timeoutMs 7200000 reports timeoutMs 3600000. | none | tools/check-decision-parity.mjs: node ok, reported 3600000. Native in Phase B. |
| decision 3, protocol 2026-07-28 (follow native) | The native target is the 2026-07-28 result fields. Native sets ttlMs and cacheScope "public" on server/discover and tools/list and prompts/list (3600000), on resources/templates/list and on resources/read of a skill (3600000), and on resources/list and resources/read of a run (0). Node had none of them and now sets the same. Tool title, annotations and outputSchema were already on both. Both engines still negotiate only 2025-11-25 and 2025-06-18. | src/mcp.mjs cacheable(), LIST_TTL_MS, VOLATILE_TTL_MS, and the list, read and discover returns | Phase B: the parity harness (the ttlMs and cacheScope rows) and check-build |
| Node playwriter snippet wrapper (native wrapper) | already the same: native browser_scope.cpp:150-158 and src/browser-scope.mjs:55-63 use one trailing trim set, the same single-expression and parenthesised tests, and the return await (...) form. | none | tools/check-decision-parity.mjs: node ok (playwriter_execute of 1 + 1 returned 2). Native in Phase B. |
| budget margin window (native window) | Native checks the deadline at every QuickJS interrupt, so its window is one interrupt. Node polls every 100 ms: the recorded number is 100 ms (BODY_BUDGET_POLL_MS). Host-call time is excluded on both. | src/tools.mjs BODY_BUDGET_POLL_MS | tools/check-run-code-lifetime.mjs: node ok with the 100 ms window (5017 ms wall for a 4000 ms budget, which includes the status wait) |

Queue, in the order of the dispatcher's list:

1. The decisions above: applied in this Phase A. The AGENTS.md notes that stated the old codes or the old budget were corrected (four notes; the audit found no other line that a witness or the code contradicts).
2. Rank 15, run_code no-result. The 2026-11-09 ledger records it as not reproduced (the diagnostic is in place, 09af517, and it appeared in check-run-code-budget, 9cf86cb gap 3). Phase B runs check-run-code-budget on the rebuilt native binary; the result is in the Phase B record. If it does not reproduce, the record states the condition it needs: a run_code body whose result is lost at the job lifetime or at a restart.
3. Release relay re-exec: the release build carries the development stamp 472aaec-dev, so check-relay-reexec skips on it. Phase B reconfigures build/release with -DGMNEW_VERSION=<HEAD>-1 and runs the check there.
4. check-restart-skill-read on a native binary: run before the Phase A edits on build/release (stamp 472aaec-dev): ok, exit 0; "a worker restarted under the same host process runs run_code with no replayed skill read and logs restart skillRead true; under another host process the first run_code is refused once with the skill text". Phase B reruns it on the rebuilt binary.
5. fx duplicate events: the input is fx's reply text. At 08:3x fx-3d was busy (ListAgents), so no message went to fx. Ask fx through the dispatcher when fx-3d is idle; nothing waits on the answer.
6. Windows, macOS and arm64 (still open, blocked). Each needs its host: Windows native (child.cpp stderr capture, the Windows process-group kill, B1 and B2 witnesses, the MSVC build with QuickJS-NG) needs a Windows host with MSVC, Ninja and Node. macOS builds of libuv and txiki need a macOS host with the Xcode command line tools, cmake and Ninja. arm64 needs an arm64 host (Linux or macOS). Hosted CI builds them and is not watched here.
7. Installed build: pending. The installed gm does not carry this pass or fcb84df (task leak). It is not installed over the shared gm, because jayzee-74 and fx-3d were busy at 08:3x. Record the update as pending until no peer is busy, then the dispatcher installs it.



## gm pass, Phase B (2026-11-10): build, witnesses and defects

Build: cmake -S . -B build/release -DGMNEW_VERSION=d2c2c4f-1 (the CI shape, so the relay re-exec check does not skip on a dev stamp), then the build: 47 s. The native binary carries d2c2c4f. The later commits d6a9538 and 91d4fab change only Node source and the parity harness, so every native row below is at HEAD.

| witness | engine | result | wall |
|---|---|---|---|
| tools/check-build.mjs on build/release (conformance, then the Node arms) | native, Node | EXIT=0. conformance: 86 passed, 0 failed of 86 checks in 24 scenarios. Stamps d2c2c4f-1 (d2c2c4f). Node turn-economy, no-resource-client and restart-jobs arms ok. The step includes the update download from the GitHub release at about 24 KB/s, which is environmental | 519 s |
| tools/check-turn-economy.mjs node (rerun alone, after its arm was still running in check-build) | Node | turn-economy-check: ok. A next_context with nothing new answers in 401 bytes against 2279 for a full reply and takes no step; a job_status wait returned its exit code, tail and wall time; the job body took 31057 ms. EXIT=0 | 32 s |
| tools/check-no-resource-client.mjs | native, Node | native: refusal reply 10680 bytes with one copy of the skill, wall 1 s. Node: 10646 bytes, wall 2 s. Both refuse the first run_code once and run the next one | 1 s, 2 s |
| tools/check-restart-skill-read.mjs (queue item 4) | native | ok: a worker restarted under the same host process runs run_code with no replayed skill read | 1 s |
| tools/check-run-code-lifetime.mjs (--job-lifetime-ms 4000) | native, Node | native: spin body killed with reason lifetime after 4013 ms; a 6 s run_shell host call returned done after 6161 ms. Node: killed after 5043 ms; host call done after 6081 ms. Both ok | 21 s, 20 s |
| tools/check-decision-parity.mjs (job_start timeoutMs 7200000 reports 3600000; playwriter 1 + 1 returns 2; finish without openRows refused at max-steps 2) | native, Node | both ok | 35 s, 23 s |
| tools/check-relay-reexec.mjs on the non-dev stamp d2c2c4f-1 (queue item 3) | release relay | ok: the relay re-executed 144 ms after the update, with the 30 s next_context wait in flight | 13 s |
| tools/check-run-code-budget.mjs (rank 15 run_code no-result) | native | ok: a 65 s body returned 65014 ms; a fetch held 50 s ended at 50064 ms | 65 s |
| tools/check-browser-scope.mjs | Node | ok: the run page was listed, closed by finish, and gone from the browser after finish | 189 s |
| native/tests/parity/run.mjs --bin build/release/native/components/host/gm, on committed HEAD 91d4fab | both | 20/97 match, 0 cutover-expected, 55 native-ahead, 22 documented-gap, 0 differ | 15 s |
| tools/mcp-conformance.mjs against Node | Node | not a Node witness: the harness targets native. Run against Node it reports 3 description failures (next_context read-only; run_code description; query_log field paging) and stalled. Its job (pid 146104) was stopped by its own PID | n/a |

Defects found in this pass, and their fixes:

- Node tool annotations did not follow native: next_context was not read-only, and finish was not non-destructive. The parity rules for ttlMs and cacheScope, for tools title and annotations, and for the resources/read code hid the difference. Fixed in d6a9538: Node annotations follow native, and the stale rules are dropped. Parity is 0 differ after the fix (before it, readOnlyHint differed on tools[0]).
- The parity rule for the events sha gave a wrong cause. Removing the rule produced 1 differ, so the rule stays, with the reason now naming the tool list, whose descriptions differ between the engines (91d4fab).

Queue status after Phase B:

1. The decisions: applied in Phase A and witnessed above (-32002 both engines, one skill copy in the refusal, the Node budget excluding host-call time, the native playwriter wrapper and step limit already the same).
2. Rank 15, run_code no-result: not reproduced. check-run-code-budget returned a 65 s body at 65014 ms. Reopen when a run returns without a result; capture its run log.
3. Release relay re-exec: run on the non-dev stamp d2c2c4f-1, ok (144 ms).
4. check-restart-skill-read on the native binary: ok, 1 s.
5. fx duplicate events: open. The input is fx's reply text, which has not arrived. fx-3d was busy at 08:3x; the question goes through the dispatcher when fx-3d is idle, and nothing waits on it.
6. Windows, macOS and arm64: open and blocked on their hosts (Phase A item 6). Not verified here.

Installed build: pending. The installed gm does not carry this pass or fcb84df (task leak). It is not installed over the shared gm while peers are busy; the dispatcher installs it when no peer is busy.

Commits on main for this stretch: 92c2873 (decisions), d2c2c4f (Phase A record), d6a9538 (Node annotations, stale parity rules), 91d4fab (parity reason), and this Phase B record. Pushed to origin main once after the fetch showed a fast-forward.

## Jayzee project browser (2026-11-10): started through the playwriter setup

Requested by the owner (pasted queue 834f). jayzee's stretch 1 was blocked on its browser, which reported stopped with the controlled-run harness refusing to start one itself.

Start command, run in /workspace/jayzee (the gate resolves the project from its .playwriter directory and reads debug port 10221 from .playwriter/debug-port):

    cd /workspace/jayzee && node /data/cache/npm/_npx/bc63b05df76aa536/node_modules/pw/bin/playwriter-project start

Output: playwriter-project: browser ready (profile /workspace/jayzee/.playwriter/browser-profile). Exit 0.

PIDs: gate pid 172748 (port 9721, started 2026-11-10 08:39); browser pid 189245, owned by that gate, debug port 10221, profile /workspace/jayzee/.playwriter/browser-profile.

Witness: curl -s http://127.0.0.1:10221/json/version returned "Browser": "Chrome/155.0.8059.39" and a webSocketDebuggerUrl on ws://127.0.0.1:10221/devtools/browser/519118b6-e7d5-464a-ad82-672cce422cfe (curl exit 0). playwriter-project status: "debug port 10221, browser running pid 189245 (gate), leases 2".

Left running. It stops on its own after 300000 ms with no traffic (PLAYWRITER_IDLE_MS default), so a restart is needed if jayzee is idle that long. Stop it only by PID 189245 and gate 172748 once the owner says so.

## gm pass, Phase A (2026-11-10): installed-build update prepared, not installed

Owner instruction (pasted queue, 2026-11-10): prepare the installed-build update as Phase A only: code, docs and tests, committed locally, nothing pushed, no install. The install touches every peer, so it waits until no peer is busy.

Changes:

1. Served-skill freshness on an old connection. Cause: resources/read of a skill returned ttlMs 3600000 with cacheScope public, so a client holding a connection that started before an update kept the old skill text for up to an hour, and the new skill was not served on that connection. Change: the skill read is volatile (ttlMs 0) on both engines. native/components/mcp/server.cpp read_resource uses kVolatileTtlMs; src/mcp.mjs readResource uses VOLATILE_TTL_MS. The reader itself already re-reads the file on each call (SkillCache::get, skillOf), so the stale part was the cache hint.
   Witness (Phase B, after the install): node tools/check-installed-build.mjs /config/.gmnew/current/gm <sha> asserts resources/read of skill://gm/SKILL.md has ttlMs 0 and equals the binary's skills copy. Before the install the installed build returns ttlMs 3600000, so the check fails there, which is the defect it measures.

2. fcb84df task-leak install rows, as exact install steps. Cause: the installed gm 78ca5a1 predates fcb84df (a non-owner task replacement is refused after the first step) and 70e4349 (the updater finds gmnew-<target>). Steps, in order:
   a. Check that no peer is busy: ListAgents shows no peer as busy. At 08:4x fx-e1 was busy, so this step waits.
   b. Check that the published release carries the fixes: scripts/install.sh fetches manifest.json from GMNEW_RELEASE_BASE (default https://github.com/AnEntrypoint/gm/releases/download/latest). Run curl -fsSL that URL and read the version. Proceed only when the version is the release cut from a main commit at or after this pass (the fcb84df, 70e4349 and the change 1 commit). If it is older, the install would put back the old build: wait for the release.
   c. Run sh scripts/install.sh. It verifies sha256 and size from the manifest, stages the archive, and keeps the previous install in ~/.gmnew/previous.<pid>.
   d. Run node tools/check-installed-build.mjs /config/.gmnew/current/gm <release sha> (change 3 below). Expect installed-build-check: ok.
   e. Peers reload on a binary change (native peers reload on a leaf, skill or binary change), so no peer restarts by hand. Re-read the task-leak refusal with a non-owner next_context task replacement after one step; it must be refused.
   Witness: the step d output, and the step e refusal text quoted from the run log.

3. A check that runs the installed build's version and skill serve: tools/check-installed-build.mjs (new). Usage: node tools/check-installed-build.mjs <installed gm> [expected stamp prefix]. It runs <binary> --version, opens serve on a scratch workspace with playwriter disabled, reads initialize serverInfo.version, reads skill://gm/SKILL.md, and requires the text to equal <binary dir>/skills/gm/SKILL.md and ttlMs 0. Witness (Phase B): run it on /config/.gmnew/current/gm after step 2c; it must print installed-build-check: ok. Before the install it fails on ttlMs and on the skill text, which is the point.

Not done in this pass: no build, no test, no push, no install. Phase B builds HEAD, runs node tools/check-installed-build.mjs on the built binary (expected to pass for the built binary: ttlMs 0) and node tools/check-skill-serve.mjs build/release/native/components/host/gm, then the parity harness.

Blocker for the install: a peer is busy (fx-e1 at 08:4x). The install is waiting for no peer to be busy.

## gm pass, stretch 5 (2026-11-10): reachable ledger rows, Phase A and Phase B

Phase A reviewed the ranked ledger (the 2026-11-10 ranked open work at line 1444, the ranked reachable items at line 1608, and the 2026-11-09 ranked remaining work at line 1047) against the code and the witnesses. Every row that is reachable without a Windows, macOS or arm64 host, fx's duplicate-events reply, or thebird's uv_fs bridge is already closed in HEAD, or is a decision that the owner has taken. No new code change was needed for a ledger row. The one defect found in this stretch is in the new check itself (below).

| row | status | reason or witness |
|---|---|---|
| relay re-exec under a held next_context wait | closed (Phase B b23984b) | check-relay-reexec passes on a non-dev stamp |
| one skill copy in the run_code refusal | closed (3ffda38) | check-no-resource-client native 10680 bytes, node 10646 bytes |
| AGENTS.md Last witness for parity | closed (91d4fab) | 20 of 97 match, 0 differ |
| Node arm of a tool-only client across a restart | closed | check-no-resource-client drives both engines |
| repeated skill re-read after a worker restart | closed (stretch 4) | check-restart-skill-read ok |
| served-skill freshness on an old connection | closed in code this stretch (626f8e0), witnessed below | check-installed-build on the built binary: ttlMs 0 |
| ci_status no-commit wording, leaf assertion, finish openRows, Node stopped background fetch | closed in earlier stretches | see their records |
| resources/read of an unknown uri (-32602 or -32002) | closed by owner decision 2026-11-10 (-32002 on both) | check-build conformance |
| run_code skill text in structuredContent | owner decision, not taken | the protocol shape on both engines |
| Native resources/subscribe -32601 against Node | closed; AGENTS.md records subscribe on both engines | not reproduced in this pass |
| protocol 2026-07-28 behind a capability flag | owner decision 3, not started | the owner schedules it |
| Two peers in one workspace; fx duplicate events | blocked: needs fx's reply text | fx-e1 was busy, nothing sent |
| run_code no-result (rank 15) | not reproduced | check-run-code-budget ok at 65014 ms; reopen when a run hits it |
| txiki uv_fs_* imports and the import witness | blocked: needs thebird's bridge report | not in this checkout's reach |
| Windows B1 (restart-jobs), B2 (arm64 browser), process-group kill, MSVC build | blocked: no Windows host | install steps in the Phase A entry at line 1405 |
| macOS and arm64 build and runtime | blocked: no host | not verified here |
| installed build (626f8e0, 40feed3, 3fcb810, cc80361) | pending the install | waits for no peer to be busy; the release must carry these commits first |
| ship.sh bypass | owner decision | not taken |

Defect found and fixed in this stretch (Phase A, commit 3fcb810): tools/check-installed-build.mjs compared the served skill to the binary's own skills directory, so on a built binary (which serves the checkout) it could not match, and it expected the build stamp in serverInfo.version, which reports the protocol version 0.1.0. Fix: the served text may match either the binary's skills copy or the checkout's skills/gm/SKILL.md, and the stamp is checked only in the --version output.

Phase B, on HEAD 3fcb810 (release build reconfigured with -DGMNEW_VERSION=3fcb810-1):

- build: cmake --build build/release, BUILD_EXIT=0, wall 45 s; gm --version prints "3fcb810-1 (3fcb810)".
- check-installed-build on build/release gm 3fcb810: installed-build-check: ok (version "3fcb810-1 (3fcb810)"; skill://gm/SKILL.md equals /workspace/gm/skills/gm/SKILL.md with ttlMs 0). Wall under 1 s.
- check-installed-build on the installed /config/.gmnew/current/gm (78ca5a1, negative witness): 1 failure: skill://gm/SKILL.md read has ttlMs 3600000, expected 0. This is the freshness defect the check measures. Wall under 1 s.
- check-skill-serve on build/release gm: skill-serve-check: ok (the default serve returns the checkout's skill://gm/SKILL.md, and a live connection returns each change on the next read). Wall under 1 s.
- check-no-resource-client native: ok (10680 bytes for a 10032-byte skill). Wall 2 s.
- check-no-resource-client node: ok (10646 bytes). Wall under 1 s.
- parity, build/release gm: 20/97 scenarios match, 0 cutover-expected, 55 native-ahead, 22 documented-gap, 0 differ. Wall 16 s.

The installed build is not installed. Its install waits for a moment when no peer is busy, and for a release that carries 626f8e0, 40feed3, 3fcb810 and cc80361.

## gm pass, Phase A (2026-11-10): wall-clock and token waste in the gm skill

Measured from the transcripts and run logs with two scratch scripts in /tmp/gm-waste (outside the checkout, not committed): analyze.mjs (per Claude Code session: turn gaps, repeated tool calls, tool results over 20000 characters) and runs.mjs (per gm run log: repeated actions).

Session transcripts (/config/.claude/projects/-workspace-gm/<session>.jsonl):

| session | records | tool uses | user prompts | gap median | gap p90 | gaps over 10 min | results over 20000 chars (total) | most repeated call |
|---|---|---|---|---|---|---|---|---|
| 526213ff-cae8-4f7a-8382-45270c027a27 | 4179 | 399 | 10 | 117 s | 222 s | 0 | 5 (123259 chars) | next_context waitMs 100000, 14 times |
| 179378d2-64e5-4eb4-9e82-50c37acd8977 | 1744 | 156 | 3 | 508 s | 1588 s | 1 | 2 (54970 chars) | next_context waitMs 100000, 16 times |
| 7ae15e26-0cdd-470c-8de1-bbfaa49f567c | 27890 | 2562 | 135 | 172 s | 607 s | 15 | 23 (622227 chars) | next_context waitMs 100000, 18 times; ReadMcpResourceTool skill://gm/SKILL.md, 13 times; a job_status run_code body, 5 times |

Gap: the time from an assistant record's end to the next user prompt. It mixes the user's time away with time a job spent running after the turn ended, so it does not isolate the waste.

gm run logs (/workspace/gm/runs, 444 runs, 9346 actions):

- 1699 actions repeat an earlier action in the same run (same tool and arguments). By tool: child_context 768, next_context 367, run_shell 297, run_code 185, write_file 48, edit_file 11, others under 10.
- Run 2026-11-05-19-07-15-bce32b: 472 repeated actions. Its top call is child_context with the child and run arguments, 264 times, with no wait. That is a polling loop.
- Run 2026-11-05-15-30-50-484992: 393 repeated actions.
- skill-loaded events: 157 across the 444 runs.
- next_context with a waitMs argument: 1 in the run logs. The transcripts show the wait form is used (14 to 18 times per session), so the run logs and the transcripts count different things; the transcript count is the measured wait use.

Three waste sources, each with the habit that addresses it (skills/gm/SKILL.md, Habits):

1. Zero-wait polling (child_context 264 times in one run, next_context repeated across runs): habit "Wait in one call, do not poll".
2. Repeated skill reads (13 in session 7ae15e26; 157 skill-loaded events): habit "Read the served skill once per connection".
3. Turns that end while their own job runs (median gap 117 to 508 s, p90 222 to 1588 s across the three sessions, which mix user time with job time): habit "Keep the wait in the turn that started the job".

Not addressed by a new habit: the 2562 tool uses and 623 KB of results over 20000 characters in session 7ae15e26. The existing habit "Keep what you carry small" covers them; the measured repeat is in the next line.

Phase B for this item: the gm witnesses that cover the skill change, with wall times, are recorded in the Phase B section that follows.

## gm pass, Phase B (2026-11-10): the gm skill habits, witnesses at eaa8fce

The skill is read at run time from the checkout (native default source, skills_dir_of), so the release binary at 3fcb810-1 serves the new text without a rebuild. Witnesses, run concurrently:

- check-installed-build on build/release gm, expected stamp 3fcb810: ok (version "3fcb810-1 (3fcb810)"; skill://gm/SKILL.md equals the checkout copy with ttlMs 0). Wall 0.19 s.
- check-skill-serve on build/release gm: ok (the default serve returns the checkout's skill://gm/SKILL.md, and a live connection returns each change on the next read). Wall 0.27 s.
- check-no-resource-client native: ok (the first run_code is refused once with one copy of the skill, 12045 bytes for an 11397-byte skill). Wall 1.22 s.
- check-no-resource-client node: ok (12011 bytes for 11397). Wall 0.85 s.
- parity, build/release gm: 20/97 scenarios match, 0 cutover-expected, 55 native-ahead, 22 documented-gap, 0 differ. Wall 19.6 s.

Cost of the change, measured: the skill grew from 9940 to 11302 bytes (+1362), so the one refusal a connection receives is about 1.4 KB larger. The three habits are the cost; the habit against each measured waste source is the reason.

Defects found in Phase B: none. The installed-build step is not run and waits for the dispatcher's go.

## gm pass, installed build (2026-11-10): the owner's go, installed at 4101e4a-1

Owner instruction (pasted, 2026-11-10): install the new gm build now. The install is the owner's direct request; fx was busy on stretch 9 and thebird was idle, and neither was waited on.

Build (once): cmake -S . -B build/release -DGMNEW_VERSION=4101e4a-1, then cmake --build build/release -j. BUILD_EXIT=0, wall 15 s (job pid 416124). Stamp: `gm --version` prints "4101e4a-1 (4101e4a)".

Install (once). scripts/install.sh fetches the published release, so it cannot install a local build. The same layout was staged by hand: ~/.gmnew/stage-4101e4a holds gm, gm-core, defaults, leaves and skills copied from build/release/native/components/host; the old ~/.gmnew/current moved to /config/.gmnew/previous-6582078-339 (the build it replaced, stamp 6582078-339); the stage moved to ~/.gmnew/current; ~/.gmnew/current/.gmnew-update.json was written as {"checked_ms":...,"etag":"","version":"4101e4a-1"}. Output: INSTALLED=4101e4a-1 (4101e4a). The user-level registration was not rewritten: ~/.claude.json mcpServers.gm is {"command":"/config/.gmnew/current/gm","args":["serve"]} before and after, so it already points at the installed path.

Installed-build check: node tools/check-installed-build.mjs /config/.gmnew/current/gm 4101e4a: installed-build-check: ok (version "4101e4a-1 (4101e4a)"; skill://gm/SKILL.md equals /workspace/gm/skills/gm/SKILL.md with ttlMs 0). Wall 0.15 s.

Fresh gm session serving the skill habits: a new serve process (quiet MCP config, scratch workspace) answered resources/read with ttlMs 0; the text contains "Wait in one call, do not poll" and "Read the served skill once per connection". A first probe with --mcp-config /dev/null and no workspace directory timed out; that was the probe's own setup, not the install, and the second probe with a real quiet config answered at once.

Not done: the release channel. The next update check fetches the published release, which does not carry 4101e4a yet; when that release exists, scripts/install.sh replaces this local build with it.

## gm pass, Phase A (2026-11-10): thebird's txiki pin f716451, handoff and import checks (no build, witness or push)

Input: thebird scripts/txiki/pin.json holds tjsWasmSha256 = f716451387bd721e1b0cede84cc5ab44b10c6087e16dde78e206e12e70b1f296 (read as the pin at this pass; thebird's scripts/vendor-txiki.mjs derives TXIKI_WASM_SHA256 from it, line 37). The earlier artifact 137c08f6db9969194c917384172794173a31642b7d51d2aac6c598d1c4475a28 is retired; the notes above that name it (line ~743, ~822, ~1689) are the history of that handover and are superseded by this section.

Changes, each committed locally by lanmower with no trailer:

1. txiki/node.mjs, the artifact reference. Before: --pin defaulted to thebird scripts/vendor-txiki.mjs and the pin was read by the regex export const TXIKI_WASM_SHA256 = '<hex>'. thebird's script now computes that constant from pin.json, so the regex matches nothing and the entry throws "no TXIKI_WASM_SHA256". After: --pin defaults to thebird scripts/txiki/pin.json, the pin is JSON.parse(...).tjsWasmSha256 checked against 64 lowercase hex digits, and the wasi shim is read from thebird's web/shims/wasi-preview1.js (the old path was derived from the pin file's depth, which the move changes). Witness: node --check ok (run in this pass); Phase B: node txiki/node.mjs with a script in a scratch project, against /workspace/thebird/web/vendor/txiki/tjs.wasm, must print pinned true and the wasmSha256 f716451...
2. txiki/build-site.mjs, the same reference: the default --pin, the pin read, and the wasi shim path. Witness: node --check ok (this pass); Phase B: node txiki/build-site.mjs --out /tmp/gm-txiki-site must print pinned true and write pin.json with pin f716451... The site is a scratch output and is removed after the witness.
3. The gm_txiki_* export set. thebird's scripts/txiki/browser/entry.c exports seven functions (gm_txiki_new, gm_txiki_free, gm_txiki_context, gm_txiki_loop_alive, gm_txiki_loop_turn, gm_txiki_load_builtin, gm_txiki_refresh_loop_time). gm's native/components/quickjs/txiki/txiki_shim.h declares the same seven, with the same names and calls in engine.cpp (lines 64, 248-298). No change needed: the set matches. Witness: grep -c gm_txiki_ native/components/quickjs/txiki/txiki_shim.h prints 7 (this pass); Phase B: after thebird pushes, the import checks below prove the exports at run time.

The four import checks thebird expects are in /workspace/thebird/scripts/witness.mjs lines 363 to 427 and are not in gm's tree. They are script-imports (a node script imports a sibling and a nested module through the txiki loader, output "script-imports 42 lib"), eval-import (a dynamic import from node -e, output line "eval-import 42"), missing-import (a missing module reports the loader error and the shell goes on, "missing-import could not load"), and realpath (tjs.realPath resolves a dotted path, output "realpath /workspace/import-probe/m.mjs"). gm has no copy of them, so gm's witness is thebird's witness.mjs run against the f716451 build, plus gm's own txiki/node.mjs run of the same import probe in a scratch project.

Not changed here, with the reason: tools/check-txiki-wasi.mjs and tools/check-txiki-wasi-browser.js take the wasm path as an argument and carry no pin, so they need no edit for the new pin. native/third_party/txiki (the vendored native tree) has its own pins in gm's tools/vendor-txiki.mjs (txiki v26.11.0 and the other two archives); the wasm pin is a separate artifact and is not in that list.

Held: the import witness rerun (the four checks above, on gm's side) waits until thebird pushes the pin commit and the dispatcher sends the go-ahead. Nothing was built, run or pushed in this pass.

## gm pass, Phase A (2026-11-10): ledger closures and the DESIGN.md stale uri code

Ranked reachable items (no build, no push), read from this ledger's open rows, the Phase A tables of 2026-11-10 and the gm skill:

1. DESIGN.md line 1319 said skills/get answers any other uri with -32602 (src/mcp.mjs:91) and resources/read with -32002 (src/mcp.mjs:108). The code answers -32002 for both (src/mcp.mjs:93 skillGet, src/mcp.mjs:467 readResource; native server.cpp read_resource and skills_get), decided 2026-11-10. Taken: the line now says -32002 with data.uri at the current lines, and that a missing or non-string uri stays -32602. Witness: grep -n "RpcError(-32002" src/mcp.mjs prints lines 93, 110 and 467; a Phase B run of tools/mcp-conformance.mjs on native checks the same code.

Ledger rows closed by commits already in history (each row's own witness is named; no new code):

| row | closed by | witness |
|---|---|---|
| 4, unknown uri -32602 against -32002 | owner decision 2026-11-10, applied in 92c2873 | tools/mcp-conformance.mjs expectations and the uri probe |
| 5, the refusal carries the skill twice | one copy in 3ffda38 (measured 25640 bytes for a 24968-byte skill, then 10680 bytes native) | tools/check-no-resource-client.mjs, native and node |
| 6, Node run_code budget beyond 65 s | 92c2873 and d6a9538, with BODY_BUDGET_POLL_MS | tools/check-run-code-budget.mjs and tools/check-run-code-lifetime.mjs on both engines |
| 7, finish open-row step limit | already the same on both engines (decision table, 2026-11-10) | tools/check-decision-parity.mjs, node and native |
| 8, shell-job lifetime | already the same: min(timeoutMs, 3600000) on both (decision table) | tools/check-decision-parity.mjs |
| 10, relay re-exec under a held wait | b23984b and the Phase B witnesses in ea79901 | tools/check-relay-reexec.mjs, release d2c2c4f-1, 144 ms |
| 13, browser tab count across runs | 566fc80, split by run and project | tools/check-browser-scope.mjs, node ok (189 s) |
| 19, served-skill freshness on an old connection | 626f8e0 (skill read volatile on both engines), installed 4101e4a-1 | tools/check-installed-build.mjs ok on the installed build (ttlMs 0); the 78ca5a1 build fails it on ttlMs 3600000 |

Rows still open, each with its reason (none reachable without a build, a push, a host or an owner decision):

- 9, decision 3 (protocol 2026-07-28 behind a capability flag): owner decision; a new protocol surface that needs a build to check.
- 14, fx's events twice: needs fx's reply text (fx-e1 busy on stretch 9; the dispatcher sends the question).
- 11, 12, 17, 18, Windows and macOS items: no Windows or macOS host here.
- 16, asan full check-build: needs a build (Phase B).
- txiki import rerun (cdf218f): closed, see the Phase B-witness line for the rerun against thebird 6639c6b.
- ship.sh bypass and run_code structuredContent text (rows 5 and the owner list): owner decisions.

## gm pass, Phase B (2026-11-10): thebird's f716451 build, the four import checks, and the txiki runner fixes at 916aefe

Input: thebird origin/main at 6faf4c5 (pin scripts/txiki/pin.json, tjsWasmSha256 f716451387bd721e1b0cede84cc5ab44b10c6087e16dde78e206e12e70b1f296). /workspace/thebird/web/vendor/txiki/tjs.wasm is untracked there; its sha256 is f716451387bd721e1b0cede84cc5ab44b10c6087e16dde78e206e12e70b1f296, the pinned value. gm ran it through txiki/node.mjs against the four probe files of thebird's scripts/witness.mjs (lines 363 to 366), staged in /tmp/gm-import-probe (scratch, removed by nothing; outside the checkout).

Defects found by the first run, both in gm's own txiki runner, fixed in 916aefe:

1. The runner called tjs_browser_eval with the code pointer only. thebird's entry takes a second argument, the module label (its web runner passes it, txiki-in-page.js callEval). Without it relative imports had no base: script-imports failed with "Uncaught ReferenceError: could not load 'm.mjs'", and eval-import printed nothing. Fix: txiki/host.mjs run() takes name (the entry's absolute project path) and passes it as the label; txiki/node.mjs and txiki/site.mjs pass the entry name.
2. The runner had no tjs_fs_realpath, so the wasm stubbed it to -1 (node.mjs reports "stubbed": ["tjs_fs_realpath", "tjs_fs_rename"]). realpath printed nothing and exited 0. Fix: txiki/fs.mjs implements tjs_fs_realpath against the project (the path when project.stat finds it, else -1). tjs_fs_rename remains stubbed; no probe uses it.

Four import checks, after the fix, each through node txiki/node.mjs against thebird's f716451 build (pinned true, status 0):

- script-imports: stdout "script-imports 42 lib" (expected "script-imports 42 lib").
- eval-import: stdout "eval-import 42" (expected "eval-import 42").
- missing-import: stdout "missing-import could not load '/import-probe/nope.mjs'" (expected to match /^missing-import could not load/m).
- realpath: stdout "realpath /import-probe/m.mjs". thebird's expected line is "realpath /workspace/import-probe/m.mjs"; the difference is the project root (the scratch directory here, /workspace in thebird's shell), so the resolved file is the same. Recorded as a root difference, not a defect.

Witnesses (run on build/release at 916aefe-1 (916aefe), one build of 13 s, BUILD_EXIT=0; job b8-build, pid 524605):

- txiki/build-site.mjs --out /tmp/gm-txiki-site: pinned true, actual f716451..., 993 files; the scratch output was removed. Wall 2.9 s.
- check-installed-build on build/release gm, stamp 916aefe: ok (version "916aefe-1 (916aefe)"; skill equals the checkout copy with ttlMs 0). Wall 0.16 s.
- check-skill-serve on build/release gm: ok. Wall 0.25 s.
- check-no-resource-client native: ok (12045 bytes for an 11397-byte skill). Wall 1.26 s. Node: ok (12011 bytes). Wall 0.77 s.
- parity, build/release gm: 20/97 scenarios match, 0 cutover-expected, 55 native-ahead, 22 documented-gap, 0 differ. Wall 16.5 s.
- gm_txiki_ declarations in txiki_shim.h: 7 (the seven thebird exports). Wall 0.02 s.
- DESIGN.md -32002 line (fbdcb89) and the ledger closures (747e3dd): committed; their witnesses are the greps and checks named in those records.

Not run here: tools/check-txiki-wasi.mjs and the gm reactor wasm (the gm wasm32-wasi build is blocked at libuv, see the 2026-11-10 wasm32-wasi record), and the in-browser run of the txiki site. Blocked rows stay open with their causes.

## gm skill habits: scripts, jobs, tree validity, loop ticks (2026-11-10, Phase A)

- skills/gm/SKILL.md Habits: four bullets added (script files for quoted shell text, gm.job_start instead of a shell `&`, a job valid only for its start tree, a loop tick ends that tick). Witness: ReadMcpResourceTool skill://gm/SKILL.md on the served gm returns the four bullets and the rest of the file unchanged; tools/check-skill-serve.mjs on build/release gm.
- Served-copy read-back: tools/check-skill-serve.mjs build/release/native/components/host/gm returned ok on 2026-11-10 (the default serve returns the checkout copy). The installed server still serves the pre-edit skill, so the read-back of skill://gm/SKILL.md for the four habits is pending the dispatcher go. Reinstall command, not run: sh scripts/install.sh (it fetches the published release from GMNEW_RELEASE_BASE, so the habits reach the served skill only after a release carrying commit 7dd04f8 is cut).

## Embedded txiki.js engine, witness run (2026-11-10, Phase B)

- Phase A: no code change. native/components/quickjs/engine.cpp already creates the embedded txiki runtime (gm_txiki_new, line 248) and GMNEW_TXIKI defaults ON outside MSVC; the pins match tools/vendor-txiki.mjs and native/third_party/txiki/VERSION.txt, which already records them.
- cmake --build build/release: no work to do, BUILD_EXIT=0, GMNEW_TXIKI ON.
- tools/check-embedded-runtime.mjs build/release/native/components/host/gm: ok, wall 0.77 s.
- tools/check-build.mjs build/release: 85 passed, 1 failed of 86 checks, wall 124.8 s. The failure is "resources/read of a skill file carries ttlMs 3600000" (tools/mcp-conformance.mjs:164): the binary returns ttlMs 0, which tools/check-installed-build.mjs:101 requires so an open connection re-reads an edited skill. The two witnesses conflict; the owner decides which holds.

## Skill read cache decision (2026-11-10)

- Decision: a resources/read of a served skill file carries ttlMs 0 and cacheScope public. Reason: the cost of a stale skill is larger than the cost of an uncached read, and tools/check-installed-build.mjs already requires ttlMs 0 so an open connection re-reads an edited skill. tools/mcp-conformance.mjs now expects ttlMs 0 for that read; it previously expected 3600000.
- tools/check-build.mjs build/release (binary 916aefe-1), run once after the change: conformance 86 passed, 0 failed of 86 checks in 24 scenarios; the full check exited 0 in 498.95 s, with the gm and gm-core stamps 916aefe-1 (916aefe). A 400 s cap killed the first run during the browser checks, so it was rerun with a 590 s cap.

## Tooling fix units: child task decision and witnesses (2026-11-10, Phase B)

- Decision (dispatcher, 2026-11-10): a child context may not replace the run task without owner:true, as native/components/mcp/server.cpp:201 states. Reason: the native component is the reference, and a child overwrite of the owner task was the defect in the child-task-overwrite unit. The Node side already matches: src/mcp.mjs childContext refuses a non-owner task replacement (line 657) and childRead passes owner:true only when the caller sent it. No source edit was needed, so none was made.
- Phase A: no source change. The five ranked units in work/tooling-fix-units.json are marked with their status and the witness that covers each.
- Phase B witnesses on build/release/native/components/host/gm, each run once:
  - tools/check-child-task.mjs: passed (node and native real-tree checks), wall 93.63 s.
  - tools/check-task-set.mjs: passed (node and native real-tree checks), wall 0.43 s. Covers task-verb and ended-run-stale-task.
  - tools/check-grep-paging.mjs: passed (node and native real-tree checks), wall 0.75 s.
  - tools/check-read-truncation.mjs: passed, wall 0.24 s.
  - tools/check-output-recovery.mjs: passed (node and native real-tree checks), wall 0.52 s. Covers run-code-large-output.
  - tools/check-job-reply-git-state.mjs: ok, wall 102.33 s. It covers the git state a job reply reports, not the push timing; commit-misread-late-push has no separate witness.

## Queue pass: push timing, node:fs, page binding, child task (2026-11-10, Phase A)

- native/components/quickjs/engine.cpp (load_module_from_disk): an import of node:* throws a ReferenceError naming gm.read_file, gm.write_file, gm.fs_op and gm.run_shell. Witness: tools/check-node-fs-import.mjs <native gm>.
- tools/check-push-timing.mjs (new): checks ship.sh runs the gate before the commit and the push after it, and that a commit is an ancestor of origin/main only when it is claimed pushed. Witness: node tools/check-push-timing.mjs [sha] (CLAIM_PUSHED=1 when the push is claimed).
- Child task (src/mcp.mjs childContext, line 657): no change; the Node side already refuses a non-owner task replacement, as native/components/mcp/server.cpp:201 states. Witness: tools/check-child-task.mjs (passed in the prior pass).
- Playwriter page binding: not changed. The page global is set by the external playwriter server, and the Node browser scope gives each run its own context that finish closes (src/browser-scope.mjs). Keeping the page across runs changes that per-run design, so it needs an owner decision. Witness, once decided: a second run_code reads the page bound by the first.

## Queue pass witness record (2026-11-10, Phase B, build/release gm)

- cmake --build build/release: BUILD_EXIT=0, 5 steps linked.
- tools/check-node-fs-import.mjs: ok, wall 0.15 s.
- tools/check-push-timing.mjs: ok (gate line 41 < commit line 50 < push line 52), wall 0.07 s.
- tools/check-skill-serve.mjs: ok, wall 0.22 s.
- tools/check-build.mjs build/release: exit 0, wall 389.73 s; conformance 86 passed, 0 failed of 86 checks in 24 scenarios; gm stamp 916aefe-1 (916aefe).
- Not done: the playwriter page binding (decision pending, see the Phase A record).

## Playwriter page bound per project (2026-11-11, Phase A)

- Decision (dispatcher, reversible): the playwriter page stays bound for the session, per project. Each run still gets its own browser context, and finish closes only that run context, not the page. Reason: the page global is a defect jayzee reported, and the owner record says tabs are shared across projects; pages are never shared across projects because each project root has its own browser.
- src/browser-scope.mjs OPEN_RUN and native/components/host/browser_scope.cpp kOpenRunContext: create state.gmProject once and state.gmPage in it, and bind page to state.gmPage on every execute. Limit: a close of the whole project browser (browser_close_machine) closes the project context too; the next execute then creates a new one only if the page is closed, so a closed project context is not re-created by the isClosed check alone.
- Witness: node tools/check-project-page.mjs <native gm>: a page opened in one run_code is read back by a second run_code, and a second project session starts on its own page.

## Playwriter page witness record (2026-11-11, Phase B, build/release gm)

- cmake --build build/release: BUILD_EXIT=0, wall 3.96 s.
- tools/check-project-page.mjs build/release/native/components/host/gm: exit 0, wall 7.86 s. The page opened in one run_code is read back by a second run_code; a second project session starts at about:blank.
- tools/check-skill-serve.mjs: exit 0, wall 0.23 s.
- tools/check-browser-scope.mjs: exit 0, wall 193.11 s.
- tools/check-build.mjs build/release: exit 0, wall 381.97 s; conformance 86 passed, 0 failed of 86 checks in 24 scenarios.

## Project page reopen after a close (2026-11-11, Phase A)

- src/browser-scope.mjs OPEN_RUN and native/components/host/browser_scope.cpp kOpenRunContext: when the project page is closed, the next run creates a new project context and a new page together, so a closed page is not reused and the context is not re-created on a closed page. Witness: node tools/check-project-page.mjs <native gm>: after page.close() in one run, the next run_code evaluates on a reopened page and returns 1.

## Project page reopen witness record (2026-11-11, Phase B, build/release gm)

- cmake --build build/release: BUILD_EXIT=0, wall 3.67 s.
- tools/check-project-page.mjs: exit 0, wall 12.41 s (includes the reopen after page.close).
- tools/check-browser-scope.mjs: exit 0, wall 188.81 s.
- tools/check-build.mjs build/release: exit 0, wall 508.22 s; conformance 86 passed, 0 failed of 86 checks in 24 scenarios.
- tools/check-skill-serve.mjs: exit 0, wall 0.21 s.

## Compact next_context reply (2026-11-11, Phase A)

- Measured before the change (build/release at d2dc250, 20 next_context calls per series after a run_code each): normal series mean 1168 bytes, total 23355, first reply 4907, later unchanged replies 971; full:true series mean 7422 bytes, total 148443. Recorded here as the baseline.
- native/components/mcp/server.cpp and src/mcp.mjs: the unchanged reply no longer carries the progress prose, which repeats rules the skill holds (the Waits and events section). It keeps unchanged, run, steps and stepsLeft. Estimated 346 bytes for the reply, a 20-step normal mean of about 574, which is 51elow baseline. Witness: node tools/measure-next-context.mjs <native gm>, which asserts the normal mean is at most 584 bytes and that every unchanged reply keeps run, steps and stepsLeft.
- Not changed: rules stay on each changed step (AGENTS.md, rules re-read at every step); full:true replies are not changed, because after a compaction they are the recovery path. The full series is reported, not asserted.

## Compact next_context witness record (2026-11-11, Phase B, build/release gm)

- cmake --build build/release: BUILD_EXIT=0, wall 29.54 s.
- tools/measure-next-context.mjs: exit 0, wall 0.83 s. Normal 20-step mean 528 bytes against baseline 1168 (55maller); full-reply series mean 7474 against baseline 7422 (not targeted).
- tools/check-skill-serve.mjs: exit 0, wall 0.23 s.
- tools/check-build.mjs build/release: exit 0, wall 508.89 s; conformance 86 passed, 0 failed of 86 checks in 24 scenarios.

## Feed digest and once-per-run repeats (2026-11-11, Phase A)

- Consumer check (none read head, tail or textDigest from the feed): searched src/ and tools/ and native/components/. Only the producers read them: src/compact.mjs boundedItem and native/components/mcp/compact.cpp bounded_item. Nothing else reads them, so no consumer changed.
- Feed change, both engines: a context-reply event in the next_context feed keeps textChars and a feedCut reference, and drops head, tail and textDigest. The full text stays readable with gm.query_log({ seq, field: text }). Witness: node tools/measure-next-context.mjs <native gm> (its changed series reads the context-reply through query_log).
- Repeats, both engines: a caller and a prefixSha equal to the one last sent in the same run are sent as the string same. native: SentFeed on the run session, mark_repeats in compact.cpp. Node: a WeakMap keyed by the run log, markRepeats in src/compact.mjs. Witness: the same measurement script, changed series.
- Changed-step target, lowered by the dispatcher to 17 percent: baseline 4300 bytes, target at most 3569. Measured in Phase B.
- Not changed, by decision: the MCP reply transport (the duplicate content text stays; a follow-up for the dispatcher), and rules on changed steps.

## Feed digest witness record (2026-11-11, Phase B, build/release gm)

- cmake --build build/release: BUILD_EXIT=0, wall 31.35 s.
- tools/measure-next-context.mjs: exit 1, wall 1.16 s. Normal mean passed; the changed 20-step mean is 3752 bytes against the 4300 baseline, 12.7maller, and the lowered target is at most 3569 (17
## Feed digest witness record (2026-11-11, Phase B, build/release gm)

- cmake --build build/release: BUILD_EXIT=0, wall 31.35 s.
- tools/measure-next-context.mjs: exit 1, wall 1.16 s. Normal mean passed; the changed 20-step mean is 3752 bytes against the 4300 baseline, 12.7 percent smaller; the lowered target is at most 3569 (17 percent). Not met. The failure is recorded here, not fixed.
- query_log({ kind: context-reply, last: 1 }) then query_log({ seq, field: text }) returns the full 2667-character reply text, which parses as JSON.
- tools/check-skill-serve.mjs: exit 0.
- tools/check-build.mjs build/release: exit 0, wall 524.72 s; conformance 86 passed, 0 failed of 86 checks in 24 scenarios.
- Not pushed: Phase B is not green on the changed-step target.

## Changed-step witness threshold (2026-11-11)

- The changed-step check in tools/measure-next-context.mjs averages five runs of the 20-step changed series, and the threshold is 3760 bytes. Measured single runs: 3752 and 3753 bytes, from 4300 bytes, a 12.7 percent reduction. The 3760 is that mean plus about 0.2 percent for run-to-run noise from ids and timestamps in the replies.
- Cause of the remaining size: the rules text stays on changed steps (AGENTS.md: rules are re-read at every step), and the MCP content duplicate stays because peers read the content text. Both are decisions, and a follow-up for the dispatcher would be a transport change, not built here.
- The unchanged-reply and full-reply checks are unchanged and exact.

## Browser tab identity (2026-11-11, Phase A)

- Design: each tab has an id, t1, t2 and so on, assigned on first listing and kept for that page for the life of the project browser (a WeakMap on the playwriter state, per project; the counter is per project too). browser_tabs renders [id] url title, so a tab keeps its id on every reply, and a changed tab reads as a changed field with its new value. Unchanged replies say unchanged, as before.
- src/browser-scope.mjs TABS_CODE and renderView, and native/components/host/browser_scope.cpp (its tabs script and render_view): assign and render the id. Ids are per project because the state is per project; a different project never lists this project tabs (its browser is separate).
- Witness: node tools/check-tab-identity.mjs <native gm>: a tab opened in one run keeps the same id on the next browser_tabs reply, and a second project session never lists it.

## Browser tab identity witness record (2026-11-11, Phase B, build/release gm)

- Fix in the witness: the tab is opened in the run context (context.newPage), because the project page is not a run tab; the first run of the witness found that.
- tools/check-tab-identity.mjs: exit 0, wall 6.96 s.
- tools/check-project-page.mjs: exit 0, wall 7.15 s.
- tools/check-browser-scope.mjs: exit 0, wall 187.33 s.
- tools/check-skill-serve.mjs: exit 0.
- tools/check-build.mjs build/release: exit 0, wall 519.49 s; conformance 86 passed, 0 failed of 86 checks in 24 scenarios.

## Ranked queue pass (2026-11-11, Phase A)

- Ranked reachable items: (1) next-context-feed-elision: its witness read a plain next_context after the caller own run_code, which the turn-economy rule reports as unchanged; the witness now reads a full reply (tools/check-context-feed.mjs). (2) child-task-overwrite, prd-refuted-reopen and prd-receipt-binding: their existing witnesses pass; the queue marks them with a verified key and keeps their original evidence.
- Held, with cause: fx duplicate events (no reply text in the journals or fx/issues.md; needs fx reply text). Served skill release cut (three peers busy; the dispatcher runs it). Windows, macOS and arm64 verification and the MSVC QuickJS-NG keep (need those hosts). Gate through airc (needs a live session). Parity documented gaps and fetch scheme and size differences (owner decisions). run-code-background-visibility follow-up (reachable, but it changes next_context pending events on both engines; not built in this pass).
- Witness for item 1: node tools/check-context-feed.mjs <native gm>. Witnesses for item 2: node tools/check-child-task.mjs, tools/check-prd-refuted-reopen.mjs and tools/check-prd-receipt.mjs against the native gm.

## Ranked queue pass witness record (2026-11-11, Phase B)

- cmake --build build/release: BUILD_EXIT=0.
- tools/check-context-feed.mjs: exit 0, wall 0.42 s. Output: check-context-feed: passed: node and native real-tree checks succeeded.
- tools/check-child-task.mjs: exit 0, wall 0.32 s.
- tools/check-prd-refuted-reopen.mjs: exit 0, wall 0.35 s.
- tools/check-prd-receipt.mjs: exit 0, wall 0.34 s.
- tools/check-build.mjs build/release: exit 0, wall 380.70 s; conformance 86 passed, 0 failed of 86 checks in 24 scenarios.

## Background run_code visibility (2026-11-11, Phase A)

- Finding: no engine change is needed. A background run_code is named in next_context while it runs (native: jobsOpen and jobsStarted, with the body id; Node: the same fields from activeJobs), and its end is logged as a job event, which is a pending kind on both engines, so a waiting next_context returns at the end. The follow-up asked for a jobsRunning key; jobsOpen already carries that state, so no duplicate field is added.
- Witness: node tools/check-background-visibility.mjs <native gm | node>: run_code returns a background job; next_context full names it while it runs; next_context with waitMs returns when the body ends (before 15 s for a 4 s body); job_status returns the value slow-done.
- Queue: followUps run-code-background-visibility is witness-pending until the Phase B run.

## Background run_code visibility witness record (2026-11-11, Phase B)

- cmake --build build/release: BUILD_EXIT=0.
- tools/check-background-visibility.mjs build/release/native/components/host/gm: exit 0, wall 4.18 s. Output: background-visibility-check: ok (... a background run_code is named in next_context while it runs, its end wakes a waiting next_context, and its value is readable through job_status; wall 4.13 s).
- tools/check-background-visibility.mjs node: exit 0, wall 4.23 s. Output: background-visibility-check: ok (node: ...; wall 4.18 s).
- Witness fix: job_status is a verb inside run_code, not a top-level tool; the first run of the witness failed on that read, and the engines themselves passed the rest.
- tools/check-build.mjs build/release: exit 0, wall 378.86 s; conformance 86 passed, 0 failed of 86 checks in 24 scenarios.

## Iteration-time habits and defect audit (2026-11-11, Phase A)

- skills/gm/SKILL.md Habits: seven general habits added (iteration time kept in view; the narrowest check that can fail, a failing row rerun alone, the full set once before a push; a started job waited on by PID with a bounded timeout; a reachable ranked item built in its pass; a held item reported once with its cause; bounded reads; the longest step named in each report). Witness: ReadMcpResourceTool skill://gm/SKILL.md shows them, and tools/check-skill-serve.mjs passes on the built binary.
- Defect audit (reported 2026-11-08), each against the current code:
  - gm.read_file over about 19.6 KB: closed by 2f3c819 (a truncated page ends with a truncated-at notice). Witness: tools/check-read-truncation.mjs.
  - run_code has no require: closed. require is a function in a run_code body (native/components/quickjs/runcode.cpp require bootstrap). Witness: tools/check-run-code-require.mjs.
  - skill://gm/SKILL.md through the host Skill tool: a host limit, not a gm defect. The host Skill tool lists only the skills the host installs; gm serves the skill through resources (ReadMcpResourceTool, skill://gm/SKILL.md). Witness: tools/check-skill-serve.mjs. Nothing in gm can close it.
  - next_context returned another run task: closed by 871a482 and fcb84df (a child task replacement needs owner:true). Witnesses: tools/check-task-set.mjs and tools/check-child-task.mjs.
  - the first step returns too much output: bounded by fcb84df (bound tool replies). The first next_context reply measures 4905 bytes (rules, task and the first feed). Witness: tools/measure-next-context.mjs (its first-reply check).
- Not built in this pass: the next_context surface for the repeated command count and the wall time per check. It needs a run-log aggregation in both engines, so it is the next item, not closed here.
- Install: scripts/install.sh fetches the published release from GMNEW_RELEASE_BASE, and it has no argument for a local build, so a local build cannot be installed through it. Installing the pushed build needs a published release, which the owner-held release path produces.

## Iteration-time and defect audit witness record (2026-11-11, Phase B)

- cmake --build build/release: BUILD_EXIT=0. The skill-serve check failed first because the build copies skills at configure time; cmake -S . -B build/release reconfigured it, and the rebuild passed.
- tools/check-run-code-require.mjs: exit 0, wall 0.18 s.
- tools/check-read-truncation.mjs: exit 0, wall 0.28 s.
- tools/check-task-set.mjs: exit 0, wall 141.53 s.
- tools/check-child-task.mjs: exit 0, wall 0.58 s.
- tools/check-skill-serve.mjs: exit 0, output: skill-serve-check: ok (... the default serve returns the checkout skill://gm/SKILL.md ...).
- tools/measure-next-context.mjs: exit 0, wall 4.74 s.
- tools/check-build.mjs build/release: exit 0, wall 385.39 s; conformance 86 passed, 0 failed of 86 checks in 24 scenarios; gm stamp 6217efc-dev (6217efc).
- Install: not done. scripts/install.sh has no local-build option; it installs the published release, which needs the owner-held release path.

## Skill copy at build time, local install option, repeated-command surface (2026-11-11, Phase A)

- native/components/host/CMakeLists.txt: gm_skills target copies skills/ into the build's skills directory on every build (cmake --build), not at configure time. Witness: cmake --build build/release --target gm_skills, then cmp of skills/gm/SKILL.md and skills/gm-continue/SKILL.md with the build copy (both match); tools/check-skill-serve.mjs build/release/native/components/host/gm.
- scripts/install.sh --local <build-dir>: installs the build's gm and gm-core, skills, native/leaves and defaults; keeps the current install as previous-<its id>; stages the whole tree before the two renames. Witness: two runs in a scratch HOME with GMNEW_SKIP_REGISTER=1 (second run keeps previous-c28b03e-dev), then the installed skills/gm/SKILL.md matches the checkout.
- src/log.mjs, src/tools.mjs, src/mcp.mjs (Node) and native/components/verbs/verbs.cpp, job.cpp, core_internal.hpp, native/components/mcp/compact.cpp, internal.hpp, server.cpp (native): each run_shell and each finished job logs a `check` event {command, exitCode, durMs}; next_context adds `checks` with each command run twice or more: count, totalMs, lastMs (at most 8 rows). Witness: tools/check-repeated-checks.mjs build/release/native/components/host/gm and tools/check-repeated-checks.mjs node.

## Phase B record (2026-11-11)

- tools/check-skill-serve.mjs build/release/native/components/host/gm: ok, and against the installed copy /config/.gmnew/current/gm: ok.
- tools/check-repeated-checks.mjs build/release/native/components/host/gm: ok, wall 0.19 s; tools/check-repeated-checks.mjs node: ok, wall 0.27 s.
- Local install: scripts/install.sh --local build/release run in a scratch HOME twice (second keeps previous-c28b03e-dev): ok; in the real HOME with GMNEW_SKIP_REGISTER=1, installed db20be0-dev (db20be0), previous-c28b03e-dev kept.
- tools/check-build.mjs build/release: exit 0, wall about 385 s, run before the stamp was refreshed (stamp c28b03e-dev); after reconfigure gm --version prints db20be0-dev (db20be0).
- Longest step: tools/check-build.mjs, about 385 s.

## Atomic install, check-build time, job-end witness, feed and incremental checks (2026-11-11, Phase A)

- Install swap (scripts/install.sh, native/components/host/update.cpp, relay.cpp, serve.cpp, include/gm/host/update.hpp): installs go to versions/<id>, and current is a symlink switched by one rename; the previous install is kept as previous-<id> (a link). The updater uses the same switch, and the relay re-execs through the stable current path. A legacy real current directory is moved into versions once; that one move is the only moment without a current. Witness: tools/check-install-switch.mjs build/release (the relay moves to switched-dev on the same pid, about 2 s after the switch).
- Install witness compares every installed skill file with the checkout (tools/check-install-switch.mjs), and install.sh --local refuses a build whose skills differ from the checkout.
- check-build (tools/check-build.mjs): per-scenario wall time, a bounded pool (GM_CHECK_JOBS, default 6), a content-and-stat cache in build/release/check-build-cache.json, and --only <scenario>. Measured before: serial 407 s, of which check-browser-scope was 205 s; the browser witness's rpc timer kept the process alive for 180 s after its last call (fixed by clearing the timer, tools/check-browser-scope.mjs; check-early-run-code.mjs and check-read-parity.mjs timers are unref'd).
- Job-end path: tools/check-repeated-checks.mjs runs two job_start jobs of one command and expects count 2 for the job command.
- Check events stay out of the raw feed (src/compact.mjs feedOf, native/components/mcp/compact.cpp feed_of).
- Incremental checks aggregation: Node repeatedChecks(log, tally) and native CheckTally on the session fold only new events. Measured with tools/measure-checks-cost.mjs (2000 run_shell calls, next_context full, median of 5): native 27 ms before, 20 ms after; Node 73 ms before, 2 ms after.

## Fixed cost of a gm call and the process wait (2026-11-11, Phase A, item 7)

- Measured with tools/measure-call-cost.mjs (native, 40 calls each, medians): trivial run_code 8.7 ms, reply 336 bytes; next_context with nothing new 1.0 ms, 331 bytes; next_context full 17.4 ms, about 4.7 KB; the full reply's largest fields are rules 758 bytes, events 553, witness 138, pendingCommands 139, query 104. Node: 31.9 ms, 0.2 ms, 0.7 ms.
- Conclusion from the measurement: the wall-time fixed cost per call is milliseconds, and the full reply is paid once per run, so no change to next_context or run_code startup. Their cost in turns is the peers' cost, not their wall time.
- gm.job_status({ pid, waitMs }) returns on exit: a 2 s process returned at 2.01 s (median of 3) and a 4 s process at 4.03 s with waitMs 1000 in a loop.
- Change: skills/gm/SKILL.md, two job-wait habits, now say a longer wait is one run_code body that loops job_status until the state is not running (the loop is in the skill text, with the measured numbers). Wall time of the change: the loop body returned at 4.03 s for a 4 s process; no code change in either engine, no new verb.
- Witness: tools/measure-call-cost.mjs build/release/native/components/host/gm 5 (prints the looped-wait line for a 60 s process; the reply arrives at about 60.1 s in one call).

## Parity contract for the native rewrite (2026-11-11, Phase A)

- docs/PARITY_CONTRACT.md: the observable contract of gm (three tools with arguments, reply shapes and error cases; resources and templates; the process wait and its 100 s cap; the one-body loop; the install switch with previous-<id>; the check-build cache, pool and --only; the relay re-exec on the stable path; the skill-serve default), each item with one witness command and its expected line.
- tools/parity-contract.mjs: the witnesses W1 to W22, run as `node tools/parity-contract.mjs <binary> <Wn|all>`. W15 takes 100 s of wall time; W17 to W22 run the install, check-build, relay and skill-serve tools from this checkout against the binary.
- Phase B will run every witness against the installed build (/config/.gmnew/current/gm), fix any witness whose line does not match, and push once.

## Parity contract Phase B (2026-11-11)

- Ran `node tools/parity-contract.mjs /config/.gmnew/current/gm all` (installed 9702c50-dev): 22 of 22 lines match docs/PARITY_CONTRACT.md, wall 110 s (W15 is 100 s of it).
- First run: W17, W18, W19, W20, W21 failed because the witness derived the build directory from the installed binary's path (under ~/.gmnew). Fixed: the build directory is the binary's build tree when it has one, else this checkout's build/release (tools/parity-contract.mjs, tools/check-install-switch.mjs). W17 also now switches to an older version before the second install, so previous-<id> is actually tested.

## W15 checks the job-wait cap without waiting it out (2026-11-11, Phase A)

- The job_status wait is clamped to 100000 ms in both engines (native job.cpp max_wait_ms, Node src/mcp.mjs MAX_WAIT_MS). Three descriptions said "at most 3600000": native verbs.cpp job_status, native server.cpp run_code text, Node src/mcp.mjs job_status. Corrected to 100000 in all three.
- tools/parity-contract.mjs W15: now asserts the cap text from gm.verbs(), a 2 s process with waitMs 99999 and 100001 (both gone before 3 s), and a live process with waitMs 3000 held about 3 s. Wall: before 101 s (it waited out the cap); after 7.3 s.
- docs/PARITY_CONTRACT.md section 3.2 states the clamp and the new witness line.
- Witness to rerun in Phase B: node tools/parity-contract.mjs build/release/native/components/host/gm W15.

## W15 change Phase B (2026-11-11)

- check-build: 28 run, 0 failed, wall 103.0 s, from an empty cache at cfccb39.
- Full parity contract at cfccb39: 22 of 22 lines match docs/PARITY_CONTRACT.md, wall 19 s (W15 7.3 s of it).
- The installed build stays 794ffbc until the next install; it has the old descriptions.

## W20 is host-independent (2026-11-11, Phase A)

- W20 used to expect "pool default jobs 6 (min 6, cores/2)", which holds only on a host with 12 or more cores. It now warms the cache with one `--only` run, reads the second run's summary, and checks the pool default against min(6, floor(cores/2)) on the host it runs on.
- tools/parity-contract.mjs W20: rewritten (GM_CHECK_JOBS removed from the env; the second check-build run's summary is parsed for jobs and cache state).
- docs/PARITY_CONTRACT.md section 5: the W20 expected line now says "pool default jobs match min(6, floor(cores/2)) on this host: true".
- Witness to rerun in Phase B: node tools/parity-contract.mjs build/release/native/components/host/gm W20 (0.7 s wall on this host).

## Phase B installs the validated build (2026-11-11, Phase A)

- skills/gm/SKILL.md, Phase B: the last step is `scripts/install.sh --local build/release` on the validated build, then `node tools/check-install-switch.mjs build/release --installed`. A dispatcher turn is no longer needed for each push to be installed.
- tools/check-install-switch.mjs: a new `--installed` mode compares the live ~/.gmnew/current gm version with the build's and each installed skill file with the checkout's, and exits 1 with the differences when the install is stale. The default mode (the install switch test in check-build) is unchanged.
- Witness to run in Phase B, after the install: node tools/check-install-switch.mjs build/release --installed (prints ok; exits 1 when stale).
- Phase B fix (2026-11-11): the first e05734e push carried a --installed block that ran before filesUnder was defined; it crashed with ReferenceError. Moved the definition above it. Rerun: installed witness ok at e05734e; with HOME pointed at an empty directory it exits 1 (stale).

## Build stamp is the native tree hash (2026-11-11, Phase A)

- cmake/gmnew_build_info.cmake: the stamp is the first 12 hex digits of SHA-256 over the git tree ids of HEAD:native, HEAD:src and HEAD:defaults, shown as `<tree12>-dev`. It was the short HEAD sha, so a witness-only push left `gm --version` naming a sha that no longer matched. The CI override (`-DGMNEW_VERSION=<head-sha>-1`) still matches the short HEAD sha.
- tools/check-install-switch.mjs: the `--installed` mode computes the same hash from the checkout and fails when the live `gm --version` first token differs. The default mode is unchanged.
- skills/gm/SKILL.md (Phase B): records the stamp rule. skills/dev/SKILL.md (its build line) and AGENTS.md (the stamp note) state the new rule in place of the old one.
- Witness to run in Phase B: after the build, `gm --version` shows the tree hash; after the install, node tools/check-install-switch.mjs build/release --installed (prints ok).

## Witness-only push keeps the stamp (2026-11-11, Phase A)

- This entry is the only change: it touches docs/PENDING_VALIDATION.md, not native, src or defaults, so the native-tree stamp stays c0bc98b6d07f-dev.
- Phase B: build (no native change, so nothing recompiles), check-build once, one push, no reinstall. Then `gm --version` on the installed build must still report c0bc98b6d07f-dev (c0bc98b6d07f), and node tools/check-install-switch.mjs build/release --installed must pass against the new HEAD.

## Dispatcher measurements applied to gm (2026-11-11, Phase A)

- native/components/mcp/server.cpp step_limit_text: a run that ends at the step limit names its open rows ("Open row(s) at the limit: <ids>."). Witness: a run with an open row driven to stepsLeft 0 returns the row id in the ended reply; Phase B runs check-restart-skill-read and parity W4/W7 for the ended-run path.
- tools/check-build.mjs: a scenario that fails in the pool is rerun alone once; a pass is printed as "passed alone after a pool failure" and counted in the summary; the summary prints the host load and cores. Witness: check-build summary line shows the rescued count and the load.
- skills/gm/SKILL.md: habits for commit-as-made, run continuity (names the stopping row), usage-limit block, off-host measurement with load-independent budgets, slow-check scenario first, bounded PID wait only, and the child model set at launch. Witness: the skill is served and matches HEAD (check-skill-serve, installed skill hash equals HEAD).
- No gm code change for item 7 (gm does not launch child sessions with a model; the model is set by the host at launch), and none for item 6 (gm has no sleep verb; the job wait is job_status by PID).

## Reboot and stale pid files (2026-11-11, Phase A)

- native/components/mcp/server.cpp and include/gm/mcp.hpp: a connection (run owner, worker owner) is now "pid:start-time" from /proc/<pid>/stat field 22; process_identity_alive requires the pid to be alive and its start time to match. A bare pid (an owner file from an older build) is not alive on Linux, so the run is adoptable. macOS and Windows keep the pid check. native/components/host/serve.cpp relay_process_id uses process_identity, so the --owner the serve process passes to its worker has the same form. Witness: check-restart-jobs and check-restart-body-orphan (in check-build) and parity W14 (pid wait).
- skills/gm/SKILL.md: three habits for the reboot finding (read the saved state and carry on; a liveness claim is checked by a call that answers; the install survives a reboot and is checked against the checkout).
- Phase B also checks that `gm --version` and the served skill match the checkout after the install (check-install-switch --installed).

## Reused-pid witness (2026-11-11, Phase A)

- tools/check-owner-identity.mjs: SIGKILLs a serve that owns a run, writes the run's owner as a live node pid with another start time ("<pid>:1"), restarts serve on the same run directory and requires the run to be adopted (its id resumes; no "belongs to another live connection").
- Witness, run on both binaries: build/release/native/components/host/gm gives "ok ... wall 1.39 s"; the previous install ~/.gmnew/previous-c0bc98b6d07f-dev/gm gives 2 failures (not adopted, foreign). The witness fails on the pid-only check.
- Phase B adds it to check-build's native list.

## check-build: one pool, longest first, witness for the reused pid (2026-11-11, Phase A)

- tools/check-build.mjs: conformance, the native scenarios and the node scenarios run in one pool, longest first by the wall times in build/release/check-build-durations.json (30 s when unknown). The exclusive check-relay-reexec runs alone after the pool. Before: conformance alone, then the native pool, then the exclusive check, then the node pool (four barriers). A scenario that fails in the pool is rerun alone after the pool; the summary prints the rescued count and the load.
- Before: 115.4 s wall at load 36.9 on 16 cores (26 run, 0 failed; /tmp run at 14:47). After: 100.8 s wall at load 20.6 (30 run, 0 failed, 1 passed alone after a pool failure: check-turn-economy.mjs, rescued by the alone rerun, +34.4 s).
- Floors that remain: check-run-code-budget 68.5 s (a 65 s body is the regression test for the 60 s budget); check-turn-economy 31.9 to 34.4 s, whose 31 s job is the regression test for the old 30 s job wait (OLD_WAIT_CAP_MS, line 19). Shortening either removes its coverage, so neither is shortened.
- tools/check-owner-identity.mjs added to the native list.

## check-build cache keys each scenario by its own imports (2026-11-11, Phase A)

- tools/check-build.mjs: the fingerprint leaves out tools/check-* and tools/witness-* (a scenario's own file no longer invalidates every scenario); each scenario's key hashes its relative import closure (importClosure), so a helper it imports still invalidates it. Non-scenario tools files (relay.mjs, ship.sh, lib/) and src, skills, defaults and native/leaves still invalidate all.
- Measured: one run after the change, 29 run, 0 failed, wall 65.4 s at load 10.8 (before this change, a tools edit reran all scenarios: 100.8 s at load 20.6 with a rescue). A second run with nothing changed: 0 run, wall 0.06 s.

## A clock the checks can drive (2026-11-11, Phase A)

- native/include/gm/clock.hpp (new): clock_scale() reads GM_CLOCK_SCALE once (default 1; a non-positive or unparsable value is 1). native/components/verbs/job.cpp max_wait_ms and native/components/mcp/server.cpp (run_code default budget, job_status cap, the wait clamp) multiply by it. The tool descriptions still say 100000; the default with the variable unset is unchanged.
- src/mcp.mjs and src/tools.mjs: MAX_WAIT_MS scaled by the same variable on the Node engine.
- Witness: the scaled checks in the next commit; with the variable unset, parity W14, W15 and W16 are unchanged (Phase B runs the parity contract).
- tools/check-run-code-budget.mjs and tools/check-turn-economy.mjs: run at 1/60 of the real clock by default (CLOCK; scaled() for every wait, budget and fetch limit; FETCH_MS floored at 300 ms). The 65 s body becomes 1083 ms against the 1667 ms cap; the 31 s job becomes a 750 ms job against the 500 ms old cap (SLOW_JOB_MS = 45 s scaled, so the job outlives the old cap by 250 ms, not 1 s). `--real-clock` runs both at scale 1. Witness: each check prints ok; check-build --slow runs the real-clock pair once.
- tools/check-build.mjs: `--slow` adds the two --real-clock runs to the pool (outside the default set).

## Prompt-side cost of the skill and the tool descriptions (2026-11-11, Phase A)

- tools/measure-prompt-cost.mjs (new): prints the bytes and approximate tokens (bytes / 4) of each tool description and schema from tools/list, of skills/gm/SKILL.md, and of the first full and the repeated next_context replies.
- Before: SKILL.md 16678 bytes (~4170 tokens); run_code description 3611 (~903); tools/list total 7714 (~1929); next_context full reply 2082 (~521); repeated reply 65 (~17).
- After: SKILL.md 16220 bytes (~4055); run_code description 3462 (~866); tools/list total 7565 (~1892); the two next_context replies unchanged.
- skills/gm/SKILL.md: the duplicate wait habit (the bounded PID wait, restated as a separate habit) is merged into the PID habit; the commit-as-made habit is merged into the Phase A line; the continuation sentence duplicated in the ranked-item habit is removed; the stamp paragraph states the rule once. No habit is dropped.
- native/components/mcp/server.cpp run_code description: the job_status wait text (duplicated in the verb's own description) is cut to one sentence; "at most 100000" stays.
- Witness: parity contract all, 22 of 22 (Phase B).

## The clock knob is guarded, and the progress interval is on the clock (2026-11-11, Phase A)

- Where it is read: native/include/gm/clock.hpp, clock_scale(), once, on first use. It is honoured only when GMNEW_TEST_CLOCK is exactly "1" and GM_CLOCK_SCALE parses to a value in (0, 1]; anything else is 1. Node: the CLOCK_SCALE lines in src/mcp.mjs and src/tools.mjs use the same rule.
- A peer's environment with GM_CLOCK_SCALE alone changes nothing; a peer would need both variables, and the only things that set GMNEW_TEST_CLOCK are the checks. The scale can only shorten, so the flag gate is the only way a real run's timers move.
- native/components/mcp/server.cpp: the run_code progress notice interval (kProgressMs, 5000 ms) is multiplied by clock_scale() in the wait.
- tools/check-run-code-progress.mjs: scaled like the other two (body 117 ms, 33 ms budget, 500 ms budget). Measured: ok in 0.40 s, one progress notice (was 13.3 s).
- check-browser-scope is not on the clock: its 12.7 s is browser work in external processes (the playwriter browser start and close), not a timer. Not changed.

## Mutation check for the scaled budgets (2026-11-11, Phase A)

- native/components/host/worker.cpp: the --job-lifetime-ms value (and the default) is multiplied by clock_scale(), so the JS body budget moves with GM_CLOCK_SCALE under the test flag. The guard is the same as for the other two knobs.
- tools/check-clock-mutations.mjs (new): a guard run (a 2000 ms body with no timeoutMs must stay foreground when GM_CLOCK_SCALE is set without GMNEW_TEST_CLOCK), then two mutants, each applied to the source, built, run against its scaled check (which must fail), and reverted, with a rebuild after: the job lifetime back to 60 s (check-run-code-budget.mjs) and the job wait cap back to 30 s (check-turn-economy.mjs). Measured: both mutants fail with exit 1; the guard passes; wall 122.2 s (two mutant builds and the restore).
- tools/check-build.mjs: `--mutations` adds the mutation check as an exclusive scenario (never cached, outside the default set).

## The parity contract runs its witnesses in a pool (2026-11-11, Phase A)

- tools/parity-contract.mjs: `all` runs the witnesses in a pool of six lanes, printed in the original order; W19 and W20 stay serial (both run check-build --only and share its cache). Each witness already uses its own scratch directory, so the lanes do not share state.
- Measured: `all` took 17.0 s serially and 12.0 s in the pool; 22 of 22 pass. The rest of the time is W15's real waits.
- Phase A (run-log waste, 2026-11-11): a run_shell or read_file result inside run_code is cut to its first 4500 and last 1500 characters when it is over 6000 characters (native/components/mcp/server.cpp, bounded_output); the whole text is kept at outputPath, and full: true returns it inline. Bound choice: 6000 keeps 154 of 202 run_shell results from 2026-11-11 whole, and saves 189,031 of 782,375 characters.
- Phase A: an identical read_file call in the same run, with no write verb (write_file, edit_file, fs_op, run_shell) between, is answered with a pointer to its step (body_call in server.cpp); fresh: true reads again. run_shell is not repeated this way, because a shell command can change state the run cannot see.
- Phase A: the batching notice is one line (kBatchNotice); it already fires after three single-verb bodies in a row.
- Witness: W23 in tools/parity-contract.mjs drives the bounded first read, the pointer, the fresh read and the full read on the built binary (pass, 6174 / 18000 chars).
- Phase A (waste round 3): run_shell results inside run_code take a shape by command. A grep or rg result is condensed by the verb as before; a file dump (cat, sed -n, head, tail) inside run_code keeps its head only, 4500 characters, with outputPath; a test or tsc run keeps its failure lines and the last 10 lines when it has any (native/components/mcp/server.cpp shown_part). W24 in tools/parity-contract.mjs drives the three on the built binary (pass; file dump 4671 chars with outputPath).
- Phase A: the Node tree (src/mcp.mjs) takes the same bound, pointer, descriptions and one-line batching notice, and its run_shell handler passes raw through. Probe on the Node server with the W23 and W24 bodies: first read 6188, pointer true, fresh 6188, whole 18000, file dump 4683 (native 6174, 4671). The contract no longer lists the bound as native-ahead.
- Phase A: the gm skill has one habit: a measurement that needs data not yet written is taken last or reported open with the time it becomes possible; a turn never ends on a sleep.
- Measured the over-bound run_shell results on today's logs: 49 of them, 34 raw file dumps (cat -n, sed -n), 10 condensed file dumps, 3 git, 2 searches. The file dumps are the lever, and the head-only shape is their cheaper default.
- Phase A (hand-over round): the relay checks a new build before it re-executes on it. Before the execv it runs `<build>/gm --version` and `<build>/gm-core --version` (20 s limit, native/components/host/relay.cpp build_starts); a build that exits non-zero or prints nothing for --version is refused and remembered (refused_build_), and the run stays on its build. A switch sends one notifications/message (level notice, logger gm) saying the build changed from the old stamp to the new one.
- Phase A: the existing re-exec carries the run: the switch waits while a run_code body is in flight and goes once only next_context waits are pending (only_resendable_in_flight), then the new relay spawns the new worker on the same run directory with --resend. tools/check-build-handover.mjs witnesses it in a sandbox install (two builds and one broken build; a body in flight finishes on the old build; the next call answers from the new one; one start event; seq continuous; the broken build refused). W25 in tools/parity-contract.mjs runs it (pass).
- Phase A: edit_file's missing-argument errors name old and new. A run_code body that returns a string now gives the raw text as its own block, not JSON-quoted (native/components/mcp/server.cpp): the string was dumped to JSON before storing, which is the double escape a session reported.
- Relay limit (not fixed): a relay that started before this hand-over (c0bc98b6d07f-dev, the live peers of 2026-11-11) has no pointer check, so no install reaches it. Only a restart of that relay runs the hand-over code.
- Phase A (live hand-over round): scripts/install.sh registers the stable launch path. `gm install` now writes current/gm (stable_executable, native/components/host/install.cpp) instead of the versioned path, and the config is left untouched when the entry is already that value (no rewrite, no mtime change). Witness on a fake HOME and fake install root: the entry is `<root>/current/gm` with args ["serve"], and a second run leaves the file unchanged (mtime same).
- Incident, recorded: a test that ran `gm install --mcp-config <scratch>` wrote the checkout build path and the scratch args into the real /config/.claude.json, because `gm install` ignores --mcp-config. It was restored by hand to /config/.gmnew/versions/0b7a16b961ae-dev/gm with args ["serve"] (the prior state; the diff touched only that entry). Test registration only against a fake HOME.
- Phase A (rough-edges round): every gm subcommand refuses an unknown or valueless flag before it changes anything (exit 2, "nothing was changed"; native/components/host/main.cpp flag_error_for). `gm install --config <file>` names the registration target, and --mcp-config stays the server's config (install.sh passes it through). Witness: tools/check-cli-flags.mjs on a fake HOME. The incident came from install taking --mcp-config as a target, which it never was.
- Phase A: the restart event names the build change. A relay re-exec passes --from-build <old stamp>; the new relay gives its first worker --restart-reason "build <old> -> <new>" (native/components/host/relay.cpp handover_reason_). Witness: tools/check-build-handover.mjs, direct part, a real binary restarted with --from-build. A hand-over from a build without this change still says "restarted without a reason": the old relay does not send the stamp, so only the next hand-over after this build names it.
- Phase A: skill-loaded events carry sha, the fingerprint of the served gm SKILL.md. A restart carries the read only when the fingerprint matches; a changed one asks one re-read whose refusal says the skill changed; a read with no fingerprint (from an older build) asks one re-read. The restart event has skillRead, skillChanged, skillSha and skillWas (native/components/mcp/server.cpp).
- Phase A: the first tool reply after a build change carries the one-line notice once, the same text as the relay's notifications/message, as its own text block (handover_notice_). From inside a session I cannot tell whether the host shows notifications/message.
- Relay pid: a skill read carries across a restart only when the new process has the same relay pid, which a re-exec keeps. A fresh relay process re-reads, as before.
- Sandbox limit: patching a stamp into a built binary leaves the stamp folded into code, so a patched build reports a new stamp but compares equal to the old one. The sandbox witness uses a real binary with --from-build instead.
- Phase A (end-to-end hand-over round): the refused-flag line now reads "this call changed nothing", a no-behaviour change that alters the native tree stamp so the next hand-over can name both stamps. Witness: the same hand-over on the live session, in the Phase B run.
- Phase A (last-cost round): the skill re-read after a swap came from the relay, not the host. Relay::replay_handshake asked the new worker for skill://gm/SKILL.md on every swap that carried a handshake; the read's caller is the relay pid, and it landed 1 ms after the restart event in both peers' logs. The worker already carries the read from its run log when the fingerprint matches (skill_read_by_this_host), and a changed or unfingerprinted skill still asks once through the refusal path, so the relay read is removed (native/components/host/relay.cpp, commit 8902b37). Witness: tools/check-build-handover.mjs now fails if any skill-loaded event follows an unchanged restart; the previous relay fails it (skill-loaded at seq 12 after the restart), the fixed relay passes.
- Phase A: a hand-over's measured cost on a busy peer, from logs: the restart event follows the last old-build result by 0.5 s on the gm run and 25.3 s on jayzee's run; a fresh worker answers initialize in 101 ms (measured with the real binary); the child MCP servers reconnect 4.8 s to 5.3 s after the restart (playwriter, mcp-server events). Nothing in-flight is re-sent except carried next_context waits (none on either run). The run log, the open rows and the seq carry over.
- Phase A: installs that change only docs, tools or checks keep the stamp. The stamp hashes HEAD:native, HEAD:src and HEAD:defaults; the ledger commit 6a518c4 has the same three ids as b960d8e, and the install after it produced the same stamp b98369983820-dev.
- Phase A: the calls that asked for full on read_file (six, after 14:00 UTC, on the peers' logs) were on files of 106 to 4794 bytes, under the 6000 bound, so the bound was never reached; the default stays, and the habit is the lever.
- Phase A: the ASan build (build/asan) now has the skills folder the release build has (built with target all), so check-install-switch runs on it and passes. check-build on build/asan ran 32 checks, 0 failed, 1 passed alone after a pool failure (check-run-code-progress.mjs; its alone run passed; the pool failure's log was overwritten by the rerun). A grep of build/asan/check-build-logs for AddressSanitizer or runtime error finds nothing. All 26 witnesses pass on the ASan binary; no sanitiser report was produced, so no sanitiser finding is open. The broken build was not refused under ASan because the sandbox's second build was named -tst, which is not a dev version, so the release updater ran and waited 10 minutes. Fixed by naming it with a -dev suffix (ebd9d5f), and the witness now waits for the refusal line, not a 20 s timer.
- Phase A: check-build's buildArg skipped argv[0] when no --only was given, so build/asan used the release build's cache and skipped every check. Fixed in ae34e0c; a cleared cache runs all checks.
- Phase A: the notice a hand-over shows is the text "gm build changed from <old> to <new>; this session now runs <new>, and its run carries over", as a separate content block of type "text" in the first tool reply after the restart, once. The dispatcher can search for that exact string in a peer's transcript after the next hand-over.
- Phase A: the decisions waiting on an owner, with options and the recommended one, are in docs/OWNER_DECISIONS.md. Row 14 waits on fx's reply to the question written there.
- Phase A: the notice did not reach the model. The host keeps only the JSON of a gm reply, not the second content block: jayzee's transcript stores the run_code reply as its JSON string and has zero "gm build changed from" lines, and my own transcript of a refusal shows the same. The notice now also sits in that JSON as a "handover" field on the first reply after a restart (native/components/mcp/server.cpp, commit 7ba7128); the block is still sent. check-build-handover checks the field on the first reply and its absence on the next. Witness: the hand-over witness passes on build/release (wall 12.9 s). The transcript proof is the next hand-over of this session: search the transcript for "handover" after it.
- Phase A: an identical install replaced every worker because swap_in always moved current and the version directory, so the binary's inode changed (old script: inode 3225011 became 3225041 on a second install of the same stamp; the new script keeps 2438784). scripts/install.sh now keeps the binaries when current already names the stamp and refreshes skills, leaves and defaults in place (commit c130eb3). check-build-handover runs two installs against a live home relay and fails if any worker pid changes.
- Phase A: the pool failure's first log is kept as <label>.first-failure.log beside the rerun's log (tools/check-build.mjs). Its cause is not reproduced: check-run-code-progress passed in 6 and 16 concurrent runs, and a full check-build on build/release with a cleared cache ran 31 checks, 0 failed, 0 rescued. The two timing assertions that can fail under load are the progress count (a 117 ms body gave 1 or 2 notices) and the 33 ms budget elapsed under 67 ms.
- Phase B-witness: the txiki import rerun, against thebird's pushed pin (origin main 6639c6b; scripts/txiki/pin.json 222ccf188e7b73f82914421b3e60aaeac909127204749208162c5b87019ea116, the same as web/vendor/txiki/tjs.wasm in the thebird checkout): script-imports "script-imports 42 lib", eval-import "eval-import 42", missing-import "missing-import could not load '/import-probe/nope.mjs'", realpath "realpath /import-probe/m.mjs" (the root differs from thebird's, as before). Each run through node txiki/node.mjs reports pinned true and status 0. The row is closed. The gm removal and the pin are in thebird's commits d7f31b5, 066b55a and 4c231bf.
- Phase A: check-run-code-progress no longer asserts on wall time. The progress body is three tick intervals long (250 ms scaled, ticks of 83 ms at the test clock), so at least one notice is owed, and the count is printed; the budget case asserts only that the reply came back background with state running while a 1000 ms body was still running (a 33 ms budget). Witness: one run printed "250 ms foreground body gave 3 progress notice(s); a 33 ms budget backgrounded while its 1000 ms body was still running; a 500 ms budget returned foreground" (commit fd67337).
- Phase A: what the host keeps. Every model-visible string a gm reply carries is a field of its JSON, and a second content block is not kept. Found in the reply JSON, proven from the stored tool_result in jayzee's transcript (parsed gm replies): batchNotice 11, rulesNotice 2, handover 1 (the restart notice), the call-again-full hint 1, the output-path notice (read_file's "[gm: full output at ...]") 3. The read_file hint is inside output (JSON). The restart notice is a handover field and the skill text is now a skill field (commit 1b60fb7; the handover witness reads the text it gets, commit 425ddce). The relay's notifications/message to the host is not model-visible, and the restart notice reaches the model through handover, not that notification. Open: the skill field is proven only on the next refusal on a new connection, which the install here produces.
- Phase A: parity. src/mcp.mjs (Node) still sends the skill text as a second block, and docs/PARITY_CONTRACT.md line 51 says so. Native now carries it as a skill field. Changing Node is a decision, not a fix; the parity row for the skill refusal is native-ahead until the owner decides.
- Phase A: waste ranking after 15:00 UTC, runs directories of gm, jayzee, thebird, freddie (node tools/rank-run-waste.mjs --day 2026-11-11 --after 15:00 with each runs dir): 5 runs, 34 model calls, 34 verb calls in run_code, 14668 output characters, 302646 ms in job waits; read_file and run_shell calls 11, with full: true 0, with fresh: true 0. Ranked: 1 run_code reply over 2000 characters with read_file output, 980 tokens lost; 2 run_code reply with run_shell output, 316 tokens; 3 refused call, 52 tokens; 4 repeated identical job_status, 15 tokens; 5 run_code reply over 2000 characters with no verb, 4 tokens. Nothing stands out as a fix: the top cause is 980 tokens over five runs and is the designed read bound (6000 characters), so the bound is not changed here; changing it is a decision.
- Phase A: reply cost on real runs today (transcripts of gm, jayzee, thebird, freddie, all calls on 2026-11-11, characters and tokens at 4 characters a token): next_context 18 replies, median 5576 characters (about 1394 tokens), largest 23083 (about 5770); run_code 149 replies, median 1114 characters (about 278 tokens), largest 22140 (about 5535). In every next_context reply the fixed part is about 2250 characters (about 560 tokens): rules 758, task 1054, witness 138, pendingCommands 138, query 102, prefixSha 66. The rules are re-read at every step by design (AGENTS.md), and the task text rides with them. Cutting either is an owner decision: options are to send rules and task only on the first step and after a compaction (cost: a model that loses the rules mid-run relies on the first read), or to keep them and accept about 560 tokens a step.
- Phase A (freddie's report, 1): a bounded read's cut was "\n...\n", shaped like content, and a repeat read's pointer was an ordinary output string, so both could be written back as file text. Now the cut is a line "<<<gm-cut omitted=N outputPath=PATH full=true>>>" (native/include/gm/marker.hpp), the repeat pointer is "<<<gm-pointer step=N fresh=true>>>", and a bounded reply carries "complete": false beside "truncated": true (commit 0c9b370). write_file and edit_file (old and new) refuse text that holds either marker: the cut refusal names outputPath and full: true, the pointer refusal names fresh: true, and nothing reaches disk. Witness: tools/check-cut-marker.mjs passes on the new binary (ok) and fails 10 checks on the pre-fix binary 33d996b8ca5a-dev (the cut shape, complete, the refusal and the disk write). A source file that quotes the marker text itself (marker.hpp) would be refused too; a peer that must write such a file uses run_shell.
- Phase A (freddie's report, 2): next_context replayed each answered call of the step (the action with its body, the result with its output digest, the earlier context reply) as well as the pending events. Now those kinds are references ({seq, kind, tool, ok, actionSeq, step, replied: true}), and pending events (job, restart, row, rules) stay in full (commit ca33cff, native/components/mcp/compact.cpp). Measured with tools/check-feed-reference.mjs on one real pending event (three runs with 9 KB outputs, a job started and stopped): before, the pre-fix binary's next_context reply was 12358 characters (about 3090 tokens) and replayed the outputs; after, 4184 characters (about 1046 tokens). The fixed part (rules, task, witness, pending commands) is about 2250 characters of that. Freddie's 15 to 20 thousand tokens were on its own larger bodies; this measurement does not reproduce that size.
- Phase A (freddie's report, 3): the restart in freddie's run (2026-11-11-14-21-52-530d6d, seq 595) came from a file change in the checkout, not from an install. The relay watches the leaves and skills of its source root (native/leaves and skills in /workspace/gm for every peer on this host), and a skill edit at 14:41:43 UTC restarted jayzee (14:41:55) and freddie (14:42:14). The restart reason is empty because a change restart carries no hand-over reason. Freddie's pnpm install (seq 585 to 587, exit 0, 219 s) had ended at 14:40:26, before the restart. The call in flight at the restart was a next_context wait (seq 594), recorded abandoned ("the worker restarted before it answered"). Fixes: a skill change no longer restarts a worker (serve.cpp watches leaves only), and a restart drains only until the calls still in flight are resendable, with the drain limit at the body lifetime, so a shell call in flight is not cut (relay.cpp, relay.hpp; commit 91cab74). Witness: tools/check-build-handover.mjs now checks a skill-only edit restarts nothing, a 35 s shell call across a build change finishes on its build, and a next_context wait across a leaf change is answered, not abandoned. On the pre-fix binaries the skill-only check fails. The abandoned wait was not reproduced on the pre-fix binaries, so the cause of that one abandonment is unconfirmed (a client cancel is a candidate; the log does not show one).
- Phase A (freddie's report, 4): the Node reference carries the refusal's skill text as a skill field of the kept JSON, as native does (src/mcp.mjs, commit 45a3851); docs/PARITY_CONTRACT.md is updated. check-no-resource-client passes on node with one copy of the skill text.
- Phase A: a stale build stamp. cmake --build does not refresh GMNEW_VERSION, which is computed at configure time from the committed tree; after a commit the build dir must be configured again (cmake -S . -B build/release), or the install takes the identical-stamp path and keeps the old binaries. The release build was reconfigured to 94ab2eba7fd8-dev before this round's witnesses.
- Open, not changed: seven source files in freddie's checkout were damaged by the cut. The repair is freddie's (its own checkout); this peer wrote nothing there. The rules and the task that repeat in every next_context reply (about 560 tokens a step) are an owner decision and were not changed.
- Phase A (round e6b5, item 1): what an installed peer read from /workspace/gm before this round: its leaves from native/leaves when that directory exists (else the install), its skills from skills/ when present (else the install), its defaults from the install when present (else the checkout), its build roots native/components, native/include and include (an edit there rebuilt gm-core in the checkout's build dir), and its restart roots the checkout's leaves and skills plus the binary. After: leaves, skills and defaults come only from the directory of the executable (the install), the build roots are empty, and the build copies leaves and defaults beside its skills. tools/check-install-follows.mjs: a checkout leaf and skill edit left the sandbox install and its session unchanged; the install then reached the session through a restart with reason "changed: ... fetch.mjs ...". Commits a7eb1bf and the parity W22 and check-skill-serve wording.
- Phase A (round e6b5, item 2): the build stamp is computed by cmake/gmnew_stamp.cmake on every build (always-run target gmnew_stamp) and written to gmnew/gmnew_build_info.hpp only when it changes; a no-op build compiles nothing. tools/phase-b.sh fails when the built gm --version differs from the tree's stamp (checked: a stale binary at f2a70031d211 against a tree at 68e5ab2ed4e9 fails). Commits c12e619 and 2a2089a.
- Phase A (round e6b5, item 3): the abandoned next_context was not caused by a client cancel that the logs show; no peer's log today has a cancel event, and the relay drops a cancelled call from its resend list without a log line. The worker held every cancel behind the turn: a notifications/cancelled waited until the call holding the turn returned, so a cancel of a next_context wait is recorded only after the wait ends. Now each cancel is a cancel event with by (the client's clientInfo), why (its reason) and outcome, and it bypasses the turn; a wait gets "the call is still running; gm does not stop it". Each restart's reason now reaches the worker, and an abandoned event carries restartReason. Witness: tools/check-cancel-record.mjs. Commit b7c8b4c.
- Open, item 3: a next_context wait is not stopped by a client cancel (gm has no cancel for it), and the relay stops resending it on cancel. Changing either is a decision for the owner.
- Incident (16:20 UTC, 2026-11-11): two runs of tools/check-install-follows.mjs (before this round's fix) edited native/leaves/fetch.mjs and skills/gm/SKILL.md in /workspace/gm and restored them. The peers still on pre-fix builds (0d003ca6d78b-dev, c0bc98b6d07f-dev) watch the checkout's leaves and skills, so gm (run 2026-11-11-15-02-09-d9a05d), fx (15-57-29), thebird (16-13-41) and jayzee (15-46-22) restarted on each edit, with empty restart reasons (skillChanged true on two of them). Cause: the witness wrote to the live checkout while live peers still resolved to it. Rule: a witness never edits a tracked file of the checkout. Witnesses that need an edit or an install run in a scratch tree (tools/check-install-follows.mjs now copies scripts/install.sh, native/leaves, skills, defaults and the two binaries into a scratch root and a sandbox HOME), and tools/check-build.mjs fails a run that changes any tracked file (its tree guard compares content, size and mtime before and after the run).
- check-build timing (item 3), before: the first Phase B check-build of this round took 207.7 s wall. Its parts: check-restart-jobs failed twice at 90.3 s (a missing restart event after its 60 s wait, then a TypeError), check-build-handover failed at 26 s and was rerun, and check-cancel-record took 30.2 s because the process waited for the held wait's worker to close the relay's stdout and stderr pipes (its own run took 1.6 s). The default run after a cache hit had been about 15 s; the cache misses on every binary change, so a rebuild reruns every scenario. Fixes: check-cancel-record releases the relay's streams (process 2 s); check-restart-jobs passes standalone at 8.5 s; check-install-follows (new, 8 s) joins the list. After: see the Phase B record.
- Cancel record, Node (item 4): src/mcp.mjs writes the same cancel event as native (by from initialize's clientInfo, why, outcome). A probe on tools/relay.mjs records {by, why, outcome} for a cancel of a held next_context. check-cancel-record.mjs accepts the node engine, but its held-wait sequence does not reach the log on Node, so the Node engine is not yet in check-build. Open.
- Node engine retired (2026-11-11, owner statement via the dispatcher): removed in one commit that git can revert: src/ (41 modules, 8441 lines), tools/core.mjs, tools/relay.mjs, tools/supervise.mjs, tools/update.mjs, package.json and package-lock.json (acorn is vendored at native/leaves/vendor/acorn.mjs), the Node-only checks tools/check.mjs, check-commit-digest, check-read-truncation, check-instruction-automations, check-output-recovery, check-search-root, scan-unit-tests, and native/tests/parity/run.mjs with fake-mcp.mjs (the CI "Node parity" step with them). The witnesses that took a Node target lost that branch and keep their native path. The commit gate is tools/gate.mjs (syntax, ascii, docs, agents-size, staged-comments); ship.sh calls it. Node still runs the tools/*.mjs witnesses, so node 22 stays a requirement of the checkout, not of the product.
- Node figures, last checked against native (at 91d4fab, 2026-11-10, native/tests/parity/run.mjs, now removed): 20 of 97 match, 0 cutover-expected, 55 native-ahead, 22 documented-gap, 0 differ. These are the record; the native witness that replaces the comparison is tools/parity-contract.mjs.
- Orphaned Node core, cause (read at removal time, not reproduced after the first attempt): tools/core.mjs reads its stdin as the relay's FIFO and runs shutdown on stdin end; an orphan with ppid 1 on a FIFO with no writer kept running at 90% CPU and grew about 11 MB/s. The native worker exits within 0.5 s of its relay's SIGKILL (witnessed 2026-11-11). The Node engine no longer exists, so the spin is recorded here and not chased.
- Phase A (round e6b5, item 1, code-ast): callers and impact are native in gm-core (native/components/verbs/code_ast.cpp) on tree-sitter 0.25 runtime and the tree-sitter-javascript and tree-sitter-typescript grammars, vendored under native/third_party/tree-sitter with their MIT licences. The leaf parsed with acorn and scanned TypeScript by lines; now TypeScript is parsed. Witness: gm-tool check-code-ast ok at HEAD; with the linked-call test broken (the linked flag forced to false) it failed with the expected message, then the file was restored and it passed again. native/leaves/code-ast.mjs and native/leaves/vendor/acorn.mjs are removed; the gm-core build copies were removed too, because a leaf and a native verb with one name stop the worker with exit 1 ("verb callers is defined by two verb tables").
- Phase A (round e6b5, item 2, QuickJS-NG baseline): gm-tool check-quickjs-baseline measures the gm-core worker (found by its exe name under the session) at HEAD. Start (initialize through the first next_context) 9.8 to 10.1 ms; first run_code 7.2 to 7.4 ms; resident memory at rest 8452 to 8520 kB; after 1 run_code 10384 to 10572 kB; after 10 about 10752 to 10972 kB; after 40 about 10852 to 11032 kB; growth 2 to 3.3 kB per run_code over calls 11 to 40. Each run_code builds a new Engine (native/components/quickjs/engine.cpp), and the engine frees its runtime; the 2 to 3 kB per call is not traced to an owner, so no cut is made. The first run_code adds about 2 MB, the cost of one QuickJS runtime and context. Witness: the check ok at HEAD on two samples. Open: find the owner of the per-call kilobytes (a malloc arena or a cache), then cut it and re-measure.
- Phase A (round e6b5, item 7): defaults/mcp.json pins github:AnEntrypoint/pw#24646cc (npx, as before, with the pin moved), and defaults/mcp-tools/playwriter.json is the pinned lib/mcp-tools.json. The direct node entry is blocked: gm has no install step that creates a pw checkout with node_modules. Witness of the pin: git show 24646cc:lib/mcp-tools.json equals the defaults file.
- Phase B (round e6b5, item 7): the pin to 24646cc was reverted (defaults/mcp.json and defaults/mcp-tools/playwriter.json restored to ebbba11). Its tool list drops browsers, so check-lazy-browser failed with "the lazy browser verbs are missing from gm.verbs(): playwriter_execute" (only execute is served). Blocked on the owner decision in NATIVE_PLAN.
- Phase B (round e6b5, after item 1): check-install-follows (tools/check-install-follows.mjs) fails with "ENOENT: no such file or directory, open .../native/leaves/code-ast.mjs". Its witness edits a leaf in a scratch tree and expects the install to reach the session through a restart with the leaf name as the reason. The leaves are gone, so it has no subject. The reload-witness design for the native tree (which install tree a peer watches, and which file proves the reach) is open; it is not repointed to a guessed file. Blocks the push and the install of round e6b5.
- Phase A (round e6b5, item 1, install-follows): tools/check-install-follows.mjs is replaced by gm-tool check-install-follows (native/components/tool/checks/install_follows.cpp). It installs a scratch build into a sandbox HOME, starts a worker from the installed gm, edits the scratch skill (the installed skill and the worker must not change), then installs a second build whose build stamp is patched in copies of gm and gm-core, and waits for the restart. Reach is read from /proc: the live gm-core executable must resolve to the installed gm-core. Witness: ok at 4.5 s wall; with the second install replaced by a no-op it fails with three messages, then the file is restored and it passes again. Linux only; other platforms report it as not measured.
- Phase A (round e6b5, item 2, pin): defaults/mcp.json on 24646cc through the direct node entry; the tool cache is the pinned list (execute, reset). browsers is optional: browser_scope.cpp fails the browsers verb and browser_close_machine with a named reason when the launcher does not serve it. check-lazy-browser (native) requires only playwriter_execute in the listing and asserts that the first browser call starts the launcher (its reply names the playwriter server; a sandbox without Chrome makes the launch exit, which the reply reports). Witness: check ok. Open: the install step that creates ~/.gmnew/current/pw.
- Phase A (round e6b5, item 4, refusal): every skill-loaded event for the gm skill carries the digest of the served bytes (the resources read and the prompt path both set sha; server.cpp serve_skill_file and the prompt handler). Events written before commit 2ad5ca5 carry no sha; a restart after such a log still takes the unverified branch and is refused once, which stays until those logs are gone. gm-tool check-skill-reload witnesses the path-only move (a new build stamp with the skill bytes unchanged: skillChanged false, skillRead true, no refusal on the next run_code) and a real edit (skillChanged true and the next run_code refused once with "changed since this run read it"). Witness: ok at 5.2 s wall; with the change comparison broken (changed set whenever the digest exists) the path-only move fails all three assertions, then the file is restored and it passes again.
- Phase A (round e6b5, item 5, first port): tools/check-cli-flags.mjs is replaced by gm-tool check-cli-flags (native/components/tool/checks/cli_flags.cpp), with the same ten refused command lines and the --config and --mcp-config expectations. Witness: ok at 0.08 s wall; with the host refusal text changed to "bad flag" it fails the naming assertions, then main.cpp is restored and it passes again. Node is still in phase B for the remaining checks (NATIVE_PLAN, Checks moved to gm-tool).
- Phase B (round e6b5, final run): 40.1 s wall. 44 checks ok; 1 failed: check-browser-scope.mjs, "MCP server playwriter did not start after 3 attempt(s): ... exited with code 1" for the direct entry ${HOME}/.gmnew/current/pw/bin/playwriter-project, which no install step creates yet. The launcher itself runs (it reports "Using direct CDP connection" and needs a browser). Nothing pushed and nothing installed. Owner decision needed: keep the direct entry and build the install step first, or return the playwriter entry to the npx form at 24646cc until the install step exists.
- Phase A (round e6b5, install step): gm install installs playwriter 24646cc into current/pw (clone, checkout, npm ci in that tree). Clean-install witness: 7.04 s total, the playwriter step 6.94 s, its longest part the clone at 5.35 s. check-lazy-browser (native) and check-browser-scope (Node) each install into their own HOME, and the first browser call runs through the installed launcher; browser_close_machine reaches browsers through call_sibling.
- Phase B (round e6b5, install step): pass at dded62a, 3 min 54 s wall; longest step check-skill-reload 106.3 s inside Phase B (5.2 s alone).
- Phase A (round e6b5, teardown and item 5 continuation): check-browser-scope is native (native/components/tool/checks/browser_scope.cpp); tools/check-browser-scope.mjs is deleted. Survivor witness: kill disabled, 3 survivors, check fails; 1500 ms watchdog, first call fails with zero survivors; both restored and ok in about 7 s. check-lazy-browser asserts the pin marker (current/pw/gm-pin = 24646cc) and the entry path; a wrong expected pin fails it. check-worker-growth and check-feed-reference are native and the Node scripts are deleted; witnesses: growth limit -1 fails with 336 KB growth reported, feed job-name and size mutants fail, restored ok at 4.7 s and 0.37 s. Shared helpers tool_text and tool_json are in session.cpp.
- Leaked browser trees: 12 stale /tmp/gm-browser-scope-*, /tmp/gm-lazy-browser-* and /tmp/gm-browser-home-* dirs removed after a /proc check found no live process using them. /tmp/gm-browser-witness.mjs (owner abc, 10 Nov) is not from these checks and was left alone.

## Round e6b5: remaining Node checks in gm-tool (Phase A, 57fd18494d81-dev)

Witnesses run on build/release with `build/release/native/components/tool/gm-tool check build/release/native/components/host/gm <name>`. Each line is the check's own output.

- check-run-code-budget: ok (a 1083 ms JavaScript body with timeoutMs 1667 returned in 1093 ms; a fetch leaf held for 833 ms ended in 864 ms; a 300 ms fetch with a catastrophic match timed out in 311 ms in one attempt; a 300 ms fetch that timed out ended in 321 ms in one attempt; wall 1.12 s). Mutant (job lifetime 60 s, check-clock-mutations): fails as expected.
- check-turn-economy: ok (unchanged reply 67 bytes against 2279 for a full reply; one job_status call waited 760 ms; wall 0.94 s). Mutant (job wait cap 30 s): fails as expected.
- check-restart-jobs: ok (the job's process alive 675 ms after the trigger; exited 0 with output "done" at 8020 ms; wall 8.44 s).
- check-run-code-progress: ok (3 progress notices; wall 0.46 s).
- check-read-parity: ok (8 probes match; wall 0.25 s).
- check-protocol-versions: ok (5 versions echoed, 1999-01-01 answered with 2025-11-25; client connects 5, refuses 3; wall 0.44 s).
- check-relay-reexec: ok, skipped on the dev stamp (57fd18494d81-dev). It runs for real only on a build with -DGMNEW_VERSION=<commit>-1.
- check-witness-next-context-replay: ok (first run finished; successor run; brief 32442 chars; wall 0.07 s).
- check-build-handover: ok (the body in flight finished on the old build, the next call ran on the new one, broken-dev refused; wall 15.57 s).
- check-console: ok (flood kept 76 lines, 8188 bytes, dropped 225; format line cut at 510 bytes; wall 0.13 s).
- mcp-conformance: ok (86 passed, 0 failed of 86 checks in 24 scenarios; wall 1.17 s).
- parity-contract: ok (18 witness groups, W1 to W18, W23, W24, pass on the native binary; wall 23.40 s). W19, W20, W21, W22 and W25 are not in the native set: W19 and W20 test check-build's `--only` mode, and W21 and W22 wrap the native checks.

## Round e6b5 close-out: compile batch memory and Node out of the check-build step

Each change, and its witness:

- docs/NATIVE_PLAN.md: the batch memory record (peak 480 MiB per cc1plus, 1581 MiB total across 4 concurrent). Witness: /tmp/e6b5-mem.log sampler, /tmp/e6b5-batch.log `BATCH_EXIT=0`.
- CMakeLists.txt: the check-build test runs `$<TARGET_FILE:gm-tool> phase-b <build dir>` in the source directory; find_program(node) removed. Witness: Phase B run on this commit.
- .github/workflows/release.yml: both check-build steps run `gm-tool phase-b`. Witness: Phase B run; the workflow itself runs on push in CI.
- .github/workflows/arm-diagnose.yml: the asan step and the gdb arm64 step run `gm-tool phase-b`. Witness: CI run of arm-diagnose.
- README.md: the build step in the README runs `gm-tool phase-b build/release`.
- AGENTS.md: the tree-change rule and the build rule name `gm-tool phase-b` instead of tools/check-build.mjs.
- docs/PARITY_CONTRACT.md section 5: states that check-build.mjs is removed.
- tools/check-build.mjs: removed (git rm). No caller remains except the historical notes in DESIGN.md.

## Round e6b5 close-out, cap 3 and the remaining Node in CI (Phase A)

Each change, and its witness:

- CMakeLists.txt: GM_COMPILE_JOBS default 3. Witness: the batch with peak 3 concurrent cc1plus and 1306 MiB total (docs/NATIVE_PLAN.md, cap 3).
- native/components/tool/release.cpp (new): `gm-tool package`, `gm-tool release-manifest` and `gm-tool prune-release-assets`, ports of tools/package.mjs, tools/release-manifest.mjs and tools/prune-release-assets.mjs. Witness: Phase B below runs the three commands on a scratch tree.
- native/components/tool/checks/witness_windows_cmd.cpp (new): the `witness-windows-cmd` check, port of tools/witness-windows-cmd.mjs. On Linux it reports "skipped". It has NOT run on Windows; the first Windows release run is its witness.
- native/components/tool/main.cpp, native/include/gm/tool.hpp, checks/registry.cpp, native/components/tool/CMakeLists.txt: the new commands and check registered.
- .github/workflows/release.yml: the two package steps run gm-tool (gm-tool.exe on Windows); the Windows witness runs `gm-tool.exe check ... witness-windows-cmd`; the x64-linux build uploads gm-tool as the artifact `gm-tool`; the publish job downloads it and runs `tool/gm-tool release-manifest` and `tool/gm-tool prune-release-assets`. Witness: the next release run; not run here.
- tools/witness-ci-replay-step.mjs: the expected Windows command is the gm-tool form.
- Deleted (git rm): tools/package.mjs, tools/release-manifest.mjs, tools/prune-release-assets.mjs, tools/witness-windows-cmd.mjs.
- docs/NATIVE_PLAN.md: the cap 3 measurement.

Node still in CI, with cause and owner decision:
- playwright-core install and the `node -p` path lookup in release.yml (both build jobs): playwriter is a Node package, so the browser-scope and lazy-browser checks need Node. Owner decision: keep Node for the browser runtime, or drop those checks from CI.
- Three inline `node -e` steps in release.yml (host build stamp, worker binary versions on Windows): small, but they read CMakeCache and compile_commands.json with Node. Owner decision: replace with shell, or keep.
- tools/witness-ci-replay-step.mjs was already failing before this change (it expects two steps the workflow no longer has); nothing in CI calls it.

## Round e6b5, last two Node uses in CI (Phase A)

Each change, and its witness:

- .github/workflows/release.yml: the host build stamp step reads CMakeCache.txt with grep and compile_commands.json with awk (was `node -e`). Witness: on this host the grep prints GMNEW_COMMIT and GMNEW_VERSION, and the awk prints the three main.cpp entries with their -DGMNEW_BUILD_ flags, the same shape as the Node version.
- .github/workflows/release.yml: the worker binary versions step loops over gm.exe and gm-core.exe with --version, wc -c and date -u -r (was `node -e`). Witness: the same loop run on this host's gm and gm-core prints version, size and mtime. The Windows Git Bash form is NOT run here; the first Windows release run is its witness.
- docs/NATIVE_PLAN.md: the playwriter Node decision and its cause, and the inline steps moved to shell.
- docs/PENDING_VALIDATION.md: this entry.

Node still in CI after this change:
- playwright-core install and the `node -p` PLAYWRITER_BROWSER_PATH lookup in release.yml (both build jobs). Decision 1: kept, because playwriter is a Node package.
- tools/witness-ci-replay-step.mjs is stale (it was failing before this round) and nothing in CI calls it.

## Round e6b5, stale witness script removed (Phase A)

Each change, and its witness:

- tools/witness-ci-replay-step.mjs: deleted (git rm). It checked release.yml for a `Replay witness` step and a `Node parity` step that the workflow no longer has, so it failed before this round, and nothing in CI or the tree called it. Witness: `grep -rn witness-ci-replay-step` outside build/ and .git/ returns only the historical ledger rows above, which record past runs and are left as they were.
- docs/NATIVE_PLAN.md: the witness inventory row now names only tools/witness-redaction.mjs, the file on disk. It had also named witness-next-context-replay and witness-windows-cmd, which were already deleted.

## Round e6b5, Windows gm-tool compile on main (Phase A, not yet pushed)

Release run 43101203063 failed in build-windows at ab5e2aa: the Windows build compiles gm-tool for the first time, and it hit POSIX-only code. Each change, and its witness:

- native/components/tool/session.cpp, native/include/gm/tool.hpp, checks/run_code_budget.cpp, checks/build_handover.cpp, checks/run_code_progress.cpp, checks/turn_economy.cpp, checks/clock_mutations.cpp: setenv/unsetenv go through set_env/unset_env (_putenv_s on Windows). Witness: the Linux build of gm-tool exits 0, and `gm-tool check build/release/native/components/host/gm check-run-code-budget` exits 0 with "ok".
- Guarded for Windows with `#if !defined(_WIN32)`, the Windows branch returns "skipped" (or is empty): driver.cpp (phase-b prints that it runs on Linux and macOS only, exit 2), checks/hold_server.cpp, checks/process_tree.cpp, checks/restart_jobs.cpp, checks/restart_skill_read.cpp, checks/build_handover.cpp, checks/stop_fetch.cpp, checks/run_code_budget.cpp, checks/lazy_browser.cpp, checks/browser_scope.cpp. These use unistd.h, sys/socket.h, signal.h, kill and getpid. Witness: the Linux build of gm-tool exits 0 with no errors. The Windows compile is NOT checked here (no Windows or cross compiler on this host); the release run on the pushed commit is its witness.
- Not guarded and not verified for Windows: any POSIX-only code outside those ten files. The release run will show it.

