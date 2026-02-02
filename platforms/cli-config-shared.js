const factory = require('./cli-config-factory');

const cc = factory('cc', 'Claude Code', 'plugin.json', 'CLAUDE.md', {
  formatConfigJson(config) {
    return JSON.stringify({
      ...config,
      author: { name: config.author, url: 'https://github.com/AnEntrypoint' },
      hooks: './hooks/hooks.json'
    }, null, 2);
  },
  getPackageJsonMain() { return '.claude-plugin/plugin.json'; },
  getPackageJsonFields() {
    return {
      main: '.claude-plugin/plugin.json',
      bin: { 'glootie-cc': './cli.js' },
      files: ['.claude-plugin/', 'hooks/', 'README.md', 'CLAUDE.md', '.mcp.json', 'plugin.json', 'prompt-submit-hook.js', 'stop-hook.js'],
      keywords: ['claude-code', 'claude-plugin', 'wfgy', 'mcp', 'automation', 'glootie'],
      peerDependencies: { '@anthropic-ai/claude-code': '*' }
    };
  },
  getAdditionalFiles(spec) {
    return {
      '.claude-plugin/marketplace.json': JSON.stringify({
        name: spec.name + '-cc',
        owner: { name: 'AnEntrypoint', email: 'almagestfraternite@gmail.com' },
        version: spec.version,
        description: spec.description,
        plugins: [{ name: 'gm', source: './' }]
      }, null, 2)
    };
  },
  generateReadme(spec) {
    const repoName = `${spec.name}-cc`;
    return `# ${repoName} for Claude Code\n\n## Installation\n\n\`\`\`bash\nclaude plugin marketplace add AnEntrypoint/${repoName}\nclaude plugin install -s user ${repoName}@${repoName}\n\`\`\`\n\n## Update\n\n\`\`\`bash\nclaude plugin marketplace update ${repoName}\nclaude plugin update ${repoName}@${repoName}\n\`\`\`\n\n## Features\n\n- MCP tools for code execution and search\n- State machine agent policy (gm)\n- Stop hook verification loop\n- Git enforcement on session end\n- AST analysis via thorns at session start\n\nThe plugin activates automatically on session start.\n`;
  }
});

const gc = factory('gc', 'Gemini CLI', 'gemini-extension.json', 'GEMINI.md', {
  formatConfigJson(config) {
    return JSON.stringify({ ...config, contextFileName: this.contextFile }, null, 2);
  },
  getPackageJsonFields() {
    return {
      files: ['agents/', 'hooks/', 'README.md', 'GEMINI.md', '.mcp.json', 'gemini-extension.json', 'cli.js', 'pre-tool-use-hook.js', 'session-start-hook.js', 'prompt-submit-hook.js', 'stop-hook.js', 'stop-hook-git.js']
    };
  },
  getAdditionalFiles(pluginSpec) {
    return {
      'cli.js': `#!/usr/bin/env node\n\nconst show = () => {\n  console.log('glootie-gc: Advanced Gemini CLI extension');\n  console.log('Version: 2.0.9');\n  console.log('');\n  console.log('Usage: glootie-gc [command]');\n  console.log('Commands:');\n  console.log('  help, --help, -h');\n  console.log('  version, --version');\n};\n\nconst args = process.argv.slice(2);\nif (!args.length || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {\n  show();\n} else if (args[0] === 'version' || args[0] === '--version') {\n  console.log('2.0.9');\n}\n`
    };
  },
  buildHookCommand(hookFile) {
    return `node \${extensionPath}/${hookFile}`;
  },
  generateReadme(spec) {
    return `# ${spec.name} for Gemini CLI\n\n## Installation\n\nCopy to your Gemini extensions directory:\n\n\`\`\`bash\ncp -r . ~/.gemini/extensions/${spec.name}\n\`\`\`\n\nOr clone directly:\n\n\`\`\`bash\ngit clone https://github.com/AnEntrypoint/glootie-gc ~/.gemini/extensions/${spec.name}\n\`\`\`\n\n## Automatic Path Resolution\n\nHooks automatically use \`\${extensionPath}\` for path resolution. No manual environment variable setup required. The extension is fully portable.\n\n## Features\n\n- MCP tools for code execution and search\n- State machine agent policy (gm)\n- Stop hook verification loop\n- Git enforcement on session end\n- AST analysis via thorns at session start\n\nThe extension activates automatically on session start.\n`;
  }
});

