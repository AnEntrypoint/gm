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
