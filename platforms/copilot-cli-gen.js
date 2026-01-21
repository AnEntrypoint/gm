module.exports = {
  generateAgentProfile(pluginSpec) {
    return `---
name: glootie
version: ${pluginSpec.version}
description: ${pluginSpec.description || 'AI state machine for GitHub Copilot CLI'}
author: ${pluginSpec.author || 'Glootie'}
repository: https://github.com/AnEntrypoint/glootie-copilot-cli
license: MIT
capabilities:
  - code_analysis
  - semantic_search
  - autonomous_execution
  - state_management
activation:
  trigger: prompt_start
  auto_activate: true
  context_window: 200000
models:
  - claude-3-5-sonnet
  - claude-opus-4-1
---

# Glootie State Machine Agent

Autonomous AI-powered state machine for GitHub Copilot CLI.

## Features

- State machine with checkpointing
- Autonomous actions
- MCP integration
- Hot reload
- Real-time execution

## Activation

Auto-activates on prompt submission.

## Tools

- \`shell\` - Execute commands
- \`file_write\` - Create/modify files
- \`file_glob\` - Find files
- \`file_search\` - Search files
- \`semantic_search\` - AI search

## State Management

State in \`~/.gh/extensions/glootie/state.json\`.

## Configuration

\`~/.copilot/config.json\`:

\`\`\`json
{
  "glootie": {
    "enabled": true,
    "auto_activate": true,
    "log_level": "info"
  }
}
\`\`\`

## Example Usage

\`\`\`bash
gh copilot run "analyze code complexity"
gh copilot run "refactor component"
gh copilot run "generate tests"
\`\`\`
`;
  },

  generateToolsJson(pluginSpec) {
    return JSON.stringify({
      name: 'glootie',
      version: pluginSpec.version,
      description: pluginSpec.description,
      tools: [
        {
          name: 'shell',
          description: 'Execute shell commands',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'Command to execute' },
              timeout: { type: 'number', description: 'Timeout in ms', default: 30000 }
            },
            required: ['command']
          }
        },
        {
          name: 'file_write',
          description: 'Write or modify files',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
              mode: { type: 'string', enum: ['create', 'append', 'overwrite'], default: 'overwrite' }
            },
            required: ['path', 'content']
          }
        },
        {
          name: 'file_glob',
          description: 'Find files matching pattern',
          parameters: {
            type: 'object',
            properties: {
              pattern: { type: 'string' },
              exclude: { type: 'array' }
            },
            required: ['pattern']
          }
        },
        {
          name: 'file_search',
          description: 'Search file content',
          parameters: {
            type: 'object',
            properties: {
              pattern: { type: 'string' },
              files: { type: 'string' },
              context_lines: { type: 'number', default: 2 }
            },
            required: ['pattern']
          }
        },
        {
          name: 'semantic_search',
          description: 'AI-powered semantic search',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              scope: { type: 'string' }
            },
            required: ['query']
          }
        }
      ],
      mcp_servers: pluginSpec.mcp || {}
    }, null, 2);
  },

  generateManifest(pluginSpec) {
    return `name: glootie
version: ${pluginSpec.version}
description: ${pluginSpec.description || 'AI state machine for Copilot CLI'}
author: ${pluginSpec.author || 'Glootie'}

repository:
  url: https://github.com/AnEntrypoint/glootie-copilot-cli
  type: git

license: MIT

keywords:
  - ai
  - state-machine
  - agent

activation:
  on_load: true
  auto_activate: true

commands:
  - name: glootie:activate
    description: Activate state machine
  - name: glootie:analyze
    description: Analyze code
  - name: glootie:search
    description: Semantic search
  - name: glootie:refactor
    description: Refactor code

api:
  version: 1.0.0
  min_gh_version: 2.45.0

permissions:
  - read:environment
  - read:project
  - write:project

configuration:
  settings:
    - name: enabled
      type: boolean
      default: true
    - name: auto_activate
      type: boolean
      default: true
    - name: log_level
      type: string
      enum: [debug, info, warn, error]
      default: info
`;
  },

  generateCliJs() {
    return `#!/usr/bin/env node

import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));

const commands = {
  help() {
    console.log(\`glootie v\${pkg.version} - AI State Machine Agent\`);
    console.log('Usage: glootie [command]');
    console.log('Commands:');
    console.log('  help      Show this help');
    console.log('  version   Show version');
    console.log('  status    Show status');
    console.log('  config    Show config');
  },

  version() {
    console.log(pkg.version);
  },

  status() {
    console.log('Status: Active');
    console.log('Mode: Autonomous');
    console.log('State: Ready');
  },

  config() {
    console.log(JSON.stringify({
      enabled: true,
      autoActivate: true,
      contextWindow: 200000
    }, null, 2));
  }
};

const cmd = process.argv[2] || 'help';
if (commands[cmd]) {
  commands[cmd]();
} else {
  console.error(\`Unknown command: \${cmd}\`);
  commands.help();
  process.exit(1);
}`;
  },

  generateReadme() {
    return `# Glootie for GitHub Copilot CLI

AI state machine agent for Copilot CLI.

## Installation

\`\`\`bash
gh extension install AnEntrypoint/glootie-copilot-cli
\`\`\`

## Quick Start

\`\`\`bash
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

\`~/.copilot/config.json\`:

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
`;
  }
};