const codex = factory('codex', 'Codex', 'plugin.json', 'CLAUDE.md', {
  formatConfigJson(config) {
    return JSON.stringify({
      ...config,
      author: { name: config.author, url: 'https://github.com/AnEntrypoint' },
      hooks: './hooks/hooks.json'
    }, null, 2);
  },
  getPackageJsonMain() { return 'plugin.json'; },
  getPackageJsonFields() {
    return {
      main: 'plugin.json',
      bin: { 'glootie-codex': './cli.js' },
      files: ['hooks/', 'agents/', 'README.md', 'CLAUDE.md', '.mcp.json', 'plugin.json', 'pre-tool-use-hook.js', 'session-start-hook.js', 'prompt-submit-hook.js', 'stop-hook.js', 'stop-hook-git.js'],
      keywords: ['codex', 'claude-code', 'wfgy', 'mcp', 'automation', 'glootie']
    };
  },
  generateReadme(spec) {
    return `# ${spec.name} for Codex\n\n## Installation\n\nCopy to your Codex plugins directory:\n\n\`\`\`bash\ncp -r . ~/.codex/plugins/${spec.name}\n\`\`\`\n\nOr clone directly:\n\n\`\`\`bash\ngit clone https://github.com/AnEntrypoint/glootie-codex ~/.codex/plugins/${spec.name}\n\`\`\`\n\n## Environment\n\nSet CODEX_PLUGIN_ROOT to your plugin directory in your shell profile.\n\n## Features\n\n- MCP tools for code execution and search\n- State machine agent policy (gm)\n- Stop hook verification loop\n- Git enforcement on session end\n- AST analysis via thorns at session start\n\nThe plugin activates automatically on session start.\n`;
  }
});

