---
name: oscraft-gm-backlog
description: "Peer backlog of gm tooling defects from the oscraft drain (2026-10-25), 37 items, to be filed as PRD rows once the open-row count drops below 20"
metadata:
  node_type: memory
  type: project
  originSessionId: d196665c-8e22-4a3a-8a93-96e5b7e2c1a4
  modified: 2026-10-25T12:04:06.701Z
---

Source: cross-session message from the oscraft session. Each item cost real time or gave a wrong result. Filing rule: one row per symptom, check for an open row first. At 20 or more open rows the drain has priority and no new row is filed; findings already noted on open rows are listed as covered.

**Bundle and runner**
1. Served bundle lags installed for hours; each fix needs a manual /mcp reconnect. Covered by open row gm-mcp-bundle-version-stale (note added).
2. health sometimes omits bundle_served_version / bundle_installed_version. Covered by gm-mcp-bundle-version-stale (note added).
3. "plugin gm is not registered ... no plugin pool exists" for about 15 minutes, every project. Covered by gmfr-plugin-not-registered (note added).
4. Several gm-mcp processes fight over the handover ("no-http-singleton" on 8787); leak-watch counts them. Covered by gmfr-plugin-not-registered (note added); a separate row if it persists.
5. Status read inside bootstrap times out at 4000 ms, pending count null. Probably covered by gmfr-status-read-timeout (resolved or pending; verify before filing).

**Code search**
6. codesearch on a stale checkout: stale verdict and ahead/behind belong on line 1; zero on a stale tree must read "unknown".
7. fs_read refuses paths outside the project root; lanes cannot read skill files under /config. Needs a read-only skill-path allowlist.
8. Multi-word query is a phrase match by default; make terms the default or name the phrase mode.
9. codesearch skips .gm/ silently; a refutation over .gm reports zero. Name the skipped paths on line 1.

**Rows and PRD**
10. prd-list has no text search. Covered by gm-mcp-prd-add-wrapper-origin-key (note added): add a query key.
11. prd-add overwrite:true with a disposition wiped four rows' bodies. Covered by the same row (note added): keep unnamed fields.
12. prd-note refuses a closed row; no way to annotate closed rows without reopening. New.
13. Closed rows in prd-log.jsonl are not shown by prd-list; no lookup by id. Covered by prd-list-shows-resolved-rows-pending (note added).
14. describe("prd_resolve") returns empty input properties; witness fields not discoverable. New.
15. folded_duplicates counts folded ids but does not list them. New.

**Witnesses and attribution**
16. Plain-text browser body records no session unless the first line is gm_session_id=. Take the session from the call's session_id, and reject a sessionless plain body with an error that names the fix. New.
17. A sessionless witness is rejected only at close time. Reject it at dispatch time. New.
18. No per-row witness list (session, dispatch id, verb, result). New.
19. prd-resolve should refuse a stale close unless its scan ran on origin's tip. New.

