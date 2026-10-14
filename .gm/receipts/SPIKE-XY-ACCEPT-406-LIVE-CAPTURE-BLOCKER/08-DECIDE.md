# DECIDE
Verdict: the 406 is the MCP SDK streamable HTTP transport rejecting an Accept header that lacks text/event-stream (or application/json). Client guidance: send "Accept: application/json, text/event-stream". Not an application bug.
Witness 1791959327946-500-96ef1a69c097fdf9 is from session gm-drain-w1-288, not the row's session lean-close-xy-g5, so it is not a self-witness.
