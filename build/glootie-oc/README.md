# gm for OpenCode

## Installation

### Global (recommended)

**Windows and Unix:**
```bash
mkdir -p ~/.config/opencode/plugins && git clone https://github.com/AnEntrypoint/glootie-oc ~/.config/opencode/plugins/glootie-oc && cd ~/.config/opencode/plugins/glootie-oc && bun install
```

**Windows PowerShell:**
```powershell
mkdir -Force "$env:APPDATA\opencode\plugins"; git clone https://github.com/AnEntrypoint/glootie-oc "$env:APPDATA\opencode\plugins\glootie-oc"; cd "$env:APPDATA\opencode\plugins\glootie-oc"; bun install
```

### Project-level

**Windows and Unix:**
```bash
mkdir -p .opencode/plugins && git clone https://github.com/AnEntrypoint/glootie-oc .opencode/plugins/glootie-oc && cd .opencode/plugins/glootie-oc && bun install
```

**Windows PowerShell:**
```powershell
mkdir -Force ".opencode\plugins"; git clone https://github.com/AnEntrypoint/glootie-oc ".opencode\plugins\glootie-oc"; cd ".opencode\plugins\glootie-oc"; bun install
```

## Features

- MCP tools for code execution and search
- State machine agent policy (gm)
- Git enforcement on session idle
- AST analysis via thorns at session start

The plugin activates automatically on session start.
