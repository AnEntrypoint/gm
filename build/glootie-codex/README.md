# gm for Codex

## Installation

Copy to your Codex plugins directory:

```bash
cp -r . ~/.codex/plugins/gm
```

Or clone directly:

```bash
git clone https://github.com/AnEntrypoint/glootie-codex ~/.codex/plugins/gm
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