const oc = factory('oc', 'OpenCode', 'opencode.json', 'GLOOTIE.md', {
  getPackageJsonFields() {
    return {
      main: 'index.js',
      bin: { 'glootie-oc': './index.js' },
      files: ['agents/', 'hooks/', 'index.js', 'opencode.json', '.mcp.json', 'setup.sh', 'setup.bat', 'setup-global.js', 'install-global.sh', 'install-global.bat', 'README.md'],
      keywords: ['opencode', 'opencode-plugin', 'mcp', 'automation', 'glootie']
    };
  },
  generatePackageJson(pluginSpec, extraFields = {}) {
    return JSON.stringify({
      name: `${pluginSpec.name}-oc`,
      version: pluginSpec.version,
      description: pluginSpec.description,
      author: pluginSpec.author,
      license: pluginSpec.license,
      keywords: pluginSpec.keywords,
      repository: { type: 'git', url: `https://github.com/AnEntrypoint/${pluginSpec.name}-oc.git` },
      homepage: `https://github.com/AnEntrypoint/${pluginSpec.name}-oc#readme`,
      bugs: { url: `https://github.com/AnEntrypoint/${pluginSpec.name}-oc/issues` },
      engines: pluginSpec.engines,
      publishConfig: pluginSpec.publishConfig,
      ...extraFields
    }, null, 2);
  },
  formatConfigJson(config, pluginSpec) {
    return JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      default_agent: 'gm',
      plugin: [pluginSpec.name],
      mcp: {
        dev: { type: 'local', command: ['bash', '<(curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/mcp-glootie/main/bun-run.sh)'], timeout: 360000, enabled: true },
        'code-search': { type: 'local', command: ['npx', '-y', 'gxe@latest', 'AnEntrypoint/code-search'], timeout: 360000, enabled: true }
      }
    }, null, 2);
  },
  getAdditionalFiles(pluginSpec) {
    return {
      'index.js': `export const glootie = async ({ project, client, $, directory, worktree }) => {\n  return {\n    hooks: {\n      sessionStart: require('./hooks/session-start-hook.js'),\n      preTool: require('./hooks/pre-tool-use-hook.js'),\n      promptSubmit: require('./hooks/prompt-submit-hook.js'),\n      stop: require('./hooks/stop-hook.js'),\n      stopGit: require('./hooks/stop-hook-git.js')\n    }\n  };\n};\n`,
      'setup.sh': `#!/bin/bash\nset -e\nSCRIPT_DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"\nmkdir -p "$SCRIPT_DIR/.opencode/agents"\nmkdir -p "$SCRIPT_DIR/.opencode/plugins"\ncp "$SCRIPT_DIR/agents/gm.md" "$SCRIPT_DIR/.opencode/agents/" 2>/dev/null || true\nnpm install --save-dev 2>/dev/null || true\necho "Setup complete!"\n`,
      'setup.bat': `@echo off\nsetlocal enabledelayedexpansion\nset SCRIPT_DIR=%~dp0\nif not exist "%SCRIPT_DIR%.opencode" mkdir "%SCRIPT_DIR%.opencode"\nif not exist "%SCRIPT_DIR%.opencode\\\\agents" mkdir "%SCRIPT_DIR%.opencode\\\\agents"\ncopy "%SCRIPT_DIR%agents\\\\gm.md" "%SCRIPT_DIR%.opencode\\\\agents\\\\" >nul 2>&1 || true\ncall npm install --save-dev >nul 2>&1 || true\necho Setup complete!\n`,
      'setup-global.js': `#!/usr/bin/env node\nconst fs = require('fs');\nconst path = require('path');\nconst os = require('os');\n\nconst configDir = process.env.XDG_CONFIG_HOME ? path.join(process.env.XDG_CONFIG_HOME, 'opencode') : path.join(os.homedir(), '.config', 'opencode');\nconst pluginDir = path.join(configDir, 'plugins', 'glootie');\nconst scriptDir = __dirname;\n\nconsole.log('Installing glootie plugin globally...');\nconsole.log('Target directory:', pluginDir);\n\ntry {\n  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });\n  const parentDir = path.dirname(pluginDir);\n  if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });\n  const files = fs.readdirSync(scriptDir);\n  files.forEach(file => {\n    const src = path.join(scriptDir, file);\n    const dest = path.join(pluginDir, file);\n    if (file !== 'node_modules' && file !== '.git') copyRecursive(src, dest);\n  });\n  console.log('Installation complete!');\n} catch (err) {\n  console.error('Installation failed:', err.message);\n  process.exit(1);\n}\n\nfunction copyRecursive(src, dest) {\n  const stat = fs.statSync(src);\n  if (stat.isDirectory()) {\n    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });\n    fs.readdirSync(src).forEach(file => copyRecursive(path.join(src, file), path.join(dest, file)));\n  } else fs.copyFileSync(src, dest);\n}\n`,
      'install-global.sh': `#!/bin/bash\nset -e\nSCRIPT_DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"\nOPENCODE_CONFIG_DIR="\${XDG_CONFIG_HOME:-$HOME/.config}/opencode"\nmkdir -p "$OPENCODE_CONFIG_DIR/plugins"\ncp -r "$SCRIPT_DIR" "$OPENCODE_CONFIG_DIR/plugins/glootie"\necho "Global installation complete!"\n`,
      'install-global.bat': `@echo off\nsetlocal enabledelayedexpansion\nset SCRIPT_DIR=%~dp0\nif "%APPDATA%"=="" (\n    echo Error: APPDATA not set\n    exit /b 1\n)\nset OPENCODE_CONFIG_DIR=%APPDATA%\\\\opencode\\\\plugins\nif not exist "%OPENCODE_CONFIG_DIR%" mkdir "%OPENCODE_CONFIG_DIR%"\nxcopy /E /I /Y "%SCRIPT_DIR%" "%OPENCODE_CONFIG_DIR%\\\\glootie" >nul 2>&1\necho Global installation complete!\n`
    };
  },
  generateReadme(spec) {
    return `# ${spec.name} for OpenCode\n\n## Installation\n\n### Local (project-level)\n\n\`\`\`bash\n./setup.sh\n\`\`\`\n\nOr on Windows:\n\n\`\`\`bat\nsetup.bat\n\`\`\`\n\n### Global\n\n\`\`\`bash\n./install-global.sh\n\`\`\`\n\nOr on Windows:\n\n\`\`\`bat\ninstall-global.bat\n\`\`\`\n\n## Environment\n\nSet OC_PLUGIN_ROOT to your plugin directory in your shell profile.\n\n## Features\n\n- MCP tools for code execution and search\n- State machine agent policy (gm)\n- Stop hook verification loop\n- Git enforcement on session end\n- AST analysis via thorns at session start\n\nThe plugin activates automatically on session start.\n`;
  }
});

module.exports = { cc, gc, codex, oc };
