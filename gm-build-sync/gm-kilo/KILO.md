# KILO

## Technical Notes

Hook response format: `{"decision":"allow|block","reason":"text"}` with exit code 0.

Tool names for this platform: `bash` → `spawn/exec`, `write` → `fs.writeFile`, `glob` → `fs.glob`, `grep` → `grep`, `search` → `search`

When filtering transcript history by sessionId, use: `if (sessionId && entry.sessionId === sessionId)`

Verification file `.gm-stop-verified` is auto-added to .gitignore and tracks session completion state.
