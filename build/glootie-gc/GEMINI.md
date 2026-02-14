# GEMINI

## Technical Notes

Hook response format: `{"decision":"allow|block","reason":"text"}` with exit code 0.

Tool names for this platform: `bash` → `run_shell_command`, `write` → `write_file`, `glob` → `glob`, `grep` → `search_file_content`, `search` → `search`

When filtering transcript history by sessionId, use: `if (sessionId && entry.sessionId === sessionId)`

Verification file `.glootie-stop-verified` is auto-added to .gitignore and tracks session completion state.
