# Glootie - GM State Machine for VSCode

An AI-powered state machine extension for Visual Studio Code with dynamic adaptation and autonomous decision-making.

## Features

- **State Machine**: Persistent state management with checkpointing and recovery
- **Autonomous Agents**: AI-driven agents for code analysis and development tasks
- **Hot Reload**: Zero-downtime updates to agent logic
- **Real-Time Debugging**: Inspect internal state and agent behavior
- **Code Search**: Semantic code search via integrated agents
- **Web Search**: LLM-powered web search capabilities

## Installation

**Windows, macOS, and Linux:**
1. Open VSCode Extension Marketplace (Ctrl+Shift+X / Cmd+Shift+X)
2. Search for "Glootie"
3. Click Install

**Manual installation:**
```bash
git clone https://github.com/AnEntrypoint/glootie-vscode && cd glootie-vscode && npm install && vsce package && code --install-extension glootie-*.vsix
```

## Quick Start

Once installed, the extension activates automatically. Access Glootie via:
- Command palette: `Ctrl+Shift+P` → "Glootie: Activate"
- View: Look for "Glootie" panel in the Explorer sidebar

## Configuration

Configure via VSCode settings (`settings.json`):

```json
{
  "glootie.enabled": true,
  "glootie.autoActivate": true,
  "glootie.logLevel": "info"
}
```

## Development

See agents documentation in `agents/`:
- `agents/gm.md` - GM state machine agent
- `agents/codesearch.md` - Code search agent
- `agents/websearch.md` - Web search agent

## Publishing

Build and publish to VSCode Marketplace:

```bash
npm install -g vsce
vsce publish
```

## License

MIT
