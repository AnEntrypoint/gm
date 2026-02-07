# gm-cc for Claude Code

## Installation

This package supports three installation modes:

### Mode 1: Standalone (npm install in project)

Install gm-cc into your project to add the gm state machine and hooks:

```bash
cd /path/to/your/project
npm install gm-cc
```

The postinstall script automatically copies files to your project's `.claude/` directory:

```
project/
├── node_modules/gm-cc/
└── .claude/
    ├── agents/
    │   └── gm.md
    ├── hooks/
    │   ├── pre-tool-use-hook.js
    │   ├── session-start-hook.js
    │   ├── prompt-submit-hook.js
    │   ├── stop-hook.js
    │   └── stop-hook-git.js
    └── .mcp.json
```

Claude Code automatically discovers and reads from the `.claude/` directory without any configuration needed.

### Mode 2: Plugin System (global or distributed)

For Claude Code plugin system recognition, the package includes `.claude-plugin/plugin.json`:

```
node_modules/gm-cc/
└── .claude-plugin/
    └── plugin.json
```

When installed globally or via the Claude Code plugin system, the plugin.json enables:
- Automatic agent discovery via Claude Code plugin system
- Direct plugin installation without manual file copying
- Marketplace distribution and updates

### Mode 3: Both Modes

The package includes both mechanisms:
- `.claude-plugin/plugin.json` for plugin system recognition
- `scripts/postinstall.js` for standalone npm installation
- Both coexist without conflict

Standalone mode takes precedence when installed locally. Plugin mode available when used with the plugin system.

## Update

```bash
npm update gm-cc
```

The postinstall script runs again and updates all files in `.claude/`.

## Features

- State machine agent with exhaustive behavioral rules
- Five enforcement hooks (validation, prompts, startup, completion, git)
- MCP integration for code execution and search
- Automatic thorns AST analysis at session start
- .prd completion enforcement at session end
- Dual-mode installation: standalone npm or Claude Code plugin system
- Automatic .claude/ directory setup via postinstall in standalone mode
- Plugin system discovery via .claude-plugin/plugin.json in plugin mode
