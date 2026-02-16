const factory = require('./cli-config-factory');

const cc = factory('cc', 'Claude Code', 'CLAUDE.md', 'CLAUDE.md', {
  formatConfigJson(config) {
    return JSON.stringify({
      ...config,
      author: { name: config.author, url: 'https://github.com/AnEntrypoint' }
    }, null, 2);
  },
  generatePackageJson(pluginSpec, extraFields = {}) {
    return JSON.stringify({
      name: 'glootie-cc',
      version: pluginSpec.version,
      description: pluginSpec.description,
      author: pluginSpec.author,
      license: pluginSpec.license,
      repository: { type: 'git', url: 'https://github.com/AnEntrypoint/glootie-cc.git' },
      homepage: 'https://github.com/AnEntrypoint/glootie-cc#readme',
      bugs: { url: 'https://github.com/AnEntrypoint/glootie-cc/issues' },
      engines: pluginSpec.engines,
      publishConfig: pluginSpec.publishConfig,
      bin: { 'glootie-cc': './cli.js', 'glootie-install': './install.js' },
      files: ['agents/', 'hooks/', 'scripts/', 'skills/', '.github/', '.mcp.json', '.claude-plugin/', 'plugin.json', 'README.md', 'LICENSE', '.gitignore', '.editorconfig', 'CONTRIBUTING.md', 'CLAUDE.md'],
      keywords: ['claude-code', 'agent', 'state-machine', 'mcp', 'automation', 'glootie'],
      peerDependencies: { '@anthropic-ai/claude-code': '*' },
      scripts: pluginSpec.scripts,
      ...extraFields
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
    const repoName = 'glootie-cc';
    return `# ${repoName} for Claude Code

## Installation

### Plugin Marketplace Installation (Recommended)

The easiest way to install ${repoName} is through Claude Code's plugin marketplace:

\`\`\`bash
claude plugin marketplace add AnEntrypoint/${repoName}
claude plugin install -s user gm@${repoName}
\`\`\`

This installation method is best for:
- One-time plugin installation across all projects
- Always having the latest version
- Minimal setup and configuration
- Access to marketplace updates

### Repository Installation (Project-Specific)

For development or project-specific customization, install ${repoName} directly into your project:

\`\`\`bash
cd /path/to/your/project
npm install ${repoName} && npx glootie install
\`\`\`

This installation method is ideal when you need to:
- Customize hooks or agents for your workflow
- Integrate with existing Claude Code projects
- Use the latest development version
- Configure platform-specific behavior per project

#### Installation Command Breakdown

The \`npm install ${repoName} && npx glootie install\` command performs two steps:

1. **\`npm install ${repoName}\`** - Downloads the ${repoName} package and stores it in your project's \`node_modules/\` directory
2. **\`npx glootie install\`** - Runs the glootie installer that copies configuration files into your Claude Code plugin directory

**Expected output:**
\`\`\`
$ npm install ${repoName}
added 1 package in 1.2s

$ npx glootie install
Installing ${repoName}...
✓ Created .claude/ directory
✓ Copied agents/gm.md
✓ Copied hooks to .claude/hooks/
✓ Created .mcp.json for MCP integration
\`\`\`

#### Installed File Structure (Project-Specific)

After running \`npx glootie install\`, your project will have:

\`\`\`
.claude/
├── agents/
│   └── gm.md                 # State machine agent rules
├── hooks/
│   ├── pre-tool-use-hook.js  # Tool validation and filtering
│   ├── session-start-hook.js # Session initialization
│   ├── prompt-submit-hook.js # Prompt validation
│   ├── stop-hook.js          # Session completion enforcement
│   └── stop-hook-git.js      # Git state verification
└── .mcp.json                 # MCP server configuration
\`\`\`

Each hook runs automatically at the appropriate session event. No manual trigger needed.

## File Installation (Manual Setup)

If you prefer manual file management, clone the repository and copy files directly:

\`\`\`bash
# Clone the repository
git clone https://github.com/AnEntrypoint/${repoName}.git

# Copy to your Claude Code plugin directory
cp -r ./agents ~/.claude/agents
cp -r ./hooks ~/.claude/hooks
cp .mcp.json ~/.claude/.mcp.json
\`\`\`

## Environment Setup

\`\`\`bash
# Ensure you have Node.js and bunx installed
# bunx is required for hook execution
# It's bundled with Node.js 18+
which bunx
bunx --version
\`\`\`

## MCP Server Configuration

The \`.mcp.json\` file automatically configures:
- **dev**: Local code execution environment (uses \`bunx\`)
- **code-search**: Semantic code search via mcp-codebasesearch

No additional configuration needed.

## Configuration

### Option 1: Marketplace Installation (Default)

Marketplace installations use the default configuration. All settings work out-of-box:
- Hooks auto-detect file locations in .claude/hooks/
- MCP servers configured via included .mcp.json
- Agents loaded from .claude/agents/gm.md

### Option 2: Project-Specific Installation

For project customization:

1. **Edit agents/gm.md** to adjust behavioral rules
2. **Modify hooks** in .claude/hooks/ for custom behavior
3. **Update .mcp.json** to add or change MCP servers

Customizations are isolated to your project and won't affect other installations.

## Hook Enablement

Hooks run automatically once installed. To verify hooks are active:

1. Restart Claude Code
2. Start a new session
3. You should see hook output in the Claude Code terminal

If hooks don't activate:
- Check that .claude/hooks/ directory exists
- Verify hook files have executable permissions
- Ensure .mcp.json references the correct hook paths

## Update Procedures

### Plugin Marketplace Installation

\`\`\`bash
# Method 1: Via Claude Code commands
claude plugin marketplace update gm-cc
claude plugin update gm@gm-cc

# Method 2: Manual update
npm install -g ${repoName}@latest
\`\`\`

### Project-Specific Installation

\`\`\`bash
# Update the package
npm update ${repoName}

# Re-run the installer to update .claude/ directory
npx glootie install

# Or manually copy updated files
cp -r node_modules/${repoName}/agents/* .claude/agents/
cp -r node_modules/${repoName}/hooks/* .claude/hooks/
cp node_modules/${repoName}/.mcp.json .claude/.mcp.json
\`\`\`

## Features

- **State machine agent** - Complete behavioral rule system for development
- **Five enforcement hooks** - Validation, prompts, startup, completion, git enforcement
- **MCP integration** - Code execution and semantic code search
- **Automatic thorns analysis** - AST analysis on session start
- **.prd enforcement** - Completion blocking at session end
- **Dual-mode installation** - Both user-wide (marketplace) and project-specific (npm)
- **Automatic setup** - No manual configuration needed
- **Convention-driven** - Works with existing code structure

## Troubleshooting

### Hooks not running

**Symptom:** Hooks don't execute when expected

**Solutions:**
1. Verify .claude/hooks/ directory exists: \`ls -la ~/.claude/hooks/\`
2. Check hook files are executable: \`chmod +x ~/.claude/hooks/*.js\`
3. Restart Claude Code completely
4. Check if hooks are loaded: Look for hook output in Claude Code terminal

### MCP servers not available

**Symptom:** Code execution or search tools don't work

**Solutions:**
1. Verify .mcp.json exists: \`cat ~/.claude/.mcp.json\`
2. Check MCP configuration references correct paths
3. Ensure bunx is installed: \`which bunx\`
4. Restart Claude Code and retry

### Plugin not appearing in marketplace

**Symptom:** Plugin doesn't show in \`claude plugin marketplace list\`

**Solutions:**
1. Check plugin is published: \`npm view ${repoName}\`
2. Verify package.json has correct plugin metadata
3. Check .claude-plugin/marketplace.json is valid JSON
4. Wait 5-10 minutes for marketplace index to refresh

### Permission denied errors

**Symptom:** "Permission denied" when running hooks

**Solutions:**
1. Make hook files executable: \`chmod +x ~/.claude/hooks/*.js\`
2. Check parent directories are readable: \`chmod 755 ~/.claude ~/.claude/hooks\`
3. Verify Claude Code process has file access

### Installation failed with npm

**Symptom:** \`npm install\` fails with network or permission errors

**Solutions:**
1. Check internet connection
2. Clear npm cache: \`npm cache clean --force\`
3. Use \`npm install\` with \`--legacy-peer-deps\` if needed
4. Check disk space: \`df -h\`
5. Run \`npm audit fix\` to resolve dependency issues

## Uninstall

### Plugin Marketplace

\`\`\`bash
claude plugin remove gm@gm-cc
\`\`\`

### Project-Specific

\`\`\`bash
# Remove from project
npm uninstall ${repoName}

# Remove configuration
rm -rf .claude/
\`\`\`

## Installation Comparison

| Method | Setup Time | Scope | Updates | Best For |
|--------|-----------|-------|---------|----------|
| **Marketplace** | 2 minutes | User-wide | One-click | Most users, all projects |
| **Project Installation** | 5 minutes | Per-project | \`npm update\` | Custom configurations |
| **File Installation** | 10 minutes | Per-project | Manual | Advanced users, offline setup |

## Contributing

Issues and pull requests welcome: [GitHub Issues](https://github.com/AnEntrypoint/${repoName}/issues)

## License

MIT - See LICENSE file for details
`;
  }
});

const gc = factory('gc', 'Gemini CLI', 'gemini-extension.json', 'GEMINI.md', {
  formatConfigJson(config) {
    return JSON.stringify({ ...config, contextFileName: this.contextFile }, null, 2);
  },
  generatePackageJson(pluginSpec, extraFields = {}) {
    return JSON.stringify({
      name: 'glootie-gc',
      version: pluginSpec.version,
      description: pluginSpec.description,
      author: pluginSpec.author,
      license: pluginSpec.license,
      repository: { type: 'git', url: 'https://github.com/AnEntrypoint/glootie-gc.git' },
      homepage: 'https://github.com/AnEntrypoint/glootie-gc#readme',
      bugs: { url: 'https://github.com/AnEntrypoint/glootie-gc/issues' },
      engines: pluginSpec.engines,
      publishConfig: pluginSpec.publishConfig,
      files: ['agents/', 'hooks/', '.github/', 'README.md', 'GEMINI.md', '.mcp.json', 'gemini-extension.json', 'cli.js'],
      ...extraFields
    }, null, 2);
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
    return `# ${spec.name} for Gemini CLI\n\n## Installation\n\n**Windows and Unix:**\n\`\`\`bash\ngit clone https://github.com/AnEntrypoint/glootie-gc ~/.gemini/extensions/${spec.name}\n\`\`\`\n\n**Windows PowerShell:**\n\`\`\`powershell\ngit clone https://github.com/AnEntrypoint/glootie-gc \"\\$env:APPDATA\\gemini\\extensions\\${spec.name}\"\n\`\`\`\n\n## Automatic Path Resolution\n\nHooks automatically use \`\${extensionPath}\` for path resolution. No manual environment variable setup required. The extension is fully portable.\n\n## Features\n\n- MCP tools for code execution and search\n- State machine agent policy (gm)\n- Stop hook verification loop\n- Git enforcement on session end\n- AST analysis via thorns at session start\n\nThe extension activates automatically on session start.\n`;
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
  generatePackageJson(pluginSpec, extraFields = {}) {
    return JSON.stringify({
      name: 'glootie-codex',
      version: pluginSpec.version,
      description: pluginSpec.description,
      author: pluginSpec.author,
      license: pluginSpec.license,
      main: 'plugin.json',
      bin: { 'glootie-codex': './cli.js' },
      repository: { type: 'git', url: 'https://github.com/AnEntrypoint/glootie-codex.git' },
      homepage: 'https://github.com/AnEntrypoint/glootie-codex#readme',
      bugs: { url: 'https://github.com/AnEntrypoint/glootie-codex/issues' },
      engines: pluginSpec.engines,
      publishConfig: pluginSpec.publishConfig,
      files: ['hooks/', 'agents/', '.github/', 'README.md', 'CLAUDE.md', '.mcp.json', 'plugin.json', 'pre-tool-use-hook.js', 'session-start-hook.js', 'prompt-submit-hook.js', 'stop-hook.js', 'stop-hook-git.js'],
      keywords: ['codex', 'claude-code', 'wfgy', 'mcp', 'automation', 'glootie'],
      ...extraFields
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
    return `# ${spec.name} for Codex\n\n## Installation\n\n**Windows and Unix:**\n\`\`\`bash\ngit clone https://github.com/AnEntrypoint/glootie-codex ~/.codex/plugins/${spec.name}\n\`\`\`\n\n**Windows PowerShell:**\n\`\`\`powershell\ngit clone https://github.com/AnEntrypoint/glootie-codex \"\\$env:APPDATA\\codex\\plugins\\${spec.name}\"\n\`\`\`\n\n## Environment\n\nSet CODEX_PLUGIN_ROOT to your plugin directory in your shell profile.\n\n## Features\n\n- MCP tools for code execution and search\n- State machine agent policy (gm)\n- Stop hook verification loop\n- Git enforcement on session end\n- AST analysis via thorns at session start\n\nThe plugin activates automatically on session start.\n`;
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
    "      const status = await $" + BT + "git status --porcelain" + BT + ".timeout(2000).nothrow();",
    "      if (status.exitCode === 0 && status.stdout.trim().length > 0)",
    "        blockReasons.push('Git: Uncommitted changes exist');",
    "    } catch (e) {}",
    "    try {",
    "      const ahead = await $" + BT + "git rev-list --count @{u}..HEAD" + BT + ".timeout(2000).nothrow();",
    "      if (ahead.exitCode === 0 && parseInt(ahead.stdout.trim()) > 0)",
    "        blockReasons.push('Git: ' + ahead.stdout.trim() + ' commit(s) not pushed');",
    "    } catch (e) {}",
    "    try {",
    "      const behind = await $" + BT + "git rev-list --count HEAD..@{u}" + BT + ".timeout(2000).nothrow();",
    "      if (behind.exitCode === 0 && parseInt(behind.stdout.trim()) > 0)",
    "        blockReasons.push('Git: ' + behind.stdout.trim() + ' upstream change(s) not pulled');",
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
      name: 'glootie-oc',
      version: pluginSpec.version,
      description: pluginSpec.description,
      author: pluginSpec.author,
      license: pluginSpec.license,
      type: 'module',
      main: 'glootie.mjs',
      keywords: ['opencode', 'opencode-plugin', 'mcp', 'automation', 'glootie'],
      repository: { type: 'git', url: 'https://github.com/AnEntrypoint/glootie-oc.git' },
      homepage: 'https://github.com/AnEntrypoint/glootie-oc#readme',
      bugs: { url: 'https://github.com/AnEntrypoint/glootie-oc/issues' },
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
    return `# ${spec.name} for OpenCode\n\n## Installation\n\n### Global (recommended)\n\n**Windows and Unix:**\n\`\`\`bash\ngit clone https://github.com/AnEntrypoint/glootie-oc ~/.config/opencode/plugin && cd ~/.config/opencode/plugin && bun install\n\`\`\`\n\n**Windows PowerShell:**\n\`\`\`powershell\ngit clone https://github.com/AnEntrypoint/glootie-oc \"\\$env:APPDATA\\opencode\\plugin\" && cd \"\\$env:APPDATA\\opencode\\plugin\" && bun install\n\`\`\`\n\n### Project-level\n\n**Windows and Unix:**\n\`\`\`bash\ngit clone https://github.com/AnEntrypoint/glootie-oc .opencode/plugins && cd .opencode/plugins && bun install\n\`\`\`\n\n## Features\n\n- MCP tools for code execution and search\n- State machine agent policy (gm)\n- Git enforcement on session idle\n- AST analysis via thorns at session start\n\nThe plugin activates automatically on session start.\n`;
  }
});

function kiloPluginSource() {
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
    "      const status = await $" + BT + "git status --porcelain" + BT + ".timeout(2000).nothrow();",
    "      if (status.exitCode === 0 && status.stdout.trim().length > 0)",
    "        blockReasons.push('Git: Uncommitted changes exist');",
    "    } catch (e) {}",
    "    try {",
    "      const ahead = await $" + BT + "git rev-list --count @{u}..HEAD" + BT + ".timeout(2000).nothrow();",
    "      if (ahead.exitCode === 0 && parseInt(ahead.stdout.trim()) > 0)",
    "        blockReasons.push('Git: ' + ahead.stdout.trim() + ' commit(s) not pushed');",
    "    } catch (e) {}",
    "    try {",
    "      const behind = await $" + BT + "git rev-list --count HEAD..@{u}" + BT + ".timeout(2000).nothrow();",
    "      if (behind.exitCode === 0 && parseInt(behind.stdout.trim()) > 0)",
    "        blockReasons.push('Git: ' + behind.stdout.trim() + ' upstream change(s) not pulled');",
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

const kilo = factory('kilo', 'Kilo CLI', 'kilocode.json', 'KILO.md', {
  getPackageJsonFields() {
    return {
      type: 'module',
      main: 'glootie.mjs',
      files: ['agents/', 'glootie.mjs', 'index.js', 'kilocode.json', '.github/', '.mcp.json', 'README.md'],
      keywords: ['kilo', 'kilo-cli', 'mcp', 'automation', 'glootie'],
      dependencies: { 'mcp-thorns': '^4.1.0' }
    };
  },
  generatePackageJson(pluginSpec, extraFields = {}) {
    return JSON.stringify({
      name: 'glootie-kilo',
      version: pluginSpec.version,
      description: pluginSpec.description,
      author: pluginSpec.author,
      license: pluginSpec.license,
      type: 'module',
      main: 'glootie.mjs',
      keywords: ['kilo', 'kilo-cli', 'mcp', 'automation', 'glootie'],
      repository: { type: 'git', url: 'https://github.com/AnEntrypoint/glootie-kilo.git' },
      homepage: 'https://github.com/AnEntrypoint/glootie-kilo#readme',
      bugs: { url: 'https://github.com/AnEntrypoint/glootie-kilo/issues' },
      engines: pluginSpec.engines,
      publishConfig: pluginSpec.publishConfig,
      dependencies: { 'mcp-thorns': '^4.1.0' },
      ...extraFields
    }, null, 2);
  },
  formatConfigJson(config, pluginSpec) {
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
      $schema: 'https://kilo.ai/config.json',
      default_agent: 'gm',
      mcp: mcpServers,
      plugin: ['glootie-kilo']
    }, null, 2);
  },
  getAdditionalFiles(pluginSpec) {
    return {
      'index.js': `export { GlootiePlugin } from './glootie.mjs';\n`,
      'glootie.mjs': kiloPluginSource(),
    };
  },
  generateReadme(spec) {
    return `# ${spec.name} for Kilo CLI

## Installation

### Step 1: Clone the Plugin

**Windows and Unix:**
\`\`\`bash
git clone https://github.com/AnEntrypoint/glootie-kilo ~/.config/kilo/plugin && cd ~/.config/kilo/plugin && bun install
\`\`\`

**Windows PowerShell:**
\`\`\`powershell
git clone https://github.com/AnEntrypoint/glootie-kilo "\\\$env:APPDATA\\kilo\\plugin" && cd "\\\$env:APPDATA\\kilo\\plugin" && bun install
\`\`\`

### Step 2: Configure MCP Servers

Kilo uses the OpenCode configuration format. Create or update \`~/.config/kilo/opencode.json\`:

\`\`\`json
{
  "\\\$schema": "https://opencode.ai/config.json",
  "mcp": {
    "dev": {
      "type": "local",
      "command": ["bunx", "mcp-glootie@latest"],
      "timeout": 360000,
      "enabled": true
    },
    "code-search": {
      "type": "local",
      "command": ["bunx", "codebasesearch@latest"],
      "timeout": 360000,
      "enabled": true
    }
  }
}
\`\`\`

### Step 3: Update Kilo Configuration

Update \`~/.config/kilo/kilocode.json\` to reference the plugin:

\`\`\`json
{
  "\\\$schema": "https://kilo.ai/config.json",
  "default_agent": "gm",
  "plugin": ["/home/user/.config/kilo/plugin"]
}
\`\`\`

Replace \`/home/user\` with your actual home directory path.

### Step 4: Verify Installation

Start Kilo and verify the tools appear:
\`\`\`bash
kilo
\`\`\`

Check MCP tools are connected:
\`\`\`bash
kilo mcp list
\`\`\`

You should see \`dev\` and \`code-search\` marked as connected.

## Features

- **MCP tools** - Code execution (\`dev\`) and semantic search (\`code-search\`)
- **State machine agent** - Complete \`gm\` behavioral rule system
- **Git enforcement** - Blocks uncommitted changes and unpushed commits on session idle
- **AST analysis** - Automatic codebase analysis via mcp-thorns on session start
- **.prd enforcement** - Blocks exit if work items remain in .prd file

## Troubleshooting

**MCP tools not appearing:**
- Verify \`~/.config/kilo/opencode.json\` exists with correct MCP server definitions
- Check that \`plugin\` path in \`kilocode.json\` points to the correct directory
- Run \`kilo mcp list\` to verify servers are connected
- Restart Kilo CLI completely

**Plugin not loading:**
- Verify plugin path in \`kilocode.json\` is absolute (e.g., \`/home/user/.config/kilo/plugin\`, not relative)
- Check \`index.js\` and \`gloutie.mjs\` exist in the plugin directory
- Run \`bun install\` in the plugin directory to ensure dependencies are installed

The plugin activates automatically on session start once MCP servers are configured.
`;
  }
});

module.exports = { cc, gc, codex, oc, kilo };
