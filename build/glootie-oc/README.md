# glootie for OpenCode

## Installation

### Local (project-level)

```bash
./setup.sh
```

Or on Windows:

```bat
setup.bat
```

### Global

```bash
./install-global.sh
```

Or on Windows:

```bat
install-global.bat
```

## Environment

Set OC_PLUGIN_ROOT to your plugin directory in your shell profile.

## Features

- MCP tools for code execution and search
- State machine agent policy (gm)
- Stop hook verification loop
- Git enforcement on session end
- AST analysis via thorns at session start

The plugin activates automatically on session start.
