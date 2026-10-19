# Spool adapter

The spool is the file protocol that a dispatch writes through. The gm MCP server and the bundled dispatch CLI use it. The verb set is in `docs/verbs.md`.

## Transport selection

The dispatch port is served by the first transport that applies this turn:

1. A connected `gm`/`mcp_tool` server, when one is available. It wraps the write-then-poll cycle into one call with cleaned output. Never spend a turn connecting one before dispatching real work.
2. The bundled CLI, when the host has no gm MCP tools: `node ~/.gm-tools/gm-mcp-server.mjs dispatch <verb> [--body '<json>'] [--raw '<text>'] --cwd <project root>`. Check it first with `dispatch health`. If `~/.gm-tools/gm-mcp-server.mjs` is missing, the runtime is not installed: run the repo's `install.sh` (or `install.ps1`) before any gm work.
3. The raw spool protocol below, when neither is available. Follow it for every spool write.

## Request and response files

Create `.gm/exec-spool/in/<verb>/` when it is absent, then write `.gm/exec-spool/in/<verb>/<N>.txt` as JSON. Read `.gm/exec-spool/out/<verb>-<N>.json` in the same tool-call block, and never narrate first.

Write the in-file atomically: write the body to a sibling temp name, then `mv` (PowerShell: `Move-Item`) it onto `<N>.txt`. A plain `>` redirect creates the file empty and fills it a moment later, so a claim that lands in that window dispatches a torn body and is answered with a validation error for a field the body does supply. A rename is atomic, so the file only ever appears complete.

Stage that temp OUTSIDE `in/`, for example `.gm/exec-spool/.staging/<N>.txt`, and rename it into `in/<verb>/`. A sweep of `in/<verb>/` moves any file whose extension is not `txt` (or the verb's own language extension) to `in-quarantine/<verb>__<name>` and answers `out/<verb>-<name minus .ext>.json` with `spool_filename_rejected` ("the spool ABI is in/<verb>/<session-id>-<local-counter>.<ext>, so a non-conforming name is never claimed by the dispatch loop"). A `.tmp` temp staged inside `in/<verb>/` is therefore taken away before your `mv` runs, the rename has nothing left to move, and the request is lost behind an error that blames the name. Measured 2026-10-10 over 24 projects: 279 quarantined requests, 30 of them temp siblings staged this way (latest `phase-status__.orch-main-r135-20380-1791668514867-5976.20380.1791668514948.tmp`, gm, 21:41Z), each with a rejection answer and no dispatch out-file.

The sweep is not a poll. It runs on the daemon's cold sweep (`cold_sweep_pending`, set when any project root newly attaches, and then walking every known root) and under `agentplug-runner sweep-spool <root>`. So a temp is taken only when a sweep lands inside the rename window, and a non-conforming file written after a sweep can sit in `in/` with no answer at all. Measured 2026-10-10 in a scratch root: a `.<task>.<pid>.<ts>.tmp` staged in `in/phase-status/` survived 3 s untouched (no quarantine, no answer), then the same file was quarantined as `phase-status__<tmp>` and answered `spool_filename_rejected` the moment `sweep-spool` ran; a conforming `orch-main-r169-sub1-1.txt` beside it was left in place.

The in-file body is flat: `session_id`, `cwd` and the verb's own fields sit at the top level of the JSON, with no `body` wrapper. For example, a codesearch request is `{"session_id":"<id>","cwd":"<project root>","query":"<text>","mode":"literal","path":"skills"}`. Nesting the fields under `body` answers `invalid_args` with `query required`, although `query` was supplied (live witness: dispatch `1792427067827-5000-81b516191688f62c`); the flat form returns data (live witness: dispatch `1792427069207-5000-e3c43bf43a39858d`).

`<N>` is `<session_id>-<N>`, never a bare integer. The daemon keys in-flight claims by literal `(verb, N)` with no per-session partition, so two sessions that pick `1`, `2` and `3` read each other's responses.

## Starting the watcher

Start the installed runner detached and fire-and-forget. Do not wait on it; write the first verb immediately. The runner binary lives at `~/.gm-tools/agentplug-runner`.

- POSIX: `~/.gm-tools/agentplug-runner spool`
- PowerShell: `& "$env:USERPROFILE\.gm-tools\agentplug-runner" spool`

When to start one is owned by `SKILL.md` (the verified-dead rule).
