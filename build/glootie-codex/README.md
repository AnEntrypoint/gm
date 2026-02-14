# gm for Codex

## Installation

**Windows and Unix:**
```bash
git clone https://github.com/AnEntrypoint/glootie-codex ~/.codex/plugins/gm
```

**Windows PowerShell:**
```powershell
git clone https://github.com/AnEntrypoint/glootie-codex "\$env:APPDATA\codex\plugins\gm"
```

## Environment

Set CODEX_PLUGIN_ROOT to your plugin directory in your shell profile.

## Features

- MCP tools for code execution and search
- State machine agent policy (gm)
- Stop hook verification loop
- Git enforcement on session end
- AST analysis via thorns at session start

The plugin activates automatically on session start.
