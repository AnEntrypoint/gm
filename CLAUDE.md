# Technical Caveats & Gotchas

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
