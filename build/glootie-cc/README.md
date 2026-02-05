# glootie-cc for Claude Code

## Installation

### Plugin Marketplace Installation

The easiest way to install glootie-cc is through Claude Code's plugin marketplace:

```bash
claude plugin marketplace add AnEntrypoint/glootie-cc
claude plugin install -s user gm@glootie-cc
```

### Repository Installation

For development or customization, you can install glootie-cc directly from the repository:

```bash
npm install glootie-cc && npx glootie install
```

This installation method is ideal when you need to:
- Customize hooks or agents for your workflow
- Integrate with existing Claude Code projects
- Use the latest development version before marketplace updates
- Configure platform-specific behavior

#### Installation Command Breakdown

The `npm install glootie-cc && npx glootie install` command performs two steps:

1. **`npm install glootie-cc`** - Downloads the glootie-cc package and stores it in your project's `node_modules/` directory
2. **`npx glootie install`** - Runs the glootie installer that copies configuration files into your Claude Code plugin directory

**Expected output:**
```
$ npm install glootie-cc
added 12 packages in 3.5s

$ npx glootie install
Installing glootie-cc...
✓ Created .claude-plugin/ directory
✓ Copied agents/gm.md
✓ Copied hooks/* (6 files)
✓ Created .mcp.json
✓ Updated .gitignore
Installation complete. Point Claude Code at: ~/.claude-plugins/glootie-cc
```

#### File Installation Locations

After running `npx glootie install`, the following files are installed in your Claude Code plugin directory:

```
~/.claude-plugins/glootie-cc/
├── agents/
│   └── gm.md                      # State machine agent with behavioral rules
├── hooks/
│   ├── hooks.json                 # Hook configuration and enablement
│   ├── pre-tool-use-hook.js        # Validates tools before execution
│   ├── prompt-submit-hook.js       # Processes user prompts
│   ├── session-start-hook.js       # Initializes session, runs thorns analysis
│   ├── stop-hook.js                # Verifies session completion (.prd enforcement)
│   └── stop-hook-git.js            # Enforces git on session end
├── .mcp.json                       # MCP server configuration
├── .gitignore                      # Git exclusions (auto-updated)
└── plugin.json                     # Plugin manifest
```

**Key files explained:**

- **agents/gm.md** - The unified agent that contains all behavioral rules and state machine logic. This is the core of glootie-cc.
- **hooks/hooks.json** - Declares which hooks to run on which events (PreToolUse, SessionStart, UserPromptSubmit, Stop)
- **.mcp.json** - Configures MCP servers (dev and code-search) that provide code execution and search capabilities
- **.gitignore** - Updated with `.glootie-stop-verified` to track session completion state

#### Environment Setup

glootie-cc requires `bunx` to run MCP servers. Verify it's installed:

```bash
bunx --version
```

If not installed, install bun:

```bash
curl -fsSL https://bun.sh/install | bash
```

**MCP Server Configuration** (in `.mcp.json`):

```json
{
  "mcpServers": {
    "dev": {
      "command": "bunx",
      "args": ["mcp-glootie@latest"],
      "timeout": 360000
    },
    "code-search": {
      "command": "bunx",
      "args": ["codebasesearch@latest"],
      "timeout": 360000
    }
  }
}
```

**Default environment variables:**

- `CLAUDE_PLUGIN_ROOT` - Set automatically by Claude Code, points to plugin directory
- `XDG_CONFIG_HOME` - Optional, defaults to `~/.config`
- `NODE_PATH` - Defaults to system Node.js path

No manual environment variable setup is required; Claude Code manages these automatically.

#### Configuring Claude Code to Use Installed Files

After running `npx glootie install`, configure Claude Code to load the installed plugin:

**Option 1: Direct Plugin Directory**

In Claude Code settings, add the plugin directory:

```json
{
  "plugins": [
    "~/.claude-plugins/glootie-cc"
  ]
}
```

**Option 2: Via Plugin Manager**

```bash
claude plugin install -s user gm@glootie-cc
```

**Enable hooks in Claude Code settings:**

Open `~/.claude-plugins/glootie-cc/hooks/hooks.json` and verify all hooks are enabled:

- **PreToolUse** - Validates all tool calls (required for enforcement)
- **SessionStart** - Runs thorns analysis at session start (recommended)
- **UserPromptSubmit** - Processes prompts before execution
- **Stop** - Enforces .prd completion and git status (required)

Each hook references:
```
${CLAUDE_PLUGIN_ROOT}/hooks/[hook-file].js
```

Claude Code automatically expands `${CLAUDE_PLUGIN_ROOT}` to the plugin directory path.

## Update

### Plugin Marketplace Update

```bash
claude plugin marketplace update glootie-cc
claude plugin update gm@glootie-cc
```

### Repository-Based Update

```bash
npm update glootie-cc
npx glootie install
```

## Features

- MCP tools for code execution and search
- State machine agent policy (gm)
- Stop hook verification loop
- Git enforcement on session end
- AST analysis via thorns at session start

The plugin activates automatically on session start.

## Troubleshooting

