# gm for OpenCode

## Installation

### Global (recommended)

**Windows and Unix:**
```bash
git clone https://github.com/AnEntrypoint/glootie-oc ~/.config/opencode/plugin && cd ~/.config/opencode/plugin && bun install
```

**Windows PowerShell:**
```powershell
git clone https://github.com/AnEntrypoint/glootie-oc "\$env:APPDATA\opencode\plugin" && cd "\$env:APPDATA\opencode\plugin" && bun install
```

### Project-level

**Windows and Unix:**
```bash
git clone https://github.com/AnEntrypoint/glootie-oc .opencode/plugins && cd .opencode/plugins && bun install
```

## Features

- MCP tools for code execution and search
- State machine agent policy (gm)
- Git enforcement on session idle
- AST analysis via thorns at session start

The plugin activates automatically on session start.
