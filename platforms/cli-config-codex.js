module.exports = {
  name: 'codex',
  label: 'Codex',
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
    pluginRoot: 'CODEX_PLUGIN_ROOT',
    projectDir: 'CODEX_PROJECT_DIR'
  },
  formatConfigJson(config) {
    return JSON.stringify({
      ...config,
      author: {
        name: config.author,
        url: 'https://github.com/AnEntrypoint'
      },
      hooks: './hooks/hooks.json'
    }, null, 2);
  },
  getPackageJsonMain() {
    return 'plugin.json';
  },
  getPackageJsonFields() {
    return {
      main: 'plugin.json',
      bin: { 'glootie-codex': './cli.js' },
      files: [
        'hooks/',
        'agents/',
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
      keywords: [
        'codex',
        'claude-code',
        'wfgy',
        'mcp',
        'automation',
        'glootie'
      ]
    };
  }
};
