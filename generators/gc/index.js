const fs = require('fs');
const path = require('path');
const { writeFile, ensureDir } = require('../../lib/file-generator');
const { defaultConfig, getPlatformConfig } = require('../../lib/config-schema');

const generateGeminiPlugin = (sourceDir, outputDir) => {
  const platform = getPlatformConfig('gc');
  ensureDir(outputDir);

  const structure = {
    'gemini-extension.json': generateExtensionJson(),
    '.mcp.json': generateMcpJson(),
    'GEMINI.md': generateGeminiMd(),
    'README.md': generateReadme('Gemini CLI'),
    'package.json': generatePackageJson('gc'),
    'hooks/hooks.json': generateHooksJson('gc'),
    'agents/gm.md': readSourceFile(sourceDir, 'glootie-gc/agents/gm.md') || readSourceFile(sourceDir, 'glootie-cc/agents/gm.md'),
    'agents/codesearch.md': readSourceFile(sourceDir, 'glootie-gc/agents/codesearch.md') || readSourceFile(sourceDir, 'glootie-cc/agents/codesearch.md'),
    'agents/websearch.md': readSourceFile(sourceDir, 'glootie-gc/agents/websearch.md') || readSourceFile(sourceDir, 'glootie-cc/agents/websearch.md'),
    'pre-tool-use-hook.js': readSourceFile(sourceDir, 'glootie-gc/pre-tool-use-hook.js'),
    'session-start-hook.js': readSourceFile(sourceDir, 'glootie-gc/session-start-hook.js'),
    'prompt-submit-hook.js': readSourceFile(sourceDir, 'glootie-gc/prompt-submit-hook.js'),
    'stop-hook.js': readSourceFile(sourceDir, 'glootie-gc/stop-hook.js'),
    'stop-hook-git.js': readSourceFile(sourceDir, 'glootie-gc/stop-hook-git.js'),
    'cli.js': generateCliJs()
  };

  Object.entries(structure).forEach(([filePath, content]) => {
    if (content) {
      writeFile(path.join(outputDir, filePath), content);
    }
  });
};

const generateExtensionJson = () => {
  return JSON.stringify({
    name: 'gm',
    version: '2.0.9',
    description: 'Advanced Gemini CLI extension with WFGY integration, MCP tools, and automated hooks',
    author: defaultConfig.author,
    homepage: defaultConfig.homepage,
    mcpServers: defaultConfig.mcpServers,
    contextFileName: 'GEMINI.md'
  }, null, 2);
};

const generateMcpJson = () => {
  return JSON.stringify({
    $schema: 'https://schemas.modelcontextprotocol.io/0.1.0/mcp.json',
    mcpServers: defaultConfig.mcpServers
  }, null, 2);
};

const generateGeminiMd = () => {
  return `# GEMINI.md - Technical Caveats & Gotchas

## Gemini CLI Extension System

### Hook Response Format
- Gemini CLI hooks output bare JSON (no wrapper)
- Format: \`{"decision":"deny|allow","reason":"..."}\`
- Exit code 0 for all responses (exceptions use non-zero)

### Hook Event Names
- **BeforeTool**: Intercepts tool selection (equiv. PreToolUse)
- **SessionStart**: Initialize context
- **BeforeAgent**: Before prompt processing (equiv. UserPromptSubmit)
- **SessionEnd**: Session termination (equiv. Stop)

### SessionStart Hook
- Automatically adds \`.glootie-stop-verified\` to \`.gitignore\`
- Runs AST analysis via \`mcp-thorns\` with 3min timeout
- Injects codebase insight as additional context

### Tool Names
- Gemini CLI uses different tool names than Claude Code:
  - run_shell_command (not Bash)
  - write_file (not Write)
  - glob, search_file_content (not Glob/Grep)

### Verification File Lifecycle
- Path: \`.glootie-stop-verified\` (project root)
- Created: When work is verified complete
- Deleted: On each new prompt (BeforeAgent hook)
- Must be in \`.gitignore\` (auto-added by SessionStart hook)
`;
};

const generateReadme = (platform) => {
  return `# gm - Advanced ${platform} Plugin

Unified gm state machine implementation for ${platform}.

## Installation

For ${platform}: [Installation instructions]

## Features

- Automated hook-based tool interception
- AST-based codebase analysis
- Verification file lifecycle management
- Hot reload support
- Real-time context enrichment

## Architecture

### Hooks
- SessionStart: Initialize context
- BeforeTool: Tool policy enforcement
- BeforeAgent: State reset
- SessionEnd: Verification and completion

### Configuration
- MCP Servers: dev, code-search
- Agents: gm (state machine)
`;
};

const generatePackageJson = (platform) => {
  return JSON.stringify({
    name: 'glootie-gc',
    version: '2.0.9',
    description: 'Advanced Gemini CLI extension with WFGY integration, MCP tools, and automated hooks',
    main: 'cli.js',
    files: [
      'agents/',
      'hooks/',
      'README.md',
      'GEMINI.md',
      '.mcp.json',
      'gemini-extension.json',
      'cli.js',
      'pre-tool-use-hook.js',
      'session-start-hook.js',
      'prompt-submit-hook.js',
      'stop-hook.js',
      'stop-hook-git.js'
    ],
    keywords: ['gemini-cli', 'gemini-extension', 'wfgy', 'mcp', 'automation', 'glootie'],
    author: 'AnEntrypoint',
    license: 'MIT',
    repository: {
      type: 'git',
      url: 'https://github.com/AnEntrypoint/glootie-gc.git'
    },
    homepage: 'https://github.com/AnEntrypoint/glootie-gc#readme',
    bugs: {
      url: 'https://github.com/AnEntrypoint/glootie-gc/issues'
    },
    engines: {
      node: '>=16.0.0'
    },
    publishConfig: {
      access: 'public'
    }
  }, null, 2);
};

const generateHooksJson = (platform) => {
  return JSON.stringify({
    description: 'Hooks for glootie Gemini CLI extension',
    hooks: {
      BeforeTool: [
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: 'node ${extensionPath}/pre-tool-use-hook.js',
              timeout: 3600
            }
          ]
        }
      ],
      SessionStart: [
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: 'node ${extensionPath}/session-start-hook.js',
              timeout: 10000
            }
          ]
        }
      ],
      BeforeAgent: [
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: 'node ${extensionPath}/prompt-submit-hook.js',
              timeout: 3600
            }
          ]
        }
      ],
      SessionEnd: [
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: 'node ${extensionPath}/stop-hook.js',
              timeout: 300000
            },
            {
              type: 'command',
              command: 'node ${extensionPath}/stop-hook-git.js',
              timeout: 60000
            }
          ]
        }
      ]
    }
  }, null, 2);
};

const generateCliJs = () => {
  return `#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const show = () => {
  console.log('glootie-gc: Advanced Gemini CLI extension');
  console.log('Version: 2.0.9');
  console.log('');
  console.log('Usage: glootie-gc [command]');
  console.log('');
  console.log('Commands:');
  console.log('  help, --help, -h    Show this help message');
  console.log('  version, --version   Show version');
};

const args = process.argv.slice(2);
if (!args.length || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
  show();
} else if (args[0] === 'version' || args[0] === '--version') {
  console.log('2.0.9');
}
`;
};

const readSourceFile = (sourceDir, relativePath) => {
  const fullPath = path.join(sourceDir, relativePath);
  try {
    return fs.readFileSync(fullPath, 'utf-8');
  } catch (e) {
    return null;
  }
};

module.exports = { generateGeminiPlugin };
