# gm-cc for Claude Code

## Installation

### Plugin Marketplace Installation (Recommended)

The easiest way to install gm-cc is through Claude Code's plugin marketplace:

```bash
claude plugin marketplace add AnEntrypoint/gm-cc
claude plugin install -s user gm@gm-cc
```

This installation method is best for:
- One-time plugin installation across all projects
- Always having the latest version
- Minimal setup and configuration
- Access to marketplace updates

### Repository Installation (Project-Specific)

For development or project-specific customization, install gm-cc directly into your project:

```bash
cd /path/to/your/project
npm install gm-cc && npx glootie install
```

This installation method is ideal when you need to:
- Customize hooks or agents for your workflow
- Integrate with existing Claude Code projects
- Use the latest development version
- Configure platform-specific behavior per project

#### Installation Command Breakdown

The `npm install gm-cc && npx glootie install` command performs two steps:

1. **`npm install gm-cc`** - Downloads the gm-cc package and stores it in your project's `node_modules/` directory
2. **`npx glootie install`** - Runs the glootie installer that copies configuration files into your Claude Code plugin directory

**Expected output:**
```
$ npm install gm-cc
added 1 package in 1.2s

$ npx glootie install
Installing gm-cc...
✓ Created .claude/ directory
✓ Copied agents/gm.md
✓ Copied hooks to .claude/hooks/
✓ Created .mcp.json for MCP integration
```

#### Installed File Structure (Project-Specific)

After running `npx glootie install`, your project will have:

```
.claude/
├── agents/
│   └── gm.md                 # State machine agent rules
├── hooks/
│   ├── pre-tool-use-hook.js  # Tool validation and filtering
│   ├── session-start-hook.js # Session initialization
│   ├── prompt-submit-hook.js # Prompt validation
│   ├── stop-hook.js          # Session completion enforcement
│   └── stop-hook-git.js      # Git state verification
└── .mcp.json                 # MCP server configuration
```

Each hook runs automatically at the appropriate session event. No manual trigger needed.

## File Installation (Manual Setup)

If you prefer manual file management, clone the repository and copy files directly:

```bash
# Clone the repository
git clone https://github.com/AnEntrypoint/gm-cc.git

# Copy to your Claude Code plugin directory
cp -r ./agents ~/.claude/agents
cp -r ./hooks ~/.claude/hooks
cp .mcp.json ~/.claude/.mcp.json
```

## Environment Setup

```bash
# Ensure you have Node.js and bunx installed
# bunx is required for hook execution
# It's bundled with Node.js 18+
which bunx
bunx --version
```

## MCP Server Configuration

The `.mcp.json` file automatically configures:
- **dev**: Local code execution environment (uses `bunx`)
- **code-search**: Semantic code search via mcp-codebasesearch

No additional configuration needed.

## Configuration

### Option 1: Marketplace Installation (Default)

Marketplace installations use the default configuration. All settings work out-of-box:
- Hooks auto-detect file locations in .claude/hooks/
- MCP servers configured via included .mcp.json
- Agents loaded from .claude/agents/gm.md

### Option 2: Project-Specific Installation

For project customization:

1. **Edit agents/gm.md** to adjust behavioral rules
2. **Modify hooks** in .claude/hooks/ for custom behavior
3. **Update .mcp.json** to add or change MCP servers

Customizations are isolated to your project and won't affect other installations.

## Hook Enablement

Hooks run automatically once installed. To verify hooks are active:

1. Restart Claude Code
2. Start a new session
3. You should see hook output in the Claude Code terminal

If hooks don't activate:
- Check that .claude/hooks/ directory exists
- Verify hook files have executable permissions
- Ensure .mcp.json references the correct hook paths

## Update Procedures

### Plugin Marketplace Installation

```bash
# Method 1: Via Claude Code commands
claude plugin marketplace update gm-cc
claude plugin update gm@gm-cc

# Method 2: Manual update
npm install -g gm-cc@latest
```

### Project-Specific Installation

```bash
# Update the package
npm update gm-cc

# Re-run the installer to update .claude/ directory
npx glootie install

# Or manually copy updated files
cp -r node_modules/gm-cc/agents/* .claude/agents/
cp -r node_modules/gm-cc/hooks/* .claude/hooks/
cp node_modules/gm-cc/.mcp.json .claude/.mcp.json
```

## Features

- **State machine agent** - Complete behavioral rule system for development
- **Five enforcement hooks** - Validation, prompts, startup, completion, git enforcement
- **MCP integration** - Code execution and semantic code search
- **Automatic thorns analysis** - AST analysis on session start
- **.prd enforcement** - Completion blocking at session end
- **Dual-mode installation** - Both user-wide (marketplace) and project-specific (npm)
- **Automatic setup** - No manual configuration needed
- **Convention-driven** - Works with existing code structure

## Troubleshooting

### Hooks not running

**Symptom:** Hooks don't execute when expected

**Solutions:**
1. Verify .claude/hooks/ directory exists: `ls -la ~/.claude/hooks/`
2. Check hook files are executable: `chmod +x ~/.claude/hooks/*.js`
3. Restart Claude Code completely
4. Check if hooks are loaded: Look for hook output in Claude Code terminal

### MCP servers not available

**Symptom:** Code execution or search tools don't work

**Solutions:**
1. Verify .mcp.json exists: `cat ~/.claude/.mcp.json`
2. Check MCP configuration references correct paths
3. Ensure bunx is installed: `which bunx`
4. Restart Claude Code and retry

### Plugin not appearing in marketplace

**Symptom:** Plugin doesn't show in `claude plugin marketplace list`

**Solutions:**
1. Check plugin is published: `npm view gm-cc`
2. Verify package.json has correct plugin metadata
3. Check .claude-plugin/marketplace.json is valid JSON
4. Wait 5-10 minutes for marketplace index to refresh

### Permission denied errors

**Symptom:** "Permission denied" when running hooks

**Solutions:**
1. Make hook files executable: `chmod +x ~/.claude/hooks/*.js`
2. Check parent directories are readable: `chmod 755 ~/.claude ~/.claude/hooks`
3. Verify Claude Code process has file access

### Installation failed with npm

**Symptom:** `npm install` fails with network or permission errors

**Solutions:**
1. Check internet connection
2. Clear npm cache: `npm cache clean --force`
3. Use `npm install` with `--legacy-peer-deps` if needed
4. Check disk space: `df -h`
5. Run `npm audit fix` to resolve dependency issues

## Uninstall

### Plugin Marketplace

```bash
claude plugin remove gm@gm-cc
```

### Project-Specific

```bash
# Remove from project
npm uninstall gm-cc

# Remove configuration
rm -rf .claude/
```

## Installation Comparison

| Method | Setup Time | Scope | Updates | Best For |
|--------|-----------|-------|---------|----------|
| **Marketplace** | 2 minutes | User-wide | One-click | Most users, all projects |
| **Project Installation** | 5 minutes | Per-project | `npm update` | Custom configurations |
| **File Installation** | 10 minutes | Per-project | Manual | Advanced users, offline setup |

## Contributing

Issues and pull requests welcome: [GitHub Issues](https://github.com/AnEntrypoint/gm-cc/issues)

## License

MIT - See LICENSE file for details
