# Glootie for Zed

AI-powered state machine for Zed Editor with native Claude 3.5 Sonnet support, autonomous agent coordination, and MCP integration.

## Building from Source

### Prerequisites

- Rust 1.70+ (install from https://rustup.rs/)
- Cargo (included with Rust)
- Zed development environment

### Build Steps

```bash
cargo build --release
```

The compiled extension will be in `target/release/glootie.so` (Linux/Mac) or `glootie.dll` (Windows).

## Installation

### From Built Binary

1. Compile with `cargo build --release`
2. Copy compiled library to Zed extensions directory:
   - macOS/Linux: `~/.config/zed/extensions/glootie`
   - Windows: `%APPDATA%\\Zed\\extensions\\glootie`
3. Restart Zed

### From Registry

Once published to Zed registry, install directly from Zed settings.

## Features

- Native Claude 3.5 Sonnet integration
- Async state machine with checkpointing
- Autonomous agent coordination
- MCP server support
- Real-time state inspection
- Multi-language support: Rust, JavaScript, TypeScript, Python, Go, Java, Kotlin, Swift, C#
- Hot reload support (with care)

## Quick Start

After installation:

1. Open Zed
2. Press `Cmd+Shift+P` (macOS) or `Ctrl+Shift+P` (Linux/Windows)
3. Type "Activate State Machine" to enable Glootie
4. Use "Toggle AI Assistant" to enable/disable AI features
5. Type "Show State" to view current machine status

## Configuration

Edit `~/.config/zed/settings.json`:

```json
{
  "glootie": {
    "enabled": true,
    "autoActivate": true,
    "logLevel": "info",
    "llm": "claude-3-5-sonnet",
    "temperature": 0.7,
    "contextWindow": 200000
  }
}
```

## Architecture

### Extension Lifecycle

1. **Activation**: Zed loads WASM module via FFI
2. **Initialization**: Register commands and language support
3. **Runtime**: Process commands, maintain state, coordinate agents
4. **Deactivation**: Clean up resources and state

### Language Server Integration

Glootie integrates with Zed's language server protocol for:
- Code completion
- Diagnostics
- Code formatting
- Hover information
- Navigation

### MCP Support

Model Context Protocol servers can be registered in extension.toml for:
- Tool execution
- Resource access
- Prompts and context

## Development

### Project Structure

```
glootie-zed/
├── Cargo.toml              # Rust dependencies and metadata
├── extension.toml          # Zed extension manifest
├── src/
│   └── lib.rs             # Main extension code
├── agents/                # AI agent definitions
│   ├── gm.md
│   ├── codesearch.md
│   └── websearch.md
└── skills/                # Specialized skills
    ├── code-search/
    ├── web-search/
    └── ...
```

### Building Documentation

Generate docs with:
```bash
cargo doc --open
```

### Running Tests

```bash
cargo test
```

## Troubleshooting

### Extension fails to load

Check `~/.config/zed/extensions/glootie` exists with compiled binary.

### Commands not available

Restart Zed after installation. Run `cargo build --release` if binary is missing.

### Performance issues

Disable `glootie.autoActivate` in settings and manually activate when needed.

## Performance Notes

- Compiled WASM module is optimized with LTO and minimal size
- Async runtime via Tokio for non-blocking operations
- State machine uses minimal memory footprint

## License

MIT

## Support

Report issues: https://github.com/AnEntrypoint/glootie-zed/issues
