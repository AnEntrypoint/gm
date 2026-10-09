# Spool adapter

The spool is the file protocol that a dispatch writes through. The gm MCP server and the bundled dispatch CLI use it. The verb set is in `docs/verbs.md`.

## Request and response files

Create `.gm/exec-spool/in/<verb>/` when it is absent, then write `.gm/exec-spool/in/<verb>/<N>.txt` as JSON. Read `.gm/exec-spool/out/<verb>-<N>.json` in the same tool-call block, and never narrate first.

Write the in-file atomically: write the body to a sibling temp name, then `mv` (PowerShell: `Move-Item`) it onto `<N>.txt`. A plain `>` redirect creates the file empty and fills it a moment later, so a claim that lands in that window dispatches a torn body and is answered with a validation error for a field the body does supply. A rename is atomic, so the file only ever appears complete.

`<N>` is `<session_id>-<N>`, never a bare integer. The daemon keys in-flight claims by literal `(verb, N)` with no per-session partition, so two sessions that pick `1`, `2` and `3` read each other's responses.
