# Architecture & Philosophy

plugforge generates 9 platform implementations from a single convention-driven source. The system eliminates duplication through inheritance, shared template building, and clean regeneration patterns.

## Design Philosophy

### Convention Over Configuration

plugforge uses convention-driven discovery instead of build-time configuration:

- **Single source** in `plugforge-starter/`: glootie.json, agents/, skills/, hooks/
- **Adapters transform** source to platform-specific format (package.json, Cargo.toml, build.gradle.kts, etc)
- **No configuration files** - directory structure defines behavior
- **Adding a skill** automatically appears in all 9 outputs

### Clean Build Pattern

Adapter changes can leave stale files in output directories. `cleanBuildDir()` prevents this:

1. Delete entire platform output directory
2. Regenerate from scratch
3. Only current adapter files appear

This prevents silent failures where old files shadow new ones.

### Library Extraction Over Duplication

Shared methods extracted to `TemplateBuilder`:
- `generatePackageJson()` - Unified generation for all platforms
- `generateMcpJson()` - MCP server configuration
- `loadSkillsFromSource()` - Skill discovery with configurable paths
- `buildHooksMap()` - Hook mapping and configuration
- `getGenericFiles()` - LICENSE, .gitignore, .editorconfig, CONTRIBUTING.md

All adapters use these methods. Template changes propagate automatically.

### Adapter Hierarchy

**PlatformAdapter** (base.js): Abstract base
- `createFileStructure()` - Implemented by subclass
- `generate()` - Orchestrates file generation with generic template merge
- Uses TemplateBuilder for all shared methods

**ExtensionAdapter** (extension-adapter.js): IDE extension base (VSCode, Cursor, Zed, JetBrains)

**CLIAdapter** (cli-adapter.js): CLI platform base (Claude Code, Gemini, OpenCode, Codex)
- Specialized hook generation for CLI tool requirements

**Platform-specific adapters**: Minimal code (vscode.js, zed.js, etc)
- Only `createFileStructure()` - inherits everything else

### Key Architectural Decisions

**Generic template distribution**: License, .gitignore, .editorconfig, CONTRIBUTING.md automatically included in all 9 platforms. Platform-specific implementations override when needed.

**Graceful platform degradation**: Single platform failure doesn't block others. All 9 attempt generation. Failed platforms reported separately.

**Skill path flexibility**: `TemplateBuilder.loadSkillsFromSource()` takes configurable baseOutputPath. JetBrains uses `docs/skills/`, others use `skills/`.

**GitHub Actions rsync sync**: Uses `rsync --delete` to remove orphaned files from target repos, preventing stale code illusion.

## File Structure

**Source** (`plugforge-starter/`):
```
glootie.json              # Single spec
agents/gm.md              # Auto-distributed
skills/*/SKILL.md         # Auto-discovered
hooks/*.js                # Platform-agnostic
```

**Output**: 9 auto-generated GitHub repositories
- 5 CLI platforms: glootie-cc, glootie-gc, glootie-oc, glootie-codex, glootie-copilot-cli
- 4 IDE extensions: glootie-vscode, glootie-cursor, glootie-zed, glootie-jetbrains

Each built by GitHub Actions from `plugforge-starter/` on every commit.

## Known Gotchas

**Hook naming**: Different files may use `-hook` suffix or not. `getHookSourcePaths()` handles variants but explicit naming is preferred.

**Skill paths**: Intentional variation - `skills/` for most, `docs/skills/` for JetBrains. Specify in adapter call to `loadSkillsFromSource()`.

**Build validation**: `validateGeneratedFiles()` checks platform-specific requirements (some platforms don't need package.json). Reports missing or extra files.
