const PlatformAdapter = require('../platforms/base');
const path = require('path');

class CLIAdapter extends PlatformAdapter {
  constructor(config = {}) {
    super(config);
    this.cliConfig = {
      hookEventNames: config.hookEventNames || {},
      hookOutputFormat: config.hookOutputFormat || 'wrapped',
      tools: config.tools || {},
      env: config.env || {}
    };
  }

  createFileStructure(pluginSpec, sourceDir) {
    const readFile = (paths) => this.readSourceFile(sourceDir, paths);
    return {
      [this.configFile]: this.generateConfigJson(pluginSpec),
      '.mcp.json': this.generateMcpJson(pluginSpec),
      [this.contextFile]: this.generateContextFile(),
      'README.md': this.generateReadme(),
      'package.json': this.generatePackageJson(pluginSpec, this.getPackageJsonFields()),
      'hooks/hooks.json': this.generateHooksJson(pluginSpec),
      'agents/gm.md': readFile(this.getAgentSourcePaths('gm')),
      'agents/codesearch.md': readFile(this.getAgentSourcePaths('codesearch')),
      'agents/websearch.md': readFile(this.getAgentSourcePaths('websearch')),
      'pre-tool-use-hook.js': readFile(this.getHookSourcePaths('pre-tool-use')),
      'session-start-hook.js': readFile(this.getHookSourcePaths('session-start')),
      'prompt-submit-hook.js': readFile(this.getHookSourcePaths('prompt-submit')),
      'stop-hook.js': readFile(this.getHookSourcePaths('stop')),
      'stop-hook-git.js': readFile(this.getHookSourcePaths('stop-git')),
      ...this.getAdditionalFiles(pluginSpec, readFile)
    };
  }

  getPackageJsonFields() {
    return {
      main: this.getPackageJsonMain(),
      files: this.getPackageJsonFiles(),
      ...(this.getPeerDependencies && { peerDependencies: this.getPeerDependencies() })
    };
  }

  getPackageJsonMain() {
    return 'cli.js';
  }

  getPackageJsonFiles() {
    return [
      'agents/',
      'hooks/',
      'README.md',
      this.contextFile,
      '.mcp.json',
      this.configFile,
      'cli.js',
      'pre-tool-use-hook.js',
      'session-start-hook.js',
      'prompt-submit-hook.js',
      'stop-hook.js',
      'stop-hook-git.js'
    ];
  }

  getAgentSourcePaths(agent) {
    return [`glootie-${this.name}/agents/${agent}.md`, `glootie-cc/agents/${agent}.md`];
  }

  getHookSourcePaths(hook) {
    const hookMap = {
      'pre-tool-use': ['hooks/pre-tool.js'],
      'session-start': ['hooks/session-start.js'],
      'prompt-submit': ['hooks/prompt-submit.js'],
      'stop': ['hooks/stop.js'],
      'stop-git': ['hooks/stop-git.js']
    };
    return hookMap[hook] || [`hooks/${hook}.js`];
  }

  getAdditionalFiles(pluginSpec, readFile) {
    return {};
  }

  generateConfigJson(pluginSpec) {
    const config = {
      name: pluginSpec.name,
      version: pluginSpec.version,
      description: pluginSpec.description,
      author: pluginSpec.author,
      homepage: pluginSpec.homepage,
      mcpServers: pluginSpec.mcp
    };
    return this.formatConfigJson(config, pluginSpec);
  }

  formatConfigJson(config, pluginSpec) {
    return JSON.stringify(config, null, 2);
  }

  generateHooksJson(pluginSpec) {
    const hooks = this.buildHooksMap(pluginSpec);
    return JSON.stringify({
      description: `Hooks for glootie ${this.label} extension`,
      hooks
    }, null, 2);
  }

  buildHooksMap(pluginSpec) {
    const hooks = {};
    const eventMap = this.cliConfig.hookEventNames;

    hooks[eventMap.preTool] = this.createHookConfig(
      'pre-tool-use-hook.js',
      3600
    );

    hooks[eventMap.sessionStart] = this.createHookConfig(
      'session-start-hook.js',
      10000
    );

    hooks[eventMap.promptSubmit] = this.createHookConfig(
      'prompt-submit-hook.js',
      3600
    );

    hooks[eventMap.stop] = [
      {
        matcher: '*',
        hooks: [
          this.createCommand('stop-hook.js', 300000),
          this.createCommand('stop-hook-git.js', 60000)
        ]
      }
    ];

    return hooks;
  }

  createHookConfig(hookFile, timeout) {
    return [{
      matcher: '*',
      hooks: [this.createCommand(hookFile, timeout)]
    }];
  }

  createCommand(hookFile, timeout) {
    return {
      type: 'command',
      command: this.getHookCommand(hookFile),
      timeout
    };
  }

  getHookCommand(hookFile) {
    const envVar = this.cliConfig.env.pluginRoot;
    return `node \${${envVar}}/${hookFile}`;
  }

  generateContextFile() {
    return `# ${path.basename(this.contextFile, '.md')}

## Technical Notes

Hook response format: \`{"decision":"allow|block","reason":"text"}\` with exit code 0.

Tool names for this platform: ${this.getToolNamesDescription()}

When filtering transcript history by sessionId, use: \`if (sessionId && entry.sessionId === sessionId)\`

Verification file \`.glootie-stop-verified\` is auto-added to .gitignore and tracks session completion state.
`;
  }

  getToolNamesDescription() {
    const toolMap = this.cliConfig.tools;
    const names = Object.entries(toolMap)
      .map(([generic, platform]) => `\`${generic}\` → \`${platform}\``)
      .join(', ');
    return names;
  }

  generateReadme() {
    return `# gm Extension for ${this.label}

Copy the directory to your ${this.label} extensions path and restart.

The extension activates automatically on session start.
`;
  }
}

module.exports = CLIAdapter;
