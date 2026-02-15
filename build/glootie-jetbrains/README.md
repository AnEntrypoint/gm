# Glootie for JetBrains IDEs

AI state machine plugin for all JetBrains IDEs with semantic code search.

## Supported IDEs

- IntelliJ IDEA
- PyCharm
- WebStorm
- GoLand
- CLion
- Rider
- PhpStorm

## Installation

From Plugin Marketplace:
1. Open IDE
2. Settings → Plugins → Marketplace
3. Search "Glootie"
4. Install and restart

## Features

- **Semantic Code Search**: Use natural language to explore your codebase
  - "Find authentication validation" → Discovers auth checks, guards, permission logic
  - "Where is database initialization?" → Finds connections, migrations, schemas
  - "Show error handling patterns" → Locates try/catch, error boundaries, handlers
- Unified state machine
- Code analysis
- Real-time sync
- Hot reload
- Multi-language support

## Semantic Code Search

Your IDE uses **semantic code search** - describe what you're looking for in plain language, not regex.

### How It Works
- Intent-based queries understand meaning across files
- Finds related code patterns regardless of implementation
- Discovers where features are implemented across your project

### When to Use
- Exploring unfamiliar codebases
- Finding similar patterns
- Understanding component integrations
- Locating feature implementations
- Discovering related code sections

## Quick Start

1. Tools → Glootie → Activate
2. Ctrl+Alt+Shift+G (Show State)
3. Right-click → Glootie → Analyze
4. Use semantic code search: type "Find [what you're looking for]" in queries

## Configuration

Settings → Tools → Glootie

## License

MIT
