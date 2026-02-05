const factory = require('./cli-config-factory');

const cc = factory('cc', 'Claude Code', 'CLAUDE.md', 'CLAUDE.md', {
  formatConfigJson(config) {
    return JSON.stringify({
      ...config,
      author: { name: config.author, url: 'https://github.com/AnEntrypoint' }
    }, null, 2);
  },
  getPackageJsonFields() {
    return {
      files: ['agents/', 'hooks/', 'scripts/', 'skills/', '.github/', '.mcp.json', '.claude-plugin/', 'plugin.json', 'README.md', 'LICENSE', '.gitignore', '.editorconfig', 'CONTRIBUTING.md', 'CLAUDE.md'],
      keywords: ['claude-code', 'agent', 'state-machine', 'mcp', 'automation', 'glootie'],
      peerDependencies: { '@anthropic-ai/claude-code': '*' }
    };
  },
  getAdditionalFiles(spec) {
    const TemplateBuilder = require('../lib/template-builder');
    return {
      'plugin.json': TemplateBuilder.generatePluginJson(spec),
      '.claude-plugin/marketplace.json': TemplateBuilder.generateMarketplaceJson(spec)
    };
  },
  generateReadme(spec) {
    const repoName = `${spec.name}-cc`;
    return `# ${repoName} for Claude Code\n\n## Installation\n\nThis package supports three installation modes:\n\n### Mode 1: Standalone (npm install in project)\n\nInstall ${repoName} into your project to add the gm state machine and hooks:\n\n\`\`\`bash\ncd /path/to/your/project\nnpm install ${repoName}\n\`\`\`\n\nThe postinstall script automatically copies files to your project's \`.claude/\` directory:\n\n\`\`\`\nproject/\n├── node_modules/${repoName}/\n└── .claude/\n    ├── agents/\n    │   └── gm.md\n    ├── hooks/\n    │   ├── pre-tool-use-hook.js\n    │   ├── session-start-hook.js\n    │   ├── prompt-submit-hook.js\n    │   ├── stop-hook.js\n    │   └── stop-hook-git.js\n    └── .mcp.json\n\`\`\`\n\nClaude Code automatically discovers and reads from the \`.claude/\` directory without any configuration needed.\n\n### Mode 2: Plugin System (global or distributed)\n\nFor Claude Code plugin system recognition, the package includes \`.claude-plugin/plugin.json\`:\n\n\`\`\`\nnode_modules/${repoName}/\n└── .claude-plugin/\n    └── plugin.json\n\`\`\`\n\nWhen installed globally or via the Claude Code plugin system, the plugin.json enables:\n- Automatic agent discovery via Claude Code plugin system\n- Direct plugin installation without manual file copying\n- Marketplace distribution and updates\n\n### Mode 3: Both Modes\n\nThe package includes both mechanisms:\n- \`.claude-plugin/plugin.json\` for plugin system recognition\n- \`scripts/postinstall.js\` for standalone npm installation\n- Both coexist without conflict\n\nStandalone mode takes precedence when installed locally. Plugin mode available when used with the plugin system.\n\n## Update\n\n\`\`\`bash\nnpm update ${repoName}\n\`\`\`\n\nThe postinstall script runs again and updates all files in \`.claude/\`.\n\n## Features\n\n- State machine agent with exhaustive behavioral rules\n- Five enforcement hooks (validation, prompts, startup, completion, git)\n- MCP integration for code execution and search\n- Automatic thorns AST analysis at session start\n- .prd completion enforcement at session end\n- Dual-mode installation: standalone npm or Claude Code plugin system\n- Automatic .claude/ directory setup via postinstall in standalone mode\n- Plugin system discovery via .claude-plugin/plugin.json in plugin mode\n`;
  }
});

