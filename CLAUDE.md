# Technical Caveats & Gotchas

## Platform-Specific Hook Format Detection (Jan 22, 2026)

### CLI Platform Hook Output Format
Hook generation depends on `hookOutputFormat` config value in cli-platforms.js:
- **wrapped format** (cc, oc, codex): Generates matcher-based structure with `hookSpecificOutput` wrapper
  - Example: `{ hookSpecificOutput: { hookEventName: 'PreToolUse', ... } }`
- **bare format** (gc): Generates flat structure without matchers
  - Example: `{ decision: 'allow', systemMessage: '...' }`
- Hook files detect environment variables to determine format at runtime
- Set in hook templates via platform env var: `${CLAUDE_PLUGIN_ROOT}`, `${GEMINI_PROJECT_DIR}`, `${CODEX_PLUGIN_ROOT}`, `${OC_PLUGIN_ROOT}`

### Codex as CLI Platform (Jan 22)
Codex was initially misclassified as ExtensionAdapter (like VSCode/Cursor) but is actually a CLI platform:
- Now uses CLIAdapter with factory pattern in cli-platforms.js
- Generates 14 files including all 5 hook types (session-start, pre-tool-use, prompt-submit, stop, stop-git)
- Uses CODEX_PLUGIN_ROOT environment variable (mirrors Claude Code structure)
- Full parity with Claude Code reference verified: agents, hooks, configuration identical
- Fixed in Jan 22: Added platforms/cli-config-codex.js and updated auto-generator.js routing

### Platform-Specific README Generation (Jan 23)
Each CLI platform generates its own README with platform-specific installation instructions:
- **DO NOT read shared README.md** from plugforge-starter/ - it will have wrong instructions
- CLI adapter now always calls `generateReadme(pluginSpec)` instead of reading source file
- Each CLI config (cli-config-cc.js, cli-config-codex.js, etc.) defines `generateReadme(spec)` method
- Factory in cli-platforms.js overrides generateReadme to call config's method
- IDE platforms (vscode, cursor, zed, jetbrains) have generateReadme in their adapter classes
- Copilot CLI uses copilot-cli-content.js for readme generation

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
- **Gemini CLI (gc)**: SessionStart, BeforeTool, BeforeAgent, SessionEnd (different event names and response format)
- **OpenCode (oc)**: SessionStart, PreToolUse, UserPromptSubmit, Stop
- **Codex**: SessionStart, PreToolUse, UserPromptSubmit, Stop (identical to CC)
- **VSCode/Cursor**: TypeScript async functions
- **Zed/JetBrains**: JavaScript (not language-specific despite initial design)
- **Copilot CLI**: YAML profile + markdown (pragmatic degradation)

### Agent File Path Resolution (CRITICAL)
CLIAdapter.getAgentSourcePaths() must include `agents/${agent}.md` as FIRST path in lookup:
- Template: `agents/` contains gm.md, codesearch.md, websearch.md
- readSourceFile() returns on first path match, so direct `agents/` path must come first
- Fallback paths: glootie-cc/agents for reference implementations
- Without direct `agents/` path, agent files fail to resolve and output is missing agents/ directory
- Fixed in Jan 21: Added `agents/${agent}.md` to head of getAgentSourcePaths() return array

### File System Paths (CRITICAL FIX)
ConventionLoader.load() must use path.resolve() on input pluginDir:
- Relative paths (e.g., "./plugin" or "~/plugin") cause fs.existsSync() to fail unpredictably
- path.resolve(pluginDir) normalizes to absolute path before joining
- Fixed in Jan 21: ConventionLoader now resolves plugin directory before file operations
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
- Fixed in Jan 21: Added hook name → filename mapping to ensure all hooks resolve
- Without mapping, hooks/ directory wouldn't be checked, causing hooks to be missing from output
- Copilot CLI hooks generated as stubs because specification not yet active

### Dist Folder Antipattern (Jan 22)
IDE platforms were nesting generated files in dist/ directories unnecessarily:
- **Removed from**: vscode, cursor, zed, codex
- **Effect**: extension.js and agents/ now at root level, not nested in dist/
- **Result**: Cleaner file structure matching platform expectations for direct loading
- Rationale: Plugins are published directly from source, not as transpiled artifacts

### Code Organization
- All lib/ and platforms/ files actively used (no dead code remaining)
- hook-translator.js removed - hook translation now done via HookFormatters
- continue-gen.js removed - dead code not referenced by any platform
- 9 platform adapters all functioning end-to-end (verified, including Codex)
- Codex newly added as CLI platform using factory pattern (Jan 22)
- Most files under 200 lines; vscode.js (267) and copilot-cli-gen.js (308) exceed due to complex config generation
- Total codebase: 2,800+ lines across 25 active files

