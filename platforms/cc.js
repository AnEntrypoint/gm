const CLIAdapter = require('../lib/cli-adapter');

class ClaudeCodeAdapter extends CLIAdapter {
  constructor() {
    super({
      name: 'cc',
      label: 'Claude Code',
      configFile: 'plugin.json',
      contextFile: 'CLAUDE.md',
      hookEventNames: {
        sessionStart: 'SessionStart',
        preTool: 'PreToolUse',
        promptSubmit: 'UserPromptSubmit',
        stop: 'Stop',
        stopGit: 'Stop'
      },
      hookOutputFormat: 'wrapped',
      tools: {
        bash: 'Bash',
        write: 'Write',
        glob: 'Glob',
        grep: 'Grep',
        search: 'Search'
      },
      env: {
        pluginRoot: 'CLAUDE_PLUGIN_ROOT',
        projectDir: 'CLAUDE_PROJECT_DIR'
      }
    });
  }

  formatConfigJson(config, pluginSpec) {
    return JSON.stringify({
      ...config,
      author: {
        name: config.author,
        url: 'https://github.com/AnEntrypoint'
      },
      hooks: './hooks/hooks.json'
    }, null, 2);
  }

  getPackageJsonMain() {
    return '.claude-plugin/plugin.json';
  }

  getPackageJsonFields() {
    return {
      main: this.getPackageJsonMain(),
      bin: { 'glootie-cc': './cli.js' },
      files: this.getPackageJsonFiles(),
      keywords: this.getKeywords(),
      peerDependencies: { '@anthropic-ai/claude-code': '*' }
    };
  }

  getKeywords() {
    return [
      'claude-code',
      'claude-plugin',
      'wfgy',
      'mcp',
      'automation',
      'glootie'
    ];
  }

  getPackageJsonFiles() {
    return [
      '.claude-plugin/',
      'hooks/',
      'README.md',
      'CLAUDE.md',
      '.mcp.json',
      'plugin.json',
      'prompt-submit-hook.js',
      'stop-hook.js'
    ];
  }

  getAdditionalFiles(pluginSpec, readFile) {
    return {
      '.claude-plugin/marketplace.json': this.generateMarketplaceJson(pluginSpec)
    };
  }

  generateMarketplaceJson(pluginSpec) {
    return JSON.stringify({
      name: pluginSpec.name,
      version: pluginSpec.version,
      description: pluginSpec.description
    }, null, 2);
  }

  generateReadme() {
    return `# gm Plugin for Claude Code

Install via Claude Code plugin marketplace: \`claude plugin add AnEntrypoint/glootie-cc\`

The plugin activates automatically on session start.
`;
  }
}

module.exports = ClaudeCodeAdapter;
