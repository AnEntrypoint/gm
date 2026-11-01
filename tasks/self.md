Iterate on gm-new itself, in /workspace/gm-new, using the gm-new tools. Call next_context at the start of every step, and follow the rules it returns and the rules in AGENTS.md.

Next work, in order, from the gm agent's phase plan (DESIGN.md, Decided, 2026-11-02):
1. Phases 1 and 2 are witnessed in DESIGN.md under Measured: the kernel tools, and search (BM25 with literal, regex and whole-word grep). callers and impact stay unavailable until the user decides the parser dependency, and the reply must say so.
2. Phase 3, JIT checks through run_shell, is witnessed in DESIGN.md under Measured (8 of 8). Open defect for the gate: doctor's last-run pick chooses runs/live over the timestamped runs. Write no test files.
3. Phase 4 is optional: fetch, then browser over CDP, only if a project needs them.
4. The gate: edit a small real change to gm-new with its own tools in a live Claude session through airc, commit it through its git verbs, and see CI pass. Only after that remove the gm dependencies listed in DESIGN.md under "Dependencies on gm, to be replaced", each in its own commit.
5. Hot reload is witnessed in two sessions (DESIGN.md). The witness through the project's own .mcp.json in Claude Code waits for the user's one-time /mcp approval.
6. The minimal tool set is not run and is not requested.

Every change needs a witness before it is committed: a scripted run, a supervisor test, or a JSON-RPC check, with its run id or output recorded in DESIGN.md under Measured. Commit each change by explicit path on main. Do not create branches. Keep the code ASCII, use Node built-ins only, and write no test files.

Call finish, with a witness, when this session's work is done. finish closes only this session's run. The next session that opens this project starts a new run, so the closed run does not affect it.
