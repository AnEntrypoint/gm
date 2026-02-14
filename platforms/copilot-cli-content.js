module.exports = {
  readme: () => `# Glootie for GitHub Copilot CLI

AI state machine agent for Copilot CLI.

## Installation

**Windows and Unix:**
\`\`\`bash
gh extension install AnEntrypoint/glootie-copilot-cli
\`\`\`

**Windows PowerShell:**
\`\`\`powershell
gh extension install AnEntrypoint/glootie-copilot-cli
\`\`\`

## Quick Start

**Windows and Unix:**
\`\`\`bash
gh copilot run "analyze code complexity"
gh copilot run "refactor component"
gh copilot run "generate tests"
\`\`\`

**Windows PowerShell:**
\`\`\`powershell
gh copilot run "analyze code complexity"
gh copilot run "refactor component"
gh copilot run "generate tests"
\`\`\`

## Features

- Autonomous execution
- State persistence
- Semantic search
- Tool integration
- MCP support

## Configuration

**Unix:** \`~/.copilot/config.json\`

**Windows:** \`%APPDATA%\\copilot\\config.json\`

\`\`\`json
{
  "glootie": {
    "enabled": true,
    "auto_activate": true,
    "log_level": "info"
  }
}
\`\`\`

## Tools

- shell
- file_write
- file_glob
- file_search
- semantic_search

## License

MIT
`
};