const gc = factory('gc', 'Gemini CLI', 'gemini-extension.json', 'GEMINI.md', {
  formatConfigJson(config) {
    return JSON.stringify({ ...config, contextFileName: this.contextFile }, null, 2);
  },
  getPackageJsonFields() {
    return {
      files: ['agents/', 'hooks/', '.github/', 'README.md', 'GEMINI.md', '.mcp.json', 'gemini-extension.json', 'cli.js']
    };
  },
  getAdditionalFiles(pluginSpec) {
    return {
      'cli.js': `#!/usr/bin/env node\n\nconst show = () => {\n  console.log('glootie-gc: Advanced Gemini CLI extension');\n  console.log('Version: 2.0.9');\n  console.log('');\n  console.log('Usage: glootie-gc [command]');\n  console.log('Commands:');\n  console.log('  help, --help, -h');\n  console.log('  version, --version');\n};\n\nconst args = process.argv.slice(2);\nif (!args.length || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {\n  show();\n} else if (args[0] === 'version' || args[0] === '--version') {\n  console.log('2.0.9');\n}\n`
    };
  },
  buildHookCommand(hookFile) {
    return `node \${extensionPath}/hooks/${hookFile}`;
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
      files: ['hooks/', 'agents/', '.github/', 'README.md', 'CLAUDE.md', '.mcp.json', 'plugin.json', 'pre-tool-use-hook.js', 'session-start-hook.js', 'prompt-submit-hook.js', 'stop-hook.js', 'stop-hook-git.js'],
      keywords: ['codex', 'claude-code', 'wfgy', 'mcp', 'automation', 'glootie']
    };
  },
  generateReadme(spec) {
    return `# ${spec.name} for Codex\n\n## Installation\n\nCopy to your Codex plugins directory:\n\n\`\`\`bash\ncp -r . ~/.codex/plugins/${spec.name}\n\`\`\`\n\nOr clone directly:\n\n\`\`\`bash\ngit clone https://github.com/AnEntrypoint/glootie-codex ~/.codex/plugins/${spec.name}\n\`\`\`\n\n## Environment\n\nSet CODEX_PLUGIN_ROOT to your plugin directory in your shell profile.\n\n## Features\n\n- MCP tools for code execution and search\n- State machine agent policy (gm)\n- Stop hook verification loop\n- Git enforcement on session end\n- AST analysis via thorns at session start\n\nThe plugin activates automatically on session start.\n`;
  }
});

