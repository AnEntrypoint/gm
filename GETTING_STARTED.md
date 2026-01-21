# Getting Started: Build Your First Plugin

5-step complete guide to creating a multi-platform AI plugin.

## Step 1: Copy Starter Template

```bash
cp -r plugforge-starter my-awesome-plugin
cd my-awesome-plugin
ls -la
```

You'll see:
- `glootie.json` - Configuration file
- `README.md` - Plugin documentation
- `agents/` - AI system prompts (gm.md, codesearch.md, websearch.md)
- `hooks/` - Implementation code (session-start.js, pre-tool.js, etc.)

## Step 2: Edit glootie.json

```json
{
  "name": "my-awesome-plugin",
  "version": "1.0.0",
  "description": "My first AI plugin",
  "author": "Your Name",
  "license": "MIT",
  "agents": ["gm", "codesearch", "websearch"],
  "hooks": ["session-start", "pre-tool", "prompt-submit", "stop", "stop-git"],
  "platforms": {
    "cc": { "enabled": true },
    "gc": { "enabled": true },
    "oc": { "enabled": true },
    "vscode": { "enabled": true },
    "cursor": { "enabled": true },
    "zed": { "enabled": true },
    "jetbrains": { "enabled": true },
    "copilot-cli": { "enabled": true }
  }
}
```

Required fields: name, version, author, license
Optional: description, repository, homepage, agents, hooks, mcp, platforms

## Step 3: Customize Agents (Optional)

Edit `agents/gm.md` to customize the main agent system prompt:

```markdown
# Main Agent

You are an AI assistant specialized in [YOUR DOMAIN].

You have access to:
- Code search for finding implementations
- Web search for learning documentation
- Tool execution for testing

Your role is to [DESCRIBE YOUR PLUGIN'S PURPOSE].
```

## Step 4: Customize Hooks (Optional)

Hooks are in `hooks/` directory. Each is optional. Starter provides complete implementations.

**session-start.js** - Called when plugin loads
**pre-tool.js** - Called before any tool execution
**prompt-submit.js** - Called when user submits prompt
**stop.js** - Called when plugin stops
**stop-git.js** - Called during git cleanup

Each hook exports:
```javascript
module.exports = {
  name: 'hook-name',
  handler: async (context) => {
    // Your code
    return { success: true };
  }
};
```

## Step 5: Build and Deploy

### Build

```bash
glootie-builder build all
```

Output in `dist/`:
- `dist/cc/` - Claude Code
- `dist/gc/` - Gemini CLI
- `dist/oc/` - OpenCode
- `dist/copilot-cli/` - GitHub Copilot CLI
- `dist/vscode/` - VS Code
- `dist/cursor/` - Cursor
- `dist/zed/` - Zed
- `dist/jetbrains/` - JetBrains

### Deploy

**Claude Code:**
```bash
cp -r dist/cc/* ~/.claude-code/plugins/my-plugin/
# Restart Claude Code
```

**VS Code:**
```bash
cd dist/vscode
npm install && npm run compile
npm run package  # Creates VSIX
# Upload to VS Code Marketplace
```

**Cursor:**
```bash
cp -r dist/cursor/* ~/.cursor/extensions/my-plugin/
# Restart Cursor
```

**Zed:**
```bash
cd dist/zed
cargo build --release
# Binary in target/release/
```

**JetBrains:**
```bash
cd dist/jetbrains
./gradlew build
# JAR in build/distributions/
```

See PLATFORMS.md for complete deployment details for each platform.

## Example: Code Quality Plugin

### 1. Initialize
```bash
cp -r plugforge-starter code-quality
cd code-quality
```

### 2. Configure glootie.json
```json
{
  "name": "code-quality",
  "version": "1.0.0",
  "description": "AI-powered code quality analyzer",
  "author": "You",
  "license": "MIT",
  "agents": ["gm"],
  "hooks": ["session-start", "pre-tool"]
}
```

### 3. Update agents/gm.md
```markdown
# Code Quality Analyzer

You are an expert code quality analyst.

When analyzing code:
1. Check for performance issues
2. Identify security vulnerabilities
3. Suggest architectural improvements
4. Recommend testing strategies

Provide actionable feedback with examples.
```

### 4. Build
```bash
glootie-builder build all
```

### 5. Deploy
```bash
# Claude Code
cp dist/cc/* ~/.claude-code/plugins/code-quality/

# VS Code
cd dist/vscode && npm install && npm run compile
```

Done! Your plugin works on 8 platforms.

## Next Steps

- Explore `plugforge-starter/` template
- Read builder source in `lib/` and `platforms/` directories
- Check `CLAUDE.md` for technical caveats
- Review `PLATFORMS.md` for platform-specific details
- Examine `templates/` for default implementations