### Hooks Not Running

**Symptom:** Hooks specified in hooks.json are not executing.

**Solutions:**

1. Verify hooks are enabled in Claude Code:
   ```bash
   cat ~/.claude-plugins/glootie-cc/hooks/hooks.json
   ```
   Ensure `"matcher": "*"` is present for each hook.

2. Check that `${CLAUDE_PLUGIN_ROOT}` is properly set:
   ```bash
   echo $CLAUDE_PLUGIN_ROOT
   ```
   Should output your plugin directory path (e.g., `/Users/name/.claude-plugins/glootie-cc`).

3. Verify hook files are executable:
   ```bash
   ls -la ~/.claude-plugins/glootie-cc/hooks/*.js
   ```
   Should show `-rw-r--r--` permissions (readable).

4. Check Claude Code logs for hook errors:
   - Open Claude Code Developer Console (Help > Toggle Developer Tools)
   - Look for messages containing "hook" or "PreToolUse"

### MCP Server Connection Failed

**Symptom:** Error about MCP servers not connecting (e.g., "dev server not available").

**Solutions:**

1. Verify bunx is installed and working:
   ```bash
   bunx --version
   ```

2. Test MCP server manually:
   ```bash
   bunx mcp-glootie@latest
   ```
   Should output connection details without errors.

3. Verify .mcp.json is valid:
   ```bash
   cat ~/.claude-plugins/glootie-cc/.mcp.json
   ```
   Should be valid JSON with "mcpServers" key.

4. Clear Claude Code cache and restart:
   ```bash
   rm -rf ~/.claude-plugins/glootie-cc/.cache
   ```
   Then restart Claude Code.

### .prd Not Enforcing

**Symptom:** `.prd` file is not being checked at session stop, or tasks appear to complete despite pending items.

**Solutions:**

1. Verify stop-hook.js is running:
   ```bash
   cat ~/.claude-plugins/glootie-cc/hooks/hooks.json | grep -A5 '"Stop"'
   ```
   Should list `stop-hook.js` in Stop hooks.

2. Check that `.prd` file exists and is valid:
   ```bash
   cat .prd
   ```
   Should have pending items listed (lines starting with `- [ ]`).

3. Verify git is initialized in the project:
   ```bash
   git status
   ```
   Should show valid git repository.

4. Check stop-hook.js logic:
   ```bash
   node ~/.claude-plugins/glootie-cc/hooks/stop-hook.js
   ```
   Should output verification status.

### Git Enforcement Failing

**Symptom:** Git status is not being checked at session end, or enforcement is not blocking session completion.

**Solutions:**

1. Verify git is initialized:
   ```bash
   git status
   ```

2. Check stop-hook-git.js is enabled:
   ```bash
   cat ~/.claude-plugins/glootie-cc/hooks/hooks.json | grep stop-hook-git
   ```

3. Verify all changes are staged:
   ```bash
   git status --short
   ```
   Should show no unstaged changes (no first character in status).

4. Review git enforcement policy in agent (agents/gm.md):
   ```bash
   cat ~/.claude-plugins/glootie-cc/agents/gm.md | grep -i "git"
   ```

## Uninstall

To completely remove glootie-cc:

### Plugin Marketplace Uninstall

```bash
claude plugin uninstall gm@glootie-cc
claude plugin marketplace remove glootie-cc
```

### Repository Installation Cleanup

1. Remove installed plugin files:
   ```bash
   rm -rf ~/.claude-plugins/glootie-cc
   ```

2. Remove npm package (if installed locally):
   ```bash
   npm uninstall glootie-cc
   ```

3. Clean up .gitignore (if updated during installation):
   ```bash
   # Remove this line from .gitignore if present:
   .glootie-stop-verified
   ```

4. Verify cleanup:
   ```bash
   ls ~/.claude-plugins/glootie-cc
   # Should output: No such file or directory
   ```

## Installation Comparison: Plugin vs Repository

| Feature | Plugin Marketplace | Repository Installation |
|---------|-------------------|------------------------|
| **Setup Time** | 1-2 minutes | 2-3 minutes |
| **Updates** | Automatic via marketplace | Manual `npm update` + `npx glootie install` |
| **Customization** | Limited (plugin manifest only) | Full (agents, hooks, .mcp.json) |
| **Version Control** | Managed by marketplace | Your choice (include in git or not) |
| **Development** | Not suitable | Ideal for development and debugging |
| **Support** | Official plugin marketplace | Community/self-support |
| **Breaking Changes** | Marketplace gates breaking versions | You control when to update |
| **File Locations** | Marketplace default | Your choice of directory |
| **Multiple Instances** | One per user | Multiple versions possible |
| **Customization Level** | 0% - Static | 100% - Full control |

### When to Use Plugin Marketplace

- You want the easiest installation
- You don't need to customize hooks or agents
- You want automatic updates
- You prefer official support

### When to Use Repository Installation

- You need to customize hooks or agents
- You're developing new features for glootie-cc
- You want to lock specific versions
- You're integrating with other Claude Code plugins
- You need full control over behavior
- You want to contribute back improvements