### Build Output Verification
Comprehensive end-to-end testing confirmed (Jan 22):
- All 9 platforms generate successfully (cc, gc, oc, codex, vscode, cursor, zed, jetbrains, copilot-cli)
- All required config files present and valid JSON/YAML/XML per spec
- CLI platforms: All 5 hook types (session-start, pre-tool-use, prompt-submit, stop, stop-git)
- 97+ total files generated across all platforms
- All agents distributed across platforms (gm, codesearch, websearch)
- Extension platforms generate native manifests (no dist/ nesting)
- 100% compatibility with documented platform specifications verified
- Codex parity with Claude Code reference: agents, hooks, configuration identical

### GitHub Actions CI/CD Pipeline
`.github/workflows/publish.yml` automates multi-repo publishing:
- Triggers on push to main branch (plugforge-starter/, platforms/, lib/, workflow changes)
- Runs build for all 9 platforms in parallel (matrix strategy includes codex)
- For each platform: checks if AnEntrypoint/glootie-{platform} repo exists
- Creates repo if missing via `gh repo create` (requires GITHUB_TOKEN or PUBLISHER_TOKEN)
- Clones existing repo, clears files using `git clean -fdx` (preserves .git), copies build artifacts
- Force pushes to main branch only (`git push -u origin main -f`)
- Matrix parallel execution means all 9 repos publish simultaneously
- `PUBLISHER_TOKEN` secret needed for org repos (requires `repo` scope)
- Initial repo creation may fail if org billing/permissions restrict it - manual creation fallback

### GitHub Actions Implementation (Jan 21)
Critical fixes for CI/CD publishing to work correctly:

**Dotfile Copying Issue:**
- Standard file removal (`rm -rf ./*`) does NOT remove dotfiles (`.claude-plugin/`, `.mcp.json`)
- Solution: Use `git clean -fdx` to remove all untracked files while preserving `.git/`
- File copying: Use `cp -r "$BUILD_DIR"/. .` (note the `/.`) to copy ALL files including dotfiles
- Without these, `.claude-plugin/marketplace.json` and `.mcp.json` never sync to published repos
- Fixed in commit: Use git clean to safely remove and replace files

**Git Context in Subprocess Scripts:**
- Shell scripts called from GitHub Actions workflow must ensure `cd "$WORK_DIR"` before git operations
- Operations like `git add -A` fail silently if not in correct directory
- `git diff-index --quiet HEAD --` must run AFTER the `cd` to check correct repo state
- Pre-git operations should not assume context (test `git init` first if needed)

**Dist Folder Cleanup (Jan 23):**
- Old IDE platform builds generated `dist/` directories that were committed to GitHub repos
- `git clean -fdx` only removes UNTRACKED files - committed `dist/` persists after reset
- Solution: Explicit `rm -rf dist/` after git reset/clean in workflow
- This ensures old dist folders from previous builds are removed before copying new artifacts
- Workflow step order: `git reset --hard` → `git clean -fdx` → `rm -rf dist/` → `cp -r "$BUILD_DIR"/.`
- Published repos will be cleaned of dist folders on next workflow run (auto-cleanup)

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

**Default Branch Mismatch (Jan 22):**
- Some repos may have both `master` (old default) and `main` branches
- Workflow pushes to `main`, but GitHub may display `master` as default
- Symptom: Updates appear successful but repo shows old content
- Fix: `gh repo edit AnEntrypoint/glootie-{platform} --default-branch main` then `git push origin --delete master`
- Verified all 9 repos now use `main` as sole/default branch

### Copilot CLI Hook Stubs (Jan 21)
Copilot CLI generates hook files as empty stubs (module.exports = {}):
- Hook spec is defined but not yet active in Copilot CLI deployments
- MCP servers (.mcp.json) is the proven extension mechanism
- Hook files remain for future activation when Copilot CLI formally supports them
- To populate: Replace stubs with async functions returning `{ decision, systemMessage }`

### Gemini CLI vs Claude Code Hook Differences (Jan 22)
Gemini CLI uses different hook event names and response formats despite similar CLI architecture:
- **Event names**: BeforeTool (not PreToolUse), BeforeAgent (not UserPromptSubmit), SessionEnd (not Stop)
- **Response format**: Flat `{ decision, systemMessage }` (not wrapped with hookSpecificOutput)
- **Environment variable**: GEMINI_PROJECT_DIR (not CLAUDE_PLUGIN_ROOT)
- Hook template files detect environment to generate correct platform-specific output
- Without platform detection, wrong format breaks Gemini CLI integration
