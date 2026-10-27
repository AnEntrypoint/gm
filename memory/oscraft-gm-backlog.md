---
name: oscraft-gm-backlog
description: "Peer backlog of gm tooling defects from the oscraft drain (2026-10-25), 37 items, to be filed as PRD rows once the open-row count drops below 20"
metadata:
  node_type: memory
  type: project
  originSessionId: d196665c-8e22-4a3a-8a93-96e5b7e2c1a4
  modified: 2026-10-25T12:04:06.701Z
---
**Bundle and runner**
1. Served bundle lag installed for hours; each fix need manual /mcp reconnect. Covered by open row gm-mcp-bundle-version-stale (note added).
2. health sometimes omit bundle_served_version / bundle_installed_version. Covered by gm-mcp-bundle-version-stale (note added).
3. "plugin gm is not registered ... no plugin pool exists" for ~15 min, every project. Covered by gmfr-plugin-not-registered (note added).
4. Several gm-mcp processes fight over handover ("no-http-singleton" on 8787); leak-watch counts them. Covered by gmfr-plugin-not-registered (note added); separate row if persists.
5. Status read inside bootstrap times out at 4000 ms, pending count null. Probably covered by gmfr-status-read-timeout (resolved or pending; verify before filing).

**Code search**
6. codesearch on stale checkout: stale verdict and ahead/behind belong on line 1; zero on stale tree must read "unknown".
7. fs_read refuses paths outside project root; lanes cannot read skill files under /config. Need read-only skill-path allowlist.
8. Multi-word query is phrase match by default; make terms default or name phrase mode.
9. codesearch skips .gm/ silently; refutation over .gm reports zero. Name skipped paths on line 1.

**Rows and PRD**
10. prd-list has no text search. Covered by gm-mcp-prd-add-wrapper-origin-key (note added): add query key.
11. prd-add overwrite:true with disposition wiped four rows' bodies. Covered by same row (note added): keep unnamed fields.
12. prd-note refuses closed row; no way to annotate closed rows without reopening. New.
13. Closed rows in prd-log.jsonl not shown by prd-list; no lookup by id. Covered by prd-list-shows-resolved-rows-pending (note added).
14. describe("prd_resolve") returns empty input properties; witness fields not discoverable. New.
15. folded_duplicates counts folded ids but does not list them. New.

**Witnesses and attribution**
16. Plain-text browser body records no session unless first line is gm_session_id=. Take session from call's session_id; reject sessionless plain body with error naming the fix. New.
17. Sessionless witness rejected only at close time. Reject at dispatch time. New.
18. No per-row witness list (session, dispatch id, verb, result). New.
19. prd-resolve should refuse stale close unless its scan ran on origin's tip. New.

