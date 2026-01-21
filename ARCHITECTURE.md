# Architecture: How Glootie Works

Deep dive into the system design and hook translation magic.

## System Overview

```
Plugin Directory (Your Code)
├── glootie.json
├── agents/
└── hooks/
       ↓
ConventionLoader (auto-detect structure)
       ↓
AutoGenerator (orchestrate build)
       ↓
8 Platform Adapters (translate hooks)
       ↓
FileGenerator (write output)
       ↓
dist/ (ready for deployment)
```

## Convention Over Configuration

No manifest needed. Structure from real files.

```
agents/*.md       → Auto-discovered agents
hooks/*.js        → Auto-discovered hooks
glootie.json      → Auto-validated config
```

## Hook Translation

One JavaScript hook → 8 platform versions:

| Hook | CC | GC | OC | VSCode | Cursor | Zed | JetBrains | Copilot |
|------|-----|-----|-----|---------|---------|-----|-----------|---------|
| session-start | wrapped | bare | class | async fn | async fn | rust | override | markdown |
| pre-tool | wrapped | bare | class | async fn | async fn | rust | override | markdown |
| prompt-submit | wrapped | bare | class | async fn | async fn | rust | override | markdown |
| stop | wrapped | bare | class | async fn | async fn | rust | override | markdown |
| stop-git | wrapped | bare | class | async fn | async fn | rust | override | markdown |

Same logic, different syntax.

## Platform Adapter Hierarchy

```
PlatformAdapter (base)
    ├── CLIAdapter
    │   ├── CCAdapter
    │   ├── GCAdapter
    │   ├── OCAdapter
    │   └── CopilotCLIAdapter
    └── ExtensionAdapter
        ├── VSCodeAdapter
        ├── CursorAdapter
        ├── ZedAdapter
        └── JetBrainsAdapter
```

## File Generation Pipeline

1. **Load** - ConventionLoader reads glootie.json, agents/, hooks/
2. **Generate** - For each platform, create adapter + generate files
3. **Translate** - HookFormatters transform hooks to platform syntax
4. **Write** - FileGenerator writes dist/ structure
5. **Output** - 8 ready-to-deploy distributions

## Key Design Patterns

**Convention-Based Loading**
- Directory structure is the manifest
- No registration required
- Auto-detection of agents and hooks

**Hook Format Translation**
- Source → Platform-specific syntax
- Same logic, different language
- Formatters per platform

**Optional File Handling**
- Missing optional files don't error
- Graceful degradation
- Partial plugins supported

**Template Inheritance**
- Default templates from template-defaults.js
- Merged with user config
- Can override defaults

**Agent Auto-Discovery**
- agents/*.md files auto-discovered
- Basename becomes agent name
- Included in all platforms

## Error Handling

Validation before generation:
- Required fields present
- Valid semantic versioning
- At least one hook
- Hook files exist
- Agent files exist
- Valid SPDX license
- Valid platform IDs

## Module Inventory

**Core (lib/)**
- convention-loader.js - Load plugin structure
- auto-generator.js - Orchestrate generation
- cli-adapter.js - Base CLI adapter
- extension-adapter.js - Base extension adapter
- file-generator.js - File I/O utilities
- hook-formatters.js - Syntax transformation
- platform-unifier.js - Normalize formats
- plugin-spec.js - Constants
- template-defaults.js - Default templates
- base.js - PlatformAdapter base

**Platforms/**
- cc/ - Claude Code
- gc/ - Gemini CLI
- oc/ - OpenCode
- vscode/ - VS Code
- cursor/ - Cursor
- zed/ - Zed
- jetbrains/ - JetBrains
- copilot-cli/ - GitHub Copilot CLI

**Generators/**
- Specialized generators for complex platforms

All files under 200 lines limit.
