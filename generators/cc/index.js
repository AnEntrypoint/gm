const fs = require('fs');
const path = require('path');
const { writeFile, ensureDir } = require('../../lib/file-generator');
const { defaultConfig, getPlatformConfig } = require('../../lib/config-schema');

const generateClaudeCodePlugin = (sourceDir, outputDir) => {
  const platform = getPlatformConfig('cc');
  ensureDir(outputDir);

  const structure = {
    'plugin.json': generatePluginJson(),
    '.mcp.json': generateMcpJson(),
    'CLAUDE.md': generateClaudeMd(),
    'README.md': generateReadme('Claude Code'),
    'package.json': generatePackageJson('cc'),
    'hooks/hooks.json': generateHooksJson('cc'),
    'agents/gm.md': readSourceFile(sourceDir, 'glootie-cc/agents/gm.md'),
    'agents/codesearch.md': readSourceFile(sourceDir, 'glootie-cc/agents/codesearch.md'),
    'agents/websearch.md': readSourceFile(sourceDir, 'glootie-cc/agents/websearch.md'),
    'pre-tool-use-hook.js': readSourceFile(sourceDir, 'glootie-cc/pre-tool-use-hook.js'),
    'session-start-hook.js': readSourceFile(sourceDir, 'glootie-cc/session-start-hook.js'),
    'prompt-submit-hook.js': readSourceFile(sourceDir, 'glootie-cc/prompt-submit-hook.js'),
    'stop-hook.js': readSourceFile(sourceDir, 'glootie-cc/stop-hook.js'),
    'stop-hook-git.js': readSourceFile(sourceDir, 'glootie-cc/stop-hook-git.js'),
    '.claude-plugin/marketplace.json': generateMarketplaceJson()
  };

  Object.entries(structure).forEach(([filePath, content]) => {
    if (content) {
      writeFile(path.join(outputDir, filePath), content);
    }
  });
};

const generatePluginJson = () => {
  return JSON.stringify({
    name: 'gm',
    version: '2.0.4',
    description: 'Advanced Claude Code plugin with WFGY integration, MCP tools, and automated hooks',
    author: defaultConfig.author,
    homepage: defaultConfig.homepage,
    mcpServers: defaultConfig.mcpServers,
    hooks: './hooks/hooks.json'
  }, null, 2);
};

const generateMcpJson = () => {
  return JSON.stringify({
    $schema: 'https://schemas.modelcontextprotocol.io/0.1.0/mcp.json',
    mcpServers: defaultConfig.mcpServers
  }, null, 2);
};

const generateClaudeMd = () => {
  return `# CLAUDE.md - Technical Caveats & Gotchas

## Claude Code Plugin System

### Stop Hook Response Format
- **Blocking Decision**: Use JSON with exit code 0 (not exit code 1)
- Format: \`{"decision":"block","reason":"<message>"}\`
- Exit code 0 with JSON output takes precedence over exit codes
- Multiple Stop hooks execute in sequence; all must allow to proceed

### Stop Hook Context Filtering
- When filtering transcript history, **must use sessionId to isolate current session only**
- Bug pattern: \`(!sessionId || entry.sessionId === sessionId)\` matches all entries (incorrect)
- Correct pattern: \`(sessionId && entry.sessionId === sessionId)\`
- Without proper filtering, stop hook shows work from previous sessions/projects

### PreToolUse Hook Blocks
- **Bash tool**: Redirects to \`dev execute\` (code execution in appropriate language)
- **Write tool**: Blocks \`.md\` and \`.txt\` file creation (except \`CLAUDE.md\` and \`readme.md\`)
- **Glob/Grep/Search tools**: Redirects to \`code-search\` MCP or \`dev execute\`
- Response format: \`{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny|allow","permissionDecisionReason":"..."}}\`

### SessionStart Hook
- Automatically adds \`.glootie-stop-verified\` to \`.gitignore\` on every session start
- Runs AST analysis via \`mcp-thorns\` with 3min timeout
- Injects codebase insight as additional context

### Verification File Lifecycle
- Path: \`.glootie-stop-verified\` (project root)
- Created: When work is verified complete during stop hook
- Deleted: On each new user prompt (via UserPromptSubmit hook)
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
- PreToolUse: Tool policy enforcement
- UserPromptSubmit: State reset
- Stop: Verification and completion

### Configuration
- MCP Servers: dev, code-search
- Agents: gm (state machine)
`;
};

const generatePackageJson = (platform) => {
  return JSON.stringify({
    name: 'glootie-cc',
    version: '2.0.9',
    description: 'Advanced Claude Code plugin with WFGY integration, MCP tools, and automated hooks',
    main: '.claude-plugin/plugin.json',
    bin: {
      'glootie-cc': './cli.js'
    },
    files: [
      '.claude-plugin/',
      'agents/',
      'hooks/',
      'README.md',
      'CLAUDE.md',
      '.mcp.json',
      'plugin.json',
      'pre-tool-use-hook.js',
      'session-start-hook.js',
      'prompt-submit-hook.js',
      'stop-hook.js',
      'stop-hook-git.js'
    ],
    keywords: ['claude-code', 'claude-plugin', 'wfgy', 'mcp', 'automation', 'glootie'],
    author: 'AnEntrypoint',
    license: 'MIT',
    repository: {
      type: 'git',
      url: 'https://github.com/AnEntrypoint/glootie-cc.git'
    },
    homepage: 'https://github.com/AnEntrypoint/glootie-cc#readme',
    bugs: {
      url: 'https://github.com/AnEntrypoint/glootie-cc/issues'
    },
    engines: {
      node: '>=16.0.0'
    },
    peerDependencies: {
      '@anthropic-ai/claude-code': '*'
    },
    publishConfig: {
      access: 'public'
    }
  }, null, 2);
};

const generateHooksJson = (platform) => {
  return JSON.stringify({
    description: 'Hooks for glootie plugin',
    hooks: {
      PreToolUse: [
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: 'node ${CLAUDE_PLUGIN_ROOT}/pre-tool-use-hook.js',
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
              command: 'node ${CLAUDE_PLUGIN_ROOT}/session-start-hook.js',
              timeout: 10000
            }
          ]
        }
      ],
      UserPromptSubmit: [
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: 'node ${CLAUDE_PLUGIN_ROOT}/prompt-submit-hook.js',
              timeout: 3600
            }
          ]
        }
      ],
      Stop: [
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: 'node ${CLAUDE_PLUGIN_ROOT}/stop-hook.js',
              timeout: 300000
            },
            {
              type: 'command',
              command: 'node ${CLAUDE_PLUGIN_ROOT}/stop-hook-git.js',
              timeout: 60000
            }
          ]
        }
      ]
    }
  }, null, 2);
};

const generateMarketplaceJson = () => {
  return JSON.stringify({
    name: 'gm',
    version: '2.0.4',
    description: 'State machine agent with WFGY integration'
  }, null, 2);
};

const readSourceFile = (sourceDir, relativePath) => {
  const fullPath = path.join(sourceDir, relativePath);
  try {
    return fs.readFileSync(fullPath, 'utf-8');
  } catch (e) {
    return null;
  }
};

module.exports = { generateClaudeCodePlugin };
