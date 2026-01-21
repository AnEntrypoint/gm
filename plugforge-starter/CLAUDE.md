# CLAUDE.md - Technical Caveats & Gotchas

## Claude Code Plugin System

### Stop Hook Response Format
- **Blocking Decision**: Use JSON with exit code 0 (not exit code 1)
- Format: `{"decision":"block","reason":"<message>"}`
- Exit code 0 with JSON output takes precedence over exit codes
- Exit code 2 is for simple blocking via stderr (only use if JSON unavailable)
- Multiple Stop hooks execute in sequence; all must allow to proceed

### Stop Hook Context Filtering
- When filtering transcript history, **must use sessionId to isolate current session only**
- Bug pattern: `(!sessionId || entry.sessionId === sessionId)` matches all entries (incorrect)
- Correct pattern: `(sessionId && entry.sessionId === sessionId)`
- Without proper filtering, stop hook shows work from previous sessions/projects

### PreToolUse Hook Blocks
- **Bash tool**: Redirects to `dev execute` (code execution in appropriate language)
- **Write tool**: Blocks `.md` and `.txt` file creation (except `CLAUDE.md` and `readme.md`)
- **Glob/Grep/Search tools**: Redirects to `code-search` MCP or `dev execute`
- Response format: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny|allow","permissionDecisionReason":"..."}}`

### SessionStart Hook
- Automatically adds `.glootie-stop-verified` to `.gitignore` on every session start
- Runs AST analysis via `mcp-thorns` with 3min timeout
- Injects codebase insight as additional context
- Response format: `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}`

### UserPromptSubmit Hook
- Deletes `.glootie-stop-verified` marker on each new user input to reset verification state
- Response format: `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"..."}}`

### Hook Output Format Rules
- **PreToolUse/SessionStart/UserPromptSubmit**: Must use `hookSpecificOutput` wrapper
- **Stop/Stop-git**: Must output `decision` and `reason` (no wrapper)
- Always output to stdout with exit code 0 (except on fatal errors)
- Pretty-printing (null, 2) is optional but keep JSON single-line for efficiency

## Verification File Lifecycle
- Path: `.glootie-stop-verified` (project root)
- Created: When work is verified complete during stop hook
- Deleted: On each new user prompt (via UserPromptSubmit hook)
- Must be in `.gitignore` (auto-added by SessionStart hook)
- Used to prevent re-verification of same work session
