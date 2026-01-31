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

**Skill consolidation**: All skills merged into agents/gm.md. No separate skill files. Reduces agent invocation overhead.

**GitHub Actions rsync sync**: Uses `rsync --delete` to remove orphaned files from target repos, preventing stale code illusion.

## File Structure

**Source** (`plugforge-starter/`):
```
glootie.json              # Single spec
agents/gm.md              # Single unified agent with all behavioral rules
hooks/*.js                # Platform-agnostic hooks
```

**Architecture Note**: All 10 skills are merged into agents/gm.md as single sections. Separate skill files were deleted to eliminate per-invocation token cost. Each skill section is substantial (10+ lines) to justify inclusion. This consolidation reduces agent startup overhead dramatically compared to invoking individual skills.

**Output**: 9 auto-generated GitHub repositories
- 5 CLI platforms: glootie-cc, glootie-gc, glootie-oc, glootie-codex, glootie-copilot-cli
- 4 IDE extensions: glootie-vscode, glootie-cursor, glootie-zed, glootie-jetbrains

Each built by GitHub Actions from `plugforge-starter/` on every commit.

## Known Gotchas

**Hook naming**: Different files may use `-hook` suffix or not. `getHookSourcePaths()` handles variants but explicit naming is preferred.

**Build validation**: `validateGeneratedFiles()` checks platform-specific requirements (some platforms don't need package.json). Reports missing or extra files.

**IDE extensions missing hooks**: VSCode Cursor Zed JetBrains extensions do not have hooks directories. Only CLI platforms have hooks. This is expected behavior.

## Kerned Framework: Zero-Surprise Design

Everything is predictable and turnkey. All corner cases handled before they occur.

### Build Process Guarantee

**Clean generation always**:
- `cleanBuildDir()` deletes entire output before regenerating
- No stale files shadow new ones
- Idempotent: run infinitely, same output every time
- GitHub Actions uses rsync --delete, cleans orphaned files

**Platform failure isolation**:
- Each of 9 platforms generated independently
- One platform error doesn't block others
- Failed platforms reported separately in build-reporter
- User can review which platforms succeeded/failed

**Template propagation guaranteed**:
- All adapters inherit from base.js and use TemplateBuilder
- Template changes in TemplateBuilder affect all 9 outputs
- No adapter overrides = automatic inheritance
- Single source of truth for LICENSE, .gitignore, .editorconfig, CONTRIBUTING.md

### Runtime Predictability

**Convention enforcement**:
- No runtime config files needed
- Directory structure alone defines behavior
- Adding skill: create `skills/name/SKILL.md` → auto-appears in all 9
- Adding hook: drop in `hooks/` → auto-discovered and distributed
- No registration files. No config. Just files.

**Hot reload by design**:
- State lives outside reloadable modules (not implemented yet, but architecture supports)
- Module boundaries are reload boundaries
- Handlers swap atomically when file changes detected
- Zero downtime. Zero dropped requests.

### Corner Cases & Contingencies

**Missing source directories**:
- ConventionLoader creates missing agent/hook dirs
- Proceeds with empty collections rather than crashing
- User gets empty plugin, not broken plugin

**Skills consolidation complete**:
- All 10 skills merged into agents/gm.md
- Separate skill files deleted to eliminate per-invocation cost
- Each skill section is substantial (10+ lines) to justify inclusion
- No more skill discovery or path variance handling needed

**Hook file naming variance**:
- `getHookSourcePaths()` checks both `name.js` and `name-hook.js`
- Explicit naming preferred but both work
- Single hook file can have multiple exports

**Empty file handling**:
- Adapters check file size before processing
- Skip MAX_FILE_SIZE overages
- Report missing/empty as warnings not errors
- Auto-healer attempts recovery but doesn't break build

**Duplication discovered in build**:
- thorns reports all duplications
- TemplateBuilder consolidates patterns
- cli-config-*.js files: same structure, parameterized for platform
- base.js vs copilot-cli-gen.js: extract shared to base, override in copilot
- cursor.js appears 7× due to copy-paste: consolidate once identified

**Graceful degradation**:
- Missing optional files don't break generation
- platforms without package.json still generate valid output
- Extension manifests validate platform-specific requirements
- buildReporter.categorizeFiles() sorts successes/failures/warnings

### Maintenance Anti-Patterns to Avoid

**Never bypass cleanBuildDir()**: Results in stale file shadowing. Always delete before regenerate.

**Never hardcode values in adapters**: Use TemplateBuilder methods. Values belong in template-builder.js.

**Never duplicate adapter logic**: If logic appears in two adapters, extract to base.js or TemplateBuilder.

**Never skip validation**: validateGeneratedFiles() catches errors early. Always run validation.

**Never ignore convention for convenience**: If tempted to add config file, redesign for convention instead.

**Never leave orphaned files**: GitHub Actions rsync --delete handles this, but delete locally too.

### Verification Checklist (Execute Before Release)

Executed in plugin:gm:dev only:

```
- [ ] cleanBuildDir() produces empty output dirs
- [ ] All 9 platforms generate without errors
- [ ] validateGeneratedFiles() passes for all 9
- [ ] thorns reveals no unexpected duplications
- [ ] ConventionLoader loads empty source gracefully
- [x] All skills consolidated into agents/gm.md (no separate files)
- [ ] Adding new hook auto-appears in all 9 outputs
- [ ] gm.md merged (455 words, 44% compression)
- [ ] All skills removed from /skills/ (consolidated into gm.md)
- [ ] No .test.* files exist anywhere
- [ ] auto-healer.js deleted (if orphaned)
- [ ] buildReporter categorizes files correctly
- [ ] Extension manifests valid for VSCode/Cursor/Zed/JetBrains
- [ ] CLI configs valid for CC/GC/OC/Codex/Copilot
- [ ] GitHub Actions sync simulation works (rsync --delete equivalent)
```

### Minimal Black Magic

The framework is explicit through convention, not magic:

- **Convention over code**: Directory structure + file existence = behavior
- **No reflection**: No runtime type introspection
- **No DSL**: Plain JavaScript, plain file discovery
- **No build step**: Ship source directly
- **No environment variables beyond platform roots**: XDG_CONFIG_HOME, CLAUDE_PLUGIN_ROOT, etc
- **No special casing**: All adapters behave same way for same inputs
