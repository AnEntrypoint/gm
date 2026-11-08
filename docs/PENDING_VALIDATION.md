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
