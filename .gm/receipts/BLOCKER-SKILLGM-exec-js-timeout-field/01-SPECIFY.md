session=gm-drain-w1-29 row=BLOCKER-SKILLGM-exec-js-timeout-field

Row: exec_js limits (default 300000 ms, ceiling 900000 ms) become a typed timeoutMs field in the dispatch request schema, not a timeoutMs= raw-body prefix. Acceptance: typed field honored by the daemon; conflicting spellings refused. Cites checked: gm-mcp/src/verb-table.js:153-154 (code, timeoutMs fields present); gm-mcp/src/dispatch.js:1403-1409 (TIMEOUT_MS_PREFIX_LINE conflict refusal, fold to prefix). Row asserts no cause; ACH not required. Unknown: none. Stale: no (cited lines present).
