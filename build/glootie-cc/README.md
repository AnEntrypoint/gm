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

For development or project-specific customization, install glootie-cc directly into your project:

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
✓ Copied hooks/* (5 files)
✓ Created .mcp.json
✓ Updated .gitignore
Installation complete. Point Claude Code at: ~/.claude/gm-cc
```

#### File Installation Locations

After running `npm install gm-cc`, the following files are installed in your project:

```
project/
├── node_modules/gm-cc/
│   ├── agents/
│   │   └── gm.md                  # State machine agent with behavioral rules
│   ├── hooks/
│   │   ├── pre-tool-use-hook.js     # Validates tools before execution
│   │   ├── prompt-submit-hook.js    # Processes user prompts
│   │   ├── session-start-hook.js    # Initializes session, runs thorns analysis
│   │   ├── stop-hook.js             # Verifies session completion (.prd enforcement)
│   │   └── stop-hook-git.js         # Enforces git on session end
│   ├── .mcp.json                   # MCP server configuration
│   ├── .claude-plugin/
│   │   └── plugin.json             # Plugin manifest
│   └── scripts/
│       └── postinstall.js          # Installation helper
├── .claude/
│   ├── agents/gm.md
│   ├── hooks/* (5 files)
│   ├── .mcp.json
│   └── .gitignore (updated)
└── package.json
```

**Key files explained:**

- **agents/gm.md** - The unified agent that contains all behavioral rules and state machine logic
- **hooks/** - Event handlers for pre-tool validation, session startup, prompts, and completion
- **.mcp.json** - Configures MCP servers (dev and code-search) for code execution and search
- **.claude-plugin/plugin.json** - Plugin metadata for Claude Code plugin system

#### Environment Setup

gm-cc requires `bunx` to run MCP servers. Verify it's installed:

```bash
bunx --version
```

If not installed, install Bun:

```bash
curl -fsSL https://bun.sh/install | bash
```

#### MCP Server Configuration

The `.mcp.json` file is automatically created/updated during installation. It configures:

```json
{
  "mcpServers": {
    "dev": {
      "command": "bunx",
      "args": ["mcp", "dev"],
      "env": {}
    },
    "code-search": {
      "command": "bunx",
      "args": ["mcp", "code-search"],
      "env": {}
    }
  }
}
```

These MCP servers provide:
- **dev** - Code execution and interactive development
- **code-search** - Semantic code search across your repository

#### Hook Enablement

Hooks are automatically enabled when installed. The hooks system enforces:

- **pre-tool-use-hook.js** - Validates tool requests before execution
- **prompt-submit-hook.js** - Processes user prompts and applies rules
- **session-start-hook.js** - Runs on session start (thorns analysis)
- **stop-hook.js** - Verifies .prd completion before session end
- **stop-hook-git.js** - Enforces git operations on session completion

## Update

### Marketplace Installation

```bash
claude plugin update gm-cc
```

### Project Installation

```bash
npm update gm-cc
```

The installation will re-run postinstall and update all files.

## Features

- **State machine agent** - Complete behavioral rule system for development
- **Five enforcement hooks** - Validation, prompts, startup, completion, git enforcement
- **MCP integration** - Code execution and semantic code search
- **Automatic thorns analysis** - AST analysis on session start
- **.prd enforcement** - Completion blocking at session end
- **Dual-mode installation** - Both user-wide (marketplace) and project-specific (npm)
- **Automatic setup** - No manual configuration needed
- **Convention-driven** - Works with existing code structure
