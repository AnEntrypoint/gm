const fs = require('fs');
const path = require('path');
const { writeFile, ensureDir } = require('../../lib/file-generator');
const { defaultConfig, getPlatformConfig } = require('../../lib/config-schema');

const generateOpenCodePlugin = (sourceDir, outputDir) => {
  const platform = getPlatformConfig('oc');
  ensureDir(outputDir);

  const structure = {
    'opencode.json': generateOpenCodeJson(),
    'package.json': generatePackageJson('oc'),
    'README.md': generateReadme('OpenCode'),
    '.mcp.json': generateMcpJson(),
    'agents/gm.md': readSourceFile(sourceDir, 'glootie-oc/agents/gm.md') || readSourceFile(sourceDir, 'glootie-cc/agents/gm.md'),
    'agents/codesearch.md': readSourceFile(sourceDir, 'glootie-oc/.opencode/agents/code-search.md') || readSourceFile(sourceDir, 'glootie-cc/agents/codesearch.md'),
    'agents/websearch.md': readSourceFile(sourceDir, 'glootie-oc/.opencode/agents/web-search.md') || readSourceFile(sourceDir, 'glootie-cc/agents/websearch.md'),
    'index.js': readSourceFile(sourceDir, 'glootie-oc/index.js'),
    'setup.sh': generateSetupSh(),
    'setup.bat': generateSetupBat(),
    'setup-global.js': readSourceFile(sourceDir, 'glootie-oc/setup-global.js'),
    'install-global.sh': generateInstallGlobalSh(),
    'install-global.bat': generateInstallGlobalBat(),
    'hooks/hooks.json': generateHooksJson('oc')
  };

  Object.entries(structure).forEach(([filePath, content]) => {
    if (content) {
      writeFile(path.join(outputDir, filePath), content);
    }
  });
};

const generateOpenCodeJson = () => {
  const mcp = defaultConfig.mcpServers;
  return JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    default_agent: 'gm',
    plugin: {
      name: 'glootie',
      module: './index.js'
    },
    mcp: {
      dev: {
        type: 'local',
        command: mcp.dev.command === 'npx'
          ? ['npx', '-y', 'gxe@latest', 'AnEntrypoint/mcp-glootie']
          : mcp.dev.args,
        timeout: mcp.dev.timeout,
        enabled: true
      },
      'code-search': {
        type: 'local',
        command: mcp['code-search'].command === 'npx'
          ? ['npx', '-y', 'gxe@latest', 'AnEntrypoint/code-search']
          : mcp['code-search'].args,
        timeout: mcp['code-search'].timeout,
        enabled: true
      }
    }
  }, null, 2);
};

const generatePackageJson = (platform) => {
  return JSON.stringify({
    name: 'glootie-oc',
    version: '2.0.9',
    description: 'Advanced OpenCode plugin with WFGY integration, MCP tools, and automated hooks',
    main: 'index.js',
    files: [
      'agents/',
      'hooks/',
      'README.md',
      '.mcp.json',
      'opencode.json',
      'index.js',
      'setup.sh',
      'setup.bat',
      'setup-global.js',
      'install-global.sh',
      'install-global.bat'
    ],
    keywords: ['opencode', 'opencode-plugin', 'wfgy', 'mcp', 'automation', 'glootie'],
    author: 'AnEntrypoint',
    license: 'MIT',
    repository: {
      type: 'git',
      url: 'https://github.com/AnEntrypoint/glootie-oc.git'
    },
    homepage: 'https://github.com/AnEntrypoint/glootie-oc#readme',
    bugs: {
      url: 'https://github.com/AnEntrypoint/glootie-oc/issues'
    },
    engines: {
      node: '>=16.0.0'
    },
    publishConfig: {
      access: 'public'
    }
  }, null, 2);
};

const generateReadme = (platform) => {
  return `# gm - Advanced ${platform} Plugin

Unified gm state machine implementation for ${platform}.

## Installation

### Local Project Installation

\`\`\`bash
./setup.sh
\`\`\`

### Global Installation

\`\`\`bash
./install-global.sh
\`\`\`

## Features

- Automated hook-based tool interception
- AST-based codebase analysis
- Verification file lifecycle management
- Hot reload support
- Real-time context enrichment

## Architecture

### Plugin System
- SDK-based plugin via index.js
- Event listeners for tool restrictions and verification
- Config management via opencode.json

### MCP Servers
- dev: Code execution
- code-search: Semantic code search

## Setup

Run \`./setup.sh\` or \`./setup-global.js\` for system-wide installation.
`;
};

const generateSetupSh = () => {
  return `#!/bin/bash

set -e

SCRIPT_DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="\${SCRIPT_DIR}"

echo "Setting up glootie for OpenCode..."

mkdir -p "$PROJECT_DIR/.opencode"
mkdir -p "$PROJECT_DIR/.opencode/agents"
mkdir -p "$PROJECT_DIR/.opencode/plugins"

cp "$PROJECT_DIR/agents/gm.md" "$PROJECT_DIR/.opencode/agents/" 2>/dev/null || true

npm install --save-dev 2>/dev/null || true

echo "Setup complete!"
echo "Run 'opencode' in this directory to start using glootie."
`;
};

const generateSetupBat = () => {
  return `@echo off
setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set PROJECT_DIR=%SCRIPT_DIR%

echo Setting up glootie for OpenCode...

if not exist "%PROJECT_DIR%.opencode" mkdir "%PROJECT_DIR%.opencode"
if not exist "%PROJECT_DIR%.opencode\\agents" mkdir "%PROJECT_DIR%.opencode\\agents"
if not exist "%PROJECT_DIR%.opencode\\plugins" mkdir "%PROJECT_DIR%.opencode\\plugins"

copy "%PROJECT_DIR%agents\\gm.md" "%PROJECT_DIR%.opencode\\agents\\" >nul 2>&1 || true

call npm install --save-dev >nul 2>&1 || true

echo Setup complete!
echo Run 'opencode' in this directory to start using glootie.
`;
};

const generateInstallGlobalSh = () => {
  return `#!/bin/bash

set -e

SCRIPT_DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"

echo "Installing glootie globally..."

OPENCODE_CONFIG_DIR="\${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
mkdir -p "$OPENCODE_CONFIG_DIR/plugins"

cp -r "$SCRIPT_DIR" "$OPENCODE_CONFIG_DIR/plugins/glootie"

echo "Global installation complete!"
echo "glootie plugin installed to: $OPENCODE_CONFIG_DIR/plugins/glootie"
`;
};

const generateInstallGlobalBat = () => {
  return `@echo off
setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0

echo Installing glootie globally...

if "%APPDATA%"=="" (
    echo Error: APPDATA environment variable not set
    exit /b 1
)

set OPENCODE_CONFIG_DIR=%APPDATA%\\opencode\\plugins

if not exist "%OPENCODE_CONFIG_DIR%" mkdir "%OPENCODE_CONFIG_DIR%"

xcopy /E /I /Y "%SCRIPT_DIR%" "%OPENCODE_CONFIG_DIR%\\glootie" >nul 2>&1

echo Global installation complete!
echo glootie plugin installed to: %OPENCODE_CONFIG_DIR%\\glootie
`;
};

const generateMcpJson = () => {
  return JSON.stringify({
    $schema: 'https://schemas.modelcontextprotocol.io/0.1.0/mcp.json',
    mcpServers: defaultConfig.mcpServers
  }, null, 2);
};

const generateHooksJson = (platform) => {
  return JSON.stringify({
    description: 'Hooks for glootie OpenCode plugin',
    hooks: {}
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

module.exports = { generateOpenCodePlugin };