**Publish and git**
20. publish_on_origin refuses with unintended_paths or diverged-main conflicts; lanes then skip its gates. Covered by gmfr-publish-rebase-retry (note added).
21. Secrets check passes empty index silently. Covered by gm-publish-checker-missing (note added).
22. writer_lock take refused session key; some builds do not register verb; lanes hand-edited .gm/locks/*.writer. New.
23. git_status shows submodule at moved pin as "?" not modified. New.
24. ci-status "no reactor running" (resolved earlier) and no per-job log summary. Per-job failing names and first failing log line: new.

**Browser**
25. Browser calls queue behind serial lane (dispatch_starved_waiting_for_serial_lane); timed-out lanes leave waiters that later open tabs. Cancel waiter when its caller times out. New.
26. browser_reset exists but no skill text names it. Name it in browser section. New.
27. Hidden headful tab suppresses rendering until Page.bringToFront; call before screenshots. New.
28. DOM clicks do not drive lobby in host mode; oscraft.debug.run('ui', ...) does. Document working route. New.
29. Lobby pack-start button opens native file dialog; refuse or warn on elements that open file chooser. New.

**Lanes and routing**
30. prompts/get not reachable from gm_codemode; expose it or put SKILL.md path in lane brief. New.
31. Hop lanes wrote no .gm/lean-walk receipts; hop verb should refuse to close without one. New.
32. Finished subagents' notifications repeat as expired hold timers, wake turn. Silence once stopped. New.
33. Harness cap refusals give no reason; report live count and cap. New.
34. Drain-first gate never probed; give verb that reports its state. New.
35. Closed rows reported as "completed". Covered by prd-list-shows-resolved-rows-pending (note added).

**Docs**
36. Skill long; referenced docs (docs/verbs.md, prompts) not reachable from lanes. Make every reference resolvable or drop it. New.
37. Lanes cannot tell whether browser verb needs lease first. Say it in verb's own description. New.

**Follow-ups from 2026-10-25 (not yet rows)**
38. Nested component calls may lose AGENTPLUG_DISPATCH_* env: scoped thread in block_on_component (agentplug ba03fd7) does not carry dispatch origin; component.rs:399 reads it. Check whether 55b4115e covers it. New.
39. Runner keeps recreating empty .gm and .agentplug skeletons under scratch dirs (/workspace/identity-scratch, /config/tmp/nested-runtime-fix and others). Runner bug: scratch paths should not get runner state. New.
40. Lanes spawned without checking origin for existing fix duplicate work (nested-runtime lane rewrote fix 55b4115e already carried, ~176k tokens). Check origin for symptom before dispatching fix lane. Process note.

**Oscraft survey, 2026-10-25 (eleven rows in oscraft store, evidence in each body)**
41. gm-closed-row-record-outside-commit-body: close lives only in gitignored prd-log.jsonl unless commit carries Row, Witness and Status. New.
42. gm-dispatch-ledger-2p5mb-unbounded: dispatch ledger grows without bound (5,300+ lines). New; resource item.
43. gm-dir-screenshot-clutter-no-sweep: screenshots under .gm/shots have no sweep. New; housekeeping.
44. gm-fs-read-refuses-outside-root: fs_read and codesearch refuse paths outside root, even lane transcripts. Partly covered by fs-readdir absolute-root lane; outside-root case separate design question.
45. gm-prd-resolve-references-requirement-friction: prd-resolve demands references on rows about our own site. Covered in part by grandfather and none_because rules; check rule for internal rows.
46. gm-git-pull-blocked-by-lane-owned-dirty-files: pulls blocked by files left dirty by finished lanes. New; relates to shared-checkout rules.
47. gm-browser-no-viewport-or-shot-size-step: no viewport step, so witness at size needs raw CDP line. Open; screenshot step exists, viewport does not.
48. gm-browser-console-network-summaries: summary shape for new capture. Covered by console and network capture lane; check shape against peer's request.
49. gm-reply-token-weight-continuation-block: continuation block makes every reply heavy. Covered by reply-compaction lane (quiet on prd-add); continuation block on other verbs still open.
50. gm-lane-transcript-size-growth: lane transcripts reach 1 to 2 MB, cannot be read. New; housekeeping.
51. gm-prd-blocker-row-proliferation: blocker rows multiply (the -blocker- rows). New; filing discipline.
Also open: gm-fs-write-no-exact-line-edit: fs_write whole-file only, so lanes fall back to native Edit tool. New.
52. Design question (not bug): fs_write never widened outside project root, so repo not gm project root (e.g. /workspace/cj from sharesies) readable only with allowOutsideRoot and cannot be written at all. Per-call write root is security boundary, needs owner's decision. Route for now: run gm with cwd set to that repo, or publish through publish_on_origin.
53. Clone route for lanes: no gm verb clones, shared gm-mcp checkout dirty, so git-clone verb and four-group codesearch rebuild blocked. Needs owner's decision: approve one-time scratch clone, or clean dirty tree first.
55. Bash gate false positive (sharesies): command whose text contains grep, find or rg denied as native-search-bypass even when process-inspection pipe (ps | grep for pid). Denial should point at proc_list when pipe reads process output, not only codesearch, which cannot answer whether pid alive. Suggested: allow grep downstream of ps or proc_list output, name proc_list in denial. Worked around with proc_list.
56. Reply weight (sharesies, cj session, measured): every reply repeats envelope (dispatch_id, gm_session_header_version, ok, verb, timed_out, duration_ms), ~six lines per call. Proposal a: emit per-call meta once per codemode body as footer table, report only anomalous values (ok false, truncated true, timed_out true). Proposal c: make dispatch_id opt-in, largest fixed cost. Reply-shape only, gm-mcp, blocked behind clone route.
57. Failure reported three times (sharesies): failing codemode body error line, codemode-threw diagnostic_record JSON, partials list restate same error. Proposal b: report once, drop diagnostic_record from normal replies (keep behind verbose flag). gm-mcp, blocked behind clone route.
58. fs_read framing and git reply weight (sharesies): fs_read adds header block and "--- data (verbatim ...)" line even when read not partial. Proposal d: no framing when truncated false and no paging requested. Proposal e: git_status and git_diff add compact true option returning only flat lists and head_sha. gm-mcp, blocked behind clone route.
59. Instruction gap (sharesies): fs_write root rule not in instruction reply, found from error. One line where write verbs described: fs_write refuses paths outside cwd project root and allowOutsideRoot is read-only, so memory or notes files outside root need host editor. Skill text, parent repo; parent checkout dirty, so needs publish route, blocked behind clone route.
60. git verbs and status hang to 1800 s codemode timeout (hy3d, before restart): git_finalize and git_log hung 1800 s each; browser_lease_status and a status call hung same way. All answer now. Needs per-verb budget returning partial result with stalled step, so hang gives caller signal not silent 1800 s. Investigate on next gm-mcp or runner change; check whether hang was runner's handover, not verb.
62. codesearch hangs 1800 s on large directory scan (hy3d, corrected): two calls with absolute paths into /workspace/hy3d/tools (inside project root, mostly dlls and data) hung; out-of-root guard not the cause. Relative paths to one file and small source dir answered in ms. Scan has no bound, and timeout_seconds NOT applied to codesearch (60 s request ran full 1800 s). Call hanging before dispatch leaves no line in dispatch ledger or gm-mcp log, so client abort only trace. Expected: bounded scan with budget returning partial result naming stalled step; timeout_seconds honoured; dispatch-start record written before any scan, so hang visible server-side. Blocked by clone decision.
61. JASS (hy3d, for adoption decision, no action yet): JASS line-oriented, so plain-node tokenizer parsed full war3map.j (102,312 lines, 0 unparsed) in 0.4 s; no grammar needed. Quest text strings span lines, so line scanner must handle them. Natives live in common.j and blizzard.j, so appear only as external names. Existing tools (jass-to-ast, PBug90/jassjs, WarRaft/jass-rs, Rust tree-sitter grammar, pjass, vjasside) judged from search results only; licence of Rust grammar and whether it parses this file unchecked. Tools in lanmower/hy3d scripts/ (jass-index.mjs, jass-query.mjs, lni-query.mjs), docs/analysis-tools.md at d5e0f8c3.
65. One slow body wedges server (hy3d, 12:14 to 13:45 SAST): gm_codemode calls hung 30 min each on several lanes. Worst triggers: body parsing 3.5 MB file, regex codesearch on 3 MB file. Server (pid 3036534) sat at 70% CPU for 88 min. Required: every verb time-boxed, one slow body cannot block other callers, clone verb (git_clone) so read-only clones need no raw git. Top priority among blocked items; subsumes items 60 and 62. Blocked by clone decision.
63. gm.list({filter}) renders as [object Object] entries (sharesies): with filter, project to name plus truncated description, as names_only does. gm-mcp codemode return shaping. Blocked by clone decision.
64. Backticks in file content break codemode (sharesies): gm.fs_write({content: String.raw`...`}) fails with SyntaxError when content has backtick (markdown, JS template literals, shell). Fix: accept content as base64 or escaped form, document safe idiom in verb description. Blocked by clone decision.
54. publish_on_origin fails with write_tree_failed every attempt from sparse partial clone (git clone --depth 1 --filter=blob:none --no-checkout, then sparse-checkout and checkout main; /workspace/oscraft-fx-scratch, hy3d). Error text names no path. Likely cause: write-tree or read-tree of origin tree with blobs outside sparse set. Not reproduced here; fix in gm-mcp, blocked by item 53. Needs: publish path works from sparse or partial clone, or stated clone shape. Workaround in use: publish through GitHub Git API. Suggested fix from hy3d: pass --missing-ok to git write-tree in publish_on_origin, skipping blob-presence check for sparse-excluded paths; origin already holds those blobs, so tree safe. Raw host git publish hy3d's lane used is workaround, not pattern to keep. Data point: sparse clone with full blobs (no --filter), made from local oscraft checkout, published 8973459c with publish_on_origin and publish_base origin/main without error. Failing clones all blob:none partial clones, supporting missing-blob cause. Until fix ships, working clone shape is full-blob sparse clone.