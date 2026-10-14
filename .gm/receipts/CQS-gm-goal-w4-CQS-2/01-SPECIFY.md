STAGE: SPECIFY  row: CQS-gm-goal-w4-CQS-2  session: gm-drain-w2-72
Row: gm-mcp/src/dispatch.js: capReplyText(text, maxChars, spillPath, out, toYaml, spillNote) is said to write spillPath via fs.writeFileSync (cited line 277).
Acceptance: capReplyText is pure; the spill write runs in the caller before the cap computation; bundle rebuilt.
Cited-line check: line 277 is not a write. capReplyText is at dispatch.js:304-333 and contains no writeFileSync.
Dispatch 1791960254014-500-b71540c5c0e0f42e (codesearch literal writeFileSync( in gm-mcp/src): dispatch.js hits are 395 and 2099 only.
Dispatch 1791960255827-500-d4d451c1b08a06da (callers capReplyText): one caller, dispatch.js:2100 in runDispatch, edge written by codeinsight_index complete:true.
ACH:
  H1 (row premise): capReplyText writes spillPath. Evidence: none. Probe: codesearch inside 304-333. Result: no write. REJECTED.
  H2 (stale): the write already sits at the caller (dispatch.js:2099, before the call at 2100), which is the row's requested end state. Result: consistent with probe. LEADER.
  H3 (partial): the caller write is unconditional or unguarded. Evidence: guard is rendered.length > replyCap. Not a fault for this row. REJECTED.
Leader: H2. Probe: the 304-333 scan above. A probe that separates H2 from H1 is the scan itself.
