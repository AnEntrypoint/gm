# Glootie Builder

Production-ready AI plugin builder for 8 platforms. Convention-driven, zero-config, black magic automation.

**Build once. Deploy everywhere.**

## Key Features

- **Convention Over Configuration**: Drop files in standard directories, builder auto-detects structure
- **Zero Config**: Works with just `plugin.json` and your hook code
- **Black Magic**: Single hook code translates to 8 platform-specific formats automatically
- **Multi-Platform**: Support for CLI tools, IDEs, and browsers
- **Hot Reload Ready**: State lives outside code for zero-downtime updates
- **Production Grade**: Real data only, no mocks, full error recovery

## Quick Start

```bash
# 1. Copy starter template
cp -r glootie-starter my-plugin
cd my-plugin

# 2. Edit configuration
nano plugin.json

# 3. Run builder
plugforge . ../build

# 4. Publish to platforms
# Output in ../build/ ready for each platform
```

## Platforms

| Platform | Type | Status |
|----------|------|--------|
| Claude Code | CLI | Stable |
| Gemini CLI | CLI | Stable |
| OpenCode | CLI | Stable |
| GitHub Copilot CLI | CLI | Stable |
| VS Code | Extension | Stable |
| Cursor | Extension | Stable |
| Zed | Extension | Stable |
| JetBrains | Extension | Stable |

## Usage

```bash
plugforge ./plugin-dir                # Build for all 8 platforms
plugforge ./plugin-dir ./output-dir   # Specify output directory
```

The builder always generates output for all 8 platforms - select desired platforms during deployment.

## Installation

```bash
npm install -g plugforge
# or
npx plugforge ./my-plugin ./output
```

## How It Works

**Hooks** (your JavaScript code) → **Adapters** (translate to platform syntax) → **8 distributions**

Single `session-start.js` hook becomes:
- Claude Code hook (subprocess)
- Gemini CLI middleware (subprocess)
- OpenCode SDK handler (subprocess)
- GitHub Copilot CLI wrapper (subprocess)
- VS Code TypeScript handler (in-process)
- Cursor TypeScript handler (in-process)
- Zed JavaScript handler (in-process)
- JetBrains plugin event listener (in-process)

## Structure

```
my-plugin/
├── plugin.json              # Configuration (name, version, author, license)
├── README.md                 # Plugin documentation
├── agents/                   # AI system prompts (*.md files)
│   ├── gm.md
│   ├── codesearch.md
│   └── websearch.md
└── hooks/                    # Implementation (*.js files)
    ├── session-start.js      # Plugin activation
    ├── pre-tool.js           # Before tool execution
    ├── prompt-submit.js      # When user submits prompt
    ├── stop.js               # Plugin shutdown
    └── stop-git.js           # Git cleanup
```

## Documentation

See documentation in the builder repository:
- **CLAUDE.md** - Technical caveats and gotchas
- **GETTING_STARTED.md** - Step-by-step plugin creation
- **ARCHITECTURE.md** - System design and concepts
- **PLATFORMS.md** - Platform-specific details and publishing
- **API.md** - Configuration schema and hook signatures

## Creating a Plugin

1. `cp -r glootie-starter my-plugin`
2. Edit `plugin.json` with your plugin details (required)
3. Customize hook implementations in `hooks/` directory (optional - defaults provided)
4. Add/update agents in `agents/` directory (optional - used as reference, not copied to output)
5. Run `plugforge . ../build` to generate all 8 platform outputs
6. Select desired platforms from output directory and deploy

## License

MIT

## Repository

https://github.com/AnEntrypoint/plugforge
