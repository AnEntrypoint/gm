# gm for Gemini CLI

## Installation

**Windows and Unix:**
```bash
git clone https://github.com/AnEntrypoint/glootie-gc ~/.gemini/extensions/gm
```

**Windows PowerShell:**
```powershell
git clone https://github.com/AnEntrypoint/glootie-gc "\$env:APPDATA\gemini\extensions\gm"
```

## Automatic Path Resolution

Hooks automatically use `${extensionPath}` for path resolution. No manual environment variable setup required. The extension is fully portable.

## Features

- MCP tools for code execution and search
- State machine agent policy (gm)
- Stop hook verification loop
- Git enforcement on session end
- AST analysis via thorns at session start

The extension activates automatically on session start.
