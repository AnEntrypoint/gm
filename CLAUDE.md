# Technical Caveats & Gotchas

## Critical Implementation Details

### Generation Pipeline
- AutoGenerator.generate() is async - must await: `await generator.generate()`
- ConventionLoader.load() reads plugin.json, agents/, hooks/ from plugin directory
- Validation requires: name, version, author, license in plugin.json
- Starter hook files provide minimal implementations - extend as needed

### Hook Translation System
Hook translation uses HookFormatters (not hook-translator which was removed as dead code):
1. ConventionLoader.load() reads unified hooks/ files
2. HookFormatters.formatFor<Platform>() converts to platform syntax
3. FileGenerator.writeFiles() outputs platform-specific hook files

Each hook type (session-start, pre-tool, prompt-submit, stop, stop-git) translates to correct platform event names:
- **Claude Code (cc)**: SessionStart, PreToolUse, UserPromptSubmit, Stop (+ Stop-git as separate)
- **Gemini CLI (gc)**: SessionStart, BeforeTool, BeforeAgent, SessionEnd
- **OpenCode (oc)**: SDK handler pattern
- **VSCode/Cursor**: TypeScript async functions
- **Zed/JetBrains**: JavaScript (not language-specific despite initial design)
- **Copilot CLI**: YAML profile + markdown

### Agent File Path Resolution (CRITICAL)
CLIAdapter.getAgentSourcePaths() must include `agents/${agent}.md` as FIRST path in lookup:
- Template: `agents/` contains gm.md, codesearch.md, websearch.md
- readSourceFile() returns on first path match, so direct `agents/` path must come first
- Fallback paths: glootie-cc/agents for reference implementations
- Without direct `agents/` path, agent files fail to resolve and output is missing agents/ directory

### File System Paths (CRITICAL FIX)
ConventionLoader.load() must use path.resolve() on input pluginDir:
- Relative paths (e.g., "./plugin" or "~/plugin") cause fs.existsSync() to fail unpredictably
- path.resolve(pluginDir) normalizes to absolute path before joining
- Without this fix, CLI would report "glootie.json not found" even when file exists

getHookSourcePaths() in CLIAdapter maps hook names to files:
- Maps consistently: pre-tool → pre-tool.js, session-start → session-start.js
- readSourceFile() tries path array in order, returns first found
- Gracefully handles missing optional files (returns null)

### MCP Configuration
plugin.json mcp property becomes .mcp.json per platform:
- CLI platforms: .mcp.json in root (CLAUDE_PLUGIN_ROOT, GEMINI_PROJECT_DIR, etc.)
- Validated against schema: https://schemas.modelcontextprotocol.io/0.1.0/mcp.json
- Platform adapters override mcp paths in config if needed

### Platform-Specific Implementation Notes
- **CC/GC/OC/Copilot**: Hook files are standalone JavaScript, executed as subprocesses
- **VSCode/Cursor/Zed**: No hook files (uses IDE native activation events)
- **JetBrains**: plugin.xml describes capabilities, no runtime hooks needed
- **Cursor**: Mirrors VSCode but adds .cursor/mcp.json for MCP server configuration

### Copilot CLI Caveat
CopilotCLIAdapter.getHookSourcePaths() requires hook name mapping:
- Maps 'pre-tool-use' → 'pre-tool.js', 'session-start' → 'session-start.js', etc.
- First lookup path must be hooks/ directory (from template)
- Without mapping, hooks/ directory wouldn't be checked, causing hooks to be missing from output

### Code Organization
- All lib/ and platforms/ files actively used (no dead code)
- hook-translator.js removed - hook translation now done via HookFormatters
- continue-gen.js removed - dead code not referenced by any platform
- Most files under 200 lines; vscode.js (267) and copilot-cli-gen.js (308) exceed due to complex config generation


### GitHub Actions CI/CD Pipeline
`.github/workflows/publish.yml` automates multi-repo publishing:
- Triggers on changes to plugforge-starter/, platforms/, lib/, or workflow itself
- Runs build for all 8 platforms in parallel (matrix strategy)
- For each platform: checks if AnEntrypoint/glootie-{platform} exists
- Creates repo if missing via `gh repo create` (requires GITHUB_TOKEN)
- Clones existing repo, clears files, copies build artifacts, commits and pushes
- Force pushes to main branch (`git push -u origin main -f`)
- Matrix parallel execution means all 8 repos publish simultaneously
- `GITHUB_TOKEN` from Actions has default permissions - may need adjustment for org repos
- Initial repo creation may fail if org billing/permissions restrict it - manual creation fallback

### GitHub Actions Implementation
Critical fixes for CI/CD publishing to work correctly:

**Dotfile Copying Issue:**
- Standard file removal (`rm -rf ./*`) does NOT remove dotfiles (`.claude-plugin/`, `.mcp.json`)
- Solution: Use `git clean -fdx` to remove all untracked files while preserving `.git/`
- File copying: Use `cp -r "$BUILD_DIR"/. .` (note the `/.`) to copy ALL files including dotfiles
- Without these, `.claude-plugin/marketplace.json` and `.mcp.json` never sync to published repos

**Git Context in Subprocess Scripts:**
- Shell scripts called from GitHub Actions workflow must ensure `cd "$WORK_DIR"` before git operations
- Operations like `git add -A` fail silently if not in correct directory
- `git diff-index --quiet HEAD --` must run AFTER the `cd` to check correct repo state
- Pre-git operations should not assume context (test `git init` first if needed)

**Token Authentication:**
- GITHUB_TOKEN from Actions has limited permissions (only current repo access)
- For publishing to org repos, need personal access token with `repo` scope
- Solution: Create PUBLISHER_TOKEN secret with full token from `gh auth token`
- Configure git with: `git config --global url."https://${GH_TOKEN}:x-oauth-basic@github.com/".insteadOf "https://github.com/"`
- This maps all github.com URLs to use the token in subsequent git operations

**Empty Commit Prevention:**
- `git diff-index --quiet HEAD --` returns 0 (success) if no changes
- Must wrap commit/push in `if ! git diff-index --quiet HEAD --; then` to skip when nothing changed
- Otherwise pushes empty commits unnecessarily

**Template File Truncation Bug:**
- Early workflow version created minimal stub agent files before build: `echo "# gm" > plugforge-starter/agents/gm.md`
- This overwrote the committed agents with single-line headers, causing published repos to have truncated agents
- Solution: Remove the "Create minimal starter template" step - rely on committed plugforge-starter/ files
