# CLAUDE

## Technical Notes

Hook response format: `{"decision":"allow|block","reason":"text"}` with exit code 0.

Tool names for this platform: `bash` → `Bash`, `write` → `Write`, `glob` → `Glob`, `grep` → `Grep`, `search` → `Search`

When filtering transcript history by sessionId, use: `if (sessionId && entry.sessionId === sessionId)`

Verification file `.glootie-stop-verified` is auto-added to .gitignore and tracks session completion state.
