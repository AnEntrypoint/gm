module.exports = {
  agentProfile: (pluginSpec) => `---
name: gm
version: ${pluginSpec.version}
description: ${pluginSpec.description || 'AI state machine for GitHub Copilot CLI'}
author: ${pluginSpec.author || 'GM'}
repository: https://github.com/AnEntrypoint/gm-copilot-cli
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

# GM State Machine Agent

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

State in \`~/.gh/extensions/gm/state.json\`.

## Configuration

\`~/.copilot/config.json\`:

\`\`\`json
{
  "gm": {
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
`,

  manifest: (pluginSpec) => `name: gm
version: ${pluginSpec.version}
description: ${pluginSpec.description || 'AI state machine for Copilot CLI'}
author: ${pluginSpec.author || 'GM'}

repository:
  url: https://github.com/AnEntrypoint/gm-copilot-cli
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
  - name: gm:activate
    description: Activate state machine
  - name: gm:analyze
    description: Analyze code
  - name: gm:search
    description: Semantic search
  - name: gm:refactor
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
`,

  cliJs: () => `#!/usr/bin/env node

import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));

const commands = {
  help() {
    console.log(\`gm v\${pkg.version} - AI State Machine Agent\`);
    console.log('Usage: gm [command]');
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
}`,

};
