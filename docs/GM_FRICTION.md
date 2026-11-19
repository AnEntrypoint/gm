# GM friction

Stable ledger of friction reported against gm. Source list: docstudio docs/GM_FRICTION.md on its origin/main (the dispatcher routes its items here). Each entry: the evidence, the status, and the commit that closes it.

## 1. read_file truncates silently at about 9.9 KB without allow_large

- Evidence (docstudio): gm.read_file({ path: 'public/js/streaming/acp-stream-session.js' }) inside one run_code body (actionSeq 9); the reply ended with "truncated":true after 9915 characters.
- Reproduced 2026-11-19 on the HEAD build: a 12000-byte file read inside run_code returns 6213 characters with truncated true, complete false and outputPath. The cut is the documented 4500 head and 1500 tail rule in verbs.cpp read_file.
- allow_large is not a read_file parameter; a call with it is refused and names the valid ones (path, offset, limit, unit, full, fresh). full: true returns all 12000 bytes.
- Real defect: the cut reply had hint null, although the read_file description says hint names the read that gets the rest.
- Status: fixed. Commit 1701723e (native/components/mcp/server.cpp bounded_output sets hint: full: true for read_file, outputPath otherwise). Witness: run_code reply hint "this reply is cut; gm.read_file with full: true returns the whole text, or read_file with offset and limit pages it".

## 2. git_commit requires paths with no visible schema in run_code

- Evidence (docstudio): gm.git_commit({ message }) inside run_code (actionSeq 29) returned {"ok":false,"error":"paths must be a non-empty array of strings"}; the retry with paths (actionSeq 36) succeeded in the same run_code step.
- Real defect: the schema required paths, but the git_commit description did not say so.
- Status: fixed. Commit 80b1730c (native/components/verbs/verbs.cpp git_commit description states paths is required). Witness: gm.verbs() git_commit description begins "Commit only the given paths, with the message. paths is required: a non-empty array of path strings, and the call fails without it."; a call without paths returns "paths must be a non-empty array of strings".

## 3. Session start latency

- Evidence (docstudio): the first gm skill read landed about 126 s after the playwriter connect event (run log seq 3 at 3046 ms, seq 5 at 129577 ms).
- Analysis: the gap is the host model's own turn time, not a gm step. The gm run log shows the skill read as a separate step after the connect; no gm code path waits for 126 s.
- Status: not a gm defect. Closed with cause: model turn time. No code change.
