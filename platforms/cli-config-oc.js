module.exports = {
  name: 'oc',
  label: 'OpenCode',
  configFile: 'opencode.json',
  contextFile: 'GLOOTIE.md',
  hookEventNames: {
    sessionStart: 'session.created',
    preTool: 'tool.execute.before',
    promptSubmit: 'message.updated',
    stop: 'session.closing',
    stopGit: 'session.closing'
  },
  hookOutputFormat: 'sdk',
  tools: {
    bash: 'spawn/exec',
    write: 'fs.writeFile',
    glob: 'fs.glob',
    grep: 'grep',
    search: 'search'
  },
  env: {
    pluginRoot: 'OC_PLUGIN_ROOT',
    projectDir: 'OC_PROJECT_DIR'
  },
  getPackageJsonFields() {
    return {
      main: 'index.js',
      files: [
        'agents/',
        'hooks/',
        'index.js',
        'opencode.json',
        '.mcp.json',
        'setup.sh',
        'setup.bat',
        'setup-global.js',
        'install-global.sh',
        'install-global.bat'
      ]
    };
  },
  formatConfigJson(config, pluginSpec) {
    return JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      default_agent: 'gm',
      plugin: {
        name: pluginSpec.name,
        module: './index.js'
      },
      mcp: {
        dev: {
          type: 'local',
          command: ['npx', '-y', 'gxe@latest', 'AnEntrypoint/mcp-glootie'],
          timeout: 360000,
          enabled: true
        },
        'code-search': {
          type: 'local',
          command: ['npx', '-y', 'gxe@latest', 'AnEntrypoint/code-search'],
          timeout: 360000,
          enabled: true
        }
      }
    }, null, 2);
  },
  getAdditionalFiles(pluginSpec, readFile) {
    return {
      'index.js': readFile(['glootie-oc/index.js']),
      'setup.sh': `#!/bin/bash
set -e
SCRIPT_DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"
mkdir -p "$SCRIPT_DIR/.opencode/agents"
mkdir -p "$SCRIPT_DIR/.opencode/plugins"
cp "$SCRIPT_DIR/agents/gm.md" "$SCRIPT_DIR/.opencode/agents/" 2>/dev/null || true
npm install --save-dev 2>/dev/null || true
echo "Setup complete!"
`,
      'setup.bat': `@echo off
setlocal enabledelayedexpansion
set SCRIPT_DIR=%~dp0
if not exist "%SCRIPT_DIR%.opencode" mkdir "%SCRIPT_DIR%.opencode"
if not exist "%SCRIPT_DIR%.opencode\\agents" mkdir "%SCRIPT_DIR%.opencode\\agents"
copy "%SCRIPT_DIR%agents\\gm.md" "%SCRIPT_DIR%.opencode\\agents\\" >nul 2>&1 || true
call npm install --save-dev >nul 2>&1 || true
echo Setup complete!
`,
      'setup-global.js': readFile(['glootie-oc/setup-global.js']),
      'install-global.sh': `#!/bin/bash
set -e
SCRIPT_DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"
OPENCODE_CONFIG_DIR="\${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
mkdir -p "$OPENCODE_CONFIG_DIR/plugins"
cp -r "$SCRIPT_DIR" "$OPENCODE_CONFIG_DIR/plugins/glootie"
echo "Global installation complete!"
`,
      'install-global.bat': `@echo off
setlocal enabledelayedexpansion
set SCRIPT_DIR=%~dp0
if "%APPDATA%"=="" (
    echo Error: APPDATA not set
    exit /b 1
)
set OPENCODE_CONFIG_DIR=%APPDATA%\\opencode\\plugins
if not exist "%OPENCODE_CONFIG_DIR%" mkdir "%OPENCODE_CONFIG_DIR%"
xcopy /E /I /Y "%SCRIPT_DIR%" "%OPENCODE_CONFIG_DIR%\\glootie" >nul 2>&1
echo Global installation complete!
`
    };
  }
};