function ocPluginSource() {
  const BT = '`';
  const lines = [
    "import fs from 'fs';",
    "import path from 'path';",
    "import { fileURLToPath } from 'url';",
    "import { analyze } from 'mcp-thorns';",
    "",
    "const SHELL_TOOLS = ['bash'];",
    "const SEARCH_TOOLS = ['glob', 'grep', 'list'];",
    "",
    "export const GlootiePlugin = async ({ project, client, $, directory, worktree }) => {",
    "  const pluginDir = path.dirname(fileURLToPath(import.meta.url));",
    "  let agentRules = '';",
    "",
    "  const loadAgentRules = () => {",
    "    if (agentRules) return agentRules;",
    "    const agentMd = path.join(pluginDir, 'agents', 'gm.md');",
    "    try { agentRules = fs.readFileSync(agentMd, 'utf-8'); } catch (e) {}",
    "    return agentRules;",
    "  };",
    "",
    "  const runSessionStart = async () => {",
    "    if (!client || !client.tui) return;",
    "    await new Promise(resolve => setTimeout(resolve, 500));",
    "    const outputs = [];",
    "    const rules = loadAgentRules();",
    "    if (rules) outputs.push(rules);",
    "    try {",
    "      outputs.push('=== mcp-thorns ===\\n' + analyze(directory));",
    "    } catch (e) {",
    "      outputs.push('=== mcp-thorns ===\\nSkipped (' + e.message + ')');",
    "    }",
    "    if (outputs.length === 0) return;",
    "    const text = outputs.join('\\n\\n')",
    "      .replace(/[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]/g, '')",
    "      .replace(/[\\u2028\\u2029]/g, '\\n')",
    "      .trim();",
    "    try {",
    "      await client.tui.appendPrompt({ body: { text } });",
    "    } catch (e) {",
    "      if (e.message && (e.message.includes('EditBuffer') || e.message.includes('disposed') || e.message.includes('illegal character') || e.message.includes('Array index'))) return;",
    "      throw e;",
    "    }",
    "  };",
    "",
    "  const runSessionIdle = async () => {",
    "    if (!client || !client.tui) return;",
    "    const blockReasons = [];",
    "    try {",
    "      const ahead = await $" + BT + "git rev-list --count origin/HEAD..HEAD" + BT + ".timeout(2000).nothrow();",
    "      if (ahead.exitCode === 0 && parseInt(ahead.stdout.trim()) > 0)",
    "        blockReasons.push('Git: ' + ahead.stdout.trim() + ' commit(s) ahead of origin/HEAD');",
    "    } catch (e) {}",
    "    try {",
    "      const behind = await $" + BT + "git rev-list --count HEAD..origin/HEAD" + BT + ".timeout(2000).nothrow();",
    "      if (behind.exitCode === 0 && parseInt(behind.stdout.trim()) > 0)",
    "        blockReasons.push('Git: ' + behind.stdout.trim() + ' commit(s) behind origin/HEAD');",
    "    } catch (e) {}",
    "    const prdFile = path.join(directory, '.prd');",
    "    if (fs.existsSync(prdFile)) {",
    "      const prd = fs.readFileSync(prdFile, 'utf-8').trim();",
    "      if (prd.length > 0) blockReasons.push('Work items remain in .prd:\\n' + prd);",
    "    }",
    "    if (blockReasons.length > 0) throw new Error(blockReasons.join(' | '));",
    "    const filesToRun = [];",
    "    const evalJs = path.join(directory, 'eval.js');",
    "    if (fs.existsSync(evalJs)) filesToRun.push('eval.js');",
    "    const evalsDir = path.join(directory, 'evals');",
    "    if (fs.existsSync(evalsDir) && fs.statSync(evalsDir).isDirectory()) {",
    "      filesToRun.push(...fs.readdirSync(evalsDir)",
    "        .filter(f => f.endsWith('.js') && !path.join(evalsDir, f).includes('/lib/'))",
    "        .sort().map(f => path.join('evals', f)));",
    "    }",
    "    for (const file of filesToRun) {",
    "      try { await $" + BT + "node ${file}" + BT + ".timeout(60000); } catch (e) {",
    "        throw new Error('eval error: ' + e.message + '\\n' + (e.stdout || '') + '\\n' + (e.stderr || ''));",
    "      }",
    "    }",
    "  };",
    "",
    "  return {",
    "    event: async ({ event }) => {",
    "      if (event.type === 'session.created') await runSessionStart();",
    "      else if (event.type === 'session.idle') await runSessionIdle();",
    "    },",
    "",
    "    'tool.execute.before': async (input, output) => {",
    "      const tool = input.tool;",
    "      if (SHELL_TOOLS.includes(tool)) {",
    "        throw new Error('Use plugin:gm:dev execute for all command execution');",
    "      }",
    "      if (SEARCH_TOOLS.includes(tool)) {",
    "        throw new Error('Use plugin:gm:code-search or plugin:gm:dev for code exploration');",
    "      }",
    "      if (tool === 'write' || tool === 'edit' || tool === 'patch') {",
    "        const fp = output.args?.file_path || output.args?.filePath || output.args?.path || '';",
    "        const ext = path.extname(fp);",
    "        const base = path.basename(fp).toLowerCase();",
    "        const inSkills = fp.includes('/skills/');",
    "        if ((ext === '.md' || ext === '.txt' || base.startsWith('features_list')) &&",
    "            !base.startsWith('claude') && !base.startsWith('readme') && !base.startsWith('glootie') && !inSkills) {",
    "          throw new Error('Cannot create documentation files. Only CLAUDE.md, GLOOTIE.md, and README.md are maintained.');",
    "        }",
    "      }",
    "    },",
    "",
    "    'experimental.chat.system.transform': async (input, output) => {",
    "      const rules = loadAgentRules();",
    "      if (rules) output.system.push(rules);",
    "    },",
    "",
    "    'experimental.session.compacting': async (input, output) => {",
    "      const rules = loadAgentRules();",
    "      if (rules) output.context.push(rules);",
    "    }",
    "  };",
    "};",
  ];
  return lines.join('\n') + '\n';
}

