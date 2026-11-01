Iterate on gm-new itself, in /workspace/gm-new, using the gm-new tools. Call next_context at the start of every step, and follow the rules it returns and the rules in AGENTS.md.

Next work, in order:
1. Hot reload is built as tools/supervise.mjs. Its tests passed in copies: a source change keeps the run and notifies the host, and a broken source is reported and recovers. Next, witness it through this project's own .mcp.json, and record that witness in DESIGN.md.
2. Dependencies on gm are listed in DESIGN.md under "Dependencies on gm, to be replaced". Do not remove any of them until the gm agent sends its phase plan. Until then, do not change them.
3. The minimal tool set is not run and is not requested.

Every change needs a witness before it is committed: a scripted run, a supervisor test, or a JSON-RPC check, with its run id or output recorded in DESIGN.md under Measured. Commit each change by explicit path on main. Do not create branches. Keep the code ASCII, use Node built-ins only, and write no test files.

Do not call finish. This run is shared by every session that opens this project, and a finished run refuses all later calls.
