# gm for Kilo CLI

## Installation

### One-liner (recommended)

Install directly from npm using bun x:

```bash
bun x gm-kilo@latest
```

This command will automatically install gm-kilo to the correct location for your platform and restart Kilo to activate.

### Manual installation

**Windows and Unix:**
```bash
git clone https://github.com/AnEntrypoint/gm-kilo ~/.config/kilo/plugin && cd ~/.config/kilo/plugin && bun install
```

**Windows PowerShell:**
```powershell
git clone https://github.com/AnEntrypoint/gm-kilo "\$env:APPDATA\kilo\plugin" && cd "\$env:APPDATA\kilo\plugin" && bun install
```

### Step 2: Configure MCP Servers

Kilo uses the OpenCode configuration format. Create or update `~/.config/kilo/opencode.json`:

```json
{
  "\$schema": "https://opencode.ai/config.json",
  "mcp": {
    "dev": {
      "type": "local",
      "command": ["bun x", "mcp-gm@latest"],
      "timeout": 360000,
      "enabled": true
    },
    "code-search": {
      "type": "local",
      "command": ["bun x", "codebasesearch@latest"],
      "timeout": 360000,
      "enabled": true
    }
  }
}
```

### Step 3: Update Kilo Configuration

Update `~/.config/kilo/kilocode.json` to reference the plugin:

```json
{
  "\$schema": "https://kilo.ai/config.json",
  "default_agent": "gm",
  "plugin": ["/home/user/.config/kilo/plugin"]
}
```

Replace `/home/user` with your actual home directory path.

### Step 4: Verify Installation

Start Kilo and verify the tools appear:
```bash
kilo
```

Check MCP tools are connected:
```bash
kilo mcp list
```

You should see `dev` and `code-search` marked as connected.

## Features

- **MCP tools** - Code execution (`dev`) and semantic search (`code-search`)
- **State machine agent** - Complete `gm` behavioral rule system
- **Git enforcement** - Blocks uncommitted changes and unpushed commits on session idle
- **AST analysis** - Automatic codebase analysis via mcp-thorns on session start
- **.prd enforcement** - Blocks exit if work items remain in .prd file

## Troubleshooting

**MCP tools not appearing:**
- Verify `~/.config/kilo/opencode.json` exists with correct MCP server definitions
- Check that `plugin` path in `kilocode.json` points to the correct directory
- Run `kilo mcp list` to verify servers are connected
- Restart Kilo CLI completely

**Plugin not loading:**
- Verify plugin path in `kilocode.json` is absolute (e.g., `/home/user/.config/kilo/plugin`, not relative)
- Check `index.js` and `gm.mjs` exist in the plugin directory
- Run `bun install` in the plugin directory to ensure dependencies are installed

The plugin activates automatically on session start once MCP servers are configured.
