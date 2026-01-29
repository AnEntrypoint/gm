module.exports = {
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
    return '.claude-plugin/plugin.json';
  },
  getPackageJsonFields() {
    return {
      main: '.claude-plugin/plugin.json',
      bin: { 'glootie-cc': './cli.js' },
      files: [
        '.claude-plugin/',
        'hooks/',
        'README.md',
        'CLAUDE.md',
        '.mcp.json',
        'plugin.json',
        'prompt-submit-hook.js',
        'stop-hook.js'
      ],
      keywords: [
        'claude-code',
        'claude-plugin',
        'wfgy',
        'mcp',
        'automation',
        'glootie'
      ],
      peerDependencies: { '@anthropic-ai/claude-code': '*' }
    };
  },
  getAdditionalFiles() {
    return {
      '.claude-plugin/marketplace.json': JSON.stringify({
        name: arguments[0].name+'-cc',
        "owner": {
          "name": "AnEntrypoint",
          "email": "almagestfraternite@gmail.com"
        },
        version: arguments[0].version,
        description: arguments[0].description,
        "plugins": [ 
          {
            "name": "gm",
            "source": "./"
          }
        ]

      }, null, 2)
      
    };
  },
  generateReadme(spec) {
    const repoName = `${spec.name}-cc`;
    return `# ${repoName} for Claude Code

## Installation

\`\`\`bash
claude plugin marketplace add AnEntrypoint/${repoName}
claude plugin install -s user ${repoName}@${repoName}
\`\`\`

## Update

\`\`\`bash
claude plugin marketplace update ${repoName}
claude plugin update ${repoName}@${repoName}
\`\`\`

## Features

- MCP tools for code execution and search
- State machine agent policy (gm)
- Stop hook verification loop
- Git enforcement on session end
- AST analysis via thorns at session start

The plugin activates automatically on session start.
`;
  }
};




