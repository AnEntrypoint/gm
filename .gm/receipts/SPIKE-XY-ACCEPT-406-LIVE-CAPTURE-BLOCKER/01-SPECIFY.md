# SPECIFY (session gm-drain-w1-288)
Row: SPIKE-XY-ACCEPT-406-LIVE-CAPTURE-BLOCKER. Original blocker: nothing listened on 127.0.0.1:8787/mcp (ECONNREFUSED), so the Accept replies could not be captured.
Acceptance: capture the Accept-header behaviour of the live MCP endpoint for multi-type and single-type Accept, and name the origin of the 406.
Cited-line check: row cites gm-mcp/src (no 406 emitter). Confirmed by codesearch literal "Not Acceptable" (dispatch 1791959313234-500-b304c8d83f7ace6e): the only hits are inside the bundled SDK in gm-mcp/bin/gm-mcp-server.js.
Preconditions: the server is now listening (GET /health = 200, see boot probe), so the blocker's stated cause is stale.
ACH matrix:
- H1 (leader): 406 comes from the MCP SDK streamable HTTP transport, which requires Accept to contain both application/json and text/event-stream.
- H2: 406 comes from gm-mcp application code (route or verb handler).
- H3: 406 depends on the Content-Type or body, not Accept.
Evidence: witness dispatch 1791959327946-500-96ef1a69c097fdf9 (Accept json only = 406, sse only = 406, json+sse = 200, body text "Not Acceptable: Client must accept both application/json and text/event-stream").
Cells: H1 C/C/C consistent; H2 I (SDK wording, no app-side string); H3 I (body held constant, Accept alone flips status).
Leader: H1. Probe: vary Accept with fixed body (done in witness).
