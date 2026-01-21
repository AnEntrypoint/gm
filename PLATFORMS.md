# Platforms: Complete Reference

Detailed information about all 8 supported platforms.

## Platform Overview

| Platform | Type | Config | Build | Status |
|----------|------|--------|-------|--------|
| Claude Code | CLI | plugin.json | No | Stable |
| Gemini CLI | CLI | gemini-extension.json | No | Stable |
| OpenCode | CLI | opencode.json | No | Stable |
| GitHub Copilot CLI | CLI | copilot-profile.md | No | Stable |
| VS Code | Extension | package.json | Yes | Stable |
| Cursor | Extension | package.json | No | Stable |
| Zed | Extension | extension.json | Yes | Stable |
| JetBrains | Extension | plugin.xml | Yes | Stable |

## CLI Platforms (No Build Required)

### Claude Code (cc)
- Config: plugin.json
- Hook format: module.exports wrapper
- Installation: Copy to ~/.claude-code/plugins/
- Distribution: Direct copy

### Gemini CLI (gc)
- Config: gemini-extension.json
- Hook format: ES6 export
- Installation: Copy to ~/.gemini/extensions/
- Distribution: Direct copy

### OpenCode (oc)
- Config: opencode.json
- Hook format: Class-based
- Installation: Copy to ~/.opencode/plugins/
- Distribution: Direct copy

### GitHub Copilot CLI (copilot-cli)
- Config: copilot-profile.md
- Hook format: Markdown + JS
- Installation: Copy to ~/.copilot/profiles/
- Distribution: Direct copy

## Extension Platforms

### VS Code (vscode)
- Config: package.json (VSCode manifest)
- Hook format: TypeScript async
- Build: npm install && npm run compile
- Build tool: esbuild (bundled)
- Marketplace: VS Code Marketplace
- Installation: Install from marketplace or VSIX

### Cursor (cursor)
- Config: package.json
- Hook format: TypeScript async
- Build: Not required (uses VSCode format)
- Marketplace: Cursor settings
- Installation: Copy or reference in config

### Zed (zed)
- Config: extension.json
- Hook format: Rust async
- Build: cargo build --release
- Build tool: Rust toolchain required
- Marketplace: Zed registry
- Installation: Place compiled .so in Zed extensions

### JetBrains (jetbrains)
- Config: plugin.xml
- Hook format: Kotlin override
- Build: ./gradlew build
- Build tool: Java, Gradle required
- Marketplace: JetBrains Marketplace
- Installation: Install JAR or from marketplace

## Installation Quick Reference

**CLI Platforms:**
```bash
cp dist/{cc,gc,oc,copilot-cli}/ ~/.{platform}/extensions/
# Restart platform
```

**VS Code:**
```bash
cd dist/vscode && npm install && npm run compile
# Test or publish to marketplace
```

**Cursor:**
```bash
cp -r dist/cursor/* ~/.cursor/extensions/
# Restart Cursor
```

**Zed:**
```bash
cd dist/zed && cargo build --release
# Binary in target/release/
```

**JetBrains:**
```bash
cd dist/jetbrains && ./gradlew build
# JAR in build/distributions/
```

## Platform Feature Matrix

| Feature | CC | GC | OC | VSCode | Cursor | Zed | JetBrains | Copilot |
|---------|-----|-----|-----|---------|---------|-----|-----------|---------|
| Agents | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Hooks | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| MCP | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ |
| Hot Reload | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Marketplace | Direct | Direct | Direct | Yes | Settings | Yes | Yes | Direct |

## Platform-Specific Notes

### Claude Code
- Requires Claude Code installation
- Plugins auto-discovered in ~/.claude-code/plugins/
- Restart required for changes

### Gemini CLI
- Requires Gemini CLI setup
- Hot reload supported
- ES6 module format required

### OpenCode
- Class-based hook design
- Platform-specific conventions
- OpenCode CLI required

### VS Code
- VSCode API types required: `npm install --save-dev @types/vscode`
- Publish via vsce CLI
- Marketplace approval process
- Publisher account required on marketplace

### Cursor
- VSCode-compatible
- Cursor-specific features in newer versions
- MCP servers in .cursor/mcp.json

### Zed
- Rust async functions
- Zed API unstable (version pins needed)
- Cargo build mandatory
- Large compile times

### JetBrains
- Kotlin or Java required
- IntelliJ SDK (~2GB) required
- Gradle build mandatory
- Plugin ID must be unique (reverse domain)
- Marketplace approval required

### Copilot CLI
- Markdown config format
- Embedded code blocks
- Direct distribution

## Publishing Checklist

- [ ] Build output verified
- [ ] All hooks formatted correctly
- [ ] Agents included
- [ ] MCP servers configured
- [ ] README documentation complete
- [ ] License file included
- [ ] Version number updated
- [ ] Tested on target platform
- [ ] Published/installed successfully
