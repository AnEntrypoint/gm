const ExtensionAdapter = require('../lib/extension-adapter');
const gen = require('./codex-gen');

class CodexAdapter extends ExtensionAdapter {
  constructor() {
    super({
      name: 'codex',
      label: 'Codex',
      configFile: 'package.json',
      manifestType: 'codex'
    });
  }

  createFileStructure(pluginSpec, sourceDir) {
    const readFile = (paths) => this.readSourceFile(sourceDir, paths);
    return {
      'package.json': this.generatePackageJson(pluginSpec),
      'dist/extension.js': gen.generateExtensionEntry(),
      'dist/gm.md': readFile(this.getAgentSourcePaths('gm')),
      'dist/codesearch.md': readFile(this.getAgentSourcePaths('codesearch')),
      'dist/websearch.md': readFile(this.getAgentSourcePaths('websearch')),
      '.codexignore': this.generateCodexignore(),
      'config.toml': gen.generateConfigToml(pluginSpec),
      'AGENTS.md': this.generateAgentsMd(),
      'README.md': this.generateReadme()
    };
  }

  generatePackageJson(pluginSpec) {
    const manifest = JSON.parse(gen.generateExtensionManifest(pluginSpec));
    return JSON.stringify(manifest, null, 2);
  }

  generateAgentsMd() {
    return `# Glootie - GM State Machine

## Custom Instructions for Codex Agent

You are an AI assistant working within the Glootie system, a state-machine-driven development automation platform.

### Core Directives

1. **State Preservation**: Maintain state machine context across all operations
2. **Checkpoint Recovery**: Create checkpoints before risky operations and restore on failure
3. **Hot Reload**: Design all changes to support zero-downtime reloading
4. **Observability**: Expose internal state to global scope for debugging
5. **Real Data**: Always work with real data; never fake responses or simulate results
6. **Error Recovery**: Implement graceful degradation and automatic recovery paths

### Agent Behavior

- Read available files and context to understand current state
- Propose changes that maintain system integrity
- Ask for confirmation on risky operations
- Provide clear, actionable error messages
- Never assume state; always verify before proceeding

### Available Agents

- **gm.md**: Primary state machine orchestrator
- **codesearch.md**: Semantic code search and analysis
- **websearch.md**: Web search and information gathering

See dist/ directory for full agent documentation.
`;
  }

  generateCodexignore() {
    return `.git
.gitignore
**/*.map
**/*.ts
!**/*.d.ts
node_modules
build
dist
.codexignore
.prettierrc
*.config.*
CHANGELOG.md
LICENSE
CONTRIBUTING.md
`;
  }

  generateReadme() {
    return `# Glootie - GM State Machine for Codex

An AI-powered state machine extension for OpenAI's Codex IDE with dynamic adaptation and autonomous decision-making.

## Features

- **State Machine**: Persistent state management with checkpointing and recovery
- **Autonomous Agents**: AI-driven agents for code analysis and development tasks
- **Hot Reload**: Zero-downtime updates to agent logic
- **Real-Time Debugging**: Inspect internal state and agent behavior
- **Code Search**: Semantic code search via integrated agents
- **Web Search**: LLM-powered web search capabilities
- **MCP Integration**: Full support for Model Context Protocol servers

## Installation

1. Install Codex IDE extension from VSCode Marketplace (works with Codex in VSCode, Cursor, Windsurf)
2. Clone or download this plugin repository
3. Place in your project or Codex extensions directory

## Quick Start

Once installed, the extension activates automatically. Access Glootie via:
- Codex IDE interface: Type commands in chat or agent mode
- Keyboard shortcuts: Set in IDE settings
- Command palette: \`Ctrl+Shift+P\` → "Glootie: Activate"

## Configuration

Configure via \`config.toml\`:

\`\`\`toml
[glootie]
enabled = true
autoActivate = true
logLevel = "info"
\`\`\`

### MCP Servers

Add MCP servers to \`config.toml\`:

\`\`\`toml
[mcp_servers.docs]
command = "npx"
args = ["mcp-context7"]

[mcp_servers.web]
command = "bash"
args = ["-c", "npx mcp-web-scraper"]
\`\`\`

## Agent Customization

Create \`AGENTS.override.md\` in your project for custom agent instructions. See \`AGENTS.md\` for format and examples.

## Development

See agents documentation in \`dist/\`:
- \`dist/gm.md\` - GM state machine agent
- \`dist/codesearch.md\` - Code search agent
- \`dist/websearch.md\` - Web search agent

## Architecture

- **Extension**: VSCode-compatible extension entry point
- **Config**: TOML-based configuration matching Codex CLI
- **Agents**: Markdown-based agent definitions with custom instructions
- **MCP**: Full Model Context Protocol integration for tool access

## Publishing

Build and publish as VSCode extension:

\`\`\`bash
npm install -g vsce
vsce publish
\`\`\`

## License

MIT
`;
  }
}

module.exports = CodexAdapter;
