# gm for OpenCode

## Installation

### One-liner (recommended)

Install directly from npm using bun x:

```bash
bun x gm-oc@latest
```

This command will automatically install gm-oc to the correct location for your platform and restart OpenCode to activate.

### Manual installation

**Windows and Unix:**
```bash
git clone https://github.com/AnEntrypoint/gm-oc ~/.config/opencode/plugin && cd ~/.config/opencode/plugin && bun install
```

**Windows PowerShell:**
```powershell
git clone https://github.com/AnEntrypoint/gm-oc "\$env:APPDATA\opencode\plugin" && cd "\$env:APPDATA\opencode\plugin" && bun install
```

### Project-level

**Windows and Unix:**
```bash
git clone https://github.com/AnEntrypoint/gm-oc .opencode/plugins && cd .opencode/plugins && bun install
```

## Features

- MCP tools for code execution and search
- State machine agent policy (gm)
- Git enforcement on session idle
- AST analysis via thorns at session start

The plugin activates automatically on session start.
