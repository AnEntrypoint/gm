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

`<N>` is `<session_id>-<N>`, never a bare integer. The daemon keys in-flight claims by literal `(verb, N)` with no per-session partition, so two sessions that pick `1`, `2` and `3` read each other's responses.

## Starting the watcher

Start the installed runner detached and fire-and-forget. Do not wait on it; write the first verb immediately. The runner binary lives at `~/.gm-tools/agentplug-runner`.

- POSIX: `~/.gm-tools/agentplug-runner spool`
- PowerShell: `& "$env:USERPROFILE\.gm-tools\agentplug-runner" spool`

When to start one is owned by `skills/gm/SKILL.md` (the verified-dead rule).
