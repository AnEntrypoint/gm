# gm for OpenCode

## Installation

### Global (recommended)

Copy plugin to opencode config:

```bash
mkdir -p ~/.config/opencode/plugin
cp -r . ~/.config/opencode/plugin/
cd ~/.config/opencode/plugin && bun install
```

### Project-level

```bash
mkdir -p .opencode/plugins
cp glootie.mjs index.js package.json .opencode/plugins/
cp -r agents .opencode/plugins/
cd .opencode && bun install
```

## Features

- MCP tools for code execution and search
- State machine agent policy (gm)
- Git enforcement on session idle
- AST analysis via thorns at session start

The plugin activates automatically on session start.
