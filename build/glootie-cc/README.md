# glootie-cc for Claude Code

## Installation

Install glootie-cc into your project to add the gm state machine and hooks:

```bash
cd /path/to/your/project
npm install glootie-cc
```

This installs the following files to your project root:

```
your-project/
├── agents/
│   └── gm.md                       # State machine agent with behavioral rules
├── hooks/
│   ├── pre-tool-use-hook.js        # Validates tools before execution
│   ├── prompt-submit-hook.js       # Processes user prompts
│   ├── session-start-hook.js       # Initializes session, runs thorns analysis
│   ├── stop-hook.js                # Verifies session completion (.prd enforcement)
│   └── stop-hook-git.js            # Enforces git on session end
├── .mcp.json                       # MCP server configuration
└── .gitignore                       # Git exclusions (auto-updated)
```

### Using glootie-cc in Claude Code / claude.ai/code

After installation, add one line to your project settings to tell Claude Code to use these files:

```json
{
  "plugins": [
    "./"
  ]
}
```

That's it. Claude Code now reads `agents/gm.md`, `hooks/`, and `.mcp.json` from your project root and uses them automatically.

### What Gets Installed

- **agents/gm.md** - The unified agent containing all behavioral rules and state machine logic
- **hooks/** - Five hook files that validate tools, process prompts, initialize sessions, and enforce completion
- **.mcp.json** - Configuration for MCP servers (dev and code-search) that provide code execution and search
- **.gitignore** - Updated to exclude `.glootie-stop-verified`

### Requirements

glootie-cc requires `bunx` (from Bun) to run MCP servers:

```bash
bunx --version
```

If not installed, install Bun:

```bash
curl -fsSL https://bun.sh/install | bash
```

## Update

To update glootie-cc to the latest version:

```bash
npm update glootie-cc
```

This updates the agent, hooks, and MCP configuration in your project.

## Features

- State machine agent with exhaustive behavioral rules
- Five enforcement hooks (validation, prompts, startup, completion, git)
- MCP integration for code execution and search
- Automatic thorns AST analysis at session start
- .prd completion enforcement at session end

## Troubleshooting

### Hooks Not Running

**Symptom:** Hooks are not executing during coding sessions.

**Solutions:**

1. Verify hook files exist in your project:
   ```bash
   ls -la hooks/
   ```
   Should show: `pre-tool-use-hook.js`, `prompt-submit-hook.js`, `session-start-hook.js`, `stop-hook.js`, `stop-hook-git.js`

2. Verify .mcp.json exists and is valid JSON:
   ```bash
   cat .mcp.json
   ```

3. Check that Claude Code can find your project's plugin directory:
   ```bash
   cat .claude/settings.json | grep plugins
   ```
   Should show `"plugins": ["./"]`

4. Restart Claude Code completely (close and reopen) to reload hooks.

### MCP Server Connection Failed

**Symptom:** Error about MCP servers not connecting (e.g., "dev server not available").

**Solutions:**

1. Verify bunx is installed:
   ```bash
   bunx --version
   ```

2. Test the dev MCP server manually:
   ```bash
   bunx mcp-glootie@latest
   ```
   Should connect without errors.

3. Test code-search MCP server:
   ```bash
   bunx codebasesearch@latest
   ```

4. Verify .mcp.json has correct MCP server configuration:
   ```bash
   cat .mcp.json
   ```
   Should contain `"mcpServers"` with `"dev"` and `"code-search"` entries.

### .prd Not Enforcing

**Symptom:** `.prd` file is not being checked at session end, or sessions end despite pending items.

**Solutions:**

1. Verify `.prd` file exists:
   ```bash
   cat .prd
   ```
   Should contain pending items (lines starting with `- [ ]`).

2. Verify stop-hook.js exists in your project:
   ```bash
   ls -la hooks/stop-hook.js
   ```

3. Check git is initialized:
   ```bash
   git status
   ```

### Git Enforcement Failing

**Symptom:** Git status is not being checked at session end.

**Solutions:**

1. Verify git is initialized:
   ```bash
   git status
   ```

2. Check stop-hook-git.js exists:
   ```bash
   ls -la hooks/stop-hook-git.js
   ```

3. Stage all changes before session end:
   ```bash
   git add .
   ```

## Uninstall

To remove glootie-cc from your project:

1. Remove installed files:
   ```bash
   rm -rf agents/ hooks/ .mcp.json
   ```

2. Remove npm package:
   ```bash
   npm uninstall glootie-cc
   ```

3. Remove from project settings:
   ```bash
   # Remove "plugins": ["./"] from your .claude/settings.json or project settings
   ```

4. Clean up .gitignore (optional):
   ```bash
   # Remove this line if present:
   .glootie-stop-verified
   ```