**Publish and git**
20. publish_on_origin refuses with unintended_paths or diverged-main conflicts; lanes then skip its gates. Covered by gmfr-publish-rebase-retry (note added).
21. Secrets check passes an empty index silently. Covered by gm-publish-checker-missing (note added).
22. writer_lock take refused the session key; some builds do not register the verb; lanes hand-edited .gm/locks/*.writer. New.
23. git_status shows a submodule at a moved pin as "?" not modified. New.
24. ci-status "no reactor running" (resolved earlier) and no per-job log summary. Per-job failing names and first failing log line: new.

**Browser**
25. Browser calls queue behind a serial lane (dispatch_starved_waiting_for_serial_lane); timed-out lanes leave waiters that later open tabs. Cancel a waiter when its caller times out. New.
26. browser_reset exists but no skill text names it. Name it in the browser section. New.
27. Hidden headful tab suppresses rendering until Page.bringToFront; call it before screenshots. New.
28. DOM clicks do not drive the lobby in host mode; oscraft.debug.run('ui', ...) does. Document the working route. New.
29. A lobby pack-start button opens a native file dialog; refuse or warn on elements that open a file chooser. New.

**Lanes and routing**
30. prompts/get is not reachable from gm_codemode; expose it or put the SKILL.md path in the lane brief. New.
31. Hop lanes wrote no .gm/lean-walk receipts; the hop verb should refuse to close without one. New.
32. Finished subagents' notifications repeat as expired hold timers and wake the turn. Silence them once stopped. New.
33. Harness cap refusals give no reason; report the live count and the cap. New.
34. The drain-first gate was never probed; give a verb that reports its state. New.
35. Closed rows reported as "completed". Covered by prd-list-shows-resolved-rows-pending (note added).

**Docs**
36. Skill is long; referenced docs (docs/verbs.md, prompts) are not reachable from lanes. Make every reference resolvable or drop it. New.
37. Lanes cannot tell whether a browser verb needs the lease first. Say it in the verb's own description. New.

**Follow-ups from 2026-10-25 (not yet rows)**
38. Nested component calls may lose AGENTPLUG_DISPATCH_* env: the scoped thread in block_on_component (agentplug ba03fd7) does not carry the dispatch origin; component.rs:399 reads it. Check whether 55b4115e covers it. New.
39. The runner keeps recreating empty .gm and .agentplug skeletons under scratch directories (/workspace/identity-scratch, /config/tmp/nested-runtime-fix and others). Runner bug: scratch paths should not get runner state. New.
40. Lanes spawned without checking origin for an existing fix duplicate work (the nested-runtime lane rewrote the fix that 55b4115e already carried, about 176k tokens). Check origin for the symptom before dispatching a fix lane. Process note.

**Oscraft survey, 2026-10-25 (eleven rows in the oscraft store, evidence in each body)**
41. gm-closed-row-record-outside-commit-body: a close lives only in the gitignored prd-log.jsonl unless a commit carries Row, Witness and Status. New.
42. gm-dispatch-ledger-2p5mb-unbounded: the dispatch ledger grows without bound (5,300+ lines). New; resource item.
43. gm-dir-screenshot-clutter-no-sweep: screenshots under .gm/shots have no sweep. New; housekeeping.
44. gm-fs-read-refuses-outside-root: fs_read and codesearch refuse paths outside the root, even lane transcripts. Partly covered by the fs-readdir absolute-root lane; the outside-root case is a separate design question.
45. gm-prd-resolve-references-requirement-friction: prd-resolve demands references on rows about our own site. Covered in part by the grandfather and none_because rules; check the rule for internal rows.
46. gm-git-pull-blocked-by-lane-owned-dirty-files: pulls are blocked by files left dirty by finished lanes. New; relates to the shared-checkout rules.
47. gm-browser-no-viewport-or-shot-size-step: no viewport step, so a witness at a size needs a raw CDP line. Open; the screenshot step exists, the viewport does not.
48. gm-browser-console-network-summaries: summary shape for the new capture. Covered by the console and network capture lane; check the shape against the peer's request.
49. gm-reply-token-weight-continuation-block: the continuation block makes every reply heavy. Covered by the reply-compaction lane (quiet on prd-add); the continuation block on other verbs is still open.
50. gm-lane-transcript-size-growth: lane transcripts reach 1 to 2 MB and cannot be read. New; housekeeping.
51. gm-prd-blocker-row-proliferation: blocker rows multiply (the -blocker- rows). New; filing discipline.
Also open: gm-fs-write-no-exact-line-edit: fs_write is whole-file only, so lanes fall back to the native Edit tool. New.
52. Design question (not a bug): fs_write is never widened outside the project root, so a repo that is not the gm project root (for example /workspace/cj from sharesies) can be read only with allowOutsideRoot and cannot be written at all. A per-call write root is a security boundary, so it needs the owner's decision. Route for now: run gm with cwd set to that repo, or publish through publish_on_origin.
53. Clone route for lanes: no gm verb clones, and the shared gm-mcp checkout is dirty, so the git-clone verb and the four-group codesearch rebuild are blocked. Needs the owner's decision: approve a one-time scratch clone, or clean the dirty tree first.
55. Bash gate false positive (sharesies): a command whose text contains grep, find or rg is denied as native-search-bypass even when it is a process-inspection pipe (ps | grep for a pid). The denial should point at proc_list when the pipe reads process output, not only at codesearch, which cannot answer whether a pid is alive. Suggested: allow grep downstream of ps or proc_list output, and name proc_list in the denial. Worked around with proc_list.
56. Reply weight (sharesies, cj session, measured): every reply repeats the envelope (dispatch_id, gm_session_header_version, ok, verb, timed_out, duration_ms), about six lines per call. Proposal a: emit per-call meta once per codemode body as a footer table, and report only anomalous values (ok false, truncated true, timed_out true). Proposal c: make dispatch_id opt-in, since it is the largest fixed cost. Reply-shape only, gm-mcp, blocked behind the clone route.
57. Failure reported three times (sharesies): on a failing codemode body the error line, the codemode-threw diagnostic_record JSON, and the partials list restate the same error. Proposal b: report once, drop the diagnostic_record from normal replies (keep it behind a verbose flag). gm-mcp, blocked behind the clone route.
58. fs_read framing and git reply weight (sharesies): fs_read adds a header block and a "--- data (verbatim ...)" line even when the read is not partial. Proposal d: no framing when truncated is false and no paging was requested. Proposal e: git_status and git_diff add a compact true option returning only the flat lists and head_sha. gm-mcp, blocked behind the clone route.
59. Instruction gap (sharesies): the fs_write root rule is not in the instruction reply, so it was found from the error. One line where the write verbs are described: fs_write refuses paths outside the cwd project root and allowOutsideRoot is read-only, so memory or notes files outside the root need the host editor. Skill text, parent repo; the parent checkout is dirty, so this needs the publish route, blocked behind the clone route.
60. git verbs and status hang to the 1800 s codemode timeout (hy3d, before a restart): git_finalize and git_log hung 1800 s each, and browser_lease_status and a status call hung the same way. All answer now. Needs a per-verb budget that returns a partial result with the stalled step, so a hang gives the caller a signal instead of a silent 1800 s. Investigate on the next gm-mcp or runner change; check whether the hang was the runner's handover, not the verb.
62. codesearch hangs 1800 s on a large directory scan (hy3d, corrected): two calls with absolute paths into /workspace/hy3d/tools (inside the project root, mostly dlls and data) hung; the out-of-root guard is not the cause. Relative paths to one file and to a small source dir answered in milliseconds. The scan has no bound, and timeout_seconds is NOT applied to codesearch (a 60 s request ran the full 1800 s). A call that hangs before dispatch leaves no line in the dispatch ledger or the gm-mcp log, so the client abort is the only trace. Expected: a bounded scan with a budget that returns a partial result naming the stalled step; timeout_seconds honoured; and a dispatch-start record written before any scan, so a hang is visible server-side. Blocked by the clone decision.
61. JASS (hy3d, for the adoption decision, no action yet): JASS is line-oriented, so a plain-node tokenizer parsed the full war3map.j (102,312 lines, 0 unparsed) in 0.4 s; no grammar was needed. Quest text strings span lines, so a line scanner must handle them. Natives live in common.j and blizzard.j, so they appear only as external names. Existing tools (jass-to-ast, PBug90/jassjs, WarRaft/jass-rs, a Rust tree-sitter grammar, pjass, vjasside) were judged from search results only; the licence of the Rust grammar and whether it parses this file are unchecked. Tools live in lanmower/hy3d scripts/ (jass-index.mjs, jass-query.mjs, lni-query.mjs), docs/analysis-tools.md at d5e0f8c3.
65. One slow body wedges the server (hy3d, 12:14 to 13:45 SAST): gm_codemode calls hung 30 min each on several lanes. Worst triggers: a body parsing a 3.5 MB file, and a regex codesearch on a 3 MB file. The server (pid 3036534) sat at 70% CPU for 88 minutes. Required: every verb time-boxed, one slow body cannot block other callers, and a clone verb (git_clone) so read-only clones need no raw git. Top priority among the blocked items; it subsumes items 60 and 62. Blocked by the clone decision.
63. gm.list({filter}) renders as [object Object] entries (sharesies): with a filter, project to name plus a truncated description, as names_only does. gm-mcp codemode return shaping. Blocked by the clone decision.
64. Backticks in file content break codemode (sharesies): gm.fs_write({content: String.raw`...`}) fails with SyntaxError when content contains a backtick (markdown, JS template literals, shell). Fix: accept content as base64 or an escaped form, and document the safe idiom in the verb description. Blocked by the clone decision.
54. publish_on_origin fails with write_tree_failed on every attempt from a sparse partial clone (git clone --depth 1 --filter=blob:none --no-checkout, then sparse-checkout and checkout main; /workspace/oscraft-fx-scratch, hy3d). The error text names no path. Likely cause: write-tree or read-tree of the origin tree with blobs outside the sparse set. Not reproduced here, and the fix is in gm-mcp, blocked by item 53. Needs: the publish path works from a sparse or partial clone, or a stated clone shape. Workaround in use: publish through the GitHub Git API. Suggested fix from hy3d: pass --missing-ok to git write-tree in publish_on_origin, which skips the blob-presence check for sparse-excluded paths; origin already holds those blobs, so the tree is safe. The raw host git publish that hy3d's lane used is a workaround, not a pattern to keep. Data point: a sparse clone with full blobs (no --filter), made from the local oscraft checkout, published 8973459c with publish_on_origin and publish_base origin/main without the error. The failing clones were all blob:none partial clones, which supports the missing-blob cause. Until the fix ships, the clone shape that works is a full-blob sparse clone.
