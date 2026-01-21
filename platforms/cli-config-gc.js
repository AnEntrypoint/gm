module.exports = {
  name: 'gc',
  label: 'Gemini CLI',
  configFile: 'gemini-extension.json',
  contextFile: 'GEMINI.md',
  hookEventNames: {
    sessionStart: 'SessionStart',
    preTool: 'BeforeTool',
    promptSubmit: 'BeforeAgent',
    stop: 'SessionEnd',
    stopGit: 'SessionEnd'
  },
  hookOutputFormat: 'bare',
  tools: {
    bash: 'run_shell_command',
    write: 'write_file',
    glob: 'glob',
    grep: 'search_file_content',
    search: 'search'
  },
  env: {
    pluginRoot: 'GEMINI_PROJECT_DIR',
    projectDir: 'GEMINI_PROJECT_DIR'
  },
  formatConfigJson(config) {
    return JSON.stringify({
      ...config,
      contextFileName: this.contextFile
    }, null, 2);
  },
  getPackageJsonFields() {
    return {
      files: [
        'agents/',
        'hooks/',
        'README.md',
        'GEMINI.md',
        '.mcp.json',
        'gemini-extension.json',
        'cli.js',
        'pre-tool-use-hook.js',
        'session-start-hook.js',
        'prompt-submit-hook.js',
        'stop-hook.js',
        'stop-hook-git.js'
      ]
    };
  },
  getAdditionalFiles(pluginSpec, readFile) {
    return {
      'cli.js': `#!/usr/bin/env node

const show = () => {
  console.log('glootie-gc: Advanced Gemini CLI extension');
  console.log('Version: 2.0.9');
  console.log('');
  console.log('Usage: glootie-gc [command]');
  console.log('Commands:');
  console.log('  help, --help, -h');
  console.log('  version, --version');
};

const args = process.argv.slice(2);
if (!args.length || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
  show();
} else if (args[0] === 'version' || args[0] === '--version') {
  console.log('2.0.9');
}
`
    };
  }
};
