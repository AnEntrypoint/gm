# Technical Caveats & Gotchas

## Complete Repository List - plugforge Builds 9 Repos

plugforge automatically generates and publishes these GitHub repositories:

### CLI Platforms (9 Repos)
1. **glootie-cc** - https://github.com/AnEntrypoint/glootie-cc - Claude Code plugin
2. **glootie-gc** - https://github.com/AnEntrypoint/glootie-gc - Gemini CLI extension
3. **glootie-oc** - https://github.com/AnEntrypoint/glootie-oc - OpenCode plugin
4. **glootie-codex** - https://github.com/AnEntrypoint/glootie-codex - Codex plugin
5. **glootie-copilot-cli** - https://github.com/AnEntrypoint/glootie-copilot-cli - GitHub Copilot CLI profile
6. **glootie-vscode** - https://github.com/AnEntrypoint/glootie-vscode - VS Code extension (TypeScript, esbuild)
7. **glootie-cursor** - https://github.com/AnEntrypoint/glootie-cursor - Cursor extension (VSCode-compatible)
8. **glootie-zed** - https://github.com/AnEntrypoint/glootie-zed - Zed extension (Rust, Cargo)
9. **glootie-jetbrains** - https://github.com/AnEntrypoint/glootie-jetbrains - JetBrains plugin (Kotlin, Gradle)

Each repo is auto-generated from `plugforge-starter/` by GitHub Actions workflow on every commit to main. Generated repos are fully functional and ready to install/build/publish.

## Claude Code Skills Architecture (Jan 28)

Proper Claude Code plugins use skills for specialized knowledge. Skills are discovered from `plugforge-starter/skills/` directory with proper structure:

```
skills/
├── web-search/
│   └── SKILL.md
└── code-search/
    └── SKILL.md
```

Each SKILL.md requires YAML frontmatter:
```yaml
---
name: skill-name
description: When to use this skill
---

# Skill instructions and guidelines...
```

The convention-loader discovers skills and CLI adapters include `skills/` in all platform outputs. Skills are automatically available in generated plugins.

## Build System Integration

Skills are included by:
- `convention-loader.js::loadSkills()` - discovers SKILL.md files
- `cli-adapter.js::createFileStructure()` - copies skills to output
- All platform adapters (VSCode, Cursor, Zed, JetBrains, etc) - include skills/ in their generated output
- `package.json` files array - includes `"skills/"` to ensure npm distribution

Without skills/ in package.json files array, skills won't be published.

## 12 Available Skills (Jan 28)

Extracted from gm.md into context-specific skills:
1. **code-search** - Semantic code exploration by meaning
2. **web-search** - Internet research with iterative refinement
3. **hot-reload-systems** - Zero-downtime code reloading and state preservation
4. **recovery-mechanisms** - Checkpoint, restore, self-healing patterns
5. **uncrashable-design** - Recovery hierarchy and infinite uptime by design
6. **async-patterns** - Promise containment and signal coordination
7. **memory-optimization** - Resource tracking and explicit cleanup cycles
8. **debug-hooks** - Expose internals via global scope for live inspection
9. **cleanup-standards** - Keep only functional code, remove ephemeral files
10. **exhaustive-execution** - Test every path, failure, and recovery scenario
11. **search-when-unknown** - Web search protocol with iterative refinement
12. **thorns-overview** - Codebase analysis using mcp-thorns for context

gm.md explicitly instructs to use skills whenever possible and applicable.