const oc = factory('oc', 'OpenCode', 'opencode.json', 'GLOOTIE.md', {
  getPackageJsonFields() {
    return {
      type: 'module',
      main: 'glootie.mjs',
      files: ['agents/', 'glootie.mjs', 'index.js', 'opencode.json', '.github/', '.mcp.json', 'README.md'],
      keywords: ['opencode', 'opencode-plugin', 'mcp', 'automation', 'glootie'],
      dependencies: { 'mcp-thorns': '^4.1.0' }
    };
  },
  generatePackageJson(pluginSpec, extraFields = {}) {
    return JSON.stringify({
      name: `${pluginSpec.name}-oc`,
      version: pluginSpec.version,
      description: pluginSpec.description,
      author: pluginSpec.author,
      license: pluginSpec.license,
      type: 'module',
      main: 'glootie.mjs',
      keywords: ['opencode', 'opencode-plugin', 'mcp', 'automation', 'glootie'],
      repository: { type: 'git', url: `https://github.com/AnEntrypoint/${pluginSpec.name}-oc.git` },
      homepage: `https://github.com/AnEntrypoint/${pluginSpec.name}-oc#readme`,
      bugs: { url: `https://github.com/AnEntrypoint/${pluginSpec.name}-oc/issues` },
      engines: pluginSpec.engines,
      publishConfig: pluginSpec.publishConfig,
      dependencies: { 'mcp-thorns': '^4.1.0' },
      ...extraFields
    }, null, 2);
  },
  formatConfigJson(config, pluginSpec) {
    // Convert MCP config from glootie.json format (command + args) to opencode format (command array)
    const mcpServers = {};
    if (pluginSpec.mcp) {
      for (const [serverName, serverConfig] of Object.entries(pluginSpec.mcp)) {
        const command = Array.isArray(serverConfig.command) 
          ? serverConfig.command 
          : [serverConfig.command];
        const args = serverConfig.args || [];
        mcpServers[serverName] = {
          type: 'local',
          command: command[0],
          args: [...command.slice(1), ...args],
          timeout: serverConfig.timeout || 360000,
          enabled: true
        };
      }
    }
    
    return JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      default_agent: 'gm',
      mcp: mcpServers,
      plugin: ['glootie-oc']
    }, null, 2);
  },
  getAdditionalFiles(pluginSpec) {
    return {
      'index.js': `export { GlootiePlugin } from './glootie.mjs';\n`,
      'glootie.mjs': ocPluginSource(),
    };
  },
  generateReadme(spec) {
    return `# ${spec.name} for OpenCode\n\n## Installation\n\n### Global (recommended)\n\nCopy plugin to opencode config:\n\n\`\`\`bash\nmkdir -p ~/.config/opencode/plugin\ncp -r . ~/.config/opencode/plugin/\ncd ~/.config/opencode/plugin && bun install\n\`\`\`\n\n### Project-level\n\n\`\`\`bash\nmkdir -p .opencode/plugins\ncp glootie.mjs index.js package.json .opencode/plugins/\ncp -r agents .opencode/plugins/\ncd .opencode && bun install\n\`\`\`\n\n## Features\n\n- MCP tools for code execution and search\n- State machine agent policy (gm)\n- Git enforcement on session idle\n- AST analysis via thorns at session start\n\nThe plugin activates automatically on session start.\n`;
  }
});

module.exports = { cc, gc, codex, oc };
